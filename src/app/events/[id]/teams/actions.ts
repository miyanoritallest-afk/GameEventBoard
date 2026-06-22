"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { findEventById } from "@/lib/repositories/events";
import {
  insertTeam,
  findTeamById,
  renameTeam as renameTeamRepo,
  deleteTeam as deleteTeamRepo,
  insertTeamMember,
  moveTeamMember,
  deleteTeamMember,
  updateMember as updateMemberRepo,
  swapMemberPositions,
  findRegistrationEventOwner,
  findMemberWithEventOwner,
} from "@/lib/repositories/teams";
import {
  teamNameSchema,
  assignMemberSchema,
  updateMemberSchema,
  swapMembersSchema,
} from "./schema";

/**
 * チーム編成（PR-1）の Server Action（Controller。薄く保つ）。
 * 実装ガイドラインに従う:
 * - 認証バイパス対策: 冒頭で必ずログイン確認。
 * - IDOR 対策: 対象イベント/チームの主催者本人かをアプリ層で確認＋ RLS（0010）が最終防衛。
 *   存在しない/他人の行は同一の「権限なし」応答にして列挙を防ぐ。
 * - マスアサインメント対策: Zod で許可フィールドのみ受理。event_id / status はサーバー固定。
 * - 想定内の失敗は throw せず戻り値で返す。想定外は throw（error.tsx）。
 *
 * organizer 振り分けのみ（self 応募は PR-3）。
 */

export type TeamActionState = { error?: string };

/** ログイン中ユーザーを返す。未ログインなら null。 */
async function currentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** 指定イベントの主催者本人か確認する。OK なら event を返す。 */
async function requireOrganizer(eventId: string, userId: string) {
  const event = await findEventById(eventId);
  if (!event || event.organizer_id !== userId) return null;
  return event;
}

/** createTeam だけは、楽観追加用に作成チームの id を返す。 */
export type CreateTeamState = { error?: string; teamId?: string };

/**
 * チーム作成。イベント主催者のみ。名前を Zod 検証し、event_id はサーバー固定。
 * 成功時は作成チームの id を返す（クライアントが即座に楽観追加できるようにする）。
 */
export async function createTeam(
  eventId: string,
  name: string,
): Promise<CreateTeamState> {
  const userId = await currentUserId();
  if (!userId) return { error: "ログインが必要です。" };

  const event = await requireOrganizer(eventId, userId);
  if (!event) return { error: "このイベントを操作する権限がありません。" };

  const parsed = teamNameSchema.safeParse({ name });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "入力を確認してください。" };
  }

  const result = await insertTeam({ eventId, name: parsed.data.name });
  if (!result.ok) {
    return { error: "同じ名前のチームがすでに存在します。" };
  }

  revalidatePath(`/events/${eventId}/teams`);
  return { teamId: result.id };
}

/**
 * チーム改名。チームの所属イベント主催者のみ。楽観ロック（version）。
 */
export async function renameTeam(
  teamId: string,
  name: string,
): Promise<TeamActionState> {
  const userId = await currentUserId();
  if (!userId) return { error: "ログインが必要です。" };

  const team = await findTeamById(teamId);
  if (!team) return { error: "このチームを操作する権限がありません。" };

  const event = await requireOrganizer(team.event_id, userId);
  if (!event) return { error: "このチームを操作する権限がありません。" };

  const parsed = teamNameSchema.safeParse({ name });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "入力を確認してください。" };
  }

  const result = await renameTeamRepo({
    teamId,
    name: parsed.data.name,
    expectedVersion: team.version,
  });
  if (!result.ok) {
    if (result.duplicate) {
      return { error: "同じ名前のチームがすでに存在します。" };
    }
    return {
      error: "更新に失敗しました。画面を更新してからもう一度お試しください。",
    };
  }

  revalidatePath(`/events/${event.id}/teams`);
  return {};
}

/**
 * チーム削除。所属イベント主催者のみ。メンバーは FK cascade で連動削除。
 */
export async function deleteTeam(teamId: string): Promise<TeamActionState> {
  const userId = await currentUserId();
  if (!userId) return { error: "ログインが必要です。" };

  const team = await findTeamById(teamId);
  if (!team) return { error: "このチームを操作する権限がありません。" };

  const event = await requireOrganizer(team.event_id, userId);
  if (!event) return { error: "このチームを操作する権限がありません。" };

  const deleted = await deleteTeamRepo(teamId);
  if (!deleted) {
    return { error: "削除に失敗しました。画面を更新してからお試しください。" };
  }

  revalidatePath(`/events/${event.id}/teams`);
  return {};
}

/**
 * メンバー割当/移動（D&D）。応募 → チーム。
 *
 * 防御:
 * 1. ログイン確認。
 * 2. 入力検証（registrationId / teamId / role＝許可フィールドのみ）。
 * 3. 2テーブル跨ぎの所有権確認: 応募・チームがともに同じ自分のイベントに属すること。
 *    存在しない/他人/別イベント混在は同一の権限なし応答。
 * 4. approved の応募のみ割当可（pending/rejected は編成対象外）。
 * 5. 未割当なら insert、割当済みなら別チームへ move（UNIQUE(registration_id) 前提）。
 */
export async function assignMember(input: {
  registrationId: string;
  teamId: string;
  role: string;
}): Promise<TeamActionState> {
  const userId = await currentUserId();
  if (!userId) return { error: "ログインが必要です。" };

  const parsed = assignMemberSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "入力を確認してください。" };
  }
  const { registrationId, teamId, role } = parsed.data;

  // 応募の所有イベントを確認。
  const reg = await findRegistrationEventOwner(registrationId);
  const regEvent = reg?.events as { id: string; organizer_id: string } | null;
  if (!reg || !regEvent || regEvent.organizer_id !== userId) {
    return { error: "この応募を操作する権限がありません。" };
  }

  // approved のみ編成対象。
  if (reg.status !== "approved") {
    return { error: "参加確定（承認済み）の応募のみチームに割り当てられます。" };
  }

  // 割当先チームの所有イベントを確認し、応募と同一イベントであること。
  const team = await findTeamById(teamId);
  if (!team || team.event_id !== reg.event_id) {
    return { error: "このチームを操作する権限がありません。" };
  }

  // 未割当なら insert、割当済みなら move（別チームへドラッグ）。
  const inserted = await insertTeamMember({ teamId, registrationId, role });
  if (!inserted.ok) {
    // 既に割当済み → 別チームへ移動。
    const moved = await moveTeamMember({ registrationId, toTeamId: teamId, role });
    if (!moved) {
      return {
        error: "割り当てに失敗しました。画面を更新してからお試しください。",
      };
    }
  }

  revalidatePath(`/events/${reg.event_id}/teams`);
  return {};
}

/**
 * メンバー解除（チームから外して未割当プールへ戻す）。registration 単位。
 * 所有権は応募の所属イベント主催者で確認。
 */
export async function unassignMember(
  registrationId: string,
): Promise<TeamActionState> {
  const userId = await currentUserId();
  if (!userId) return { error: "ログインが必要です。" };

  const reg = await findRegistrationEventOwner(registrationId);
  const regEvent = reg?.events as { id: string; organizer_id: string } | null;
  if (!reg || !regEvent || regEvent.organizer_id !== userId) {
    return { error: "この応募を操作する権限がありません。" };
  }

  const removed = await deleteTeamMember(registrationId);
  if (!removed) {
    return { error: "解除に失敗しました。画面を更新してからお試しください。" };
  }

  revalidatePath(`/events/${reg.event_id}/teams`);
  return {};
}

/**
 * メンバーの position（出場⇄リザーブ）/ role（担当ロール）を更新する。
 * 同一チーム内のゾーン移動・ロール行移動の両方を扱う。所属チームのイベント主催者のみ。
 * 防御: ログイン確認 → 入力検証 → 所有者確認（member 経由で organizer を確認）。
 */
export async function updateMember(input: {
  registrationId: string;
  position?: string;
  role?: string;
}): Promise<TeamActionState> {
  const userId = await currentUserId();
  if (!userId) return { error: "ログインが必要です。" };

  const parsed = updateMemberSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "入力を確認してください。" };
  }
  const { registrationId, position, role } = parsed.data;

  const member = await findMemberWithEventOwner(registrationId);
  const event = (member?.teams as { events: { organizer_id: string } } | null)
    ?.events;
  if (!member || !event || event.organizer_id !== userId) {
    return { error: "このメンバーを操作する権限がありません。" };
  }

  const updated = await updateMemberRepo({ registrationId, position, role });
  if (!updated) {
    return { error: "更新に失敗しました。画面を更新してからお試しください。" };
  }

  const eventId = (member.teams as { event_id: string }).event_id;
  revalidatePath(`/events/${eventId}/teams`);
  return {};
}

/**
 * 交代シミュレーションの「交代する」実行。out（レギュラー）と in（リザーブ）の
 * position を入れ替える。所属チームのイベント主催者のみ。
 *
 * 防御:
 * 1. ログイン確認。
 * 2. 入力検証（2つの uuid・別人であること）。
 * 3. 両メンバーを取得し、ともに同じ自分のイベント・同じチームに属することを確認
 *    （別チーム間の交代を防ぐ）。
 * 4. position の妥当性（out=regular / in=reserve）を確認してから入れ替え。
 */
export async function swapMembers(input: {
  outRegistrationId: string;
  inRegistrationId: string;
}): Promise<TeamActionState> {
  const userId = await currentUserId();
  if (!userId) return { error: "ログインが必要です。" };

  const parsed = swapMembersSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "入力を確認してください。" };
  }
  const { outRegistrationId, inRegistrationId } = parsed.data;

  const outMember = await findMemberWithEventOwner(outRegistrationId);
  const inMember = await findMemberWithEventOwner(inRegistrationId);
  const outTeam = outMember?.teams as
    | { id: string; event_id: string; events: { organizer_id: string } }
    | null;
  const inTeam = inMember?.teams as
    | { id: string; event_id: string; events: { organizer_id: string } }
    | null;

  // 両方存在し、同じ主催者・同じチームであること。
  if (
    !outMember ||
    !inMember ||
    !outTeam ||
    !inTeam ||
    outTeam.events.organizer_id !== userId ||
    inTeam.events.organizer_id !== userId ||
    outTeam.id !== inTeam.id
  ) {
    return { error: "このメンバーを交代する権限がありません。" };
  }

  // 区分の妥当性: out は出場、in はリザーブであること（取り違え防止）。
  if (outMember.position !== "regular" || inMember.position !== "reserve") {
    return { error: "交代の対象が正しくありません。画面を更新してお試しください。" };
  }

  const result = await swapMemberPositions({
    outRegistrationId,
    inRegistrationId,
  });
  if (!result.ok) {
    return { error: "交代に失敗しました。画面を更新してからお試しください。" };
  }

  revalidatePath(`/events/${outTeam.event_id}/teams`);
  return {};
}
