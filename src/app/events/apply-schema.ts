import { z } from "zod";

/**
 * スコアあり応募フォームの離散項目の検証（希望ロール・peak）。
 * ランクグリッドは可変長（イベントの declared_seasons / role_swap で形が変わる）ため、
 * ここでは検証せず Action 側でイベント設定に基づき parse する。
 */
export const scoredApplicationSchema = z.object({
  // 希望ロールは必須（3ロールあり全員が希望に就けないため振り分け基礎）。
  preferredRole: z.enum(["tank", "dps", "support"], {
    message: "希望ロールを選択してください",
  }),
  // 到達ボーナス（任意。未指定は none）。
  peak: z.enum(["none", "master", "gm", "champion"]).default("none"),
});

export type ScoredApplicationInput = z.infer<typeof scoredApplicationSchema>;
