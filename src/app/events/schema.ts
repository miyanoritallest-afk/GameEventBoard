import { z } from "zod";

/**
 * イベント「下書き作成」フォームの入力検証スキーマ（実装ガイドライン: 入力検証は Zod）。
 *
 * 設計（2段階バリデーション）:
 * - 下書き作成（このスキーマ）: タイトル・ゲームのみ必須。日程/説明/定員は任意で保存できる
 *   （日程などを後から詰める運用に合わせる）。
 * - 公開時（後続PR）: 日程等の必須チェックを別スキーマでかける。
 *
 * 重要（マスアサインメント対策）:
 * - ここで定義した項目以外は受理しない。
 * - organizer_id / status などは入力に含めず Server Action 側で固定する。
 *
 * null 対策: HTML フォーム未入力項目は formData.get() が null を返す。
 *   文字列項目は preprocess で null/undefined → "" に正規化してから検証する
 *   （Invalid input: expected string, received null を構造的に防ぐ）。
 */

/** null/undefined を "" に正規化し、文字列は trim する前処理付きの任意テキスト。 */
const optionalText = (max: number, maxMessage: string) =>
  z.preprocess(
    (v) => (v == null ? "" : typeof v === "string" ? v.trim() : v),
    z.string().max(max, maxMessage),
  );

export const createDraftEventSchema = z
  .object({
    // 下書きでも識別子としてタイトルは必須。
    title: z.preprocess(
      (v) => (v == null ? "" : typeof v === "string" ? v.trim() : v),
      z
        .string()
        .min(1, "タイトルを入力してください")
        .max(80, "タイトルは80文字以内で入力してください"),
    ),

    // ゲームも必須（ドロップダウンで常に選択済み。(1)の方針）。
    gameId: z.preprocess(
      (v) => (v == null ? "" : v),
      z.string().uuid("ゲームを選択してください"),
    ),

    // 以下はすべて任意（下書きなので未入力で保存できる）。
    description: optionalText(2000, "説明は2000文字以内で入力してください"),

    // 日時は datetime-local の文字列（JSTローカル）。任意・空可。
    startsAt: optionalText(32, ""),
    endsAt: optionalText(32, ""),
    recruitDeadline: optionalText(32, ""),

    // 定員（任意・1以上の整数）。空文字は未設定。
    capacity: z.preprocess(
      (v) => (v == null || v === "" ? "" : v),
      z.union([
        z.coerce.number().int().min(1, "定員は1以上で入力してください"),
        z.literal(""),
      ]),
    ),

    // スコアリング設定（既定値あり）。
    roleSwapAllowed: z.coerce.boolean().default(false),
    declaredSeasons: z.preprocess(
      (v) => (v == null || v === "" ? 3 : v),
      z.coerce
        .number()
        .int()
        .min(1, "申告シーズン数は1以上で入力してください")
        .max(10, "申告シーズン数は10以下で入力してください"),
    ),
    bonusMaster: z.preprocess(
      (v) => (v == null || v === "" ? 0 : v),
      z.coerce.number().min(0).max(10),
    ),
    bonusGm: z.preprocess(
      (v) => (v == null || v === "" ? 0 : v),
      z.coerce.number().min(0).max(10),
    ),
    bonusChampion: z.preprocess(
      (v) => (v == null || v === "" ? 0 : v),
      z.coerce.number().min(0).max(10),
    ),
  })
  // 下書きでも、開始・終了が両方あるときだけ期間の整合性を確認する。
  .refine(
    (v) =>
      !v.startsAt ||
      !v.endsAt ||
      new Date(v.endsAt).getTime() >= new Date(v.startsAt).getTime(),
    { message: "開催終了は開始日時以降にしてください", path: ["endsAt"] },
  )
  // 募集締切は、開始と両方あるときだけ「開始より前」を確認する。
  .refine(
    (v) =>
      !v.recruitDeadline ||
      !v.startsAt ||
      new Date(v.recruitDeadline).getTime() < new Date(v.startsAt).getTime(),
    { message: "募集締切は開催開始より前にしてください", path: ["recruitDeadline"] },
  );

export type CreateDraftEventInput = z.infer<typeof createDraftEventSchema>;
