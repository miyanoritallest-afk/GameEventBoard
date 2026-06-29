import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { findDiscordName } from "@/lib/repositories/users";
import { LogoutButton } from "@/app/me/logout-button";

/**
 * 全ページ共通ヘッダー（サーバーコンポーネント）。layout.tsx に配置する。
 * - ロゴ（Matchpoint）＝トップへ / イベント一覧 / イベント作成 は常時表示。
 * - ログイン状態で右側を出し分け: 未ログイン=「ログイン」/ ログイン=Discord名(→/me)＋ログアウト。
 * 表示名は users.discord_name（サイト全体で一貫した本人識別）。
 */
export async function SiteHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const discordName = user ? await findDiscordName(user.id) : null;

  return (
    <header className="dark border-b border-border bg-background text-foreground">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-lg font-bold tracking-tight">
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
