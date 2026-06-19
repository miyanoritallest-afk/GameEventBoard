// ログイン確認用のページ。ログインしていれば Discord のユーザー情報を表示する。
// （Battle Tag 登録や users テーブル保存は次の段階で実装。今は認証の動作確認用）

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "./logout-button";

export const dynamic = "force-dynamic";

export default async function MePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-lg px-6 py-16">
        <h1 className="text-2xl font-bold">ログイン状態の確認</h1>

        {user ? (
          <div className="mt-6 rounded-xl border border-primary/50 bg-primary/10 p-6">
            <p className="text-sm text-primary">✓ ログイン成功</p>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">表示名</dt>
                <dd className="font-medium">
                  {(user.user_metadata?.full_name as string) ??
                    (user.user_metadata?.name as string) ??
                    "(取得できず)"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">プロバイダー</dt>
                <dd className="font-medium">{user.app_metadata?.provider}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">ユーザーID</dt>
                <dd className="font-mono text-xs">{user.id}</dd>
              </div>
            </dl>
            <div className="mt-6">
              <LogoutButton />
            </div>
          </div>
        ) : (
          <div className="mt-6 rounded-xl border border-border bg-card p-6">
            <p className="text-sm text-muted-foreground">
              ログインしていません。
            </p>
            <Link
              href="/login"
              className="mt-4 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              ログインページへ
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
