import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { findEventByIdOrSlug } from "@/lib/repositories/events";
import { listRegistrationsByEvent } from "@/lib/repositories/registrations";
import { canViewEvent } from "@/lib/services/event-status";
import {
  RegistrationRow,
  type RegistrationRowData,
} from "./registration-row";

export const dynamic = "force-dynamic";

/** UTC(ISO) を JST 表示に整形する。 */
function fmtJst(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function EventRegistrationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const viewerId = user?.id ?? null;

  // 閲覧は「公開済みなら誰でも（観戦者含む）・下書きは主催者のみ」（フェーズB）。
  // 操作系（承認・スコア）は主催者のみ（RegistrationRow が isOrganizer で出し分け）。
  const event = await findEventByIdOrSlug(id);
  if (!event) notFound();
  if (!canViewEvent(event.status, event.organizer_id, viewerId)) {
    notFound();
  }
  const isOrganizer = viewerId !== null && event.organizer_id === viewerId;

  const registrations = await listRegistrationsByEvent(event.id);

  // 件数サマリー（status 集計）。取得済みの配列を数えるだけ。全立場に見せる（公開情報）。
  const total = registrations.length;
  const pendingCount = registrations.filter(
    (r) => r.status === "pending",
  ).length;
  const approvedCount = registrations.filter(
    (r) => r.status === "approved",
  ).length;

  const detailHref = `/events/${event.slug ?? event.id}`;

  return (
    <div className="theme-matchpoint min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-6 py-10">
        {/* パンくず */}
        <nav className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
          <Link href="/events" className="hover:text-foreground">
            イベント一覧
          </Link>
          <span className="text-[color:var(--mp-fg-subtle)]">/</span>
          <Link
            href={detailHref}
            className="max-w-[16rem] truncate hover:text-foreground"
          >
            {event.title}
          </Link>
          <span className="text-[color:var(--mp-fg-subtle)]">/</span>
          <span className="text-foreground">応募者一覧</span>
        </nav>

        {/* ヒーロー：kicker・タイトル・イベント名・件数サマリーチップ */}
        <header className="mt-5 overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-[var(--mp-e2)]">
          <p className="flex items-center gap-[9px] font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--mp-accent)] before:h-0.5 before:w-[22px] before:bg-[color:var(--mp-accent)] before:content-['']">
            主催者ツール
          </p>
          <h1 className="mt-2.5 text-2xl font-extrabold tracking-tight text-foreground">
            応募者一覧
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{event.title}</p>

          {/* 件数サマリー */}
          <div className="mt-5 flex flex-wrap gap-3">
            <SummaryCount tone="total" value={total} label="応募" />
            <SummaryCount tone="pending" value={pendingCount} label="承認待ち" />
            <SummaryCount
              tone="approved"
              value={approvedCount}
              label="参加確定"
            />
          </div>

          {/* 非主催者向けの閲覧注記 */}
          {!isOrganizer && (
            <p className="mt-4 flex items-center gap-2.5 rounded-lg border border-[color:var(--mp-accent)]/30 bg-[color:var(--mp-accent)]/[0.08] px-4 py-3 text-[12.5px] leading-relaxed text-[color:var(--mp-accent)]">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.9}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="flex-none"
                aria-hidden
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
              <span>
                <b className="font-semibold text-foreground">
                  参加者として閲覧しています。
                </b>
                チーム編成の参考にできます（Discord
                名・承認・スコア操作は主催者にのみ表示されます）。
              </span>
            </p>
          )}
        </header>

        {/* リスト見出し */}
        <div className="mb-3.5 mt-8 flex items-baseline gap-2.5">
          <span
            aria-hidden
            className="relative top-0.5 h-4 w-[3px] rounded-sm bg-[color:var(--mp-brand)]"
          />
          <h2 className="text-base font-extrabold tracking-tight text-foreground">
            応募者
          </h2>
          <span className="font-mono text-[13px] font-semibold text-[color:var(--mp-fg-subtle)]">
            ({total})
          </span>
          <span className="ml-auto text-xs text-[color:var(--mp-fg-subtle)]">
            申込みが早い順
          </span>
        </div>

        {registrations.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-[color:var(--mp-border-strong)] bg-card px-6 py-16 text-center">
            <span
              aria-hidden
              className="mb-4 flex size-14 items-center justify-center rounded-full border border-border bg-[color:var(--mp-surface-3)] text-[color:var(--mp-fg-subtle)]"
            >
              <svg
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.7}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" />
                <line x1="22" y1="11" x2="16" y2="11" />
              </svg>
            </span>
            <h3 className="text-base font-bold text-foreground">
              まだ応募がありません。
            </h3>
            <p className="mt-2 max-w-[340px] text-sm text-muted-foreground">
              募集期間中に届いた応募がここに一覧表示されます。
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {registrations.map((reg) => {
              const u = reg.users as {
                discord_name: string;
                discord_avatar_url: string | null;
                battle_tag: string | null;
              } | null;
              const row: RegistrationRowData = {
                id: reg.id,
                status: reg.status,
                createdAtLabel: fmtJst(reg.created_at),
                // 公開表示名（登録名 ?? Discord名）。全立場で主表示。
                displayName: reg.display_name ?? u?.discord_name ?? "-",
                // 素のDiscord名は運営（主催者）のみに渡す（内部識別。観戦者・応募者には null）。
                discordName: isOrganizer ? (u?.discord_name ?? null) : null,
                battleTag: u?.battle_tag ?? null,
                preferredRole: reg.preferred_role,
                preferredRoles: [
                  reg.preferred_role_1,
                  reg.preferred_role_2,
                  reg.preferred_role_3,
                ],
                individualScore: reg.individual_score,
                finalScore: reg.final_score,
                overrideScore: reg.organizer_override_score,
                breakdown:
                  (reg.score_breakdown as RegistrationRowData["breakdown"]) ??
                  null,
              };
              // スコアレスイベント（require_score=false）はスコア列・上書きを出さない。
              return (
                <RegistrationRow
                  key={reg.id}
                  reg={row}
                  showScore={event.require_score}
                  canManage={isOrganizer}
                />
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/** ヒーローの件数サマリーチップ。tone で配色・アイコンを出し分ける。 */
function SummaryCount({
  tone,
  value,
  label,
}: {
  tone: "total" | "pending" | "approved";
  value: number;
  label: string;
}) {
  const color =
    tone === "pending"
      ? "var(--mp-warning)"
      : tone === "approved"
        ? "var(--mp-success)"
        : "var(--mp-accent)";
  return (
    <div
      className="flex min-w-[120px] items-center gap-3 rounded-lg border bg-[color:var(--mp-surface)] px-4 py-3"
      style={{
        borderColor:
          tone === "pending"
            ? "color-mix(in oklab, var(--mp-warning) 32%, transparent)"
            : "var(--mp-border)",
      }}
    >
      <span
        aria-hidden
        className="flex size-[30px] flex-none items-center justify-center rounded-md"
        style={{
          color,
          backgroundColor: `color-mix(in oklab, ${color} 13%, transparent)`,
        }}
      >
        {tone === "pending" ? (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.9}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
        ) : tone === "approved" ? (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.9}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        ) : (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.9}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        )}
      </span>
      <span className="flex flex-col leading-tight">
        <span
          className="font-mono text-xl font-semibold tabular-nums"
          style={{ color: tone === "pending" ? color : "var(--mp-fg)" }}
        >
          {value}
        </span>
        <span className="mt-0.5 text-[11px] text-[color:var(--mp-fg-muted)]">
          {label}
        </span>
      </span>
    </div>
  );
}
