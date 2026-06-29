import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  listPublishedEvents,
  listEventsByOrganizer,
} from "@/lib/repositories/events";
import { listMyParticipatingEvents } from "@/lib/repositories/registrations";
import { findDiscordName } from "@/lib/repositories/users";

export const dynamic = "force-dynamic";

/** トップに出す募集中イベントの最大件数。 */
const FEATURED_LIMIT = 6;

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
  /** 応募者から見た自分の参加状態（参加セクションのみ）。 */
  regStatusLabel?: string;
};

/** イベント1件のカード。詳細へのリンク付き。 */
function EventCard({ ev }: { ev: EventCardData }) {
  const href = `/events/${ev.slug ?? ev.id}`;
  const isDraft = ev.status === "draft";
  return (
    <Link
      href={href}
      className="block rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/50"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded bg-muted px-2 py-0.5">{ev.gameName}</span>
        <span
          className={
            isDraft
              ? "rounded bg-muted px-2 py-0.5"
              : "rounded bg-primary/10 px-2 py-0.5 text-primary"
          }
        >
          {STATUS_LABEL[ev.status] ?? ev.status}
        </span>
        {ev.regStatusLabel && (
          <span className="rounded bg-primary/10 px-2 py-0.5 text-primary">
            {ev.regStatusLabel}
          </span>
        )}
      </div>
      <h3 className="mt-2 text-lg font-semibold">{ev.title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        開催 {fmtJstDate(ev.startsAt)} ／ 募集締切{" "}
        {fmtJstDate(ev.recruitDeadline)}
      </p>
    </Link>
  );
}

/** セクション見出し（右側に「すべて見る」等の任意リンク）。 */
function SectionHeading({
  title,
  action,
}: {
  title: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-lg font-bold">{title}</h2>
      {action && (
        <Link
          href={action.href}
          className="text-sm text-primary hover:underline"
        >
          {action.label}
        </Link>
      )}
    </div>
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
    }));

  // ── 未ログイン（LP の顔）─────────────────────────────
  if (!user) {
    return (
      <div className="dark flex-1 bg-background text-foreground">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <section className="text-center">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
              Matchpoint
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground">
              ゲームイベントの募集・チーム編成・対戦表をひとつに集約する大会運営ツール。
              参加するのも、主催するのも、ここから。
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/login"
                className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
              >
                Discord でログイン
              </Link>
              <Link
                href="/events"
                className="rounded-lg border border-border px-5 py-2.5 text-sm font-medium transition hover:bg-muted/50"
              >
                イベントを探す
              </Link>
            </div>
          </section>

          <section className="mt-16">
            <SectionHeading
              title="募集中のイベント"
              action={{ href: "/events", label: "すべて見る →" }}
            />
            {featured.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                公開中のイベントはまだありません。
              </p>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {featured.map((ev) => (
                  <EventCard key={ev.id} ev={ev} />
                ))}
              </div>
            )}
          </section>
        </div>
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
  }));

  return (
    <div className="dark flex-1 bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-bold">
          こんにちは、{discordName ?? "ゲスト"} さん
        </h1>

        {/* 参加中のイベント */}
        <section className="mt-8">
          <SectionHeading title="参加中のイベント" />
          {participating.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              まだ参加しているイベントはありません。下の「募集中のイベント」から探してみましょう。
            </p>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {participating.map((ev) => (
                <EventCard key={ev.id} ev={ev} />
              ))}
            </div>
          )}
        </section>

        {/* 主催イベント（あれば一覧・なければ作成CTA） */}
        <section className="mt-10">
          <SectionHeading
            title="主催イベント"
            action={
              organizingCards.length > 0
                ? { href: "/events/new", label: "新しく作成 →" }
                : undefined
            }
          />
          {organizingCards.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-border bg-card p-6 text-center">
              <p className="text-sm text-muted-foreground">
                まだ主催イベントはありません。
              </p>
              <Link
                href="/events/new"
                className="mt-4 inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
              >
                イベントを作ってみる
              </Link>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {organizingCards.map((ev) => (
                <EventCard key={ev.id} ev={ev} />
              ))}
            </div>
          )}
        </section>

        {/* 募集中のイベント（新着） */}
        <section className="mt-10">
          <SectionHeading
            title="募集中のイベント"
            action={{ href: "/events", label: "すべて見る →" }}
          />
          {featured.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              公開中のイベントはまだありません。
            </p>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {featured.map((ev) => (
                <EventCard key={ev.id} ev={ev} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
