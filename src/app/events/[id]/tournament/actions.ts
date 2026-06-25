"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  findEventById,
  updateTournamentAdvanceCount,
} from "@/lib/repositories/events";
import { replaceTournamentMatches } from "@/lib/repositories/matches";
import { computeBlockSeeds } from "@/lib/repositories/tournament";
import {
  extractSeededTeams,
  generateBracket,
} from "@/lib/services/bracket";
import type { TiebreakerKey } from "@/lib/services/standings";
import { generateTournamentSchema } from "./schema";

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
    bestOf: event.group_best_of,
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
