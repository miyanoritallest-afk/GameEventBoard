// 通知一覧: 自分宛てのアプリ内通知を新しい順に表示する（本人専用）。
// アプリ内通知は「確実な土台」（要件定義書 3.5.2）。Discord 連携は後続 PR で上に乗せる。

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listMyNotifications } from "@/lib/repositories/notifications";
import { NotificationItem } from "./notification-item";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // 本人専用。未ログインは /login へ（戻り先を持ち回る）。
  if (!user) {
    redirect(`/login?redirect=${encodeURIComponent("/notifications")}`);
  }

  const notifications = await listMyNotifications(user.id);

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-lg px-6 py-10">
        <h1 className="text-2xl font-bold">通知</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          あなた宛てのお知らせを新しい順に表示します。
        </p>

        {notifications.length === 0 ? (
          <p className="mt-8 rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            通知はまだありません。
          </p>
        ) : (
          <ul className="mt-6 space-y-3">
            {notifications.map((n) => (
              <NotificationItem
                key={n.id}
                id={n.id}
                title={n.title}
                body={n.body}
                linkUrl={n.link_url}
                isRead={n.is_read}
                createdAt={n.created_at}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
