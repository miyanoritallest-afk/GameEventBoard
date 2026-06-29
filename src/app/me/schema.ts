import { z } from "zod";

/**
 * バトルタグの検証。入口で必須/任意が異なる:
 * - マイページ（battleTagSchema）: 任意。空は「未登録に戻す」を許容。
 * - 応募フォーム（battleTagRequiredSchema）: 必須。対戦相手とゲーム内で会うため
 *   応募には必ずバトルタグが要る（壁打ち確定）。
 * 形式（Name#12345 等）は厳密に縛らない＝入力ミスで弾きすぎない／将来のゲーム別対応の余地を残す。
 */

/** マイページ用（任意・空許容＝未登録に戻せる）。 */
export const battleTagSchema = z.preprocess(
  (v) => (v == null ? "" : typeof v === "string" ? v.trim() : v),
  z.string().max(32, "バトルタグは32文字以内で入力してください"),
);

/** 応募フォーム用（必須・trim 後 1〜32 文字）。 */
export const battleTagRequiredSchema = z.preprocess(
  (v) => (v == null ? "" : typeof v === "string" ? v.trim() : v),
  z
    .string()
    .min(1, "バトルタグを入力してください")
    .max(32, "バトルタグは32文字以内で入力してください"),
);

export const updateBattleTagSchema = z.object({
  battleTag: battleTagSchema,
});

export type UpdateBattleTagInput = z.infer<typeof updateBattleTagSchema>;
