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

/**
 * 自動ブロック分け（PR-4）の入力。ブロック数のみ受理（対象チームはサーバー側で全 approved を取得）。
 * 上限はサーバー側で「承認チーム数」と突き合わせて最終検証する（ここは粗い値域チェック）。
 */
export const autoDraftSchema = z.object({
  blockCount: z
    .number({ message: "ブロック数を入力してください" })
    .int("ブロック数は整数で入力してください")
    .min(1, "ブロック数は1以上で入力してください")
    .max(100, "ブロック数が多すぎます"),
});

export type GroupNameInput = z.infer<typeof groupNameSchema>;
export type AssignTeamInput = z.infer<typeof assignTeamSchema>;
export type AutoDraftInput = z.infer<typeof autoDraftSchema>;
