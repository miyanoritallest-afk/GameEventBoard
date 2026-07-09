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

/** リプレイコード（マップ別・任意）。各要素は空可・16文字以内。配列長は最大15（BO上限）。 */
const replayCodes = z
  .array(z.string().trim().max(16, "リプレイコードは16文字以内で入力してください"))
  .max(15, "リプレイコードが多すぎます")
  .default([]);

export const reportTournamentResultSchema = z.object({
  matchId: z.string().uuid("不正な試合IDです"),
  teamAScore: mapScore,
  teamBScore: mapScore,
  potgA: potgCount,
  potgB: potgCount,
  replayCodes,
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

/**
 * ラウンド別 BO 一括編集（PR-4）。指定ラウンド（＋3位決定戦フラグ）の全試合の best_of を更新する。
 * トーナメントは引分を構造的に出さないため BO は奇数のみ受理（1〜7）。
 * round / thirdPlace はどの編集グループかを表す。event_id・matchId はサーバー側で解決する。
 */
export const updateRoundBestOfSchema = z.object({
  round: z
    .number({ message: "ラウンドを指定してください" })
    .int("ラウンドは整数です")
    .min(1, "ラウンドが不正です")
    .max(20, "ラウンドが不正です"),
  /** 最終ラウンドの3位決定戦（position=1）を対象にするか。決勝（position=0）と分けて編集する。 */
  thirdPlace: z.boolean().default(false),
  bestOf: z
    .number({ message: "BOを入力してください" })
    .int("BOは整数で入力してください")
    .min(1, "BOは1以上で入力してください")
    .max(7, "BOは7以下で入力してください")
    .refine((n) => n % 2 === 1, "トーナメントのBOは奇数のみ設定できます"),
});

export type GenerateTournamentInput = z.infer<typeof generateTournamentSchema>;
export type UpdateRoundBestOfInput = z.infer<typeof updateRoundBestOfSchema>;
export type ReportTournamentResultInput = z.infer<
  typeof reportTournamentResultSchema
>;
export type SwapBracketTeamsInput = z.infer<typeof swapBracketTeamsSchema>;
