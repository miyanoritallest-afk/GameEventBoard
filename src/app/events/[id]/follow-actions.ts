"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  insertFollow,
  deleteFollow,
} from "@/lib/repositories/follows";
import { findEventById } from "@/lib/repositories/events";
import { findDiscordName } from "@/lib/repositories/users";
import { followSchema } from "./follow-schema";

export type FollowState = { error?: string; following?: boolean };

/**
 * フォロー/解除のトグル Server Action（本人のみ）。
 * 1. ログイン確認（操作系は冒頭で必ず認証）。
 * 2. Zod で target を検証（event / user のみ・uuid）。
 * 3. target の実在確認（ポリモーフィックで FK が無いため＝存在しない対象のフォローを防ぐ）。
 * 4. follow=true なら追加（二重は握り潰す）、false なら解除。follower_id は auth.uid() 固定。
 * 最終防衛は RLS（0029）。表示更新のため対象イベントページを revalidate。
 */
export async function toggleFollow(
  input: { targetType: string; targetId: string; follow: boolean },
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

  // 対象の実在確認（存在しない対象のフォローを防ぐ）。
  if (targetType === "event") {
    const ev = await findEventById(targetId);
    if (!ev) return { error: "対象のイベントが見つかりません。" };
  } else {
    const name = await findDiscordName(targetId);
    if (name === null) return { error: "対象のユーザーが見つかりません。" };
  }

  if (input.follow) {
    await insertFollow({
      followerId: user.id,
      targetType,
      targetId,
    });
  } else {
    await deleteFollow({
      followerId: user.id,
      targetType,
      targetId,
    });
  }

  // イベントページ上のフォローボタン（event / user 両方）を最新化。
  if (targetType === "event") {
    revalidatePath(`/events/${targetId}`);
  }
  return { following: input.follow };
}
