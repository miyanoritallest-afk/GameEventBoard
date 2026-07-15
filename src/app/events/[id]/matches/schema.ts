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

/** POTG 取得数（0〜99 の整数。tiebreakers に potg が無いイベントは 0 のまま）。 */
const potgCount = z
  .number()
  .int("POTG数は整数で入力してください")
  .min(0, "POTG数は0以上で入力してください")
  .max(99, "POTG数が大きすぎます")
  .default(0);

/** リプレイコード（マップ別・任意）。各要素は空可・16文字以内。配列長は最大15（BO上限）。 */
export const replayCodes = z
  .array(
    z
      .string()
      .trim()
      .max(16, "リプレイコードは16文字以内で入力してください"),
  )
  .max(15, "リプレイコードが多すぎます")
  .default([]);

export const reportResultSchema = z.object({
  matchId: z.string().uuid("不正な試合IDです"),
  teamAScore: mapScore,
  teamBScore: mapScore,
  potgA: potgCount,
  potgB: potgCount,
  replayCodes,
});

/** 試合日時の更新（主催者or代表）。空文字＝日時クリア（null）。 */
export const updateScheduleSchema = z.object({
  matchId: z.string().uuid("不正な試合IDです"),
  // datetime-local 文字列（JST）。空は未設定。
  scheduledAtLocal: z.string().max(40).optional().default(""),
});

/**
 * 配信URLは http/https のみ許可する（javascript: 等の危険スキームを弾く）。
 * 配信URLは観戦ページ（匿名閲覧可）で <a href> として描画されるため、スキーム制限が
 * ないと `javascript:...` を保存されストアドXSSになる。React の自動エスケープは href の
 * スキームを消さないので、入力層で最終防衛する（空文字＝未設定は許可）。
 */
function isSafeHttpUrl(value: string): boolean {
  if (value === "") return true; // 空＝未設定は許可（クリア用）
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false; // URL として解釈できない文字列も弾く
  }
}

/** 配信情報の更新（主催者のみ）。URL・配信者名はともに任意。 */
export const updateStreamSchema = z.object({
  matchId: z.string().uuid("不正な試合IDです"),
  streamUrl: z
    .string()
    .trim()
    .max(500, "配信URLが長すぎます")
    .refine(isSafeHttpUrl, "配信URLは http:// または https:// で始まる必要があります")
    .optional()
    .default(""),
  streamerName: z
    .string()
    .trim()
    .max(100, "配信者名が長すぎます")
    .optional()
    .default(""),
});

export type GenerateMatchesInput = z.infer<typeof generateMatchesSchema>;
export type AddMatchInput = z.infer<typeof addMatchSchema>;
export type ReportResultInput = z.infer<typeof reportResultSchema>;
export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;
export type UpdateStreamInput = z.infer<typeof updateStreamSchema>;
