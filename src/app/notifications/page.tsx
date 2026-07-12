// 通知一覧: 自分宛てのアプリ内通知を新しい順に表示する（本人専用）。
// アプリ内通知は「確実な土台」（要件定義書 3.5.2）。Discord 連携は後続 PR で上に乗せる。

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listMyNotifications } from "@/lib/repositories/notifications";
import { NotificationItem } from "./notification-item";

export const dynamic = "force-dynamic";

/** ベルアイコン（共通・種別なし）。 */
function BellIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

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
  // 未読件数（取得済み配列を数えるだけ・追加クエリ不要）。
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div className="theme-matchpoint min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-6 py-10">
        {/* パンくず */}
        <nav className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
          <Link href="/me" className="hover:text-foreground">
            マイページ
          </Link>
          <span className="text-[color:var(--mp-fg-subtle)]">/</span>
          <span className="text-foreground">通知</span>
        </nav>

        {/* ヒーロー：kicker・タイトル・補足・未読件数チップ */}
        <header className="mt-5 overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-[var(--mp-e2)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="flex items-center gap-[9px] font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--mp-accent)] before:h-0.5 before:w-[22px] before:bg-[color:var(--mp-accent)] before:content-['']">
                お知らせ
              </p>
              <h1 className="mt-2.5 text-2xl font-extrabold tracking-tight text-foreground">
                通知
              </h1>
              <p className="mt-3 max-w-[440px] text-[13px] leading-relaxed text-muted-foreground">
                あなた宛てのお知らせを新しい順に表示します。未読の通知を開くと既読になります。
              </p>
            </div>

            {/* 未読件数チップ */}
            <div
              className={`flex flex-none items-center gap-2.5 rounded-lg border px-4 py-3 ${
                unreadCount > 0
                  ? "border-[color:var(--mp-brand)]/34 bg-[color:var(--mp-brand)]/[0.06]"
                  : "border-border bg-[color:var(--mp-surface)]"
              }`}
            >
              <span
                aria-hidden
                className={`flex size-[30px] flex-none items-center justify-center rounded-md ${
                  unreadCount > 0
                    ? "bg-[color:var(--mp-brand)]/14 text-[color:var(--mp-brand)]"
                    : "bg-[color:var(--mp-surface-3)] text-[color:var(--mp-fg-subtle)]"
                }`}
              >
                <BellIcon className="size-4" />
              </span>
              <span className="flex flex-col leading-tight">
                <span
                  className={`font-mono text-xl font-semibold tabular-nums ${
                    unreadCount > 0
                      ? "text-[color:var(--mp-brand)]"
                      : "text-foreground"
                  }`}
                >
                  {unreadCount}
                </span>
                <span className="mt-0.5 text-[11px] text-[color:var(--mp-fg-muted)]">
                  未読
                </span>
              </span>
            </div>
          </div>
        </header>

        {/* リスト見出し */}
        <div className="mb-3.5 mt-8 flex items-baseline gap-2.5">
          <span
            aria-hidden
            className="relative top-0.5 h-4 w-[3px] rounded-sm bg-[color:var(--mp-brand)]"
          />
          <h2 className="text-base font-extrabold tracking-tight text-foreground">
            すべての通知
          </h2>
          <span className="font-mono text-[13px] font-semibold tabular-nums text-[color:var(--mp-fg-subtle)]">
            ({notifications.length})
          </span>
          <span className="ml-auto text-xs text-[color:var(--mp-fg-subtle)]">
            新しい順
          </span>
        </div>

        {notifications.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-[color:var(--mp-border-strong)] bg-card px-6 py-16 text-center">
            <span
              aria-hidden
              className="mb-4 flex size-14 items-center justify-center rounded-full border border-border bg-[color:var(--mp-surface-3)] text-[color:var(--mp-fg-subtle)]"
            >
              <BellIcon className="size-[26px]" />
            </span>
            <h3 className="text-base font-bold text-foreground">
              通知はまだありません。
            </h3>
            <p className="mt-2 max-w-[340px] text-sm text-muted-foreground">
              あなた宛てのお知らせが届くと、ここに新しい順で表示されます。
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5">
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
