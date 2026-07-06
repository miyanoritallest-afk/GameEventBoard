import { z } from "zod";

/**
 * チーム日程（スクリム/練習）の登録・編集の入力検証（実装ガイドライン: 入力検証は Zod）。
 *
 * マスアサインメント対策: ここで定義した項目以外は受理しない。team_id / created_by は
 * Server Action 側で固定（入力から取らない・created_by=auth.uid()）。kind は enum で限定。
 *
 * 日時は datetime-local の JST ローカル文字列（"YYYY-MM-DDTHH:mm"）。UTC 変換は Action の責務
 * （jstLocalToUtcIso）。相手・メモは任意。相手は kind='scrim' のときだけ意味を持つ（練習は無し）。
 */

/** null/undefined を "" に正規化し trim する任意テキスト。 */
const optionalText = (max: number, maxMessage: string) =>
  z.preprocess(
    (v) => (v == null ? "" : typeof v === "string" ? v.trim() : v),
    z.string().max(max, maxMessage),
  );

export const scrimSchema = z.object({
  kind: z.enum(["scrim", "practice"]),
  // datetime-local 文字列（必須）。形式は "YYYY-MM-DDTHH:mm"（秒付きも許容）。
  scheduledAt: z.preprocess(
    (v) => (v == null ? "" : typeof v === "string" ? v.trim() : v),
    z
      .string()
      .min(1, "日時を入力してください")
      .regex(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,
        "日時の形式が正しくありません",
      ),
  ),
  // 相手（scrim のみ・自由入力）。任意。
  opponentName: optionalText(60, "相手は60文字以内で入力してください"),
  // メモ。任意。
  memo: optionalText(500, "メモは500文字以内で入力してください"),
});

export type ScrimInput = z.infer<typeof scrimSchema>;
