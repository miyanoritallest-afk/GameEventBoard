// シリーズ一覧: 継続する企画（シリーズ）の一覧。公開（誰でも閲覧可）。
// ログインユーザーは「新規作成」できる。

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { listSeries } from "@/lib/repositories/series";

export const dynamic = "force-dynamic";

export default async function SeriesListPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const series = await listSeries();

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">シリーズ</h1>
          {user && (
            <Link
              href="/series/new"
              className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              新規作成
            </Link>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          継続して開催される企画（リーグ・大会シリーズ）です。フォローすると新しい開催回の公開を通知します。
        </p>

        {series.length === 0 ? (
          <p className="mt-8 rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            まだシリーズがありません。
          </p>
        ) : (
          <ul className="mt-6 space-y-3">
            {series.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/series/${s.id}`}
                  className="block rounded-xl border border-border bg-card p-5 hover:bg-accent"
                >
                  <h2 className="font-semibold">{s.name}</h2>
                  {s.description && (
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {s.description}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
