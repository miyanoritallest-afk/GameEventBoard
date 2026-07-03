import { z } from "zod";

/**
 * イベント「下書き作成」フォームの入力検証スキーマ（実装ガイドライン: 入力検証は Zod）。
 *
 * 設計（2段階バリデーション）:
 * - 下書き作成（createDraftEventSchema）: タイトル・ゲームのみ必須。日程/説明/定員は任意で
 *   保存できる（日程などを後から詰める運用に合わせる）。
 * - 公開時（publishEventSchema・本ファイル末尾）: 日程・募集締切を必須化する
 *   （定員は公開時も任意）。
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

/**
 * Discord Webhook URL の任意項目（④ 全体告知）。空文字は「未設定」。
 * 値があれば discord.com / discordapp.com の webhook エンドポイント形式のみ受理する
 * （任意ホストへの POST を主催者入力から許さない＝SSRF/誤爆対策。全体告知は Discord のみ）。
 */
const DISCORD_WEBHOOK_RE =
  /^https:\/\/(?:\w+\.)?(?:discord\.com|discordapp\.com)\/api\/(?:v\d+\/)?webhooks\/\d+\/[\w-]+$/;
const optionalDiscordWebhookUrl = z.preprocess(
  (v) => (v == null ? "" : typeof v === "string" ? v.trim() : v),
  z
    .string()
    .max(300, "Webhook URL は300文字以内で入力してください")
    .refine(
      (v) => v === "" || DISCORD_WEBHOOK_RE.test(v),
      "Discord の Webhook URL を入力してください（https://discord.com/api/webhooks/...）",
    ),
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

    // 主催者の登録名（イベント詳細の「主催」に出す公開表示名）。
    // フォームのデフォルトは Discord 名。任意・空可（空ならフォールバックで Discord 名表示）。
    organizerDisplayName: optionalText(
      32,
      "登録名は32文字以内で入力してください",
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

    // イベント形式（2026-06-30 壁打ち）。総当たりのみ / トーナメントのみ / 総当たり→決勝T。
    // 既定は従来挙動（round_robin_then_tournament）。形式別の画面分岐は後続 PR。
    format: z
      .enum(["round_robin", "tournament", "round_robin_then_tournament"])
      .default("round_robin_then_tournament"),

    // スコアリング設定（既定値あり）。
    // 個人スコアを計算するか（スコアあり応募の親トグル）。OFF なら配下は無効。
    requireScore: z.coerce.boolean().default(true),
    // 未認定セルの補完方式（role_swap=true の算出時に使う）。既定は除外。
    uncertifiedHandling: z
      .enum(["fill_by_role", "fill_by_season", "exclude"])
      .default("exclude"),
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
    // チームスコア上限（B-1）。チームの出場メンバー final_score「平均」の上限。
    // 任意・空可（空文字＝上限なし）。値があるなら 1〜40 の整数（ランクのスコアレンジ）。
    teamScoreCap: z.preprocess(
      (v) => (v == null || v === "" ? "" : v),
      z.union([
        z.coerce
          .number()
          .int()
          .min(1, "チームスコア上限は1以上で入力してください")
          .max(40, "チームスコア上限は40以下で入力してください"),
        z.literal(""),
      ]),
    ),

    // Discord 全体告知（④）。公開時に告知チャンネルへ自動投稿する Webhook URL（任意）。
    // 空なら投稿しない（skipped 記録）。値の形式検証は optionalDiscordWebhookUrl。
    discordWebhookUrl: optionalDiscordWebhookUrl,

    // 順位設定（本戦-3b）。ranking_enabled が親トグル。OFF なら配下は使わない。
    rankingEnabled: z.coerce.boolean().default(false),
    // 勝点（0〜99 の整数。大小制約は課さない＝主催者の自由）。
    pointsWin: z.preprocess(
      (v) => (v == null || v === "" ? 3 : v),
      z.coerce.number().int().min(0).max(99),
    ),
    pointsDraw: z.preprocess(
      (v) => (v == null || v === "" ? 1 : v),
      z.coerce.number().int().min(0).max(99),
    ),
    pointsLoss: z.preprocess(
      (v) => (v == null || v === "" ? 0 : v),
      z.coerce.number().int().min(0).max(99),
    ),
    // 予選BO（本戦-3d）。総当たり生成時に全試合の best_of へ一括セットする。
    // best_of=N は最大Nマップ（奇数=過半数先取で引分なし、偶数=引分あり）。1〜15。
    groupBestOf: z.preprocess(
      (v) => (v == null || v === "" ? 3 : v),
      z.coerce
        .number()
        .int()
        .min(1, "BOは1以上で入力してください")
        .max(15, "BOは15以下で入力してください"),
    ),
    // 3位決定戦を行うか（本戦-5c）。チェックボックス＝on/未送信。
    tournamentThirdPlace: z.coerce.boolean().default(false),
    // タイブレーク優先順位。フォームからはカンマ区切り文字列（D&D の順序）で来るので
    // 配列に正規化し、許可値のみ・重複なしを検証する（先頭ほど優先）。
    tiebreakers: z.preprocess(
      (v) => {
        if (Array.isArray(v)) return v;
        if (typeof v === "string") {
          return v
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
        }
        return [];
      },
      z
        .array(z.enum(["head_to_head", "map_diff", "potg"]))
        .max(3, "タイブレーク基準が多すぎます")
        .refine((arr) => new Set(arr).size === arr.length, {
          message: "タイブレーク基準が重複しています",
        }),
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

/**
 * イベント「公開」時の必須チェック（2段階バリデーションの公開側）。
 *
 * 下書きで緩めた項目を公開時に必須化する。検証対象は「保存済みイベントの値」
 * （DB の Row 由来の ISO 文字列 / null）であり、フォーム入力ではない点に注意。
 * 公開は status を上げるだけの操作で、内容は作成/編集時にすでに保存されている。
 *
 * 公開の最低条件（募集を開始できる状態か）:
 * - 開催開始（starts_at）が設定済み
 * - 募集締切（recruit_deadline）が設定済み
 * - タイトル・ゲームは下書き時点で必須のため、ここでは前提として再掲のみ
 * - 期間・締切の整合（終了が開始以降 / 締切が開始より前）は引き続き成立すること
 *
 * 定員（capacity）は公開時も任意（未定のまま募集を開始する運用を許容）。
 * ただし設定する場合は1以上であること（0・負数は無意味なので弾く）。
 */
export const publishEventSchema = z
  .object({
    title: z.string().min(1, "タイトルが未設定です"),
    game_id: z.string().uuid("ゲームが未設定です"),
    starts_at: z
      .string({ message: "開催開始日時を設定してください" })
      .min(1, "開催開始日時を設定してください"),
    ends_at: z.string().nullable(),
    recruit_deadline: z
      .string({ message: "募集締切を設定してください" })
      .min(1, "募集締切を設定してください"),
    // 任意。null は未設定。値があるなら1以上の整数。
    capacity: z
      .number()
      .int()
      .min(1, "定員は1以上で設定してください")
      .nullable(),
  })
  .refine(
    (v) =>
      !v.ends_at ||
      new Date(v.ends_at).getTime() >= new Date(v.starts_at).getTime(),
    { message: "開催終了は開始日時以降にしてください", path: ["ends_at"] },
  )
  .refine(
    (v) =>
      new Date(v.recruit_deadline).getTime() < new Date(v.starts_at).getTime(),
    { message: "募集締切は開催開始より前にしてください", path: ["recruit_deadline"] },
  );

export type PublishEventInput = z.infer<typeof publishEventSchema>;
