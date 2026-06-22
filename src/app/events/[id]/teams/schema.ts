import { z } from "zod";

/**
 * チーム編成（PR-1）の入力検証。マスアサインメント対策＝許可フィールドのみ受理。
 * event_id / status / organizer は入力から取らず、サーバー側で固定・確認する。
 *
 * 文字数・値域の上限を必ず設ける（過大入力の防止＝実装ガイドライン 2）。
 */

const ROLE = z.enum(["tank", "dps", "support"], {
  message: "ロールが不正です",
});

/** チーム名: 必須・1〜50文字（前後空白はトリム）。 */
export const teamNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "チーム名を入力してください")
    .max(50, "チーム名は50文字以内で入力してください"),
});

/** メンバー割当: 応募 id（uuid）と割当ロール。 */
export const assignMemberSchema = z.object({
  registrationId: z.string().uuid("不正な応募IDです"),
  teamId: z.string().uuid("不正なチームIDです"),
  role: ROLE,
});

export type TeamNameInput = z.infer<typeof teamNameSchema>;
export type AssignMemberInput = z.infer<typeof assignMemberSchema>;
