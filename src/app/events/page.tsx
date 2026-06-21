import Link from "next/link";
import { listPublishedEvents } from "@/lib/repositories/events";

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
  published: "公開中",
  recruiting: "募集中",
  closed: "募集締切",
  ongoing: "開催中",
  finished: "終了",
};

export default async function EventsListPage() {
  // 公開済みのみ（下書きは出さない）。新しい順は Repository 側で担保。
  const events = await listPublishedEvents();

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-bold">イベント一覧</h1>

        {events.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">
            公開中のイベントはまだありません。
          </p>
        ) : (
          <ul className="mt-6 space-y-3">
            {events.map((event) => {
              const gameName =
                (event.games as { name: string } | null)?.name ?? "-";
              // 公開済みは slug URL、なければ id にフォールバック。
              const href = `/events/${event.slug ?? event.id}`;
              return (
                <li key={event.id}>
                  <Link
                    href={href}
                    className="block rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/50"
                  >
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="rounded bg-muted px-2 py-0.5">
                        {gameName}
                      </span>
                      <span className="rounded bg-primary/10 px-2 py-0.5 text-primary">
                        {STATUS_LABEL[event.status] ?? event.status}
                      </span>
                    </div>
                    <h2 className="mt-2 text-lg font-semibold">{event.title}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      開催 {fmtJstDate(event.starts_at)} ／ 募集締切{" "}
                      {fmtJstDate(event.recruit_deadline)}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
