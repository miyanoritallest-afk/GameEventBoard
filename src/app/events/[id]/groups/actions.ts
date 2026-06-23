"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { findEventById } from "@/lib/repositories/events";
import { findTeamById } from "@/lib/repositories/teams";
import {
  insertGroup,
  findGroupById,
  renameGroup as renameGroupRepo,
  deleteGroup as deleteGroupRepo,
  assignTeamToGroup,
  unassignTeamFromGroup,
} from "@/lib/repositories/groups";
import { groupNameSchema, assignTeamSchema } from "./schema";

/**
 * 予選ブロック分け（本戦 PR-1）の Server Action（Controller。薄く保つ）。
 * 実装ガイドラインに従う:
 * - 認証バイパス対策: 冒頭で必ずログイン確認。
 * - IDOR 対策: 対象イベント/ブロック/チームの主催者本人かをアプリ層で確認＋ RLS（0013）が最終防衛。
 *   存在しない/他人の行は同一の「権限なし」応答にして列挙を防ぐ。
 * - マスアサインメント対策: Zod で許可フィールドのみ受理。event_id はサーバー固定。
 * - 想定内の失敗は throw せず戻り値で返す。想定外は throw（error.tsx）。
 *
 * 操作（作成・改名・削除・振り分け）は主催者のみ。閲覧の開放は RLS（0013）側。
 */

export type GroupActionState = { error?: string };
export type CreateGroupState = { error?: string; groupId?: string };

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

/**
 * ブロック作成。イベント主催者のみ。名前を Zod 検証し、event_id はサーバー固定。
 * 成功時は作成ブロックの id を返す（クライアントが即座に楽観追加できるようにする）。
 */
export async function createGroup(
  eventId: string,
  name: string,
): Promise<CreateGroupState> {
  const userId = await currentUserId();
  if (!userId) return { error: "ログインが必要です。" };

  const event = await requireOrganizer(eventId, userId);
  if (!event) return { error: "このイベントを操作する権限がありません。" };

  const parsed = groupNameSchema.safeParse({ name });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "入力を確認してください。" };
  }

  const result = await insertGroup({ eventId, name: parsed.data.name });
  if (!result.ok) {
    return { error: "同じ名前のブロックがすでに存在します。" };
  }

  revalidatePath(`/events/${eventId}/groups`);
  return { groupId: result.id };
}

/** ブロック改名。ブロックの所属イベント主催者のみ。 */
export async function renameGroup(
  groupId: string,
  name: string,
): Promise<GroupActionState> {
  const userId = await currentUserId();
  if (!userId) return { error: "ログインが必要です。" };

  const group = await findGroupById(groupId);
  if (!group) return { error: "このブロックを操作する権限がありません。" };

  const event = await requireOrganizer(group.event_id, userId);
  if (!event) return { error: "このブロックを操作する権限がありません。" };

  const parsed = groupNameSchema.safeParse({ name });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "入力を確認してください。" };
  }

  const result = await renameGroupRepo({ groupId, name: parsed.data.name });
  if (!result.ok) {
    if (result.duplicate) {
      return { error: "同じ名前のブロックがすでに存在します。" };
    }
    return { error: "更新に失敗しました。画面を更新してからお試しください。" };
  }

  revalidatePath(`/events/${event.id}/groups`);
  return {};
}

/** ブロック削除。所属イベント主催者のみ。中のチームは FK cascade でプールへ戻る。 */
export async function deleteGroup(groupId: string): Promise<GroupActionState> {
  const userId = await currentUserId();
  if (!userId) return { error: "ログインが必要です。" };

  const group = await findGroupById(groupId);
  if (!group) return { error: "このブロックを操作する権限がありません。" };

  const event = await requireOrganizer(group.event_id, userId);
  if (!event) return { error: "このブロックを操作する権限がありません。" };

  const deleted = await deleteGroupRepo(groupId);
  if (!deleted) {
    return { error: "削除に失敗しました。画面を更新してからお試しください。" };
  }

  revalidatePath(`/events/${event.id}/groups`);
  return {};
}

/**
 * チームをブロックへ割当（移動）。
 *
 * 防御:
 * 1. ログイン確認。
 * 2. 入力検証（groupId / teamId）。
 * 3. 2テーブル跨ぎの所有権確認: ブロック・チームがともに同じ自分のイベントに属すること。
 * 4. approved のチームのみ割当可（pending/rejected は本戦対象外）。
 * 5. 移動モデル: 同イベントの他ブロックから外してから割当（1チーム1ブロック）。
 */
export async function assignTeam(input: {
  groupId: string;
  teamId: string;
}): Promise<GroupActionState> {
  const userId = await currentUserId();
  if (!userId) return { error: "ログインが必要です。" };

  const parsed = assignTeamSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "入力を確認してください。" };
  }
  const { groupId, teamId } = parsed.data;

  const group = await findGroupById(groupId);
  if (!group) return { error: "このブロックを操作する権限がありません。" };

  const event = await requireOrganizer(group.event_id, userId);
  if (!event) return { error: "このブロックを操作する権限がありません。" };

  // チームが同一イベントの approved であること。
  const team = await findTeamById(teamId);
  if (!team || team.event_id !== group.event_id) {
    return { error: "このチームを操作する権限がありません。" };
  }
  // findTeamById は status を返さないので、status を別途確認する。
  const supabase = await createClient();
  const { data: teamStatus, error: tsErr } = await supabase
    .from("teams")
    .select("status")
    .eq("id", teamId)
    .maybeSingle();
  if (tsErr) throw tsErr;
  if (!teamStatus || teamStatus.status !== "approved") {
    return { error: "参加確定（承認済み）のチームのみブロックに割り当てられます。" };
  }

  const result = await assignTeamToGroup({
    groupId,
    teamId,
    eventId: group.event_id,
  });
  if (!result.ok) {
    return { error: "割り当てに失敗しました。画面を更新してからお試しください。" };
  }

  revalidatePath(`/events/${group.event_id}/groups`);
  return {};
}

/**
 * チームのブロック割当を解除（プールへ戻す）。team の所属イベント主催者のみ。
 */
export async function unassignTeam(teamId: string): Promise<GroupActionState> {
  const userId = await currentUserId();
  if (!userId) return { error: "ログインが必要です。" };

  const team = await findTeamById(teamId);
  if (!team) return { error: "このチームを操作する権限がありません。" };

  const event = await requireOrganizer(team.event_id, userId);
  if (!event) return { error: "このチームを操作する権限がありません。" };

  const result = await unassignTeamFromGroup({
    teamId,
    eventId: team.event_id,
  });
  if (!result.ok) {
    return { error: "解除に失敗しました。画面を更新してからお試しください。" };
  }

  revalidatePath(`/events/${team.event_id}/groups`);
  return {};
}
