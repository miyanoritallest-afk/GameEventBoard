// シリーズ詳細: シリーズ情報＋開催回（events）一覧＋フォローボタン。公開（誰でも閲覧可）。
// フォローすると新しい開催回の公開を通知する（③接続）。

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  findSeriesById,
  listSeriesEvents,
  listSeriesMembers,
  findSeriesMembership,
} from "@/lib/repositories/series";
import { isFollowing } from "@/lib/repositories/follows";
import { FollowButton } from "@/app/events/[id]/follow-button";
import { SeriesMembersPanel } from "./members-panel";
import { InviteBanner } from "./invite-banner";
import { Avatar } from "./avatar";

export const dynamic = "force-dynamic";

/** UTC(ISO) を JST 表示に整形する。null は "未定"。 */
function fmtJst(iso: string | null): string {
  if (!iso) return "未定";
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

const STATUS_LABEL: Record<string, string> = {
  published: "募集中",
  recruiting: "募集中",
  closed: "募集締切",
  ongoing: "開催中",
  finished: "終了",
};

/** status → バッジ色トーン。 */
function statusColor(status: string): string {
  switch (status) {
    case "published":
    case "recruiting":
      return "var(--mp-success)";
    case "ongoing":
      return "var(--mp-live)";
    case "closed":
      return "var(--mp-warning)";
    default:
      return "var(--mp-fg-subtle)";
  }
}

export default async function SeriesDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const series = await findSeriesById(id);
  if (!series) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const viewerId = user?.id ?? null;

  const [events, following, members, membership] = await Promise.all([
    listSeriesEvents(series.id),
    viewerId
      ? isFollowing({
          followerId: viewerId,
          targetType: "series",
          targetId: series.id,
        })
      : Promise.resolve(false),
    listSeriesMembers(series.id),
    viewerId
      ? findSeriesMembership({ seriesId: series.id, userId: viewerId })
      : Promise.resolve(null),
  ]);

  // 運営（owner/admin・active）＝イベント運営業務ができる人。owner＝運営の追加削除もできる人。
  const isStaff = membership?.status === "active";
  const isOwner = membership?.role === "owner" && membership.status === "active";
  const isInvited = membership?.status === "invited";

  const activeMembers = members.filter((m) => m.status === "active");
  const ownerName =
    activeMembers.find((m) => m.role === "owner")?.user?.discord_name ?? null;

  return (
    <div className="theme-matchpoint min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-10">
        {/* パンくず */}
        <nav className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
          <Link href="/series" className="hover:text-foreground">
            シリーズ一覧
          </Link>
          <span className="text-[color:var(--mp-fg-subtle)]">/</span>
          <span className="max-w-[18rem] truncate text-foreground">
            {series.name}
          </span>
        </nav>

        {/* ヒーロー */}
        <header className="relative mt-5 overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-[color:var(--mp-surface-2)] to-card p-6 pl-7 shadow-[var(--mp-e2)]">
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-1 bg-[#a78bfa]"
          />
          <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[#a78bfa]">
            <span aria-hidden className="size-2.5 rounded-[3px] bg-[#a78bfa]" />
            Series
          </p>
          <div className="mt-3.5 flex flex-wrap items-start justify-between gap-4">
            <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-foreground">
              {series.name}
            </h1>
            <FollowButton
              targetType="series"
              targetId={series.id}
              initialFollowing={following}
              isLoggedIn={viewerId !== null}
              redirectTo={`/series/${series.id}`}
              label="このシリーズ"
            />
          </div>

          {/* メタ（現行が持つ分だけ: オーナー・開催回・運営） */}
          <div className="mt-3.5 flex flex-wrap items-center gap-x-[18px] gap-y-2 text-[13.5px] text-muted-foreground">
            {ownerName && (
              <span className="inline-flex items-center gap-2">
                <Avatar name={ownerName} size={22} />
                <span className="text-[color:var(--mp-fg-subtle)]">
                  オーナー
                </span>
                <span className="font-medium text-foreground">{ownerName}</span>
              </span>
            )}
            <span className="inline-flex items-center gap-2">
              <span className="text-[color:var(--mp-fg-subtle)]">開催回</span>
              <span className="font-mono font-medium tabular-nums text-foreground">
                {events.length}
              </span>
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="text-[color:var(--mp-fg-subtle)]">運営</span>
              <span className="font-mono font-medium tabular-nums text-foreground">
                {activeMembers.length}
              </span>
            </span>
          </div>

          {series.description && (
            <p className="mt-[18px] max-w-[720px] whitespace-pre-wrap text-[14.5px] leading-relaxed text-foreground/90">
              {series.description}
            </p>
          )}

          {/* シリーズ運営（active）向け: 次の開催回を作成（前回設定プリフィル）。 */}
          {isStaff && (
            <div className="mt-[22px]">
              <Link
                href={`/events/new?series=${series.id}`}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-[0_0_0_1px_rgba(255,106,43,0.35),0_6px_18px_rgba(255,106,43,0.2)] transition hover:bg-[color:var(--mp-brand-hover)]"
              >
                ＋ 次の開催回を作成
              </Link>
            </div>
          )}
        </header>

        {/* 被招待者本人（invited）へ: 承認/辞退バナー。 */}
        {isInvited && <InviteBanner seriesId={series.id} />}

        {/* 開催回 */}
        <section className="mt-5 rounded-xl border border-border bg-card p-6 shadow-[var(--mp-e1)]">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="h-4 w-[3px] rounded-sm bg-[color:var(--mp-brand)]"
            />
            <h2 className="text-[15px] font-bold tracking-tight text-foreground">
              開催回
            </h2>
            <span className="font-mono text-[13px] font-semibold tabular-nums text-[color:var(--mp-fg-subtle)]">
              {events.length}
            </span>
          </div>
          <p className="mt-1.5 text-[12.5px] text-muted-foreground">
            このシリーズにひも付く開催回です。各回をクリックするとイベント詳細へ移動します。
          </p>

          {events.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-[color:var(--mp-border-strong)] bg-[color:var(--mp-surface-2)] px-4 py-8 text-center text-sm text-muted-foreground">
              まだ公開された開催回はありません。
            </p>
          ) : (
            <ul className="mt-4 flex flex-col gap-2.5">
              {events.map((e, i) => (
                <li key={e.id}>
                  <Link
                    href={`/events/${e.slug ?? e.id}`}
                    className="group flex items-center gap-4 rounded-lg border border-border bg-[color:var(--mp-surface-2)] px-4 py-3.5 transition hover:translate-x-0.5 hover:border-[color:var(--mp-border-strong)] hover:bg-[color:var(--mp-surface-3)]"
                  >
                    <span className="w-8 flex-none font-mono text-xs font-semibold tabular-nums text-[color:var(--mp-fg-subtle)]">
                      #{events.length - i}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2.5">
                        <span className="font-semibold text-foreground">
                          {e.title}
                        </span>
                        <StatusBadge status={e.status} />
                      </span>
                      <span className="mt-1 block font-mono text-xs tabular-nums text-muted-foreground">
                        開催 {fmtJst(e.starts_at)}
                      </span>
                    </span>
                    <span
                      aria-hidden
                      className="flex-none text-[color:var(--mp-fg-subtle)] transition group-hover:translate-x-0.5 group-hover:text-[color:var(--mp-brand)]"
                    >
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 運営メンバー: owner には管理パネル（招待/削除）、それ以外には読み取り専用の一覧。 */}
        {isOwner && viewerId ? (
          <SeriesMembersPanel
            seriesId={series.id}
            members={members.map((m) => ({
              userId: m.userId,
              role: m.role,
              status: m.status,
              user: m.user,
            }))}
            currentUserId={viewerId}
          />
        ) : (
          activeMembers.length > 0 && (
            <section className="mt-5 rounded-xl border border-border bg-card p-6 shadow-[var(--mp-e1)]">
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className="h-4 w-[3px] rounded-sm bg-[color:var(--mp-brand)]"
                />
                <h2 className="text-[15px] font-bold tracking-tight text-foreground">
                  運営メンバー
                </h2>
                <span className="font-mono text-[13px] font-semibold tabular-nums text-[color:var(--mp-fg-subtle)]">
                  {activeMembers.length}
                </span>
              </div>
              <ul className="mt-4 flex flex-wrap gap-2">
                {activeMembers.map((m) => (
                  <li
                    key={m.userId}
                    className="inline-flex items-center gap-2 rounded-full border border-border bg-[color:var(--mp-surface-2)] py-1 pl-1.5 pr-3 text-xs"
                  >
                    <Avatar name={m.user?.discord_name ?? "?"} size={22} />
                    <span className="font-medium text-foreground">
                      {m.user?.discord_name ?? "（不明）"}
                    </span>
                    {m.role === "owner" && (
                      <span className="text-[color:var(--mp-brand)]">
                        オーナー
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )
        )}
      </div>
    </div>
  );
}

/** 開催回の status バッジ。 */
function StatusBadge({ status }: { status: string }) {
  const color = statusColor(status);
  const label = STATUS_LABEL[status] ?? status;
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
      style={{
        color,
        backgroundColor: `color-mix(in oklab, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in oklab, ${color} 30%, transparent)`,
      }}
    >
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${status === "ongoing" ? "animate-pulse" : ""}`}
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}
