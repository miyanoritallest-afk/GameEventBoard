import { z } from "zod";

/**
 * フォロー操作の入力検証（Zod）。マスアサインメント対策で許可値のみ受理する。
 * target は event / user / series の3種（series は⑥で追加）。
 * follower_id はサーバー側で auth.uid() 固定（入力から取らない）。
 */
export const followSchema = z.object({
  targetType: z.enum(["event", "user", "series"]),
  targetId: z.string().uuid(),
});

export type FollowInput = z.infer<typeof followSchema>;
