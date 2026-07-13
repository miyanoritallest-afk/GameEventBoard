// シリーズ一覧: 継続する企画（シリーズ）の一覧。公開（誰でも閲覧可）。
// ログインユーザーは「新規作成」できる。

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { listSeries } from "@/lib/repositories/series";

export const dynamic = "force-dynamic";

/** シリーズカードの左アクセント色（id から決定的に選ぶ・装飾）。 */
const CARD_COLORS = [
  "var(--mp-brand)",
  "var(--mp-accent)",
  "#a78bfa",
  "var(--mp-success)",
  "var(--mp-warning)",
];
function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return CARD_COLORS[h % CARD_COLORS.length];
}

export default async function SeriesListPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const series = await listSeries();

  return (
    <div className="theme-matchpoint min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-6 py-10">
        {/* 見出し行 */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="flex items-center gap-[9px] font-mono text-[11.5px] uppercase tracking-[0.2em] text-[color:var(--mp-accent)] before:h-0.5 before:w-[22px] before:bg-[color:var(--mp-accent)] before:content-['']">
              Series
            </p>
            <h1 className="mt-2 flex items-baseline gap-3 text-3xl font-extrabold tracking-tight">
              シリーズ一覧
              <span className="font-mono text-base font-medium tabular-nums text-[color:var(--mp-fg-subtle)]">
                {series.length} 件
              </span>
            </h1>
            <p className="mt-3 max-w-[560px] text-sm text-muted-foreground">
              継続して開催される企画（リーグ・大会シリーズ）です。各シリーズに複数の開催回がぶら下がります。フォローすると新しい開催回の公開を通知します。
            </p>
          </div>
          {user && (
            <Link
              href="/series/new"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-[color:var(--mp-brand-hover)]"
            >
              ＋ シリーズを作成
            </Link>
          )}
        </div>

        {/* カードグリッド */}
        {series.length === 0 ? (
          <EmptyState canCreate={!!user} />
        ) : (
          <ul className="mt-8 grid grid-cols-1 gap-[18px] sm:grid-cols-2 lg:grid-cols-3">
            {series.map((s) => (
              <li key={s.id}>
                <SeriesCard
                  href={`/series/${s.id}`}
                  name={s.name}
                  description={s.description}
                  color={colorFor(s.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** シリーズカード（名前＋説明＋左アクセント）。 */
function SeriesCard({
  href,
  name,
  description,
  color,
}: {
  href: string;
  name: string;
  description: string | null;
  color: string;
}) {
  return (
    <Link
      href={href}
      className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card p-5 pl-[22px] shadow-[var(--mp-e1)] transition hover:-translate-y-0.5 hover:border-[color:var(--mp-border-strong)] hover:shadow-[var(--mp-e2)]"
    >
      {/* 左アクセント帯 */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: color }}
      />
      <span className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--mp-fg-subtle)]">
        <span
          aria-hidden
          className="size-2.5 rounded-[3px]"
          style={{ background: color }}
        />
        Series
      </span>
      <h2 className="mt-3 line-clamp-2 text-[17px] font-bold leading-snug text-foreground">
        {name}
      </h2>
      {description ? (
        <p className="mt-2 line-clamp-3 text-[13px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : (
        <p className="mt-2 text-[13px] italic text-[color:var(--mp-fg-subtle)]">
          説明は未設定です。
        </p>
      )}
      <div className="mt-auto flex items-center justify-end pt-4">
        <span
          aria-hidden
          className="text-[color:var(--mp-fg-subtle)] transition group-hover:translate-x-0.5 group-hover:text-[color:var(--mp-brand)]"
        >
          →
        </span>
      </div>
    </Link>
  );
}

/** 空状態。作成できるかで導線を変える。 */
function EmptyState({ canCreate }: { canCreate: boolean }) {
  return (
    <div className="mt-10 flex flex-col items-center rounded-2xl border border-dashed border-[color:var(--mp-border-strong)] bg-[color:var(--mp-surface)] px-8 py-16 text-center">
      <span
        aria-hidden
        className="flex size-16 items-center justify-center rounded-xl border border-[color:var(--mp-border-strong)] bg-[color:var(--mp-surface-3)] text-2xl shadow-[var(--mp-e1)]"
      >
        🗂️
      </span>
      <h2 className="mt-5 text-lg font-bold tracking-tight text-foreground">
        まだシリーズがありません
      </h2>
      <p className="mt-2.5 max-w-[420px] text-sm text-muted-foreground">
        継続開催の企画をシリーズとしてまとめられます。最初のシリーズを作成して、開催回を束ねましょう。
      </p>
      {canCreate ? (
        <Link
          href="/series/new"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-[color:var(--mp-brand-hover)]"
        >
          ＋ 最初のシリーズを作成
        </Link>
      ) : (
        <p className="mt-6 text-xs text-[color:var(--mp-fg-subtle)]">
          ※ シリーズの作成にはログインが必要です。
        </p>
      )}
    </div>
  );
}
