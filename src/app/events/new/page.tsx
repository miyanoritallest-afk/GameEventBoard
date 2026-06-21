import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listGames } from "@/lib/repositories/games";
import { EventForm } from "../event-form";
import { createEvent } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewEventPage() {
  // A: 未ログインなら /login へ誘導（?redirect で元ページに戻す）。
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?redirect=${encodeURIComponent("/events/new")}`);
  }

  const games = await listGames();

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-2xl font-bold">イベントを作成</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          下書きとして保存されます。応募者のスコア申告ルールもここで設定します。
        </p>
        <EventForm
          games={games}
          action={createEvent}
          submitLabel="この内容で作成する（下書き）"
          pendingLabel="作成中..."
        />
      </div>
    </div>
  );
}
