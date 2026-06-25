import { z } from "zod";

/**
 * 決勝トーナメント（本戦-5a）の入力検証。マスアサインメント対策＝許可フィールドのみ受理。
 * event_id はサーバー側で固定・確認し、入力から取らない。値域の上限を必ず設ける。
 */

/** 進出数: 各ブロック上位N（1〜99）。0 は「使わない」だが生成時は1以上を要求する。 */
export const generateTournamentSchema = z.object({
  advanceCount: z
    .number({ message: "進出数を入力してください" })
    .int("進出数は整数で入力してください")
    .min(1, "進出数は1以上で入力してください")
    .max(99, "進出数が多すぎます"),
});

/**
 * トーナメント結果の入力（本戦-5b）。スコアは取マップ数（非負整数・上限あり）。
 * winner_team_id / reported_by は入力から取らずサーバーで固定（マスアサインメント対策）。
 * confirmed=true は「下流の結果削除を承諾済み」のときだけ true（条件付き確認）。
 */
const mapScore = z
  .number()
  .int("マップ数は整数で入力してください")
  .min(0, "マップ数は0以上で入力してください")
  .max(20, "マップ数が大きすぎます");

const potgCount = z
  .number()
  .int("POTG数は整数で入力してください")
  .min(0, "POTG数は0以上で入力してください")
  .max(99, "POTG数が大きすぎます")
  .default(0);

export const reportTournamentResultSchema = z.object({
  matchId: z.string().uuid("不正な試合IDです"),
  teamAScore: mapScore,
  teamBScore: mapScore,
  potgA: potgCount,
  potgB: potgCount,
});

/**
 * 1回戦のチーム入れ替え（本戦-5c）。2つのスロットを matchId＋slot(a/b) で指定する。
 * チーム id を入力から取らない（マスアサインメント対策）。サーバーが両スロットの中身を入れ替える。
 */
const slotRef = z.object({
  matchId: z.string().uuid("不正な試合IDです"),
  slot: z.enum(["a", "b"]),
});
export const swapBracketTeamsSchema = z.object({
  x: slotRef,
  y: slotRef,
});

export type GenerateTournamentInput = z.infer<typeof generateTournamentSchema>;
export type ReportTournamentResultInput = z.infer<
  typeof reportTournamentResultSchema
>;
export type SwapBracketTeamsInput = z.infer<typeof swapBracketTeamsSchema>;
