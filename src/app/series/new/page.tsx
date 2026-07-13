// シリーズ作成ページ: ログインユーザーが継続企画（シリーズ）を作る。
// 作成者は owner として登録される（Server Action 側）。

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SeriesForm } from "../series-form";

export const dynamic = "force-dynamic";

export default async function NewSeriesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // 作成は本人専用。未ログインは /login へ（戻り先を持ち回る）。
  if (!user) {
    redirect(`/login?redirect=${encodeURIComponent("/series/new")}`);
  }

  return (
    <div className="theme-matchpoint min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[720px] px-6 py-10">
        {/* パンくず */}
        <nav className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
          <Link href="/series" className="hover:text-foreground">
            シリーズ一覧
          </Link>
          <span className="text-[color:var(--mp-fg-subtle)]">/</span>
          <span className="text-foreground">新規作成</span>
        </nav>

        {/* ヒーロー */}
        <p className="mt-6 flex items-center gap-[9px] font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--mp-accent)] before:h-0.5 before:w-[22px] before:bg-[color:var(--mp-accent)] before:content-['']">
          主催者ツール
        </p>
        <h1 className="mt-2.5 text-3xl font-extrabold tracking-tight text-foreground">
          シリーズを作成
        </h1>
        <p className="mt-3 max-w-[600px] text-sm text-muted-foreground">
          継続開催の企画をまとめるシリーズを作ります。作成後、詳細ページから開催回を追加したり、運営メンバーを招待できます。
        </p>

        <SeriesForm />
      </div>
    </div>
  );
}
