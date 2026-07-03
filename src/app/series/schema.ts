import { z } from "zod";

/**
 * シリーズ作成の入力検証（Zod）。マスアサインメント対策で許可カラムのみ受理。
 * created_by はサーバー側で auth.uid() 固定（入力から取らない）。
 */
export const createSeriesSchema = z.object({
  name: z.string().trim().min(1, "シリーズ名を入力してください。").max(100),
  description: z.string().trim().max(2000).optional(),
});

export type CreateSeriesInput = z.infer<typeof createSeriesSchema>;

/**
 * 共同運営（⑥-2）の入力検証。IDOR/マスアサインメント対策で、権限付与に関わる値
 * （role・status）は入力から取らず DB関数側で固定する。ここでは対象IDのみ受理する。
 */

/** 招待候補のユーザー検索クエリ。空文字は許容しない（全件返さない）。 */
export const searchInviteSchema = z.object({
  seriesId: z.string().uuid(),
  query: z.string().trim().min(1, "検索キーワードを入力してください。").max(100),
});

/** owner による運営メンバー招待。招待相手の user_id のみ。role/status はサーバー固定。 */
export const inviteMemberSchema = z.object({
  seriesId: z.string().uuid(),
  userId: z.string().uuid(),
});

/** 招待への応答。accept=true で承認、false で拒否。 */
export const respondInviteSchema = z.object({
  seriesId: z.string().uuid(),
  accept: z.boolean(),
});

/** owner による運営メンバー削除（招待取消・退会）。 */
export const removeMemberSchema = z.object({
  seriesId: z.string().uuid(),
  userId: z.string().uuid(),
});
