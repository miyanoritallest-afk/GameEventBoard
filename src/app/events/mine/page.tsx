import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listEventsByOrganizer } from "@/lib/repositories/events";
import type { EventStatus } from "@/lib/services/event-status";
import {
  type MyEventsTab,
  MY_TAB_LABEL,
  normalizeMyTab,
  statusesForMyTab,
  countByMyTab,
  statusTone,
  type StatusTone,
} from "@/lib/services/event-list-filter";

export const dynamic = "force-dynamic";

/** UTC(ISO) を JST の「YYYY/MM/DD HH:mm」表示に整形する。null は "未定"。 */
function fmtJst(iso: string | null): string {
  if (!iso) return "未定";
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_LABEL: Record<string, string> = {
  draft: "下書き",
  published: "募集中",
  recruiting: "募集中",
  closed: "募集締切",
  ongoing: "開催中",
  finished: "終了",
};

export default async function MyEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  // 自分のイベント管理。未ログインは /login へ。
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?redirect=${encodeURIComponent("/events/mine")}`);
  }

  const tab = normalizeMyTab((await searchParams).tab);

  const pool = await listEventsByOrganizer(user.id);
  const counts = countByMyTab(pool.map((e) => e.status as EventStatus));

  // 表示分はタブ（status 群）で絞る。all は絞らない（母集合そのまま）。
  const filterStatuses = statusesForMyTab(tab);
  const statusSet = new Set<string>(filterStatuses);
  const events =
    filterStatuses.length === 0
      ? pool
      : pool.filter((e) => statusSet.has(e.status));

  return (
    <div className="theme-matchpoint min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-6 py-10">
        {/* 見出し行 */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="flex items-center gap-[9px] font-mono text-[11.5px] uppercase tracking-[0.2em] text-[color:var(--mp-accent)] before:h-0.5 before:w-[22px] before:bg-[color:var(--mp-accent)] before:content-['']">
              My Events
            </p>
            <h1 className="mt-2 flex items-baseline gap-3 text-3xl font-extrabold tracking-tight">
              自分のイベント
              <span className="font-mono text-base font-medium tabular-nums text-[color:var(--mp-fg-subtle)]">
                {counts.all} 件
              </span>
            </h1>
          </div>
          <Link
            href="/events/new"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-[color:var(--mp-brand-hover)]"
          >
            ＋ イベントを作成
          </Link>
        </div>

        {/* フィルタタブ */}
        <div className="mt-6 flex flex-wrap items-center gap-3 border-b border-border pb-[18px]">
          <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-[color:var(--mp-surface)] p-1">
            {(Object.keys(MY_TAB_LABEL) as MyEventsTab[]).map((t) => (
              <FilterTab
                key={t}
                label={MY_TAB_LABEL[t]}
                count={counts[t]}
                active={t === tab}
                href={buildHref(t)}
              />
            ))}
          </div>
        </div>

        {/* カードグリッド */}
        {events.length === 0 ? (
          <EmptyState tab={tab} />
        ) : (
          <ul className="mt-6 grid grid-cols-1 gap-[18px] sm:grid-cols-2 lg:grid-cols-3">
            {events.map((event) => {
              const gameName =
                (event.games as { name: string } | null)?.name ?? "-";
              // 下書きは uuid、公開済みは slug で詳細に遷移。編集は常に uuid。
              const detailHref = `/events/${event.slug ?? event.id}`;
              return (
                <li key={event.id}>
                  <EventCard
                    detailHref={detailHref}
                    editHref={`/events/${event.id}/edit`}
                    gameName={gameName}
                    status={event.status as EventStatus}
                    title={event.title}
                    startsAt={event.starts_at}
                    recruitDeadline={event.recruit_deadline}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/** タブのクエリを組む（all は素の /events/mine）。 */
function buildHref(tab: MyEventsTab): string {
  return tab === "all" ? "/events/mine" : `/events/mine?tab=${tab}`;
}

/** フィルタタブ1つ（件数バッジ付き）。active でブランド強調。 */
function FilterTab({
  label,
  count,
  active,
  href,
}: {
  label: string;
  count: number;
  active: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
        active
          ? "bg-[color:var(--mp-brand)]/15 text-[color:var(--mp-brand)]"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
      <span
        className={`font-mono text-xs tabular-nums ${
          active
            ? "text-[color:var(--mp-brand)]"
            : "text-[color:var(--mp-fg-subtle)]"
        }`}
      >
        {count}
      </span>
    </Link>
  );
}

/** 状態バッジ（トーン別）。live は pulse、success は ✓、draft は破線。 */
function StatusBadge({ status }: { status: EventStatus }) {
  const tone: StatusTone = statusTone(status);
  const label = STATUS_LABEL[status] ?? status;
  const color =
    tone === "success"
      ? "var(--mp-success)"
      : tone === "live"
        ? "var(--mp-live)"
        : tone === "warning"
          ? "var(--mp-warning)"
          : tone === "draft"
            ? "var(--mp-accent)"
            : "var(--mp-fg-subtle)";
  const prefix = tone === "success" ? "✓ " : tone === "draft" ? "✎ " : "";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{
        color,
        backgroundColor: `color-mix(in oklab, ${color} 12%, transparent)`,
        border: `1px ${tone === "draft" ? "dashed" : "solid"} color-mix(in oklab, ${color} 38%, transparent)`,
      }}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${tone === "live" ? "animate-pulse" : ""}`}
        style={{ backgroundColor: color }}
      />
      {prefix}
      {label}
    </span>
  );
}

/** 自分のイベントカード（詳細/編集の管理導線つき）。下書き・終了はトーンを落とす。 */
function EventCard({
  detailHref,
  editHref,
  gameName,
  status,
  title,
  startsAt,
  recruitDeadline,
}: {
  detailHref: string;
  editHref: string;
  gameName: string;
  status: EventStatus;
  title: string;
  startsAt: string | null;
  recruitDeadline: string | null;
}) {
  const isDraft = status === "draft";
  const isEnded = status === "finished";
  const deadlineClosed = status === "closed" || status === "finished";

  return (
    <div
      className={`group flex h-full flex-col rounded-xl border bg-card p-[18px] shadow-[var(--mp-e1)] transition hover:-translate-y-0.5 hover:border-[color:var(--mp-brand)]/50 hover:shadow-[var(--mp-e2)] ${
        isDraft
          ? "border-dashed border-[color:var(--mp-border-strong)]"
          : "border-border"
      } ${isEnded ? "opacity-75 hover:opacity-100" : ""}`}
    >
      {/* 上段：ゲームチップ＋状態バッジ */}
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-[color:var(--mp-surface-3)] px-2 py-1 font-mono text-[10.5px] font-medium tracking-[0.08em] text-muted-foreground">
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full bg-[color:var(--mp-danger)]"
          />
          {gameName}
        </span>
        <StatusBadge status={status} />
      </div>

      {/* タイトル */}
      <h2
        className={`mt-3.5 line-clamp-2 min-h-[2.7rem] text-[17px] font-bold leading-snug ${
          isDraft || isEnded
            ? "text-muted-foreground group-hover:text-foreground"
            : "text-foreground"
        }`}
      >
        {title}
      </h2>

      {/* 日時 */}
      <dl className="mt-3.5 flex flex-col gap-2 text-[12.5px]">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-[color:var(--mp-fg-subtle)]">開催日</dt>
          <dd
            className={`font-mono text-[13px] tabular-nums ${
              startsAt ? "text-foreground" : "text-[color:var(--mp-fg-subtle)]"
            }`}
          >
            {fmtJst(startsAt)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-[color:var(--mp-fg-subtle)]">募集締切</dt>
          <dd
            className={`font-mono text-[13px] tabular-nums ${
              status === "closed"
                ? "font-semibold text-[color:var(--mp-warning)]"
                : "text-muted-foreground"
            }`}
          >
            {deadlineClosed ? "締切済" : fmtJst(recruitDeadline)}
          </dd>
        </div>
      </dl>

      {/* フッター：管理導線（詳細 / 編集） */}
      <div className="mt-auto flex items-center gap-2 border-t border-border pt-3.5">
        <Link
          href={detailHref}
          className="flex flex-1 items-center justify-center rounded-md border border-[color:var(--mp-border-strong)] bg-[color:var(--mp-surface-3)] px-2.5 py-2 text-[12.5px] font-semibold text-foreground transition hover:border-[color:var(--mp-fg-subtle)] hover:bg-[color:var(--mp-surface-2)]"
        >
          詳細
        </Link>
        <Link
          href={editHref}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-2 text-[12.5px] font-semibold transition ${
            isDraft
              ? "bg-primary text-primary-foreground shadow-[0_0_0_1px_rgba(255,106,43,0.3)] hover:bg-[color:var(--mp-brand-hover)]"
              : "border border-border text-muted-foreground hover:border-[color:var(--mp-brand)] hover:text-[color:var(--mp-brand)]"
          }`}
        >
          ✎ 編集
        </Link>
      </div>
    </div>
  );
}

/** 空状態。タブ選択時は文言を変える。 */
function EmptyState({ tab }: { tab: MyEventsTab }) {
  const hasFilter = tab !== "all";
  return (
    <div className="mt-10 flex flex-col items-center rounded-2xl border border-dashed border-[color:var(--mp-border-strong)] bg-[color:var(--mp-surface)] px-8 py-16 text-center">
      <span
        aria-hidden
        className="flex size-16 items-center justify-center rounded-xl border border-[color:var(--mp-border-strong)] bg-[color:var(--mp-surface-3)] text-2xl shadow-[var(--mp-e1)]"
      >
        🗂️
      </span>
      <h2 className="mt-5 text-lg font-bold tracking-tight text-foreground">
        {hasFilter
          ? `${MY_TAB_LABEL[tab]}のイベントはありません`
          : "作成したイベントはまだありません"}
      </h2>
      <p className="mt-2.5 max-w-[420px] text-sm text-muted-foreground">
        {hasFilter
          ? "別のタブを見るか、新しいイベントを作成できます。"
          : "あなたが主催するイベントがここに並びます。下書きから準備を始めて、公開すると一覧に募集が表示されます。"}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2.5">
        <Link
          href="/events/new"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-[color:var(--mp-brand-hover)]"
        >
          ＋ {hasFilter ? "イベントを作成" : "最初のイベントを作成"}
        </Link>
        {hasFilter ? (
          <Link
            href="/events/mine"
            className="inline-flex items-center gap-2 rounded-lg border border-[color:var(--mp-border-strong)] bg-[color:var(--mp-surface-3)] px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-[color:var(--mp-surface-2)]"
          >
            すべて見る
          </Link>
        ) : (
          <Link
            href="/events"
            className="inline-flex items-center gap-2 rounded-lg border border-[color:var(--mp-border-strong)] bg-[color:var(--mp-surface-3)] px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-[color:var(--mp-surface-2)]"
          >
            公開中のイベントを見る →
          </Link>
        )}
      </div>
    </div>
  );
}
