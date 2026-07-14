import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { FilterSelect } from "./filter-select";
import { FilterTab } from "@/components/matchpoint/filter-tab";
import {
  listPublishedEvents,
  listGamesInPublishedEvents,
} from "@/lib/repositories/events";
import { EventStatusBadge } from "@/components/matchpoint/event-status-badge";
import type { EventStatus } from "@/lib/services/event-status";
import {
  type EventListTab,
  type EventListSort,
  TAB_LABEL,
  normalizeTab,
  normalizeSort,
  statusesForTab,
  countByTab,
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

/** 締切が近い（24時間以内・未来）かどうか。募集締切間近バッジ用。 */
function isDeadlineSoon(iso: string | null): boolean {
  if (!iso) return false;
  const diff = new Date(iso).getTime() - Date.now();
  return diff > 0 && diff <= 24 * 60 * 60 * 1000;
}

export default async function EventsListPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; sort?: string; game?: string }>;
}) {
  const sp = await searchParams;
  const tab = normalizeTab(sp.tab);
  const sort = normalizeSort(sp.sort);
  const gameId = sp.game;

  // 件数バッジ用の母集合は「ゲーム絞り込み後・タブ絞り込み前」。ゲームを選ぶと各タブの件数も
  // そのゲーム内の件数になり、バッジと実表示件数が一致する（タブはこの母集合をさらに status で絞る）。
  const [pool, games] = await Promise.all([
    listPublishedEvents({ sort, gameId }),
    listGamesInPublishedEvents(),
  ]);
  const counts = countByTab(pool.map((e) => e.status as EventStatus));

  // 表示分は母集合をタブ（status 群）でさらに絞る。all は絞らないので母集合そのまま。
  const filterStatuses = statusesForTab(tab);
  const statusSet = new Set<string>(filterStatuses);
  const events =
    filterStatuses.length === 0
      ? pool
      : pool.filter((e) => statusSet.has(e.status));

  return (
    <div className="theme-matchpoint min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* 見出し行 */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold tracking-widest text-[color:var(--mp-fg-subtle)]">
              <span className="h-px w-6 bg-[color:var(--mp-brand)]" />
              EVENTS
            </p>
            <h1 className="mt-2 flex items-baseline gap-3 text-3xl font-bold tracking-tight">
              イベント一覧
              <span className="text-base font-medium text-muted-foreground tabular-nums">
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

        {/* フィルタ行：タブ（左）＋ゲーム/並び順（右） */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-[color:var(--mp-surface)] p-1">
            {(Object.keys(TAB_LABEL) as EventListTab[]).map((t) => (
              <FilterTab
                key={t}
                label={TAB_LABEL[t]}
                count={counts[t]}
                active={t === tab}
                href={buildHref({ tab: t, sort, game: gameId })}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {games.length > 0 && (
              <FilterSelect
                name="game"
                value={gameId ?? ""}
                ariaLabel="ゲームで絞り込み"
                preserve={{ tab: tab === "all" ? undefined : tab, sort }}
                options={[
                  { value: "", label: "全ゲーム" },
                  ...games.map((g) => ({ value: g.id, label: g.name })),
                ]}
              />
            )}
            <FilterSelect
              name="sort"
              value={sort}
              ariaLabel="並び替え"
              preserve={{ tab: tab === "all" ? undefined : tab, game: gameId }}
              options={[
                { value: "soon", label: "開催日が近い順" },
                { value: "new", label: "新着順" },
              ]}
            />
          </div>
        </div>

        {/* カードグリッド */}
        {events.length === 0 ? (
          <EmptyState hasFilter={tab !== "all" || !!gameId} />
        ) : (
          <ul className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((event) => {
              const gameName =
                (event.games as { name: string } | null)?.name ?? "-";
              const organizerName =
                event.organizer_display_name ??
                (event.organizer as { discord_name: string } | null)
                  ?.discord_name ??
                "-";
              const href = `/events/${event.slug ?? event.id}`;
              const deadlineSoon =
                event.status !== "finished" &&
                isDeadlineSoon(event.recruit_deadline);
              return (
                <li key={event.id}>
                  <EventCard
                    href={href}
                    gameName={gameName}
                    status={event.status as EventStatus}
                    title={event.title}
                    startsAt={event.starts_at}
                    recruitDeadline={event.recruit_deadline}
                    deadlineSoon={deadlineSoon}
                    organizerName={organizerName}
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

/** クエリを維持したまま href を組む（undefined は落とす）。 */
function buildHref(params: {
  tab: EventListTab;
  sort: EventListSort;
  game?: string;
}): string {
  const q = new URLSearchParams();
  if (params.tab !== "all") q.set("tab", params.tab);
  if (params.sort !== "soon") q.set("sort", params.sort);
  if (params.game) q.set("game", params.game);
  const s = q.toString();
  return s ? `/events?${s}` : "/events";
}

/** イベントカード。 */
function EventCard({
  href,
  gameName,
  status,
  title,
  startsAt,
  recruitDeadline,
  deadlineSoon,
  organizerName,
}: {
  href: string;
  gameName: string;
  status: EventStatus;
  title: string;
  startsAt: string | null;
  recruitDeadline: string | null;
  deadlineSoon: boolean;
  organizerName: string;
}) {
  return (
    <Link
      href={href}
      className="group flex h-full flex-col rounded-2xl border border-border bg-card p-5 shadow-[var(--mp-e1)] transition hover:-translate-y-0.5 hover:border-[color:var(--mp-brand)]/50 hover:shadow-[var(--mp-e2)]"
    >
      {/* 上段：ゲームチップ＋状態バッジ */}
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-[color:var(--mp-surface-2)] px-2.5 py-1 text-xs font-medium text-muted-foreground">
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full bg-[color:var(--mp-danger)]"
          />
          {gameName}
        </span>
        <EventStatusBadge status={status} />
      </div>

      {/* タイトル */}
      <h2 className="mt-3 line-clamp-2 min-h-[2.75rem] text-lg font-semibold leading-snug text-foreground">
        {title}
      </h2>

      {/* 日時 */}
      <dl className="mt-3 space-y-1.5 text-sm">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-[color:var(--mp-fg-subtle)]">開催日</dt>
          <dd className="font-mono tabular-nums text-foreground">
            {fmtJst(startsAt)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-[color:var(--mp-fg-subtle)]">募集締切</dt>
          <dd
            className={`font-mono tabular-nums ${
              deadlineSoon
                ? "text-[color:var(--mp-warning)]"
                : status === "finished"
                  ? "text-muted-foreground"
                  : "text-foreground"
            }`}
          >
            {status === "closed" || status === "finished"
              ? "締切済"
              : fmtJst(recruitDeadline)}
          </dd>
        </div>
      </dl>

      {/* 下段：主催者＋矢印 */}
      <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
        <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <span
            aria-hidden
            className="flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--mp-surface-3)] text-xs font-bold text-[color:var(--mp-brand)]"
          >
            {organizerName.slice(0, 1)}
          </span>
          {organizerName}
        </span>
        <ArrowRight className="h-4 w-4 text-[color:var(--mp-fg-subtle)] transition group-hover:translate-x-0.5 group-hover:text-[color:var(--mp-brand)]" />
      </div>
    </Link>
  );
}

/** 空状態。フィルタ適用時は文言を変える。 */
function EmptyState({ hasFilter }: { hasFilter: boolean }) {
  return (
    <div className="mt-10 rounded-2xl border border-dashed border-border bg-[color:var(--mp-surface)] px-6 py-16 text-center">
      <p className="text-sm text-muted-foreground">
        {hasFilter
          ? "条件に合うイベントはありません。"
          : "公開中のイベントはまだありません。"}
      </p>
      {hasFilter ? (
        <Link
          href="/events"
          className="mt-3 inline-block text-sm text-[color:var(--mp-brand)] underline-offset-2 hover:underline"
        >
          すべてのイベントを見る
        </Link>
      ) : (
        <Link
          href="/events/new"
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-[color:var(--mp-brand-hover)]"
        >
          ＋ 最初のイベントを作成
        </Link>
      )}
    </div>
  );
}
