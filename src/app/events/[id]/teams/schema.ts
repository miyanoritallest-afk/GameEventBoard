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

/**
 * メンバーの position（出場⇄リザーブ）/ role（担当ロール）を更新する。
 * 同一チーム内のゾーン移動・ロール行移動の両方を扱う。どちらも任意指定。
 */
export const updateMemberSchema = z
  .object({
    registrationId: z.string().uuid("不正な応募IDです"),
    position: z.enum(["regular", "reserve"]).optional(),
    role: ROLE.optional(),
  })
  .refine((v) => v.position !== undefined || v.role !== undefined, {
    message: "更新内容がありません",
    path: ["registrationId"],
  });

/** 交代実行: 出る側（現レギュラー）と入る側（現リザーブ）の応募 id。 */
export const swapMembersSchema = z
  .object({
    outRegistrationId: z.string().uuid("不正な応募IDです"),
    inRegistrationId: z.string().uuid("不正な応募IDです"),
  })
  .refine((v) => v.outRegistrationId !== v.inRegistrationId, {
    message: "同一メンバーは交代できません",
    path: ["inRegistrationId"],
  });

export type TeamNameInput = z.infer<typeof teamNameSchema>;
export type AssignMemberInput = z.infer<typeof assignMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type SwapMembersInput = z.infer<typeof swapMembersSchema>;
