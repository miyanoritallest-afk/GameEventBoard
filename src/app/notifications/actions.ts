"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { markNotificationRead } from "@/lib/repositories/notifications";

/**
 * 通知を既読にする Server Action（本人のみ）。
 * 1. ログイン確認（操作系は冒頭で必ず認証）。
 * 2. 本人 id 条件で既読化（RLS 0027 の UPDATE=本人のみ が最終防衛）。
 * 他人の通知 id を渡しても user_id 不一致で 0 件更新＝静かに無効。
 */
export async function markRead(notificationId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await markNotificationRead({ notificationId, userId: user.id });
  revalidatePath("/notifications");
}
