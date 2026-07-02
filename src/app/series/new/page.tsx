// シリーズ作成ページ: ログインユーザーが継続企画（シリーズ）を作る。
// 作成者は owner として登録される（Server Action 側）。

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
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-lg px-6 py-10">
        <h1 className="text-2xl font-bold">シリーズを作成</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          継続して開催する企画を作成します。あとから各開催回（イベント）を紐付けられます。
        </p>
        <SeriesForm />
      </div>
    </div>
  );
}
