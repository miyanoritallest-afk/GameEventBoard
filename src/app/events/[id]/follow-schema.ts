import { z } from "zod";

/**
 * フォロー操作の入力検証（Zod）。マスアサインメント対策で許可値のみ受理する。
 * 本 PR（②フォロー基盤）では series 画面が未実装のため target は event / user のみ。
 * follower_id はサーバー側で auth.uid() 固定（入力から取らない）。
 */
export const followSchema = z.object({
  targetType: z.enum(["event", "user"]),
  targetId: z.string().uuid(),
});

export type FollowInput = z.infer<typeof followSchema>;
