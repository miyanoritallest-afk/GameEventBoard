"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { findEventById } from "@/lib/repositories/events";
import {
  findGroupById,
  listGroupTeamIds,
} from "@/lib/repositories/groups";
import {
  listGroupMatches,
  findMatchById,
  deleteGroupMatches,
  insertGroupMatches,
  insertGroupMatch,
  deleteMatch as deleteMatchRepo,
} from "@/lib/repositories/matches";
import {
  roundRobinPairs,
  pairExists,
  type MatchPair,
} from "@/lib/services/round-robin";
import { generateMatchesSchema, addMatchSchema } from "./schema";

/**
 * 予選対戦カード（本戦 PR-2）の Server Action（Controller。薄く保つ）。
 * 実装ガイドラインに従う:
 * - 認証バイパス対策: 冒頭で必ずログイン確認。
 * - IDOR 対策: 対象イベント/ブロック/試合の主催者本人かをアプリ層で確認＋ RLS（0014）が最終防衛。
 * - マスアサインメント対策: Zod で許可フィールドのみ受理。event_id / phase はサーバー固定。
 * - 想定内の失敗は throw せず戻り値で返す。
 *
 * 総当たり生成ロジックは純粋関数（lib/services/round-robin.ts）に切り出してテスト済み。
 */

export type MatchActionState = { error?: string };

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

/** 指定ブロックの主催者本人か確認する。OK なら group を返す。 */
async function requireGroupOrganizer(groupId: string, userId: string) {
  const group = await findGroupById(groupId);
  if (!group) return null;
  const event = await requireOrganizer(group.event_id, userId);
  if (!event) return null;
  return group;
}

/**
 * 総当たり生成。指定ブロックの既存予選試合を全削除し、所属チームの全ペアを作り直す。
 * 結果保護は本戦-3 で追加（本 PR では全削除→作り直し＝壁打ち確定）。
 */
export async function generateMatches(input: {
  groupId: string;
}): Promise<MatchActionState> {
  const userId = await currentUserId();
  if (!userId) return { error: "ログインが必要です。" };

  const parsed = generateMatchesSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "入力を確認してください。" };
  }

  const group = await requireGroupOrganizer(parsed.data.groupId, userId);
  if (!group) return { error: "このブロックを操作する権限がありません。" };

  const teamIds = await listGroupTeamIds(group.id);
  const pairs = roundRobinPairs(teamIds);

  // 既存を全削除してから作り直す（同ブロックのみ）。
  await deleteGroupMatches({ eventId: group.event_id, groupId: group.id });
  await insertGroupMatches({
    eventId: group.event_id,
    groupId: group.id,
    pairs,
  });

  revalidatePath(`/events/${group.event_id}/matches`);
  return {};
}

/**
 * 試合の手動追加。指定ブロックに、同イベント・同ブロック所属の2チームで1試合を作る。
 *
 * 防御:
 * 1. ログイン確認。
 * 2. 入力検証（groupId / teamA / teamB＝別チーム）。
 * 3. ブロックの主催者本人確認。
 * 4. 両チームがそのブロックに所属していること（場外チームを入れない）。
 * 5. 同ブロックに同じペア（順不同）が既にないか＝アプリ層で重複チェック（壁打ち確定）。
 */
export async function addMatch(input: {
  groupId: string;
  teamAId: string;
  teamBId: string;
}): Promise<MatchActionState> {
  const userId = await currentUserId();
  if (!userId) return { error: "ログインが必要です。" };

  const parsed = addMatchSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "入力を確認してください。" };
  }
  const { groupId, teamAId, teamBId } = parsed.data;

  const group = await requireGroupOrganizer(groupId, userId);
  if (!group) return { error: "このブロックを操作する権限がありません。" };

  // 両チームがそのブロックに所属していること。
  const groupTeamIds = await listGroupTeamIds(group.id);
  if (!groupTeamIds.includes(teamAId) || !groupTeamIds.includes(teamBId)) {
    return { error: "このブロックに所属するチーム同士のみ対戦カードにできます。" };
  }

  // 同ブロックに同じペア（順不同）が既にないか＝アプリ層で重複チェック。
  const sameGroup = (await listGroupMatches(group.event_id)) ?? [];
  const samePairs: MatchPair[] = sameGroup
    .filter((m) => m.group_id === group.id && m.team_a_id && m.team_b_id)
    .map((m) => ({
      teamAId: m.team_a_id as string,
      teamBId: m.team_b_id as string,
    }));
  if (pairExists(samePairs, teamAId, teamBId)) {
    return { error: "同じ対戦カードがこのブロックに既に存在します。" };
  }

  const result = await insertGroupMatch({
    eventId: group.event_id,
    groupId: group.id,
    teamAId,
    teamBId,
  });
  if (!result.ok) {
    return { error: "対戦カードの追加に失敗しました。画面を更新してからお試しください。" };
  }

  revalidatePath(`/events/${group.event_id}/matches`);
  return {};
}

/** 試合の削除。試合の所属イベント主催者のみ。 */
export async function deleteMatch(matchId: string): Promise<MatchActionState> {
  const userId = await currentUserId();
  if (!userId) return { error: "ログインが必要です。" };

  const match = await findMatchById(matchId);
  if (!match) return { error: "この試合を操作する権限がありません。" };

  const event = await requireOrganizer(match.event_id, userId);
  if (!event) return { error: "この試合を操作する権限がありません。" };

  const deleted = await deleteMatchRepo(matchId);
  if (!deleted) {
    return { error: "削除に失敗しました。画面を更新してからお試しください。" };
  }

  revalidatePath(`/events/${match.event_id}/matches`);
  return {};
}
