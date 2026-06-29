"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
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
    <div className="dark flex min-h-screen items-center justify-center bg-background text-foreground">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 text-center">
        <p className="text-sm font-medium tracking-widest text-primary/80">
          MATCHPOINT
        </p>
        <h1 className="mt-2 text-2xl font-bold">ログイン</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Discord アカウントでログインします。
        </p>

        <button
          onClick={signInWithDiscord}
          disabled={loading}
          className="mt-8 w-full rounded-lg bg-[#5865F2] px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "リダイレクト中..." : "Discord でログイン"}
        </button>

        {error && (
          <p className="mt-4 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            エラー: {error}
          </p>
        )}
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
