import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { findDiscordName } from "@/lib/repositories/users";
import { countMyUnreadNotifications } from "@/lib/repositories/notifications";
import { LogoutButton } from "@/app/me/logout-button";
import { NotificationsRealtime } from "@/components/notifications-realtime";

/**
 * 全ページ共通ヘッダー（サーバーコンポーネント）。layout.tsx に配置する。
 * - ロゴ（Matchpoint）＝トップへ / イベント一覧 / イベント作成 は常時表示。
 * - ログイン状態で右側を出し分け: 未ログイン=「ログイン」/ ログイン=🔔通知＋Discord名(→/me)＋ログアウト。
 * 表示名は users.discord_name（サイト全体で一貫した本人識別）。
 * 🔔は未読件数バッジ付き（見落とし防止が通知の価値＝どの画面からも気づける導線）。
 */
export async function SiteHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const discordName = user ? await findDiscordName(user.id) : null;
  const unreadCount = user ? await countMyUnreadNotifications(user.id) : 0;

  return (
    <header className="dark border-b border-border bg-background text-foreground">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="flex items-center gap-2 text-lg font-bold tracking-tight"
          >
            {/* ブランドのオレンジランプ（Claude Design のロゴマーク）。淡いにじみで灯りらしく。 */}
            <span
              aria-hidden
              className="h-2.5 w-2.5 rounded-full bg-[#ff6a2b] shadow-[0_0_8px_#ff6a2b99]"
            />
            Matchpoint
          </Link>
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link href="/events" className="hover:text-foreground">
              イベント一覧
            </Link>
            <Link href="/events/new" className="hover:text-foreground">
              イベント作成
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-3 text-sm">
          {user ? (
            <>
              {/* 自分宛て通知の Realtime 購読（新着で🔔・一覧をライブ更新） */}
              <NotificationsRealtime userId={user.id} />
              <Link
                href="/notifications"
                className="relative rounded-lg p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                title="通知"
                aria-label={
                  unreadCount > 0 ? `通知（未読 ${unreadCount} 件）` : "通知"
                }
              >
                <svg
                  aria-hidden
                  width="19"
                  height="19"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="block"
                >
                  <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
                </svg>
                {unreadCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </Link>
              <Link
                href="/me"
                className="font-medium hover:underline"
                title="マイページ"
              >
                {discordName ?? "マイページ"}
              </Link>
              <LogoutButton />
            </>
          ) : (
            <Link
              href="/login"
              className="rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground transition hover:opacity-90"
            >
              ログイン
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
