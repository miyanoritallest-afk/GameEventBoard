import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Eye,
  CalendarDays,
  LayoutGrid,
  Table2,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { findEventById, findEventBySlug } from "@/lib/repositories/events";
import { findRegistration } from "@/lib/repositories/registrations";
import { findDiscordName, findBattleTag } from "@/lib/repositories/users";
import { canViewEvent } from "@/lib/services/event-status";
import { isValidEventSlug } from "@/lib/services/event-slug";
import {
  hasGroupStage,
  hasTournamentStage,
  eventFormatLabel,
  tournamentStageLabel,
} from "@/lib/services/event-format";
import { isFollowing } from "@/lib/repositories/follows";
import { PublishButton } from "./publish-button";
import { DeleteDraftButton } from "./delete-draft-button";
import { ApplyButton } from "./apply-button";
import { FollowButton } from "./follow-button";
import { SeriesifyButton } from "./seriesify-button";

/** 応募ステータスの日本語ラベル。 */
const REG_STATUS_LABEL: Record<string, string> = {
  pending: "承認待ち",
  approved: "参加確定",
  rejected: "不参加",
  withdrawn: "取り下げ",
};

export const dynamic = "force-dynamic";

/** status を日本語ラベルに（表示用）。 */
const STATUS_LABEL: Record<string, string> = {
  draft: "下書き",
  published: "公開中",
  recruiting: "募集中",
  closed: "募集締切",
  ongoing: "開催中",
  finished: "終了",
};

/** UTC(ISO) を JST 表示に整形する。null は "未設定"。 */
function fmtJst(iso: string | null): string {
  if (!iso) return "未設定";
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // URL は公開=slug / 下書き=uuid の2系統。slug 形式なら slug 検索、それ以外は id 検索。
  const event = isValidEventSlug(id)
    ? await findEventBySlug(id)
    : await findEventById(id);
  if (!event) notFound();

  // 可視性: 公開済みは誰でも、下書きは本人のみ。本人以外には存在しないように 404。
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const viewerId = user?.id ?? null;
  if (!canViewEvent(event.status, event.organizer_id, viewerId)) {
    notFound();
  }

  const gameName = (event.games as { name: string } | null)?.name ?? "-";
  const isOrganizer = viewerId !== null && viewerId === event.organizer_id;
  const statusLabel = STATUS_LABEL[event.status] ?? event.status;

  // 主催者の表示名。登録名（organizer_display_name）優先・未設定なら Discord 名。
  const organizerName =
    event.organizer_display_name ??
    (event.organizer as { discord_name: string } | null)?.discord_name ??
    "-";

  // フォロー状態（イベント／主催者）。主催者は自分の対象をフォローしないので非主催者のみ。
  // 未ログインはボタンは出すが状態は false（押下で /login へ）。
  const canFollow = !isOrganizer;
  const [followingEvent, followingOrganizer] =
    canFollow && viewerId !== null
      ? await Promise.all([
          isFollowing({
            followerId: viewerId,
            targetType: "event",
            targetId: event.id,
          }),
          isFollowing({
            followerId: viewerId,
            targetType: "user",
            targetId: event.organizer_id,
          }),
        ])
      : [false, false];

  // 応募の状態（ログイン済み・非主催者・公開中のときだけ意味を持つ）。
  const canApply = viewerId !== null && !isOrganizer && event.status !== "draft";
  const myRegistration = canApply
    ? await findRegistration(event.id, viewerId)
    : null;

  // スコアなし即時応募フォームの既定値（登録名=Discord名・バトルタグ=保存済み値）。
  // 未応募・スコアなしイベントのときだけ意味を持つ。
  const showInlineApply =
    canApply && !myRegistration && !event.require_score && viewerId !== null;
  const [discordName, battleTag] = showInlineApply
    ? await Promise.all([findDiscordName(viewerId), findBattleTag(viewerId)])
    : [null, null];

  // 本戦ページ（ブロック分け/対戦表・順位表/トーナメント）への導線を出す条件。
  // フェーズB: 公開済みなら観戦者（非ログイン・非参加者）にも導線を出す（閲覧の全面公開）。
  // 下書きでは本戦が始まらないので出さない。
  const canViewTournament = event.status !== "draft";
  // 形式による出し分け（PR-2）。予選を持たない形式（トーナメントのみ）では
  // ブロック分け・予選対戦表の導線を出さない。決勝Tを持たない形式（総当たりのみ）では
  // 決勝T関連の導線を出さない。
  const showGroupStage = hasGroupStage(event.format);
  const showTournamentStage = hasTournamentStage(event.format);
  // トーナメントの呼称（トーナメント単独なら「トーナメント」・予選ありなら「決勝トーナメント」）。
  const tournamentLabel = tournamentStageLabel(event.format);

  // 開催中かどうか（ライブ表示のパルス用）。状態ラベルは既存ロジックを流用。
  const isLive = event.status === "ongoing";

  return (
    <div className="theme-matchpoint min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* パンくず */}
        <nav className="text-sm text-muted-foreground">
          <Link href="/events" className="hover:text-foreground">
            イベント一覧
          </Link>
          <span className="mx-2 text-[color:var(--mp-fg-subtle)]">/</span>
          <span className="text-foreground">{event.title}</span>
        </nav>

        {/* ヒーロー：状態バッジ＋ゲームチップ、タイトル、主催・形式・日時メタ */}
        <header className="mt-5 rounded-2xl border border-border bg-card p-6 shadow-[var(--mp-e2)]">
          <div className="flex flex-wrap items-center gap-2">
            {event.status === "draft" ? (
              <StatusBadge tone="muted" label="下書き" />
            ) : isLive ? (
              <StatusBadge tone="live" label="開催中" pulse />
            ) : (
              <StatusBadge tone="success" label={statusLabel} check />
            )}
            <Chip>{gameName}</Chip>
            <Chip>{eventFormatLabel(event.format)}</Chip>
          </div>

          <h1 className="mt-4 font-[family-name:var(--mp-font,inherit)] text-3xl font-bold tracking-tight text-foreground">
            {event.title}
          </h1>

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <span
                aria-hidden
                className="flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--mp-surface-3)] text-xs font-bold text-[color:var(--mp-brand)]"
              >
                {organizerName.slice(0, 1)}
              </span>
              主催 <span className="text-foreground">{organizerName}</span>
            </span>
            <span>
              状態 <span className="text-foreground">{statusLabel}</span>
            </span>
            <span className="tabular-nums">
              開催{" "}
              <span className="text-foreground">{fmtJst(event.starts_at)}</span>
            </span>
          </div>

          {event.status === "draft" && isOrganizer && (
            <p className="mt-4 rounded-lg border border-[color:var(--mp-warning)]/40 bg-[color:var(--mp-warning)]/10 px-3 py-2 text-sm text-[color:var(--mp-warning)]">
              このイベントは下書きです。内容を確認して公開できます。
            </p>
          )}
        </header>

        {/* 2カラム：左＝本文・メタ・本戦導線 / 右＝アクションレール（sticky） */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
          {/* 左カラム */}
          <div className="flex flex-col gap-6">
            {event.description && (
              <section className="rounded-2xl border border-border bg-card p-6">
                <h2 className="text-sm font-semibold text-muted-foreground">
                  概要
                </h2>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                  {event.description}
                </p>
              </section>
            )}

            {/* メタ facts */}
            <section className="rounded-2xl border border-border bg-card p-6">
              <h2 className="text-sm font-semibold text-muted-foreground">
                イベント情報
              </h2>
              <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
                <Fact label="開催開始" value={fmtJst(event.starts_at)} mono />
                <Fact label="開催終了" value={fmtJst(event.ends_at)} mono />
                <Fact
                  label="募集締切"
                  value={fmtJst(event.recruit_deadline)}
                  mono
                  tone="warning"
                />
                <Fact
                  label="定員（チーム数）"
                  value={
                    event.capacity != null ? String(event.capacity) : "未設定"
                  }
                  mono
                />
                <Fact
                  label="ロールスワップ"
                  value={event.role_swap_allowed ? "許可" : "不可"}
                />
                <Fact
                  label="申告シーズン数"
                  value={String(event.declared_seasons)}
                  mono
                />
                <div className="sm:col-span-2">
                  <Fact
                    label="到達ボーナス"
                    value={`マスター+${event.bonus_master} / GM+${event.bonus_gm} / チャンピオン+${event.bonus_champion}`}
                  />
                </div>
              </dl>
            </section>

            {/* 本戦導線（タイル化）。導線・出し分けの条件は既存ロジックのまま。 */}
            {canViewTournament && (
              <section className="rounded-2xl border border-border bg-card p-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-muted-foreground">
                    本戦
                  </h2>
                  {!isOrganizer && (
                    <span className="text-xs text-[color:var(--mp-fg-subtle)]">
                      閲覧のみ
                    </span>
                  )}
                </div>
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <TournamentTile
                    href={`/events/${event.id}/watch`}
                    icon={Eye}
                    title="観戦ビュー"
                    desc="対戦・順位をまとめて見る"
                    brand
                  />
                  <TournamentTile
                    href={`/events/${event.id}/schedule`}
                    icon={CalendarDays}
                    title="日程"
                    desc="スクリム・練習の予定"
                  />
                  {showGroupStage && (
                    <>
                      <TournamentTile
                        href={`/events/${event.id}/groups`}
                        icon={LayoutGrid}
                        title="ブロック分け"
                        desc="予選の組み分け"
                      />
                      <TournamentTile
                        href={`/events/${event.id}/matches`}
                        icon={Table2}
                        title="対戦表・順位表"
                        desc="予選リーグの結果"
                      />
                    </>
                  )}
                  {showTournamentStage && (
                    <TournamentTile
                      href={`/events/${event.id}/tournament`}
                      icon={Trophy}
                      title={tournamentLabel}
                      desc="決勝ブラケット"
                    />
                  )}
                </div>
              </section>
            )}
          </div>

          {/* 右レール（sticky） */}
          <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
            {/* 応募カード（非主催者・公開中）。状態別に出し分け（既存ロジック）。 */}
            {canApply &&
              (myRegistration ? (
                <div className="rounded-2xl border border-[color:var(--mp-success)]/40 bg-[color:var(--mp-success)]/10 p-5">
                  <p className="flex items-center gap-2 text-sm font-semibold text-[color:var(--mp-success)]">
                    <span aria-hidden>✓</span> 応募済み（
                    {REG_STATUS_LABEL[myRegistration.status] ??
                      myRegistration.status}
                    ）
                  </p>
                  <div className="mt-3 flex flex-col gap-2">
                    <Link
                      href={`/events/${event.id}/registrations`}
                      className="text-sm text-foreground/90 underline-offset-2 hover:underline"
                    >
                      応募者一覧を見る →
                    </Link>
                    <Link
                      href={`/events/${event.id}/teams`}
                      className="text-sm text-foreground/90 underline-offset-2 hover:underline"
                    >
                      チーム編成を試算する →
                    </Link>
                  </div>
                </div>
              ) : event.require_score ? (
                <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--mp-e1)]">
                  <h2 className="text-sm font-semibold">
                    このイベントに応募する
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    希望ロールとランクを申告して応募します。
                  </p>
                  <Link
                    href={`/events/${event.id}/apply`}
                    className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-[color:var(--mp-brand-hover)]"
                  >
                    応募フォームへ
                  </Link>
                </div>
              ) : (
                <ApplyButton
                  eventId={event.id}
                  defaultDisplayName={discordName ?? ""}
                  defaultBattleTag={battleTag ?? ""}
                />
              ))}

            {/* フォロー（非主催者のみ）。既存ロジックのまま。 */}
            {canFollow && (
              <div className="rounded-2xl border border-border bg-card p-5">
                <h2 className="text-sm font-semibold text-muted-foreground">
                  フォロー
                </h2>
                <div className="mt-3 flex flex-col gap-2">
                  <FollowButton
                    targetType="event"
                    targetId={event.id}
                    initialFollowing={followingEvent}
                    isLoggedIn={viewerId !== null}
                    redirectTo={`/events/${event.id}`}
                    label="このイベント"
                  />
                  <FollowButton
                    targetType="user"
                    targetId={event.organizer_id}
                    initialFollowing={followingOrganizer}
                    isLoggedIn={viewerId !== null}
                    redirectTo={`/events/${event.id}`}
                    label={`主催者(${organizerName})`}
                  />
                </div>
              </div>
            )}

            {/* 主催者メニュー（既存の管理導線をレールに集約）。 */}
            {isOrganizer && (
              <div className="rounded-2xl border border-border bg-card p-5">
                <h2 className="text-sm font-semibold text-muted-foreground">
                  主催者メニュー
                </h2>
                {event.status === "draft" && (
                  <div className="mt-3">
                    <PublishButton eventId={event.id} />
                  </div>
                )}
                <div className="mt-3 flex flex-col gap-2 text-sm">
                  <Link
                    href={`/events/${event.id}/edit`}
                    className="text-foreground/90 underline-offset-2 hover:underline"
                  >
                    編集する
                  </Link>
                  {event.status !== "draft" && (
                    <Link
                      href={`/events/${event.id}/registrations`}
                      className="text-foreground/90 underline-offset-2 hover:underline"
                    >
                      応募者を見る
                    </Link>
                  )}
                  {event.status !== "draft" && (
                    <Link
                      href={`/events/${event.id}/teams`}
                      className="text-foreground/90 underline-offset-2 hover:underline"
                    >
                      チーム編成
                    </Link>
                  )}
                  {event.series_id ? (
                    <Link
                      href={`/series/${event.series_id}`}
                      className="text-foreground/90 underline-offset-2 hover:underline"
                    >
                      シリーズを見る
                    </Link>
                  ) : (
                    <SeriesifyButton eventId={event.id} />
                  )}
                  {event.status === "draft" && (
                    <DeleteDraftButton eventId={event.id} />
                  )}
                  <Link
                    href="/events/mine"
                    className="text-muted-foreground underline-offset-2 hover:underline"
                  >
                    自分のイベント一覧
                  </Link>
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

/** ヒーローの状態バッジ。tone で配色、pulse=ライブの点滅、check=✓表示。 */
function StatusBadge({
  tone,
  label,
  pulse,
  check,
}: {
  tone: "success" | "live" | "muted";
  label: string;
  pulse?: boolean;
  check?: boolean;
}) {
  const color =
    tone === "success"
      ? "var(--mp-success)"
      : tone === "live"
        ? "var(--mp-live)"
        : "var(--mp-fg-subtle)";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
      style={{
        color,
        backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)`,
        border: `1px solid color-mix(in oklab, ${color} 40%, transparent)`,
      }}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${pulse ? "animate-pulse" : ""}`}
        style={{ backgroundColor: color }}
      />
      {check ? `✓ ${label}` : label}
    </span>
  );
}

/** ゲーム名・形式などの小さなチップ。 */
function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border bg-[color:var(--mp-surface-2)] px-3 py-1 text-xs font-medium text-muted-foreground">
      {children}
    </span>
  );
}

/** メタ情報の1項目。mono=等幅（日時・数値の桁揃え）、tone=warning で締切強調。 */
function Fact({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "warning";
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-[color:var(--mp-fg-subtle)]">{label}</dt>
      <dd
        className={`text-sm font-medium ${mono ? "font-mono tabular-nums" : ""} ${
          tone === "warning"
            ? "text-[color:var(--mp-warning)]"
            : "text-foreground"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

/** 本戦導線のタイル。brand=ブランド色で強調（観戦ビュー用）。icon は Lucide アイコン。 */
function TournamentTile({
  href,
  icon: Icon,
  title,
  desc,
  brand,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  desc: string;
  brand?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group flex items-center gap-3 rounded-xl border p-4 transition ${
        brand
          ? "border-[color:var(--mp-brand)]/40 bg-[color:var(--mp-brand)]/10 hover:bg-[color:var(--mp-brand)]/15"
          : "border-border bg-[color:var(--mp-surface-2)] hover:border-[color:var(--mp-border-strong)]"
      }`}
    >
      <span
        aria-hidden
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
          brand
            ? "bg-[color:var(--mp-brand)]/20 text-[color:var(--mp-brand)]"
            : "bg-[color:var(--mp-surface-3)] text-[color:var(--mp-fg-muted)]"
        }`}
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
      </span>
      <span className="min-w-0">
        <span
          className={`block text-sm font-semibold ${
            brand ? "text-[color:var(--mp-brand)]" : "text-foreground"
          }`}
        >
          {title}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {desc}
        </span>
      </span>
    </Link>
  );
}
