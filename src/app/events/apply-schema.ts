import { z } from "zod";

/**
 * 登録名（このイベントでの公開表示名）の検証。スコアあり/なし応募で共有する。
 * フォームのデフォルトは Discord 名。trim 後 1〜32 文字必須
 * （空欄送信は弾く＝フォールバックでなくユーザーが見た値を保存する）。
 */
export const displayNameSchema = z.preprocess(
  (v) => (v == null ? "" : typeof v === "string" ? v.trim() : v),
  z
    .string()
    .min(1, "登録名を入力してください")
    .max(32, "登録名は32文字以内で入力してください"),
);

/**
 * 応募時のバトルタグ検証。**応募では必須**（対戦相手とゲーム内で会うため）。
 * trim 後 1〜32 文字。応募時に入力された値は users.battle_tag を上書き更新する
 * （人単位・イベントごとに変えるものではない）。
 */
export const applyBattleTagSchema = z.preprocess(
  (v) => (v == null ? "" : typeof v === "string" ? v.trim() : v),
  z
    .string()
    .min(1, "バトルタグを入力してください")
    .max(32, "バトルタグは32文字以内で入力してください"),
);

/**
 * スコアなし即時応募の検証（登録名＋バトルタグ）。
 */
export const simpleApplicationSchema = z.object({
  displayName: displayNameSchema,
  battleTag: applyBattleTagSchema,
});

export type SimpleApplicationInput = z.infer<typeof simpleApplicationSchema>;

/**
 * スコアあり応募フォームの離散項目の検証（希望ロール第1〜第3・peak）。
 * ランクグリッドは可変長（イベントの declared_seasons / role_swap で形が変わる）ため、
 * ここでは検証せず Action 側でイベント設定に基づき parse する。
 *
 * 希望ロールは第1〜第3を持つ（第3はフォームで自動決定）。3つが相異なることを検証する。
 */
export const scoredApplicationSchema = z
  .object({
    // 登録名（このイベントでの公開表示名）。スコアなし応募と共有のスキーマを使う。
    displayName: displayNameSchema,
    // バトルタグ（応募は必須）。users.battle_tag を上書き更新する。
    battleTag: applyBattleTagSchema,
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
