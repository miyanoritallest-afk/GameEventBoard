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
