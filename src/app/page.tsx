import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  listPublishedEvents,
  listEventsByOrganizer,
} from "@/lib/repositories/events";
import { listMyParticipatingEvents } from "@/lib/repositories/registrations";
import { findDiscordName } from "@/lib/repositories/users";
import type { EventStatus } from "@/lib/services/event-status";
import { statusTone, type StatusTone } from "@/lib/services/event-list-filter";

export const dynamic = "force-dynamic";

/** トップに出す募集中イベントの最大件数。 */
const FEATURED_LIMIT = 6;

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

const REG_STATUS_LABEL: Record<string, string> = {
  pending: "承認待ち",
  approved: "参加確定",
};

/** カード表示に必要な最小のイベント情報。各 Repository の戻りをこの形に寄せる。 */
type EventCardData = {
  id: string;
  slug: string | null;
  title: string;
  status: string;
  startsAt: string | null;
  recruitDeadline: string | null;
  gameName: string;
  organizerName: string;
  /** 応募者から見た自分の参加状態（参加セクションのみ）。 */
  regStatusLabel?: string;
};

/** 状態バッジ（一覧・詳細と共通の意味づけ）。live は pulse、success は ✓。 */
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
          : "var(--mp-fg-subtle)";
  const prefix = tone === "success" ? "✓ " : "";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{
        color,
        backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)`,
        border: `1px solid color-mix(in oklab, ${color} 38%, transparent)`,
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

/** イベント1件のカード（一覧ページと同じデザイン体系）。詳細へのリンク付き。 */
function EventCard({ ev }: { ev: EventCardData }) {
  const href = `/events/${ev.slug ?? ev.id}`;
  const status = ev.status as EventStatus;
  return (
    <Link
      href={href}
      className="group flex h-full flex-col rounded-2xl border border-border bg-card p-5 shadow-[var(--mp-e1)] transition hover:-translate-y-0.5 hover:border-[color:var(--mp-brand)]/50 hover:shadow-[var(--mp-e2)]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-[color:var(--mp-surface-2)] px-2.5 py-1 text-xs font-medium text-muted-foreground">
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full bg-[color:var(--mp-danger)]"
          />
          {ev.gameName}
        </span>
        <div className="flex items-center gap-1.5">
          {ev.regStatusLabel && (
            <span className="rounded-full border border-[color:var(--mp-accent)]/38 bg-[color:var(--mp-accent)]/14 px-2.5 py-1 text-xs font-semibold text-[color:var(--mp-accent)]">
              {ev.regStatusLabel}
            </span>
          )}
          <StatusBadge status={status} />
        </div>
      </div>

      <h3 className="mt-3 line-clamp-2 min-h-[2.75rem] text-lg font-semibold leading-snug text-foreground">
        {ev.title}
      </h3>

      <dl className="mt-3 space-y-1.5 text-sm">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-[color:var(--mp-fg-subtle)]">開催日</dt>
          <dd className="font-mono tabular-nums text-foreground">
            {fmtJst(ev.startsAt)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-[color:var(--mp-fg-subtle)]">募集締切</dt>
          <dd
            className={`font-mono tabular-nums ${
              status === "closed" || status === "finished"
                ? "text-muted-foreground"
                : "text-foreground"
            }`}
          >
            {status === "closed" || status === "finished"
              ? "締切済"
              : fmtJst(ev.recruitDeadline)}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
        <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <span
            aria-hidden
            className="flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--mp-surface-3)] text-xs font-bold text-[color:var(--mp-brand)]"
          >
            {ev.organizerName.slice(0, 1)}
          </span>
          {ev.organizerName}
        </span>
        <ArrowRight className="h-4 w-4 text-[color:var(--mp-fg-subtle)] transition group-hover:translate-x-0.5 group-hover:text-[color:var(--mp-brand)]" />
      </div>
    </Link>
  );
}

/** セクション見出し（ラベル＋タイトル＋任意アクション）。 */
function SectionHeading({
  overline,
  title,
  count,
  action,
}: {
  overline?: string;
  title: string;
  count?: number;
  action?: { href: string; label: string };
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        {overline && (
          <p className="flex items-center gap-2 text-xs font-semibold tracking-widest text-[color:var(--mp-fg-subtle)]">
            <span className="h-px w-6 bg-[color:var(--mp-brand)]" />
            {overline}
          </p>
        )}
        <h2 className="mt-1 flex items-baseline gap-2 text-xl font-bold tracking-tight">
          {title}
          {count != null && (
            <span className="text-sm font-medium text-muted-foreground tabular-nums">
              {count} 件
            </span>
          )}
        </h2>
      </div>
      {action && (
        <Link
          href={action.href}
          className="shrink-0 text-sm text-[color:var(--mp-brand)] underline-offset-2 hover:underline"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}

/** 空状態の共通表示。 */
function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-4 rounded-2xl border border-dashed border-border bg-[color:var(--mp-surface)] px-5 py-8 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 募集中（公開）イベントは未ログイン/ログイン双方で使う。新着順は Repository が担保。
  const published = await listPublishedEvents();
  const featured: EventCardData[] = published
    .slice(0, FEATURED_LIMIT)
    .map((e) => ({
      id: e.id,
      slug: e.slug,
      title: e.title,
      status: e.status,
      startsAt: e.starts_at,
      recruitDeadline: e.recruit_deadline,
      gameName: (e.games as { name: string } | null)?.name ?? "-",
      organizerName:
        e.organizer_display_name ??
        (e.organizer as { discord_name: string } | null)?.discord_name ??
        "-",
    }));

  // ── 未ログイン（LP の顔）─────────────────────────────
  if (!user) {
    return (
      <div className="theme-matchpoint flex-1 bg-background text-foreground">
        {/* ヒーロー */}
        <section className="relative overflow-hidden border-b border-border">
          {/* 背景演出：微かなグリッド＋ブランドのグロー */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.04]"
            style={{
              backgroundImage:
                "linear-gradient(var(--mp-fg) 1px, transparent 1px), linear-gradient(90deg, var(--mp-fg) 1px, transparent 1px)",
              backgroundSize: "48px 48px",
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full opacity-20 blur-3xl"
            style={{ background: "var(--mp-brand)" }}
          />
          <div className="relative mx-auto max-w-5xl px-6 py-20 sm:py-28">
            <span className="inline-flex items-center gap-2 rounded-full border border-[color:var(--mp-accent)]/38 bg-[color:var(--mp-accent)]/12 px-3 py-1 text-xs font-semibold text-[color:var(--mp-accent)]">
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full bg-[color:var(--mp-accent)]"
              />
              OVERWATCH 2 コミュニティ大会プラットフォーム
            </span>
            <h1 className="mt-6 text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
              ゲーム仲間と、
              <br />
              <span className="text-[color:var(--mp-brand)]">
                もっと盛り上がる。
              </span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              イベントの募集・チーム編成・対戦表をひとつの場所で。
              <br className="hidden sm:inline" />
              大会を開くのも、参加するのも、ここから始まります。
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-lg bg-[color:var(--mp-discord)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[color:var(--mp-discord-hover)]"
              >
                Discord でログイン
              </Link>
              <Link
                href="/events"
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-[color:var(--mp-surface-2)] px-5 py-3 text-sm font-medium text-foreground transition hover:border-[color:var(--mp-border-strong)]"
              >
                イベントを探す
              </Link>
            </div>
          </div>
        </section>

        {/* 募集中のイベント */}
        <section className="mx-auto max-w-5xl px-6 py-16">
          <SectionHeading
            overline="OPEN NOW"
            title="募集中のイベント"
            count={published.length}
            action={{ href: "/events", label: "すべてのイベントを見る →" }}
          />
          {featured.length === 0 ? (
            <EmptyNote>公開中のイベントはまだありません。</EmptyNote>
          ) : (
            <ul className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {featured.map((ev) => (
                <li key={ev.id}>
                  <EventCard ev={ev} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  // ── ログイン後（ダッシュボードの顔）──────────────────
  const [discordName, participatingRaw, organizing] = await Promise.all([
    findDiscordName(user.id),
    listMyParticipatingEvents(user.id),
    listEventsByOrganizer(user.id),
  ]);

  // 参加中: 応募行から埋め込みイベント（単一オブジェクト）を取り出す。
  // events が null（消えた等）の行は除外。
  const participating: EventCardData[] = (participatingRaw ?? [])
    .map((reg): EventCardData | null => {
      const e = reg.events as {
        id: string;
        slug: string | null;
        title: string;
        status: string;
        starts_at: string | null;
        recruit_deadline: string | null;
        games: { name: string } | null;
        organizer_display_name?: string | null;
        organizer?: { discord_name: string } | null;
      } | null;
      if (!e) return null;
      return {
        id: e.id,
        slug: e.slug,
        title: e.title,
        status: e.status,
        startsAt: e.starts_at,
        recruitDeadline: e.recruit_deadline,
        gameName: e.games?.name ?? "-",
        organizerName:
          e.organizer_display_name ?? e.organizer?.discord_name ?? "-",
        regStatusLabel: REG_STATUS_LABEL[reg.status],
      };
    })
    .filter((x): x is EventCardData => x !== null);

  const organizingCards: EventCardData[] = (organizing ?? []).map((e) => ({
    id: e.id,
    slug: e.slug,
    title: e.title,
    status: e.status,
    startsAt: e.starts_at,
    recruitDeadline: e.recruit_deadline,
    gameName: (e.games as { name: string } | null)?.name ?? "-",
    organizerName: discordName ?? "あなた",
  }));

  return (
    <div className="theme-matchpoint flex-1 bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <p className="flex items-center gap-2 text-xs font-semibold tracking-widest text-[color:var(--mp-fg-subtle)]">
          <span className="h-px w-6 bg-[color:var(--mp-brand)]" />
          DASHBOARD
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          こんにちは、{discordName ?? "ゲスト"} さん
        </h1>

        {/* 参加中のイベント */}
        <section className="mt-8">
          <SectionHeading title="参加中のイベント" count={participating.length} />
          {participating.length === 0 ? (
            <EmptyNote>
              まだ参加しているイベントはありません。下の「募集中のイベント」から探してみましょう。
            </EmptyNote>
          ) : (
            <ul className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {participating.map((ev) => (
                <li key={ev.id}>
                  <EventCard ev={ev} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 主催イベント（あれば一覧・なければ作成CTA） */}
        <section className="mt-12">
          <SectionHeading
            title="主催イベント"
            count={organizingCards.length}
            action={
              organizingCards.length > 0
                ? { href: "/events/new", label: "新しく作成 →" }
                : undefined
            }
          />
          {organizingCards.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-border bg-[color:var(--mp-surface)] p-8 text-center">
              <p className="text-sm text-muted-foreground">
                まだ主催イベントはありません。
              </p>
              <Link
                href="/events/new"
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-[color:var(--mp-brand-hover)]"
              >
                ＋ イベントを作ってみる
              </Link>
            </div>
          ) : (
            <ul className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {organizingCards.map((ev) => (
                <li key={ev.id}>
                  <EventCard ev={ev} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 募集中のイベント（新着） */}
        <section className="mt-12">
          <SectionHeading
            overline="OPEN NOW"
            title="募集中のイベント"
            count={published.length}
            action={{ href: "/events", label: "すべて見る →" }}
          />
          {featured.length === 0 ? (
            <EmptyNote>公開中のイベントはまだありません。</EmptyNote>
          ) : (
            <ul className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {featured.map((ev) => (
                <li key={ev.id}>
                  <EventCard ev={ev} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
