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

export type GenerateMatchesInput = z.infer<typeof generateMatchesSchema>;
export type AddMatchInput = z.infer<typeof addMatchSchema>;
