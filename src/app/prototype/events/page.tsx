import Link from "next/link";
import { EVENTS } from "../data";

const STATUS_STYLE: Record<string, string> = {
  募集中: "border-primary/50 bg-primary/15 text-primary",
  募集終了: "border-muted-foreground/40 bg-muted/40 text-muted-foreground",
  開催中: "border-chart-2/50 bg-chart-2/15 text-chart-2",
  終了: "border-muted-foreground/30 bg-muted/30 text-muted-foreground",
};

export default function EventsListPrototype() {
  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <Link href="/prototype" className="text-sm text-muted-foreground hover:underline">
          ← プロトタイプ一覧
        </Link>

        <div className="mt-4 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold">イベント一覧</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              開催中・募集中のイベント。タグや状態で探せます。
            </p>
          </div>
          <button className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
            ＋ イベント作成
          </button>
        </div>

        {/* 簡易フィルタ（見た目のみ） */}
        <div className="mt-5 flex flex-wrap gap-2">
          {["すべて", "募集中", "初心者歓迎", "賞金あり", "長期リーグ"].map((f, i) => (
            <span
              key={f}
              className={`rounded-full border px-3 py-1 text-xs ${
                i === 0
                  ? "border-primary/60 bg-primary/15 text-primary"
                  : "border-border bg-card text-muted-foreground"
              }`}
            >
              {f}
            </span>
          ))}
        </div>

        {/* カード一覧 */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {EVENTS.map((e) => (
            <Link
              key={e.id}
              href={`/prototype/events/${e.id}`}
              className="group flex flex-col rounded-xl border border-border bg-card p-5 transition hover:border-primary/60 hover:bg-accent/40"
            >
              <div className="flex items-center justify-between">
                {e.series ? (
                  <span className="text-xs font-medium text-primary/80">{e.series}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">単発イベント</span>
                )}
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLE[e.status]}`}
                >
                  {e.status}
                </span>
              </div>
              <h2 className="mt-2 text-lg font-semibold group-hover:underline">{e.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                主催: {e.organizer} ・ {e.game}
              </p>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {e.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-md bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground"
                  >
                    {t}
                  </span>
                ))}
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-sm">
                <span className="text-muted-foreground">開始 {e.startsAt}</span>
                <span className="tabular-nums">
                  {e.applied}/{e.capacity} チーム
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
