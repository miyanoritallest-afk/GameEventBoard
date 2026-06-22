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
  findRegistrationEventOwner,
} from "@/lib/repositories/teams";
import { teamNameSchema, assignMemberSchema } from "./schema";

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
