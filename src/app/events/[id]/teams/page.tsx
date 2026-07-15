import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { findEventByIdOrSlug } from "@/lib/repositories/events";
import { findRegistration } from "@/lib/repositories/registrations";
import {
  listTeamsWithMembers,
  listUnassignedApproved,
} from "@/lib/repositories/teams";
import { canViewEvent } from "@/lib/services/event-status";
import {
  eventFormatLabel,
  hasGroupStage,
  tournamentStageLabel,
} from "@/lib/services/event-format";
import { TeamsBoard, type BoardMember, type BoardTeam } from "./teams-board";

export const dynamic = "force-dynamic";

/**
 * チーム編成画面（主催者専用）。
 * 認証ガードは registrations ページと同型:
 * - A: 未ログインは /login へリダイレクト。
 * - 主催者本人以外・存在しないイベントは 404（存在を隠す）。
 *
 * organizer 振り分け（PR-1）: approved の応募を未割当プールに出し、D&D でチームへ割当。
 * require_score=false のイベントはスコア/ランク/チーム平均を非表示にする（出し分け）。
 */
export default async function EventTeamsPage({
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
  // 主催者は編集可、応募者は試算のみ、観戦者は閲覧のみ（read-only）。
  const event = await findEventByIdOrSlug(id);
  if (!event) notFound();
  if (!canViewEvent(event.status, event.organizer_id, viewerId)) {
    notFound();
  }
  const isOrganizer = viewerId !== null && event.organizer_id === viewerId;
  const myRegistration =
    isOrganizer || viewerId === null
      ? null
      : await findRegistration(event.id, viewerId);

  const [teamsRaw, unassignedRaw] = await Promise.all([
    listTeamsWithMembers(event.id),
    listUnassignedApproved(event.id),
  ]);

  // DB の戻りをボード用の素直な型へ整形する（クライアントへ渡す最小データ）。
  type RegJoin = {
    id: string;
    display_name: string | null;
    preferred_role_1: string | null;
    preferred_role_2: string | null;
    preferred_role_3: string | null;
    final_score: number | null;
    organizer_override_score: number | null;
    users: { discord_name: string; battle_tag: string | null } | null;
  };

  function toBoardMember(
    reg: RegJoin,
    extra: { role?: string; position?: string },
  ): BoardMember {
    const u = reg.users;
    return {
      registrationId: reg.id,
      // 公開表示名（登録名 ?? Discord名）。全立場で主表示。
      displayName: reg.display_name ?? u?.discord_name ?? "-",
      // 素のDiscord名は運営（主催者）のみに渡す（内部識別。観戦者・応募者には null）。
      discordName: isOrganizer ? (u?.discord_name ?? null) : null,
      battleTag: u?.battle_tag ?? null,
      preferredRoles: [
        reg.preferred_role_1,
        reg.preferred_role_2,
        reg.preferred_role_3,
      ],
      finalScore: reg.final_score,
      overrideScore: reg.organizer_override_score,
      role: extra.role ?? reg.preferred_role_1 ?? "tank",
      position: extra.position ?? "regular",
    };
  }

  const teams: BoardTeam[] = (teamsRaw ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    status: t.status,
    captainRegistrationId:
      (t as { captain_registration_id?: string | null })
        .captain_registration_id ?? null,
    createdAt:
      (t as { created_at?: string | null }).created_at ?? null,
    members: (t.team_members ?? []).map((tm) => {
      const reg = tm.registrations as unknown as RegJoin;
      return toBoardMember(reg, { role: tm.role, position: tm.position });
    }),
  }));

  // 未割当の応募者プールは編成作業の領域。観戦者（read-only）には見せず、確定したチームだけ表示。
  // 応募者（自分の試算用）には従来どおり見せる。
  const unassigned: BoardMember[] =
    isOrganizer || myRegistration !== null
      ? (unassignedRaw ?? []).map((reg) => toBoardMember(reg as unknown as RegJoin, {}))
      : [];

  // ヘッダーのメタ表示用の派生値（ゲーム名・チーム人数・立場ラベル）。
  const gameName = (event.games as { name: string } | null)?.name ?? "-";
  const teamSize = (event.games as { team_size: number } | null)?.team_size ?? 5;
  // 立場に応じたモード名（英字ラベル）。観戦者には "Organizer" を出さない。
  const roleLabel = isOrganizer
    ? "Organizer"
    : myRegistration !== null
      ? "Applicant"
      : "Spectator";
  // 編成/参加チーム（観戦者は純粋閲覧なので「参加チーム」）。
  const pageTitle =
    isOrganizer || myRegistration !== null ? "チーム編成" : "参加チーム";

  return (
    <div className="theme-matchpoint min-h-screen bg-background text-foreground">
      {/* 編成画面は判断材料を横に並べるため広い幅を取る（他ページの max-w-3xl/6xl より広い）。 */}
      <div className="mx-auto max-w-[1600px] px-6 py-8">
        {/* パンくず（イベント一覧 → イベント名 → チーム編成）。リンクはブランド色でホバー。 */}
        <nav className="text-sm text-muted-foreground">
          <Link
            href="/events"
            className="underline-offset-2 transition-colors hover:text-[color:var(--mp-brand)] hover:underline"
          >
            イベント一覧
          </Link>
          <span className="mx-2 text-[color:var(--mp-fg-subtle)]">/</span>
          <Link
            href={`/events/${event.slug ?? event.id}`}
            className="underline-offset-2 transition-colors hover:text-[color:var(--mp-brand)] hover:underline"
          >
            {event.title}
          </Link>
          <span className="mx-2 text-[color:var(--mp-fg-subtle)]">/</span>
          <span className="text-foreground">{pageTitle}</span>
        </nav>

        {/* ヒーロー：モードラベル＋タイトル・イベント名、ゲームチップ、編成メタ（形式/上限/定員）。 */}
        <header className="mt-5 rounded-2xl border border-border bg-card p-6 shadow-[var(--mp-e2)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              {/* モードラベル: Team Builder · <立場>。観戦者には Organizer を出さない。 */}
              <p className="flex items-center gap-2 text-xs font-semibold tracking-widest text-[color:var(--mp-brand)]">
                <span className="h-px w-6 bg-[color:var(--mp-brand)]" />
                TEAM BUILDER
                <span className="text-[color:var(--mp-fg-subtle)]">·</span>
                <span className="text-[color:var(--mp-fg-subtle)]">
                  {roleLabel}
                </span>
              </p>
              <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
                {pageTitle}
              </h1>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {event.title}
              </p>
            </div>

            {/* 本戦・観戦ビューへの導線（観戦者にも出す・フェーズB）。 */}
            <div className="flex shrink-0 flex-col items-end gap-1.5 text-sm">
              {hasGroupStage(event.format) ? (
                <Link
                  href={`/events/${event.id}/groups`}
                  className="text-[color:var(--mp-brand)] underline-offset-2 hover:underline"
                >
                  ブロック分けへ →
                </Link>
              ) : (
                <Link
                  href={`/events/${event.id}/tournament`}
                  className="text-[color:var(--mp-brand)] underline-offset-2 hover:underline"
                >
                  {tournamentStageLabel(event.format)}へ →
                </Link>
              )}
              <Link
                href={`/events/${event.id}/watch`}
                className="text-muted-foreground hover:text-foreground"
              >
                観戦ビューへ →
              </Link>
            </div>
          </div>

          {/* ゲームチップ（赤ドット＋ゲーム名）。他画面の EventCard と同じ体系に寄せる。 */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-[color:var(--mp-surface-2)] px-3 py-1 text-xs font-medium text-muted-foreground">
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full bg-[color:var(--mp-danger)]"
              />
              {gameName}
            </span>
          </div>

          {/* 編成メタ: 形式（＋人数）/ 平均スコア上限 / 定員。等幅で判断材料を並べる。 */}
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <span>
              形式{" "}
              <span className="text-foreground">
                {eventFormatLabel(event.format)}
              </span>{" "}
              <span className="tabular-nums">
                （{teamSize}v{teamSize}）
              </span>
            </span>
            {event.require_score && (
              <span>
                平均スコア上限{" "}
                <span className="tabular-nums text-foreground">
                  {event.team_score_cap === null
                    ? "なし"
                    : event.team_score_cap.toLocaleString("ja-JP")}
                </span>
              </span>
            )}
            <span>
              定員{" "}
              <span className="tabular-nums text-foreground">
                {event.capacity === null
                  ? "未設定"
                  : `${event.capacity.toLocaleString("ja-JP")} チーム`}
              </span>
            </span>
          </div>
        </header>

        <TeamsBoard
          eventId={event.id}
          readOnly={!isOrganizer}
          isOrganizer={isOrganizer}
          spectator={!isOrganizer && myRegistration === null}
          selfFormation={event.team_formation === "self"}
          myRegistrationId={myRegistration?.id ?? null}
          showScore={event.require_score}
          roleSwapAllowed={event.role_swap_allowed}
          teamSize={teamSize}
          teamScoreCap={event.team_score_cap}
          initialTeams={teams}
          initialUnassigned={unassigned}
        />
      </div>
    </div>
  );
}
