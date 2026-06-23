import { z } from "zod";

/**
 * 予選対戦カード（本戦 PR-2）の入力検証。マスアサインメント対策＝許可フィールドのみ受理。
 * event_id / phase はサーバー側で固定し、入力から取らない。
 */

/** 総当たり生成: 対象ブロック id。 */
export const generateMatchesSchema = z.object({
  groupId: z.string().uuid("不正なブロックIDです"),
});

/** 試合の手動追加: 対象ブロックと対戦する2チーム（別チームであること）。 */
export const addMatchSchema = z
  .object({
    groupId: z.string().uuid("不正なブロックIDです"),
    teamAId: z.string().uuid("不正なチームIDです"),
    teamBId: z.string().uuid("不正なチームIDです"),
  })
  .refine((v) => v.teamAId !== v.teamBId, {
    message: "同じチーム同士は対戦カードにできません",
    path: ["teamBId"],
  });

/**
 * 試合結果の入力（本戦 PR-3a）。スコアは取マップ数（非負整数・上限あり）。
 * winner_team_id / reported_by は入力から取らずサーバーで固定（マスアサインメント対策）。
 */
const mapScore = z
  .number()
  .int("マップ数は整数で入力してください")
  .min(0, "マップ数は0以上で入力してください")
  .max(20, "マップ数が大きすぎます");

export const reportResultSchema = z.object({
  matchId: z.string().uuid("不正な試合IDです"),
  teamAScore: mapScore,
  teamBScore: mapScore,
});

export type GenerateMatchesInput = z.infer<typeof generateMatchesSchema>;
export type AddMatchInput = z.infer<typeof addMatchSchema>;
export type ReportResultInput = z.infer<typeof reportResultSchema>;
