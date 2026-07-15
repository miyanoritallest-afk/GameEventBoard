// チーム日程（スクリム/練習/公式戦）ページ。日程カードを縦に並べる。
// スクリム/練習は自チームのメンバー・主催者が閲覧、公式戦は全員が閲覧できる（要件 3.4.3）。

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { findEventByIdOrSlug } from "@/lib/repositories/events";
import {
  listEventScrims,
  listEventMatchesForSchedule,
  findViewerTeamId,
} from "@/lib/repositories/scrims";
import { buildScheduleItems } from "@/lib/services/schedule";
import { ScheduleList } from "./schedule-list";

export const dynamic = "force-dynamic";

export default async function SchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const event = await findEventByIdOrSlug(id);
  if (!event) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const viewerId = user?.id ?? null;

  // scrims は RLS で認証必須（未ログインは空になる）。matches は公開。
  // 以降の DB クエリは必ず event.id（uuid）を使う（params の id は slug の場合があるため）。
  const [scrims, matches, viewerTeamId] = await Promise.all([
    viewerId ? listEventScrims(event.id) : Promise.resolve([]),
    listEventMatchesForSchedule(event.id),
    viewerId
      ? findViewerTeamId({ eventId: event.id, userId: viewerId })
      : Promise.resolve(null),
  ]);

  const items = buildScheduleItems({
    scrims,
    matches,
    viewerTeamId,
    now: new Date(),
  });

  // 種別ごとの件数（凡例チップ用）。取得済みの items を数えるだけ。
  const kindCounts = {
    match: items.filter((i) => i.kind === "match").length,
    scrim: items.filter((i) => i.kind === "scrim").length,
    practice: items.filter((i) => i.kind === "practice").length,
  };

  return (
    <div className="theme-matchpoint min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-10">
        {/* パンくず */}
        <nav className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
          <Link href="/events" className="hover:text-foreground">
            イベント一覧
          </Link>
          <span className="text-[color:var(--mp-fg-subtle)]">/</span>
          <Link
            href={`/events/${event.slug ?? id}`}
            className="max-w-[16rem] truncate hover:text-foreground"
          >
            {event.title}
          </Link>
          <span className="text-[color:var(--mp-fg-subtle)]">/</span>
          <span className="text-foreground">日程</span>
        </nav>

        {/* ヒーロー：kicker・タイトル・イベント名・種別凡例チップ */}
        <header className="mt-5 overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-[var(--mp-e2)]">
          <p className="flex items-center gap-[9px] font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--mp-accent)] before:h-0.5 before:w-[22px] before:bg-[color:var(--mp-accent)] before:content-['']">
            チーム日程
          </p>
          <h1 className="mt-2.5 text-2xl font-extrabold tracking-tight text-foreground">
            日程
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{event.title}</p>

          {/* 種別凡例（件数付き） */}
          <div className="mt-5 flex flex-wrap gap-2.5">
            <LegendChip color="#F2596B" emoji="🔴" label="公式戦" count={kindCounts.match} />
            <LegendChip color="#4C9BE8" emoji="🔵" label="スクリム" count={kindCounts.scrim} />
            <LegendChip color="#3FD08A" emoji="🟢" label="練習" count={kindCounts.practice} />
          </div>

          <p className="mt-4 text-xs leading-relaxed text-[color:var(--mp-fg-subtle)]">
            公式戦は本戦の対戦表から自動生成され、この画面では編集できません。スクリム/練習はチームメンバーなら誰でも登録でき、チーム全員に共有されます。
          </p>
        </header>

        <ScheduleList
          eventId={event.id}
          items={items}
          canManage={viewerTeamId !== null}
        />
      </div>
    </div>
  );
}

/** 種別凡例チップ（色ドット＋ラベル＋件数）。 */
function LegendChip({
  color,
  emoji,
  label,
  count,
}: {
  color: string;
  emoji: string;
  label: string;
  count: number;
}) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border bg-[color:var(--mp-surface)] px-3 py-1.5 text-xs font-semibold text-foreground"
      style={{ borderColor: `color-mix(in oklab, ${color} 32%, transparent)` }}
    >
      <span aria-hidden className="text-[11px]">
        {emoji}
      </span>
      {label}
      <span className="font-mono text-[11px] tabular-nums text-[color:var(--mp-fg-subtle)]">
        {count}
      </span>
    </span>
  );
}
