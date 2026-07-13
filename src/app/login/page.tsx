"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

/** オープンリダイレクト対策: 内部パス（/始まり・//除く）のみ許可。 */
function safeRedirect(raw: string | null): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/";
}

function LoginInner() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();

  async function signInWithDiscord() {
    setLoading(true);
    setError(null);
    const next = safeRedirect(searchParams.get("redirect"));
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: {
        // Discord認証後に戻ってくる先（このアプリのコールバックルート）。
        // 認証完了後の最終遷移先を next で持ち回る。
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
    // 成功時は Discord の認可画面へリダイレクトするため、ここでは何もしない
  }

  return (
    <div className="theme-matchpoint relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6 py-14 text-foreground">
      {/* 背景グロー＋グリッド（装飾・pointer-events なし） */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(1100px 620px at 72% -8%, rgba(255,106,43,.22), transparent 56%)," +
            "radial-gradient(860px 560px at 8% 108%, rgba(34,211,238,.12), transparent 54%)," +
            "linear-gradient(180deg, rgba(11,14,20,0), rgba(11,14,20,.55))",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(rgba(41,50,63,.5) 1px,transparent 1px)," +
            "linear-gradient(90deg,rgba(41,50,63,.5) 1px,transparent 1px)",
          backgroundSize: "52px 52px",
          maskImage:
            "radial-gradient(760px 520px at 50% 40%, #000 12%, transparent 70%)",
          WebkitMaskImage:
            "radial-gradient(760px 520px at 50% 40%, #000 12%, transparent 70%)",
        }}
      />

      {/* ログインカード */}
      <div className="relative z-10 w-full max-w-[432px] overflow-hidden rounded-2xl border border-[color:var(--mp-border-strong)] bg-gradient-to-b from-[color:var(--mp-surface-2)] to-card p-10 shadow-[var(--mp-e3)]">
        {/* 上端のブランド→アクセントのグラデ帯 */}
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-0.5"
          style={{
            background:
              "linear-gradient(90deg,transparent, var(--mp-brand) 45%, var(--mp-accent) 88%, transparent)",
            opacity: 0.7,
          }}
        />

        {/* ロゴ */}
        <span className="inline-flex items-center gap-[11px] font-heading text-xl font-extrabold tracking-tight text-foreground">
          <span
            aria-hidden
            className="size-[11px] rounded-full bg-[color:var(--mp-brand)] shadow-[0_0_16px_2px_var(--mp-brand)]"
          />
          Matchpoint
        </span>

        <p className="mt-7 flex items-center gap-[9px] font-mono text-[11px] uppercase tracking-[0.22em] text-[color:var(--mp-accent)] before:h-0.5 before:w-5 before:bg-[color:var(--mp-accent)] before:content-['']">
          Sign in
        </p>
        <h1 className="mt-2.5 text-3xl font-extrabold leading-tight tracking-tight text-foreground">
          ログイン
        </h1>
        <p className="mt-3.5 text-sm leading-relaxed text-muted-foreground">
          Discord
          アカウントでログインして、大会に参加したり、自分のイベントを主催しよう。
        </p>

        {/* Discord ログインボタン */}
        <button
          type="button"
          onClick={signInWithDiscord}
          disabled={loading}
          aria-live="polite"
          className="mt-7 flex w-full items-center justify-center gap-2.5 rounded-md bg-[color:var(--mp-discord)] px-[22px] py-[15px] text-[15px] font-semibold text-white shadow-[0_0_0_1px_rgba(88,101,242,0.4),0_8px_22px_rgba(88,101,242,0.28)] transition hover:bg-[color:var(--mp-discord-hover)] active:translate-y-px disabled:cursor-progress disabled:opacity-70"
        >
          {loading ? (
            <span
              aria-hidden
              className="size-[17px] flex-none animate-spin rounded-full border-2 border-white/35 border-t-white"
            />
          ) : (
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden
              className="size-[21px] flex-none"
            >
              <path d="M19.27 5.33A16.6 16.6 0 0 0 15.1 4l-.2.4a12.5 12.5 0 0 1 3.7 1.9 13.9 13.9 0 0 0-11.2 0A12.5 12.5 0 0 1 11.1 4.4L10.9 4a16.6 16.6 0 0 0-4.17 1.33C4.1 9.24 3.4 13.05 3.75 16.8a16.7 16.7 0 0 0 5.06 2.56l.42-.6c-.7-.26-1.36-.58-1.98-.96l.16-.12a11.9 11.9 0 0 0 9.18 0l.16.12c-.62.38-1.28.7-1.98.96l.42.6a16.7 16.7 0 0 0 5.06-2.56c.42-4.35-.68-8.13-2.98-11.47ZM9.68 14.5c-.98 0-1.79-.9-1.79-2s.79-2 1.79-2 1.8.9 1.79 2c0 1.1-.8 2-1.79 2Zm4.64 0c-.98 0-1.79-.9-1.79-2s.79-2 1.79-2 1.8.9 1.79 2c0 1.1-.79 2-1.79 2Z" />
            </svg>
          )}
          {loading ? "リダイレクト中..." : "Discord でログイン"}
        </button>

        {/* エラー表示 */}
        {error && (
          <div
            role="alert"
            className="mt-5 flex items-start gap-2.5 rounded-md border border-destructive/40 bg-destructive/[0.09] px-3.5 py-3 text-[12.5px] leading-relaxed text-destructive"
          >
            <span aria-hidden className="flex-none">
              ⚠
            </span>
            <span>エラー: {error}</span>
          </div>
        )}

        {/* 区切り＋トップへ戻る */}
        <div className="mt-[26px] flex items-center gap-3 font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--mp-fg-subtle)] before:h-px before:flex-1 before:bg-border before:content-[''] after:h-px after:flex-1 after:bg-border after:content-['']">
          Matchpoint
        </div>
        <Link
          href="/"
          className="mt-5 block text-center text-[13px] text-muted-foreground transition hover:text-[color:var(--mp-brand)]"
        >
          ← トップに戻る
        </Link>
      </div>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams は Suspense 境界が必要。
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
