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
  insertGroupMatches,
  insertGroupMatch,
  deleteMatch as deleteMatchRepo,
  listGroupMatchesWithResult,
  deleteMatchesByIds,
  findMatchForReport,
} from "@/lib/repositories/matches";
import {
  upsertMatchResult,
  deleteMatchResult,
} from "@/lib/repositories/match-results";
import {
  roundRobinPairs,
  pairExists,
  pairKey,
  type MatchPair,
} from "@/lib/services/round-robin";
import { decideWinner } from "@/lib/services/match-result";
import {
  generateMatchesSchema,
  addMatchSchema,
  reportResultSchema,
} from "./schema";

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
 * 総当たり生成（再生成・結果保護つき＝本戦-3a で更新）。
 * 指定ブロックについて:
 * - 結果が入っている試合は残す（誤って結果を消さない）。
 * - 結果のない既存試合は削除し、所属チームの全ペアのうち「まだ存在しないペア」だけ追加する。
 * これで再生成しても、入力済みの結果は保護される。
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

  // 予選デフォルト BO（生成時に全試合へ一括セット）。
  const event = await findEventById(group.event_id);
  const bestOf = event?.group_best_of ?? 3;

  const teamIds = await listGroupTeamIds(group.id);
  const allPairs = roundRobinPairs(teamIds);

  // 既存試合（結果有無付き）を取得し、結果なしだけ削除。結果ありのペアは温存。
  const existing = await listGroupMatchesWithResult({
    eventId: group.event_id,
    groupId: group.id,
  });
  const toDelete = existing.filter((m) => !m.hasResult).map((m) => m.id);
  await deleteMatchesByIds(toDelete);

  // 残った（=結果ありの）ペアのキー集合。これらは作り直さない。
  const keptPairKeys = new Set(
    existing
      .filter((m) => m.hasResult && m.teamAId && m.teamBId)
      .map((m) => pairKey(m.teamAId as string, m.teamBId as string)),
  );

  // 全ペアのうち、温存ペアに含まれないものだけ新規作成する。
  const pairsToCreate = allPairs.filter(
    (p) => !keptPairKeys.has(pairKey(p.teamAId, p.teamBId)),
  );
  await insertGroupMatches({
    eventId: group.event_id,
    groupId: group.id,
    bestOf,
    pairs: pairsToCreate,
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

  // 手動追加も予選デフォルト BO を載せる（生成と同じ）。
  const event = await findEventById(group.event_id);
  const result = await insertGroupMatch({
    eventId: group.event_id,
    groupId: group.id,
    teamAId,
    teamBId,
    bestOf: event?.group_best_of ?? 3,
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

/* ========================================================================== *
 * 試合結果（本戦 PR-3a）。スコア（取マップ数）入力 → 勝者を算出して保存・修正・取り消し。
 * 入力できるのは「主催者（全試合）」または「対戦両チームの代表（自チームが絡む試合）」。
 * winner_team_id / reported_by はサーバーが固定する（マスアサインメント対策）。
 * ========================================================================== */

/** 主催者 or 対戦両チーム代表かをアプリ層で確認する。OK なら試合情報を返す。 */
async function requireReporter(matchId: string, userId: string) {
  const match = await findMatchForReport(matchId);
  if (!match) return null;
  const allowed =
    match.organizerId === userId || match.captainUserIds.includes(userId);
  if (!allowed) return null;
  return match;
}

/**
 * 試合結果の保存（新規/修正）。
 *
 * 防御:
 * 1. ログイン確認。
 * 2. 入力検証（スコア＝非負整数・上限）。
 * 3. 入力主体の確認（主催者 or 対戦両チーム代表）＋ RLS（0015）が最終防衛。
 * 4. 両チームが確定していること（team_a/team_b が null の試合は勝者判定不能＝不可）。
 * 5. winner はスコアからサーバーが算出して固定。reported_by も auth.uid() で固定。
 */
export async function reportResult(input: {
  matchId: string;
  teamAScore: number;
  teamBScore: number;
  potgA?: number;
  potgB?: number;
}): Promise<MatchActionState> {
  const userId = await currentUserId();
  if (!userId) return { error: "ログインが必要です。" };

  const parsed = reportResultSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "入力を確認してください。" };
  }
  const { matchId, teamAScore, teamBScore, potgA, potgB } = parsed.data;

  const match = await requireReporter(matchId, userId);
  if (!match) return { error: "この試合の結果を入力する権限がありません。" };

  if (!match.teamAId || !match.teamBId) {
    return {
      error:
        "対戦カードが未確定（チームが外れています）です。先に対戦表を再生成してください。",
    };
  }

  // スコア上限を BO に連動（各チーム 0〜best_of。緩め＝合計・過半数までは強制しない）。
  if (teamAScore > match.bestOf || teamBScore > match.bestOf) {
    return {
      error: `スコアはBO${match.bestOf}の上限（各チーム最大${match.bestOf}）を超えています。`,
    };
  }

  // winner はスコアからサーバーが算出（マスアサインメント対策）。
  const { winnerTeamId } = decideWinner({
    teamAId: match.teamAId,
    teamBId: match.teamBId,
    teamAScore,
    teamBScore,
  });

  const result = await upsertMatchResult({
    matchId,
    teamAScore,
    teamBScore,
    winnerTeamId,
    reportedBy: userId,
    potgA,
    potgB,
  });
  if (!result.ok) {
    return { error: "結果の保存に失敗しました。画面を更新してからお試しください。" };
  }

  revalidatePath(`/events/${match.eventId}/matches`);
  return {};
}

/** 試合結果の取り消し（未入力に戻す）。主催者 or 対戦両チーム代表。 */
export async function clearResult(matchId: string): Promise<MatchActionState> {
  const userId = await currentUserId();
  if (!userId) return { error: "ログインが必要です。" };

  const match = await requireReporter(matchId, userId);
  if (!match) return { error: "この試合の結果を操作する権限がありません。" };

  const deleted = await deleteMatchResult(matchId);
  if (!deleted) {
    return { error: "取り消しに失敗しました。画面を更新してからお試しください。" };
  }

  revalidatePath(`/events/${match.eventId}/matches`);
  return {};
}
