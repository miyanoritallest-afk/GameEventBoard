"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { insertFollow, deleteFollow } from "@/lib/repositories/follows";
import { existsEventById } from "@/lib/repositories/events";
import { existsUserById } from "@/lib/repositories/users";
import { followSchema } from "./follow-schema";

export type FollowState = { error?: string; following?: boolean };

/**
 * フォロー/解除のトグル Server Action（本人のみ）。
 * 1. ログイン確認（操作系は冒頭で必ず認証）。
 * 2. Zod で target を検証（event / user のみ・uuid）。
 * 3. target の実在確認（ポリモーフィックで FK が無いため＝存在しない対象のフォローを防ぐ）。
 *    実在確認は id の有無で行う（存在チェック専用の軽い count クエリ）。
 * 4. follow=true なら追加、false なら解除。follower_id は auth.uid() 固定。
 *    想定外失敗は insertFollow/deleteFollow が throw し error.tsx へ。二重フォロー
 *    （alreadyFollowing）は成功扱い（結果状態は「フォロー中」で正しい）。
 * 最終防衛は RLS（0029）。表示更新のため、ボタンが置かれているイベントページを revalidate
 * する（eventPath）。user フォローも同じイベントページ上のボタンなので、対象種別に依らず
 * このページを最新化する（targetId は user のとき /events/<userId> になり誤りのため使わない）。
 */
export async function toggleFollow(
  input: {
    targetType: string;
    targetId: string;
    follow: boolean;
    eventPath: string;
  },
): Promise<FollowState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "ログインが必要です。" };
  }

  const parsed = followSchema.safeParse({
    targetType: input.targetType,
    targetId: input.targetId,
  });
  if (!parsed.success) {
    return { error: "フォロー対象が正しくありません。" };
  }
  const { targetType, targetId } = parsed.data;

  // 対象の実在確認（存在しない対象のフォローを防ぐ）。id の有無だけを見る。
  const exists =
    targetType === "event"
      ? await existsEventById(targetId)
      : await existsUserById(targetId);
  if (!exists) {
    return {
      error:
        targetType === "event"
          ? "対象のイベントが見つかりません。"
          : "対象のユーザーが見つかりません。",
    };
  }

  if (input.follow) {
    await insertFollow({ followerId: user.id, targetType, targetId });
  } else {
    await deleteFollow({ followerId: user.id, targetType, targetId });
  }

  // ボタンが置かれているイベントページを最新化（event / user 両方のボタンを再描画）。
  // eventPath は "/events/<eventId>" 形式のみ許可（任意パスの revalidate を防ぐ）。
  if (/^\/events\/[^/]+$/.test(input.eventPath)) {
    revalidatePath(input.eventPath);
  }
  return { following: input.follow };
}
