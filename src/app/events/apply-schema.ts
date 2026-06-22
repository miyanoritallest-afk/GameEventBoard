import { z } from "zod";

/**
 * スコアあり応募フォームの離散項目の検証（希望ロール第1〜第3・peak）。
 * ランクグリッドは可変長（イベントの declared_seasons / role_swap で形が変わる）ため、
 * ここでは検証せず Action 側でイベント設定に基づき parse する。
 *
 * 希望ロールは第1〜第3を持つ（第3はフォームで自動決定）。3つが相異なることを検証する。
 */
export const scoredApplicationSchema = z
  .object({
    preferredRole1: z.enum(["tank", "dps", "support"], {
      message: "第1希望ロールを選択してください",
    }),
    preferredRole2: z.enum(["tank", "dps", "support"], {
      message: "第2希望ロールを選択してください",
    }),
    preferredRole3: z.enum(["tank", "dps", "support"], {
      message: "第3希望ロールが不正です",
    }),
    peak: z.enum(["none", "master", "gm", "champion"]).default("none"),
  })
  .refine(
    (v) =>
      new Set([v.preferredRole1, v.preferredRole2, v.preferredRole3]).size === 3,
    {
      message: "希望ロールは第1〜第3で別のロールを選んでください",
      path: ["preferredRole1"],
    },
  );

export type ScoredApplicationInput = z.infer<typeof scoredApplicationSchema>;
