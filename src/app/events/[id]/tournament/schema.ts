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

export type GenerateTournamentInput = z.infer<typeof generateTournamentSchema>;
