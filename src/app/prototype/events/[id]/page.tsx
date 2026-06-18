import Link from "next/link";
import { notFound } from "next/navigation";
import { EVENTS } from "../../data";

export default async function EventDetailPrototype({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const e = EVENTS.find((ev) => ev.id === id);
  if (!e) notFound();

  const full = e.applied >= e.capacity;

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Link href="/prototype/events" className="text-sm text-muted-foreground hover:underline">
          ← イベント一覧
        </Link>

        {/* ヘッダー */}
        <div className="mt-4 rounded-xl border border-border bg-card p-6">
          {e.series && (
            <Link
              href="#"
              className="text-xs font-medium text-primary/80 hover:underline"
            >
              {e.series} をフォロー
            </Link>
          )}
          <h1 className="mt-1 text-2xl font-bold">{e.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            主催 {e.organizer} ・ {e.game} ・ 開始 {e.startsAt}
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

          {/* 定員バー */}
          <div className="mt-5">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">参加チーム</span>
              <span className="tabular-nums">
                {e.applied} / {e.capacity}
              </span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted/50">
              <div
                className={`h-full ${full ? "bg-destructive" : "bg-primary"}`}
                style={{ width: `${(e.applied / e.capacity) * 100}%` }}
              />
            </div>
          </div>

          {/* 応募ボタン */}
          <div className="mt-5 flex gap-3">
            <Link
              href="/prototype/apply"
              className={`flex-1 rounded-lg px-4 py-2.5 text-center text-sm font-semibold ${
                full
                  ? "cursor-not-allowed bg-muted text-muted-foreground"
                  : "bg-primary text-primary-foreground hover:opacity-90"
              }`}
            >
              {full ? "満員（募集終了）" : "このイベントに応募する"}
            </Link>
            <button className="rounded-lg border border-border px-4 py-2.5 text-sm hover:border-primary/60">
              ♡ フォロー
            </button>
          </div>
        </div>

        {/* 概要 */}
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-muted-foreground">イベント概要</h2>
          <p className="mt-2 text-sm leading-relaxed">
            5v5 のチーム戦。予選グループ（総当たり）を勝ち抜いた上位チームが決勝トーナメントへ進出します。
            応募時にロール別ランクを申告し、運営がチーム平均スコアが均等になるよう振り分けます。
          </p>
        </section>

        {/* 関連リンク（プロトタイプ内回遊） */}
        <section className="mt-6 grid gap-3 sm:grid-cols-2">
          <Link
            href="/prototype/schedule"
            className="rounded-xl border border-border bg-card p-4 text-sm hover:border-primary/60"
          >
            🗓 試合スケジュール・順位表を見る →
          </Link>
          <Link
            href="/prototype/teams"
            className="rounded-xl border border-border bg-card p-4 text-sm hover:border-primary/60"
          >
            🛠 チーム編成（運営向け）を見る →
          </Link>
        </section>
      </div>
    </div>
  );
}
