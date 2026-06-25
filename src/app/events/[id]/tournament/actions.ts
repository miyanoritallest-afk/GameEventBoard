"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  findEventById,
  updateTournamentAdvanceCount,
} from "@/lib/repositories/events";
import {
  replaceTournamentMatches,
  findMatchForReport,
  applyBracketRecompute,
} from "@/lib/repositories/matches";
import {
  upsertMatchResult,
  deleteMatchResult,
} from "@/lib/repositories/match-results";
import {
  computeBlockSeeds,
  fetchTournamentForRecompute,
} from "@/lib/repositories/tournament";
import {
  extractSeededTeams,
  generateBracket,
  recomputeBracket,
  toOddBestOf,
} from "@/lib/services/bracket";
import {
  decideWinner,
  validateBoScore,
  validatePotg,
} from "@/lib/services/match-result";
import type { TiebreakerKey } from "@/lib/services/standings";
import {
  generateTournamentSchema,
  reportTournamentResultSchema,
} from "./schema";

/**
 * 決勝トーナメント（本戦-5a）の Server Action（Controller。薄く保つ）。
 * 実装ガイドラインに従う:
 * - 認証バイパス対策: 冒頭で必ずログイン確認。
 * - IDOR 対策: 主催者本人をアプリ層で確認＋ RLS（0014）が最終防衛。
 * - マスアサインメント対策: Zod で進出数のみ受理。event_id・phase はサーバー固定。
 * - 想定内の失敗は throw せず戻り値で返す。
 *
 * 生成（作り直し）は破壊的（既存T試合・結果を全削除）。UI 側で確認ダイアログを出す。
 */

export type TournamentActionState = { error?: string };

/**
 * 結果入力の応答。
 * - needsConfirm: 下流に削除される結果があり未承諾のとき true（UI が確認ダイアログを出す）。
 * - clearCount: 削除される下流結果の件数（確認文言に使う）。
 */
export type ReportResultState = {
  error?: string;
  needsConfirm?: boolean;
  clearCount?: number;
};

/** ログイン中ユーザーを返す。未ログインなら null。 */
async function currentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * 決勝トーナメントを生成（作り直し）する。
 *
 * 手順:
 * 1. ログイン → 主催者確認。
 * 2. 進出数 N を Zod 検証し、events に保存。
 * 3. ブロック順位（standings）から各ブロック上位N を抽出しシード順に並べる。
 * 4. シングルエリミのブラケットを生成し、matches（phase='tournament'）へ一括 insert。
 *    既存のトーナメント試合は全削除してから作り直す（連鎖する結果も cascade で消える）。
 */
export async function generateTournament(
  eventId: string,
  advanceCount: number,
): Promise<TournamentActionState> {
  const userId = await currentUserId();
  if (!userId) return { error: "ログインが必要です。" };

  const event = await findEventById(eventId);
  if (!event || event.organizer_id !== userId) {
    return { error: "このイベントを操作する権限がありません。" };
  }

  const parsed = generateTournamentSchema.safeParse({ advanceCount });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "入力を確認してください。" };
  }

  // 順位設定（events 由来）。順位機能 OFF だとブロック内順位が出ず抽出できない。
  if (!event.ranking_enabled) {
    return {
      error:
        "決勝トーナメントには順位機能が必要です。イベント編集で順位設定を有効にしてください。",
    };
  }

  const config = {
    pointsWin: event.points_win,
    pointsDraw: event.points_draw,
    pointsLoss: event.points_loss,
    tiebreakers: (event.tiebreakers ?? []) as TiebreakerKey[],
  };

  const { seeds } = await computeBlockSeeds({ eventId, config });
  const seededTeamIds = extractSeededTeams(seeds, parsed.data.advanceCount);

  if (seededTeamIds.length < 2) {
    return {
      error:
        "進出チームが2チーム未満です。進出数を増やすか、予選の結果を入力してから生成してください。",
    };
  }

  const bracket = generateBracket(seededTeamIds);

  // 進出数を保存（次回表示の既定値）し、ブラケットを永続化する。
  await updateTournamentAdvanceCount({ eventId, advanceCount: parsed.data.advanceCount });
  await replaceTournamentMatches({
    eventId,
    // トーナメントは引分を構造的に出さないため BO を奇数へ補正する（本戦-5b）。
    bestOf: toOddBestOf(event.group_best_of),
    matches: bracket.map((m) => ({
      round: m.round,
      bracketPosition: m.position,
      teamAId: m.teamAId,
      teamBId: m.teamBId,
    })),
  });

  revalidatePath(`/events/${eventId}/tournament`);
  return {};
}

/** 主催者 or 対戦両チーム代表かをアプリ層で確認する。OK なら試合情報を返す（予選と同型）。 */
async function requireReporter(matchId: string, userId: string) {
  const match = await findMatchForReport(matchId);
  if (!match) return null;
  const allowed =
    match.organizerId === userId || match.captainUserIds.includes(userId);
  if (!allowed) return null;
  return match;
}

/**
 * トーナメント試合の結果を保存（新規/修正）し、勝者を次ラウンドへ自動進出させる（本戦-5b）。
 *
 * 防御は予選 reportResult と同型（ログイン・認可・BO/POTG検証・winner はサーバー算出）。
 * 加えて全再計算（recomputeBracket）でブラケット全体を組み直し、上流修正で無効になる
 * 下流の結果を削除する。下流に削除対象があり未承諾（confirmed=false）なら、保存せず
 * needsConfirm を返して UI に確認を促す（条件付き AlertDialog）。
 */
export async function reportTournamentResult(
  input: {
    matchId: string;
    teamAScore: number;
    teamBScore: number;
    potgA?: number;
    potgB?: number;
  },
  confirmed: boolean,
): Promise<ReportResultState> {
  const userId = await currentUserId();
  if (!userId) return { error: "ログインが必要です。" };

  const parsed = reportTournamentResultSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "入力を確認してください。" };
  }
  const { matchId, teamAScore, teamBScore, potgA, potgB } = parsed.data;

  const match = await requireReporter(matchId, userId);
  if (!match) return { error: "この試合の結果を入力する権限がありません。" };

  if (!match.teamAId || !match.teamBId) {
    return {
      error: "対戦カードが未確定です。前のラウンドが終わるまで結果は入力できません。",
    };
  }

  // BO 検証（トーナメントは奇数BO強制なので引分は出ない）。
  const boCheck = validateBoScore({ bestOf: match.bestOf, teamAScore, teamBScore });
  if (!boCheck.ok) return { error: boCheck.message };

  const event = await findEventById(match.eventId);
  const usesPotg = (event?.tiebreakers ?? []).includes("potg");
  if (usesPotg) {
    const potgCheck = validatePotg({
      teamAScore,
      teamBScore,
      potgA: potgA ?? 0,
      potgB: potgB ?? 0,
    });
    if (!potgCheck.ok) return { error: potgCheck.message };
  }

  const { winnerTeamId } = decideWinner({
    teamAId: match.teamAId,
    teamBId: match.teamBId,
    teamAScore,
    teamBScore,
  });

  // --- ドライラン: この結果を反映したら下流で何件の結果が無効化されるか先に見る ---
  const { matches, results } = await fetchTournamentForRecompute(match.eventId);
  const simulatedResults = results.filter((r) => r.matchId !== matchId);
  simulatedResults.push({ matchId, winnerTeamId });
  const recomputed = recomputeBracket(matches, simulatedResults);
  // この試合自身を除く「結果削除対象」が下流の消える結果。
  const downstreamCleared = recomputed.filter(
    (m) => m.shouldClearResult && m.matchId !== matchId,
  );

  if (downstreamCleared.length > 0 && !confirmed) {
    return { needsConfirm: true, clearCount: downstreamCleared.length };
  }

  // --- 保存 → 全再計算を本適用 ---
  const saved = await upsertMatchResult({
    matchId,
    teamAScore,
    teamBScore,
    winnerTeamId,
    reportedBy: userId,
    potgA: potgA ?? 0,
    potgB: potgB ?? 0,
  });
  if (!saved.ok) {
    return { error: "結果の保存に失敗しました。画面を更新してからお試しください。" };
  }

  await applyRecompute(match.eventId);

  revalidatePath(`/events/${match.eventId}/tournament`);
  return {};
}

/**
 * トーナメント試合の結果を取り消し（未入力に戻す）、再計算で下流もリセットする（本戦-5b）。
 * 取り消しは「勝者が消える」＝下流も巻き戻るので、確認は UI 側で常に促す方針（呼び出し側）。
 */
export async function clearTournamentResult(
  matchId: string,
): Promise<TournamentActionState> {
  const userId = await currentUserId();
  if (!userId) return { error: "ログインが必要です。" };

  const match = await requireReporter(matchId, userId);
  if (!match) return { error: "この試合の結果を操作する権限がありません。" };

  const deleted = await deleteMatchResult(matchId);
  if (!deleted) {
    return { error: "取り消しに失敗しました。画面を更新してからお試しください。" };
  }

  await applyRecompute(match.eventId);

  revalidatePath(`/events/${match.eventId}/tournament`);
  return {};
}

/** 現在の全結果から再計算し、スロット更新＋無効化結果の削除を DB へ反映する。 */
async function applyRecompute(eventId: string): Promise<void> {
  const { matches, results } = await fetchTournamentForRecompute(eventId);
  const recomputed = recomputeBracket(matches, results);
  await applyBracketRecompute({
    updates: recomputed.map((m) => ({
      matchId: m.matchId,
      teamAId: m.teamAId,
      teamBId: m.teamBId,
    })),
    clearResultMatchIds: recomputed
      .filter((m) => m.shouldClearResult)
      .map((m) => m.matchId),
  });
}
