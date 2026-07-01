"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * 自分宛て通知の Realtime 購読（クライアント）。ヘッダーに1つ置けば全ページで効く。
 * notifications への自分宛て INSERT を検知したら router.refresh() でサーバーを再取得し、
 * 🔔バッジ（ヘッダー）と /notifications 一覧を最新化する（表示は常に DB 真値）。
 *
 * Realtime の postgres_changes は RLS を尊重するため、RLS 配下のテーブルでは購読者の
 * アクセストークンを Realtime に渡す必要がある（未認証だと RLS 評価で弾かれ配信されない）。
 * そのため subscribe 前にセッションの access_token を realtime.setAuth() で設定する。
 * userId が無い（未ログイン）ときは購読しない。
 */
export function NotificationsRealtime({ userId }: { userId: string | null }) {
  const router = useRouter();

  useEffect(() => {
    if (!userId) return;

    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      // 購読者の JWT を Realtime に渡す（RLS 配下テーブルの変更配信に必須）。
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.access_token) {
        await supabase.realtime.setAuth(session.access_token);
      }

      channel = supabase
        .channel(`notifications:${userId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${userId}`,
          },
          () => {
            // 新着を検知。サーバーを再取得して未読数・一覧を最新化。
            router.refresh();
          },
        )
        .subscribe();
    })();

    return () => {
      if (channel) void supabase.removeChannel(channel);
    };
  }, [userId, router]);

  return null;
}
