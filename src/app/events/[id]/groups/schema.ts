import { z } from "zod";

/**
 * 予選ブロック分け（本戦 PR-1）の入力検証。マスアサインメント対策＝許可フィールドのみ受理。
 * event_id はサーバー側で固定・確認し、入力から取らない。
 * 文字数・値域の上限を必ず設ける（過大入力の防止＝実装ガイドライン 2）。
 */

/** ブロック名: 必須・1〜50文字（前後空白はトリム）。 */
export const groupNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "ブロック名を入力してください")
    .max(50, "ブロック名は50文字以内で入力してください"),
});

/** チーム割当: ブロック id とチーム id。 */
export const assignTeamSchema = z.object({
  groupId: z.string().uuid("不正なブロックIDです"),
  teamId: z.string().uuid("不正なチームIDです"),
});

export type GroupNameInput = z.infer<typeof groupNameSchema>;
export type AssignTeamInput = z.infer<typeof assignTeamSchema>;
