import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listEventsByOrganizer } from "@/lib/repositories/events";

export const dynamic = "force-dynamic";

/** UTC(ISO) を JST の日付表示に整形する。null は "未定"。 */
function fmtJstDate(iso: string | null): string {
  if (!iso) return "未定";
  return new Date(iso).toLocaleDateString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

const STATUS_LABEL: Record<string, string> = {
  draft: "下書き",
  published: "公開中",
  recruiting: "募集中",
  closed: "募集締切",
  ongoing: "開催中",
  finished: "終了",
};

export default async function MyEventsPage() {
  // 自分のイベント管理。未ログインは /login へ。
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?redirect=${encodeURIComponent("/events/mine")}`);
  }

  const events = await listEventsByOrganizer(user.id);

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">自分のイベント</h1>
          <Link
            href="/events/new"
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            新規作成
          </Link>
        </div>

        {events.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">
            まだイベントがありません。「新規作成」から下書きを作成できます。
          </p>
        ) : (
          <ul className="mt-6 space-y-3">
            {events.map((event) => {
              const gameName =
                (event.games as { name: string } | null)?.name ?? "-";
              const isDraft = event.status === "draft";
              // 下書きは uuid、公開済みは slug で詳細に遷移。
              const detailHref = `/events/${event.slug ?? event.id}`;
              return (
                <li
                  key={event.id}
                  className="rounded-xl border border-border bg-card p-5"
                >
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="rounded bg-muted px-2 py-0.5">
                      {gameName}
                    </span>
                    <span
                      className={
                        isDraft
                          ? "rounded bg-muted px-2 py-0.5"
                          : "rounded bg-primary/10 px-2 py-0.5 text-primary"
                      }
                    >
                      {STATUS_LABEL[event.status] ?? event.status}
                    </span>
                  </div>
                  <h2 className="mt-2 text-lg font-semibold">{event.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    開催 {fmtJstDate(event.starts_at)} ／ 募集締切{" "}
                    {fmtJstDate(event.recruit_deadline)}
                  </p>
                  <div className="mt-3 flex items-center gap-4 text-sm">
                    <Link href={detailHref} className="text-primary hover:underline">
                      詳細
                    </Link>
                    <Link
                      href={`/events/${event.id}/edit`}
                      className="text-primary hover:underline"
                    >
                      編集
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
