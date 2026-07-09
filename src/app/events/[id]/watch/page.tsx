import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { findEventById, findEventBySlug } from "@/lib/repositories/events";
import { listTeamsWithMembers } from "@/lib/repositories/teams";
import { listGroupsWithTeams } from "@/lib/repositories/groups";
import {
  listGroupMatches,
  listTournamentMatches,
} from "@/lib/repositories/matches";
import { listMatchResultsByEvent } from "@/lib/repositories/match-results";
import { computeStandings } from "@/lib/services/standings";
import { canViewEvent } from "@/lib/services/event-status";
import {
  hasGroupStage,
  hasTournamentStage,
  groupStageLabel,
  tournamentStageLabel,
} from "@/lib/services/event-format";
import { isValidEventSlug } from "@/lib/services/event-slug";
import { teamColor } from "../_components/team-colors";
import { roundLabel } from "../_components/round-label";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  draft: "下書き",
  published: "公開中",
  recruiting: "募集中",
  closed: "募集締切",
  ongoing: "開催中",
  finished: "終了",
};

/** UTC(ISO) を JST の "MM/DD HH:mm" に整形する。null は "未定"。 */
function fmtJstShort(iso: string | null): string {
  if (!iso) return "未定";
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}

/** UTC(ISO) を JST 表示に整形する（概要用）。null は "未定"。 */
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

/**
 * 観戦集約ページ（/events/[id]/watch）。デザイン刷新 第10画面。
 * 参加チーム・ブロック・予選順位・試合結果・決勝トーナメントを1ページに通覧する
 * 観戦者向けダッシュボード。各セクションは「詳細画面のダイジェスト＋詳細への導線」。
 * 編集UIは持たない（閲覧専用）。インタラクションが無いので Server Component 一本で描く。
 *
 * 表示ルール: 観戦者区分のためメンバーは登録名のみ（Discord名・バトルタグは出さない）。
 * 空セクション（未実施）は丸ごと非表示にし、進行に応じてセクションが増えていく。
 * 閲覧は「公開済みなら誰でも・下書きは主催者のみ」（canViewEvent）。
 */
export default async function EventWatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const event = isValidEventSlug(id)
    ? await findEventBySlug(id)
    : await findEventById(id);
  if (!event) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const viewerId = user?.id ?? null;
  if (!canViewEvent(event.status, event.organizer_id, viewerId)) notFound();

  const detailHref = `/events/${event.slug ?? event.id}`;
  const gameName = (event.games as { name: string } | null)?.name ?? "-";
  const organizerName =
    event.organizer_display_name ??
    (event.organizer as { discord_name: string } | null)?.discord_name ??
    "-";

  const [teamsRaw, groupsRaw, groupMatchesRaw, resultsRaw, tournamentRaw] =
    await Promise.all([
      listTeamsWithMembers(event.id),
      listGroupsWithTeams(event.id),
      listGroupMatches(event.id),
      listMatchResultsByEvent(event.id),
      listTournamentMatches(event.id),
    ]);

  // ── ブロック（色・所属をチームに紐付けるため先に構築） ──────────
  type GroupTeamJoin = {
    teams: { id: string; name: string } | null;
  };
  type GroupJoin = {
    id: string;
    name: string;
    group_teams: GroupTeamJoin[] | null;
  };
  const groupJoins = (groupsRaw ?? []) as unknown as GroupJoin[];
  // ブロックに 1 始まりの番号と色を割り当てる（表示順＝取得順）。
  const blocks = groupJoins.map((g, i) => {
    const teamIds = (g.group_teams ?? [])
      .map((gt) => gt.teams?.id)
      .filter((x): x is string => !!x);
    return {
      id: g.id,
      name: g.name,
      // ブロックのラベル（"A組" 等）はブロック名をそのまま使う。バッジは番号色。
      color: teamColor(i),
      // ブロック内の各チーム id → ブロック内 index（チーム色の割当に使う）。
      teamIds,
    };
  });
  // team_id → { blockName, blockColor, colorIndex }（チーム色・所属バッジ用）。
  const teamBlockMeta = new Map<
    string,
    { blockName: string; blockColor: string; color: string }
  >();
  for (const b of blocks) {
    b.teamIds.forEach((tid, i) => {
      teamBlockMeta.set(tid, {
        blockName: b.name,
        blockColor: b.color,
        color: teamColor(i),
      });
    });
  }

  // ── 参加チーム（登録名のみ・regular/reserve 区分・代表フラグ・色） ──
  type MemberJoin = {
    position: string;
    is_representative: boolean;
    registrations: {
      display_name: string | null;
      users: { discord_name: string } | null;
    } | null;
  };
  type TeamJoin = {
    id: string;
    name: string;
    status: string;
    team_members: MemberJoin[] | null;
  };
  const teams = ((teamsRaw ?? []) as unknown as TeamJoin[]).map((t, i) => {
    const members = (t.team_members ?? []).map((tm) => {
      const reg = tm.registrations;
      // 観戦者区分: 登録名 ?? Discord名（フォールバックとしてのみ。素の Discord 名を
      // 単独で見せる用途ではない）。
      const name = reg?.display_name ?? reg?.users?.discord_name ?? "-";
      return {
        name,
        position: tm.position,
        isRepresentative: tm.is_representative,
      };
    });
    const meta = teamBlockMeta.get(t.id);
    // ブロック未所属チームはブロック未割当の色（取得順 index）を割り当てる。
    const color = meta?.color ?? teamColor(i);
    return {
      id: t.id,
      name: t.name,
      color,
      blockName: meta?.blockName ?? null,
      blockColor: meta?.blockColor ?? null,
      // regular は代表を先頭に並べる（★ 表示のため）。
      regular: members
        .filter((m) => m.position !== "reserve")
        .sort((a, b) => Number(b.isRepresentative) - Number(a.isRepresentative))
        .map((m) => ({ name: m.name, isRepresentative: m.isRepresentative })),
      reserve: members
        .filter((m) => m.position === "reserve")
        .map((m) => ({ name: m.name })),
    };
  });

  // ── チーム名・色解決（ブロック・試合・トーナメントで使う） ──────
  const teamNameById = new Map<string, string>();
  const teamColorById = new Map<string, string>();
  for (const t of teams) {
    teamNameById.set(t.id, t.name);
    teamColorById.set(t.id, t.color);
  }

  // ── ブロック表示用（所属チーム名＋色）。blocks から派生（色の二重計算を避ける）。 ──
  const blocksView = blocks.map((b) => ({
    id: b.id,
    name: b.name,
    color: b.color,
    teams: b.teamIds.map((tid) => ({
      name: teamNameById.get(tid) ?? "-",
      color: teamColorById.get(tid) ?? "var(--mp-border-strong)",
    })),
  }));

  // ── 試合結果（予選） ──────────────────────────────────────────
  type ResultRow = {
    match_id: string;
    team_a_score: number;
    team_b_score: number;
    winner_team_id: string | null;
    potg_a: number;
    potg_b: number;
    updated_at: string | null;
  };
  const resultRows = (resultsRaw ?? []) as unknown as ResultRow[];
  const resultByMatch = new Map<string, ResultRow>();
  for (const r of resultRows) resultByMatch.set(r.match_id, r);

  type MatchRow = {
    id: string;
    group_id: string | null;
    team_a_id: string | null;
    team_b_id: string | null;
    streamer_name?: string | null;
  };
  const groupMatches = (groupMatchesRaw ?? []) as MatchRow[];
  const matchById = new Map<string, MatchRow>();
  for (const m of groupMatches) matchById.set(m.id, m);
  // group_id → ブロック名（結果カードのブロックバッジ用）。
  const blockNameById = new Map(blocks.map((b) => [b.id, b.name]));
  const blockColorById = new Map(blocks.map((b) => [b.id, b.color]));

  // 消化済み試合（予選のうち結果あり）。
  const finishedMatches = groupMatches
    .filter((m) => resultByMatch.has(m.id))
    .map((m) => {
      const r = resultByMatch.get(m.id)!;
      return {
        id: m.id,
        teamAId: m.team_a_id,
        teamBId: m.team_b_id,
        teamAName: m.team_a_id ? teamNameById.get(m.team_a_id) ?? "-" : "-",
        teamBName: m.team_b_id ? teamNameById.get(m.team_b_id) ?? "-" : "-",
        teamAColor: m.team_a_id ? teamColorById.get(m.team_a_id) ?? null : null,
        teamBColor: m.team_b_id ? teamColorById.get(m.team_b_id) ?? null : null,
        teamAScore: r.team_a_score,
        teamBScore: r.team_b_score,
        winnerTeamId: r.winner_team_id,
        blockName: m.group_id ? blockNameById.get(m.group_id) ?? null : null,
        blockColor: m.group_id ? blockColorById.get(m.group_id) ?? null : null,
        streamerName: m.streamer_name ?? null,
        finishedAt: r.updated_at,
      };
    });
  // サマリーは「直近に結果が確定した試合」を最新5件。確定時刻（updated_at）降順。
  const recentResults = [...finishedMatches]
    .sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""))
    .slice(0, 5);

  // ── 予選順位（ランキング ON のときだけ。ブロックごとに集計） ────
  const rankingConfig = {
    pointsWin: event.points_win,
    pointsDraw: event.points_draw,
    pointsLoss: event.points_loss,
    tiebreakers: (event.tiebreakers ?? []) as (
      | "head_to_head"
      | "map_diff"
      | "potg"
    )[],
  };
  // 決勝トーナメント進出数（各ブロック上位N）。通過ライン強調に使う。0 は通過ラインなし。
  const advanceCount = event.tournament_advance_count ?? 0;

  const standingsByGroup = event.ranking_enabled
    ? blocks.map((b) => {
        const teamIdSet = new Set(b.teamIds);
        const groupResults = resultRows
          .map((res) => {
            const m = matchById.get(res.match_id);
            return m ? { m, res } : null;
          })
          .filter(
            (x): x is { m: MatchRow; res: ResultRow } =>
              x !== null &&
              x.m.team_a_id != null &&
              x.m.team_b_id != null &&
              teamIdSet.has(x.m.team_a_id) &&
              teamIdSet.has(x.m.team_b_id),
          )
          .map(({ m, res }) => ({
            teamAId: m.team_a_id as string,
            teamBId: m.team_b_id as string,
            teamAScore: res.team_a_score,
            teamBScore: res.team_b_score,
            potgA: res.potg_a,
            potgB: res.potg_b,
          }));
        const rows = computeStandings({
          teamIds: b.teamIds,
          results: groupResults,
          config: rankingConfig,
        }).map((row) => ({
          teamName: teamNameById.get(row.teamId) ?? "-",
          teamColor: teamColorById.get(row.teamId) ?? "var(--mp-border-strong)",
          wins: row.wins,
          draws: row.draws,
          losses: row.losses,
          points: row.points,
          mapDiff: row.mapDiff,
          rank: row.rank,
        }));
        return {
          id: b.id,
          name: b.name,
          color: b.color,
          rows,
          // このブロック自身に結果があるか（全0点の羅列を避ける判定に使う）。
          hasResults: groupResults.length > 0,
        };
      })
    : [];
  // 結果が1件もないブロックの順位は出さない（そのブロック自身の消化で判定・全0点を避ける）。
  const standingsToShow = standingsByGroup.filter((g) => g.hasResults);

  // ── 決勝トーナメント（簡易ブラケット: round ごとの対戦カード） ──
  type TMatchRow = {
    id: string;
    team_a_id: string | null;
    team_b_id: string | null;
    round: number | null;
    bracket_position: number | null;
    best_of: number;
    streamer_name?: string | null;
  };
  const tournamentMatches = (tournamentRaw ?? []) as TMatchRow[];
  const totalTournamentRounds =
    tournamentMatches.length > 0
      ? Math.max(...tournamentMatches.map((m) => m.round ?? 1))
      : 0;

  type BracketMatch = {
    teamAName: string | null;
    teamBName: string | null;
    teamAScore: number | null;
    teamBScore: number | null;
    winnerTeamId: string | null;
    teamAId: string | null;
    teamBId: string | null;
    bestOf: number;
    hasResult: boolean;
    isBye: boolean;
    streamerName: string | null;
    isThirdPlace: boolean;
  };
  const roundsMap = new Map<number, { position: number; m: BracketMatch }[]>();
  for (const m of tournamentMatches) {
    const round = m.round ?? 1;
    const r = resultByMatch.get(m.id) ?? null;
    // 1回戦で片側だけ空 = BYE（不戦勝）。決勝T詳細（matchState）と同じ規則。
    const isBye =
      round === 1 && (m.team_a_id === null) !== (m.team_b_id === null);
    const arr = roundsMap.get(round) ?? [];
    arr.push({
      position: m.bracket_position ?? 0,
      m: {
        teamAId: m.team_a_id,
        teamBId: m.team_b_id,
        teamAName: m.team_a_id ? teamNameById.get(m.team_a_id) ?? null : null,
        teamBName: m.team_b_id ? teamNameById.get(m.team_b_id) ?? null : null,
        teamAScore: r?.team_a_score ?? null,
        teamBScore: r?.team_b_score ?? null,
        winnerTeamId: r?.winner_team_id ?? null,
        bestOf: m.best_of,
        hasResult: r !== null,
        isBye,
        streamerName: m.streamer_name ?? null,
        isThirdPlace:
          totalTournamentRounds >= 2 &&
          round === totalTournamentRounds &&
          (m.bracket_position ?? 0) === 1,
      },
    });
    roundsMap.set(round, arr);
  }
  const rounds = [...roundsMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([round, arr]) => ({
      round,
      label: roundLabel(round, totalTournamentRounds),
      isFinalRound: round === totalTournamentRounds,
      bestOf: arr[0]?.m.bestOf ?? 0,
      // 本線（3位決定戦を除く）と3位決定戦を分ける。
      matches: arr
        .filter((x) => !x.m.isThirdPlace)
        .sort((a, b) => a.position - b.position)
        .map((x) => x.m),
      thirdPlace: arr.find((x) => x.m.isThirdPlace)?.m ?? null,
    }));

  // 優勝チーム（決勝の勝者）。ヒーローの優勝ゴールドチップ・決勝バナーに使う。
  const finalRound = rounds.find((r) => r.isFinalRound);
  const finalMatch = finalRound?.matches[0] ?? null;
  const champion =
    finalMatch?.hasResult && finalMatch.winnerTeamId
      ? teamNameById.get(finalMatch.winnerTeamId) ?? null
      : null;
  const finalScore =
    finalMatch?.hasResult && finalMatch.teamAScore !== null
      ? `${finalMatch.teamAScore}–${finalMatch.teamBScore}`
      : null;

  // ── セクションの表示判定（形式で絞り、空なら丸ごと非表示） ──────
  const groupStage = hasGroupStage(event.format);
  const tournamentStage = hasTournamentStage(event.format);
  const groupLabel = groupStageLabel(event.format);
  const tournamentLabel = tournamentStageLabel(event.format);
  const showTeams = teams.length > 0;
  const showGroups = groupStage && blocksView.length > 0;
  const showStandings = groupStage && standingsToShow.length > 0;
  const showResults = groupStage && finishedMatches.length > 0;
  const showTournament = tournamentStage && rounds.length > 0;

  // セクション番号は「実際に表示されるセクションだけ」を 01 から連番にする
  // （形式や進行で一部が非表示でも 01,02,03… と飛ばさない）。
  const sectionNo = (() => {
    let n = 0;
    return () => String(++n).padStart(2, "0");
  })();
  const teamsNo = showTeams ? sectionNo() : "";
  const groupsNo = showGroups ? sectionNo() : "";
  const standingsNo = showStandings ? sectionNo() : "";
  const resultsNo = showResults ? sectionNo() : "";
  const tournamentNo = showTournament ? sectionNo() : "";

  const matchesHref = `/events/${event.id}/matches`;
  // 進捗チップ用の派生値。
  const doneCount = finishedMatches.length;
  const totalCount = groupMatches.length;

  return (
    <div className="theme-matchpoint min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1240px] px-6 py-8">
        {/* パンくず（イベント一覧 → イベント名 → 観戦ビュー）。 */}
        <nav className="mb-4 text-sm text-muted-foreground">
          <Link
            href="/events"
            className="underline-offset-2 transition-colors hover:text-[color:var(--mp-brand)] hover:underline"
          >
            イベント一覧
          </Link>
          <span className="mx-2 text-[color:var(--mp-fg-subtle)]">/</span>
          <Link
            href={detailHref}
            className="underline-offset-2 transition-colors hover:text-[color:var(--mp-brand)] hover:underline"
          >
            {event.title}
          </Link>
          <span className="mx-2 text-[color:var(--mp-fg-subtle)]">/</span>
          <span className="text-foreground">観戦ビュー</span>
        </nav>

        {/* ヒーロー：kicker＋タイトル＋進捗チップ＋観戦バナー。 */}
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-[var(--mp-e2)] sm:p-7">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(680px 240px at 90% -30%, rgba(34,211,238,.12), transparent 65%)",
            }}
          />
          <div className="relative">
            <p className="flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--mp-accent)]">
              <span className="h-0.5 w-5 bg-[color:var(--mp-accent)]" />
              Watch · 観戦
            </p>
            <h1 className="mt-2.5 text-2xl font-extrabold tracking-tight sm:text-3xl">
              {event.title}
            </h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span>🔴 {gameName}</span>
              <span className="text-[color:var(--mp-border-strong)]">·</span>
              <span>状態: {STATUS_LABEL[event.status] ?? event.status}</span>
              <span className="text-[color:var(--mp-border-strong)]">·</span>
              <span>主催: {organizerName}</span>
              <span className="text-[color:var(--mp-border-strong)]">·</span>
              <span>開催 {fmtJst(event.starts_at)}</span>
            </p>

            {/* 進捗チップ。 */}
            <div className="mt-5 flex flex-wrap gap-2.5">
              {showTeams && (
                <ProgressChip label="参加" value={`${teams.length}`} unit="チーム" />
              )}
              {showGroups && (
                <ProgressChip
                  label="ブロック"
                  value={`${blocksView.length}`}
                  unit="組"
                />
              )}
              {groupStage && totalCount > 0 && (
                <ProgressChip
                  label={`${groupLabel}消化`}
                  value={`${doneCount}`}
                  unit={`/${totalCount}`}
                  progress={totalCount > 0 ? doneCount / totalCount : 0}
                />
              )}
              {showTournament && !champion && (
                <ProgressChip label={tournamentLabel} value="進行中" />
              )}
              {champion && (
                <span className="inline-flex items-center gap-2 rounded-[10px] border border-[color:var(--mp-gold)]/40 bg-gradient-to-r from-[color:var(--mp-gold)]/[0.14] to-[color:var(--mp-gold)]/[0.03] px-3.5 py-2.5 shadow-[0_0_24px_-6px_rgba(245,196,81,.4)]">
                  <span className="font-jp text-[11px] text-[color:var(--mp-gold)]/75">
                    🏆 優勝
                  </span>
                  <span className="font-sans text-base font-bold leading-none text-[color:var(--mp-gold)]">
                    {champion}
                  </span>
                </span>
              )}
            </div>

            {/* 観戦バナー。 */}
            <div className="mt-[18px] flex items-center gap-3 rounded-xl border border-[color:var(--mp-accent)]/30 bg-gradient-to-r from-[color:var(--mp-accent)]/10 to-transparent px-4 py-3 text-[12.5px] text-muted-foreground">
              <span
                aria-hidden
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--mp-live)] shadow-[0_0_10px_var(--mp-live)]"
              />
              <span>
                <span className="font-semibold text-foreground">観戦ビュー</span>{" "}
                大会の全体像を上から順に通覧できます（閲覧専用）。各セクションの「見る →」から詳細ページへ。進行に応じてセクションが増えていきます。
              </span>
            </div>
          </div>
        </div>

        {/* 参加チーム */}
        {showTeams && (
          <Section
            n={teamsNo}
            title="参加チーム"
            sub="承認された全チームと登録メンバー（★＝チーム代表）。表示は登録名のみ。"
            action={{ href: `/events/${event.id}/teams`, label: "チーム編成を見る" }}
          >
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {teams.map((t) => (
                <div
                  key={t.id}
                  className="relative overflow-hidden rounded-xl border border-border bg-card p-4 shadow-[var(--mp-e1)]"
                >
                  <span
                    aria-hidden
                    className="absolute bottom-0 left-0 top-0 w-1"
                    style={{ backgroundColor: t.color }}
                  />
                  <div className="flex items-center gap-2.5">
                    <span className="min-w-0 flex-1 truncate font-sans text-[15.5px] font-extrabold">
                      {t.name}
                    </span>
                    {t.blockName && (
                      <span
                        className="shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold text-[#0B0E14]"
                        style={{ backgroundColor: t.blockColor ?? t.color }}
                      >
                        {t.blockName}
                      </span>
                    )}
                  </div>
                  {t.regular.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {t.regular.map((m, i) => (
                        <span
                          key={i}
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-sans text-[11.5px] font-medium ${
                            m.isRepresentative
                              ? "border-[color:var(--mp-border-strong)] bg-[color:var(--mp-surface-2)] text-foreground"
                              : "border-border bg-[color:var(--mp-surface-2)] text-muted-foreground"
                          }`}
                        >
                          {m.isRepresentative && (
                            <span className="text-[10px] text-[color:var(--mp-warning)]">
                              ★
                            </span>
                          )}
                          {m.name}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 flex items-center gap-1.5 border-t border-border pt-2.5 text-[11px] text-[color:var(--mp-fg-subtle)]">
                    <span className="font-mono text-[9px] uppercase tracking-wider">
                      Regular
                    </span>
                    <span className="font-mono font-semibold text-muted-foreground">
                      {t.regular.length}名
                    </span>
                    {t.reserve.length > 0 && (
                      <>
                        <span className="text-[color:var(--mp-border-strong)]">·</span>
                        <span className="font-mono text-[9px] uppercase tracking-wider">
                          Reserve
                        </span>
                        <span className="font-mono font-semibold text-muted-foreground">
                          {t.reserve.length}名
                        </span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ブロック分け */}
        {showGroups && (
          <Section
            n={groupsNo}
            title="ブロック分け"
            sub={`${groupLabel}は各ブロック総当たり。${advanceCount > 0 ? `各ブロック上位${advanceCount}チームが${tournamentLabel}へ進出。` : ""}`}
            action={{ href: `/events/${event.id}/groups`, label: "ブロック分けを見る" }}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {blocksView.map((b) => (
                <div
                  key={b.id}
                  className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--mp-e1)]"
                >
                  <div className="flex items-center gap-2.5 border-b border-border bg-gradient-to-b from-[color:var(--mp-surface-2)] to-transparent px-4 py-3">
                    <span
                      className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-md font-sans text-[15px] font-extrabold text-[#0B0E14]"
                      style={{ backgroundColor: b.color }}
                    >
                      {b.name.replace(/組$/, "").slice(0, 2)}
                    </span>
                    <span className="font-sans text-base font-extrabold">
                      {b.name}
                    </span>
                    <span className="ml-auto font-mono text-[11px] text-[color:var(--mp-fg-subtle)]">
                      {b.teams.length} チーム
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5 p-3">
                    {b.teams.map((t, i) => (
                      <div key={i} className="flex items-center gap-2.5 px-2 py-1.5">
                        <span
                          aria-hidden
                          className="h-5 w-2 shrink-0 rounded-sm"
                          style={{ backgroundColor: t.color }}
                        />
                        <span className="grid h-[19px] w-[19px] shrink-0 place-items-center rounded-full border border-border bg-[color:var(--mp-surface-3)] font-mono text-[10px] text-[color:var(--mp-fg-subtle)]">
                          {i + 1}
                        </span>
                        <span className="truncate font-sans text-[13px] font-semibold">
                          {t.name}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* 予選順位 */}
        {showStandings && (
          <Section
            n={standingsNo}
            title={`${groupLabel}順位`}
            sub={`ブロック別の順位ダイジェスト。1位はゴールド${advanceCount > 0 ? `、通過ライン（上位${advanceCount}）を強調` : ""}。消化 ${doneCount}/${totalCount} 試合。`}
            action={{ href: matchesHref, label: "対戦表・順位を見る" }}
          >
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {standingsToShow.map((g) => (
                <StandingsPanel
                  key={g.id}
                  name={g.name}
                  color={g.color}
                  rows={g.rows}
                  advanceCount={advanceCount}
                />
              ))}
            </div>
          </Section>
        )}

        {/* 試合結果 */}
        {showResults && (
          <Section
            n={resultsNo}
            title={`${groupLabel}試合結果`}
            sub="直近5試合。勝者を強調表示。配信された試合には 📺 を表示。"
            action={{ href: matchesHref, label: "すべての結果を見る" }}
          >
            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--mp-e1)]">
              {recentResults.map((m) => {
                const aWin = m.winnerTeamId != null && m.winnerTeamId === m.teamAId;
                const bWin = m.winnerTeamId != null && m.winnerTeamId === m.teamBId;
                // 引分（勝者なし）は両者を敗者色にせず中立表示にする。
                const isDraw = m.winnerTeamId == null;
                return (
                  <div
                    key={m.id}
                    className="flex items-center gap-3.5 border-b border-border px-4 py-3 last:border-b-0"
                  >
                    <span className="hidden w-[76px] shrink-0 font-mono text-[11.5px] text-[color:var(--mp-fg-subtle)] tabular-nums sm:block">
                      {fmtJstShort(m.finishedAt)}
                    </span>
                    {m.blockName && (
                      <span
                        className="shrink-0 rounded-full px-2 py-0.5 font-mono text-[9.5px] font-semibold text-[#0B0E14]"
                        style={{ backgroundColor: m.blockColor ?? "var(--mp-border-strong)" }}
                      >
                        {m.blockName}
                      </span>
                    )}
                    <div className="flex min-w-0 flex-1 items-center justify-center gap-2.5">
                      <div className={`flex min-w-0 flex-1 items-center justify-end gap-2 text-right ${aWin || isDraw ? "" : "text-[color:var(--mp-fg-subtle)]"}`}>
                        <span className="truncate font-sans text-[13.5px] font-bold">
                          {m.teamAName}
                        </span>
                        {aWin && <span className="shrink-0 text-[11px]">👑</span>}
                        <span
                          aria-hidden
                          className="h-[18px] w-2 shrink-0 rounded-sm"
                          style={{ backgroundColor: m.teamAColor ?? "var(--mp-border-strong)" }}
                        />
                      </div>
                      <span className="shrink-0 px-1 font-mono text-[17px] font-bold tabular-nums">
                        <span className={aWin ? "text-[color:var(--mp-success)]" : "text-[color:var(--mp-fg-subtle)]"}>
                          {m.teamAScore}
                        </span>
                        <span className="mx-1 text-[11px] font-normal text-[color:var(--mp-fg-subtle)]">
                          –
                        </span>
                        <span className={bWin ? "text-[color:var(--mp-success)]" : "text-[color:var(--mp-fg-subtle)]"}>
                          {m.teamBScore}
                        </span>
                      </span>
                      <div className={`flex min-w-0 flex-1 items-center gap-2 ${bWin || isDraw ? "" : "text-[color:var(--mp-fg-subtle)]"}`}>
                        <span
                          aria-hidden
                          className="h-[18px] w-2 shrink-0 rounded-sm"
                          style={{ backgroundColor: m.teamBColor ?? "var(--mp-border-strong)" }}
                        />
                        {bWin && <span className="shrink-0 text-[11px]">👑</span>}
                        <span className="truncate font-sans text-[13.5px] font-bold">
                          {m.teamBName}
                        </span>
                      </div>
                    </div>
                    <span className="hidden w-[110px] shrink-0 items-center justify-end gap-1.5 font-mono text-[11px] text-[color:var(--mp-fg-subtle)] sm:flex">
                      {m.streamerName && (
                        <>
                          <span className="text-[12px] text-[color:var(--mp-live)]">📺</span>
                          <span className="truncate">{m.streamerName}</span>
                        </>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* 決勝トーナメント（簡易ブラケット・コネクタ線なし） */}
        {showTournament && (
          <Section
            n={tournamentNo}
            title={tournamentLabel}
            sub="ラウンド別のダイジェスト。勝者を強調、配信は 📺。フルブラケットは詳細ページへ。"
            action={{
              href: `/events/${event.id}/tournament`,
              label: "ブラケットを見る",
            }}
          >
            <div
              className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-[var(--mp-e1)] sm:p-5"
            >
              {champion && (
                <>
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0"
                    style={{
                      background:
                        "radial-gradient(520px 200px at 82% -40%, rgba(245,196,81,.1), transparent 70%)",
                    }}
                  />
                  <div className="relative mb-5 flex items-center gap-3.5 rounded-xl border border-[color:var(--mp-gold)]/40 bg-gradient-to-r from-[color:var(--mp-gold)]/[0.16] to-[color:var(--mp-gold)]/[0.03] px-4 py-3.5">
                    <span className="text-3xl" style={{ filter: "drop-shadow(0 3px 8px rgba(0,0,0,.5))" }}>
                      🏆
                    </span>
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-widest text-[color:var(--mp-gold)]/80">
                        Champion · 優勝
                      </div>
                      <div className="mt-0.5 font-sans text-xl font-extrabold text-[color:var(--mp-gold)]">
                        {champion}
                      </div>
                    </div>
                    {finalScore && (
                      <span className="ml-auto font-mono text-xs text-muted-foreground">
                        決勝 {finalScore}
                      </span>
                    )}
                  </div>
                </>
              )}
              <div className="relative overflow-x-auto pb-2">
                <div className="flex min-w-min gap-6">
                  {rounds.map((r) => (
                    <div key={r.round} className="flex min-w-[224px] flex-col">
                      <div className="mb-3.5 flex items-baseline gap-2.5">
                        <span className="font-sans text-[14px] font-extrabold tracking-tight">
                          {r.label}
                        </span>
                        <span className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--mp-fg-subtle)]">
                          {r.matches.length} {r.matches.length > 1 ? "matches" : "match"}
                        </span>
                        <span className="ml-auto rounded-full border border-[color:var(--mp-brand)]/30 bg-[color:var(--mp-brand)]/10 px-2 py-0.5 font-mono text-[9.5px] font-semibold text-[color:var(--mp-brand)]">
                          BO{r.bestOf}
                        </span>
                      </div>
                      <div className="flex flex-1 flex-col justify-around gap-3.5">
                        {r.matches.map((m, i) => (
                          <BracketCard key={i} match={m} isFinal={r.isFinalRound} />
                        ))}
                      </div>
                      {r.isFinalRound && r.thirdPlace && (
                        <div className="mt-4 rounded-lg border-[1.5px] border-dashed border-[color:var(--mp-border-strong)] p-3">
                          <div className="mb-2.5 flex items-center gap-2 font-sans text-[11.5px] font-bold text-muted-foreground">
                            <span>🥉</span>3位決定戦
                            <span className="font-normal text-[color:var(--mp-fg-subtle)]">
                              · 準決勝敗者
                            </span>
                          </div>
                          <BracketCard match={r.thirdPlace} isFinal={false} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Section>
        )}

        {/* どのセクションも出ない初期段階の案内 */}
        {!showTeams && (
          <div className="mt-11 flex items-center gap-2.5 rounded-xl border border-dashed border-[color:var(--mp-border-strong)] bg-[color:var(--mp-surface)]/40 px-4 py-4 text-[12.5px] text-[color:var(--mp-fg-subtle)]">
            <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--mp-fg-subtle)]" />
            まだ参加チームが確定していません。募集・編成が進むと、ここに参加チームやブロック・対戦表が表示されます。
          </div>
        )}
      </div>
    </div>
  );
}

/** ヒーローの進捗チップ（値＋任意でプログレスバー）。 */
function ProgressChip({
  label,
  value,
  unit,
  progress,
}: {
  label: string;
  value: string;
  unit?: string;
  progress?: number;
}) {
  return (
    <span className="inline-flex items-center gap-2.5 rounded-[10px] border border-border bg-[color:var(--mp-surface-2)] px-3.5 py-2.5">
      <span className="font-jp text-[11px] text-[color:var(--mp-fg-subtle)]">
        {label}
      </span>
      <span className="font-mono text-base font-bold leading-none text-foreground tabular-nums">
        {value}
        {unit && (
          <span className="ml-0.5 text-[11px] font-medium text-muted-foreground">
            {unit}
          </span>
        )}
      </span>
      {progress !== undefined && (
        <span className="h-[5px] w-[54px] overflow-hidden rounded-full bg-[color:var(--mp-surface-3)]">
          <span
            className="block h-full rounded-full bg-gradient-to-r from-[color:var(--mp-accent)] to-[#5ce2f2]"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </span>
      )}
    </span>
  );
}

/** セクション枠（番号＋見出し＋サブ＋右上の詳細リンク＋本体）。 */
function Section({
  n,
  title,
  sub,
  action,
  children,
}: {
  n: string;
  title: string;
  sub?: string;
  action?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section className="mt-11">
      <div className="mb-[18px] flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2.5 font-sans text-[19px] font-extrabold tracking-tight">
            <span aria-hidden className="h-[19px] w-[3px] rounded-sm bg-[color:var(--mp-brand)]" />
            {title}
            <span className="font-mono text-[11px] tracking-widest text-[color:var(--mp-fg-subtle)]">
              {n}
            </span>
          </h2>
          {sub && (
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-[color:var(--mp-fg-subtle)]">
              {sub}
            </p>
          )}
        </div>
        {action && (
          <Link
            href={action.href}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[color:var(--mp-accent)]/30 bg-[color:var(--mp-accent)]/[0.07] px-3 py-1.5 font-sans text-[12.5px] font-semibold text-[color:var(--mp-accent)] transition-colors hover:border-[color:var(--mp-accent)]/50 hover:bg-[color:var(--mp-accent)]/[0.14]"
          >
            {action.label}
            <svg viewBox="0 0 24 24" className="h-[13px] w-[13px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12h14" />
              <path d="M13 6l6 6-6 6" />
            </svg>
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

type StandingRowView = {
  teamName: string;
  teamColor: string;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  mapDiff: number;
  rank: number;
};

/** 順位ダイジェストパネル（1位ゴールド・通過ライン強調・勝分敗・得失）。 */
function StandingsPanel({
  name,
  color,
  rows,
  advanceCount,
}: {
  name: string;
  color: string;
  rows: StandingRowView[];
  advanceCount: number;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--mp-e1)]">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <span className="flex items-center gap-2.5 font-sans text-[14.5px] font-extrabold">
          <span
            className="grid h-[22px] w-[22px] place-items-center rounded-sm font-sans text-[11px] font-extrabold text-[#0B0E14]"
            style={{ backgroundColor: color }}
          >
            {name.replace(/組$/, "").slice(0, 2)}
          </span>
          {name} 順位
        </span>
        <span className="font-mono text-[10.5px] text-[color:var(--mp-fg-subtle)]">
          {rows.length} チーム
        </span>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-[color:var(--mp-surface-2)] font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--mp-fg-subtle)]">
            <th className="w-[46px] px-1.5 py-2.5 text-center font-medium">順位</th>
            <th className="px-1.5 py-2.5 pl-4 text-left font-medium">チーム</th>
            <th className="px-1.5 py-2.5 text-center font-medium">勝分敗</th>
            <th className="px-1.5 py-2.5 text-center font-medium">勝点</th>
            <th className="px-1.5 py-2.5 text-center font-medium">得失</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isFirst = r.rank === 1;
            const isQual = advanceCount > 0 && r.rank <= advanceCount;
            const showQualLine =
              advanceCount > 0 && r.rank === advanceCount && rows.length > advanceCount;
            const gdCls =
              r.mapDiff > 0
                ? "text-[color:var(--mp-success)]"
                : r.mapDiff < 0
                  ? "text-[color:var(--mp-danger)]"
                  : "text-[color:var(--mp-fg-subtle)]";
            return (
              <tr key={r.rank} className="group">
                <td colSpan={5} className="p-0">
                  <div
                    className={`border-b border-border ${
                      isFirst
                        ? "bg-gradient-to-r from-[color:var(--mp-gold)]/[0.07] to-transparent"
                        : isQual
                          ? "bg-gradient-to-r from-[color:var(--mp-success)]/[0.05] to-transparent"
                          : ""
                    }`}
                  >
                    <div className="grid grid-cols-[46px_1fr_auto_auto_auto] items-center">
                      <div className="px-1.5 py-2.5 text-center">
                        <span
                          className={`inline-grid h-6 w-6 place-items-center rounded-sm font-mono text-[12px] font-bold tabular-nums ${
                            isFirst
                              ? "border-transparent text-[#1a1206] shadow-[0_0_12px_rgba(245,196,81,.35)]"
                              : isQual
                                ? "border border-[color:var(--mp-success)]/35 bg-[color:var(--mp-success)]/10 text-[color:var(--mp-success)]"
                                : "border border-border bg-[color:var(--mp-surface-3)] text-[color:var(--mp-fg-muted)]"
                          }`}
                          style={
                            isFirst
                              ? { background: "linear-gradient(135deg,var(--mp-gold),#E0A93A)" }
                              : undefined
                          }
                        >
                          {r.rank}
                        </span>
                      </div>
                      <div className="flex items-center gap-2.5 py-2.5 pl-4 pr-1.5">
                        <span
                          aria-hidden
                          className="h-5 w-[9px] shrink-0 rounded-sm"
                          style={{ backgroundColor: r.teamColor }}
                        />
                        <span
                          className="truncate font-sans text-[13.5px] font-bold"
                          style={isFirst ? { color: "var(--mp-gold)" } : undefined}
                        >
                          {r.teamName}
                        </span>
                      </div>
                      <div className="px-2 py-2.5 text-center font-mono text-[12.5px] font-semibold tabular-nums">
                        <span className="text-[color:var(--mp-success)]">{r.wins}</span>
                        <span className="text-[color:var(--mp-fg-subtle)]">-</span>
                        <span className="text-[color:var(--mp-fg-muted)]">{r.draws}</span>
                        <span className="text-[color:var(--mp-fg-subtle)]">-</span>
                        <span className="text-[color:var(--mp-danger)]">{r.losses}</span>
                      </div>
                      <div className="px-2 py-2.5 text-center">
                        <span
                          className="font-mono text-base font-bold tabular-nums"
                          style={isFirst ? { color: "var(--mp-gold)" } : undefined}
                        >
                          {r.points}
                        </span>
                      </div>
                      <div className={`px-2 py-2.5 text-center font-mono text-[12.5px] font-semibold tabular-nums ${gdCls}`}>
                        {r.mapDiff > 0 ? `+${r.mapDiff}` : r.mapDiff}
                      </div>
                    </div>
                    {showQualLine && (
                      <div className="flex items-center gap-2.5 bg-[repeating-linear-gradient(90deg,transparent,transparent_6px,rgba(52,211,153,.12)_6px,rgba(52,211,153,.12)_12px)] px-4 py-1.5 font-mono text-[9.5px] tracking-wider text-[color:var(--mp-success)]">
                        <span className="rounded-full border border-[color:var(--mp-success)]/35 bg-card px-2 py-px">
                          ▲ 予選通過ライン
                        </span>
                        <span>上位 {advanceCount} が{name.includes("組") ? "決勝Tへ" : "進出"}</span>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type BracketMatchView = {
  teamAName: string | null;
  teamBName: string | null;
  teamAScore: number | null;
  teamBScore: number | null;
  winnerTeamId: string | null;
  teamAId: string | null;
  teamBId: string | null;
  bestOf: number;
  hasResult: boolean;
  isBye: boolean;
  streamerName: string | null;
};

/** ブラケットのダイジェストカード（コネクタ線なし・勝者強調・BYE・配信）。 */
function BracketCard({
  match,
  isFinal,
}: {
  match: BracketMatchView;
  isFinal: boolean;
}) {
  const done = match.hasResult;
  const tag = match.isBye ? "不戦勝" : done ? "✓ 終了" : "進行前";
  const champWinnerA = isFinal && done && match.winnerTeamId === match.teamAId;
  const champWinnerB = isFinal && done && match.winnerTeamId === match.teamBId;
  return (
    <div
      className={`overflow-hidden rounded-lg border bg-[color:var(--mp-surface-2)] shadow-[var(--mp-e1)] ${
        isFinal && done
          ? "border-[color:var(--mp-gold)]/55 shadow-[0_0_26px_rgba(245,196,81,.14),var(--mp-e1)]"
          : "border-border"
      } ${match.isBye ? "opacity-90" : ""}`}
    >
      <div className="flex items-center justify-between border-b border-border bg-[color:var(--mp-surface)]/60 px-2.5 py-1.5">
        <span
          className={`font-mono text-[9px] uppercase tracking-wider ${
            done && !match.isBye ? "text-[color:var(--mp-success)]" : "text-[color:var(--mp-fg-subtle)]"
          }`}
        >
          {tag}
        </span>
        <span className="rounded-full border border-[color:var(--mp-brand)]/30 bg-[color:var(--mp-brand)]/10 px-1.5 py-px font-mono text-[9px] font-semibold text-[color:var(--mp-brand)]">
          BO{match.bestOf}
        </span>
      </div>
      <BracketSlot
        name={match.teamAName}
        score={match.teamAScore}
        state={slotVisual(match, "a")}
        isChamp={champWinnerA}
      />
      <BracketSlot
        name={match.teamBName}
        score={match.teamBScore}
        state={slotVisual(match, "b")}
        isChamp={champWinnerB}
      />
      {done && match.streamerName && !match.isBye && (
        <div className="flex items-center gap-2 border-t border-border bg-[color:var(--mp-bg)]/40 px-3 py-1.5 font-mono text-[10px] text-[color:var(--mp-fg-subtle)]">
          <span className="text-[color:var(--mp-live)]">📺 {match.streamerName}</span>
        </div>
      )}
    </div>
  );
}

type SlotVisual = "win" | "lose" | "tbd" | "bye" | "neutral";
function slotVisual(match: BracketMatchView, slot: "a" | "b"): SlotVisual {
  const teamId = slot === "a" ? match.teamAId : match.teamBId;
  const name = slot === "a" ? match.teamAName : match.teamBName;
  // BYE カードは「実チーム側=そのまま表示・空側=BYE」。
  if (match.isBye) return name === null ? "bye" : "neutral";
  if (match.hasResult)
    return match.winnerTeamId === teamId ? "win" : "lose";
  if (name === null) return "tbd";
  return "neutral";
}

/** ブラケットカードの1スロット。 */
function BracketSlot({
  name,
  score,
  state,
  isChamp,
}: {
  name: string | null;
  score: number | null;
  state: SlotVisual;
  isChamp: boolean;
}) {
  const accent =
    state === "win"
      ? isChamp
        ? "bg-[color:var(--mp-gold)]"
        : "bg-[color:var(--mp-success)]"
      : "bg-transparent";
  const nameCls =
    state === "lose"
      ? "text-[color:var(--mp-fg-muted)] font-semibold"
      : state === "tbd" || state === "bye"
        ? "text-[color:var(--mp-fg-subtle)] font-semibold"
        : "text-foreground font-bold";
  const scoreCls =
    state === "win"
      ? isChamp
        ? "text-[color:var(--mp-gold)]"
        : "text-[color:var(--mp-success)]"
      : state === "lose"
        ? "text-[color:var(--mp-fg-subtle)]"
        : "text-[color:var(--mp-fg-muted)]";
  const label = name ?? (state === "bye" ? "BYE" : "未定");
  return (
    <div className="relative flex items-center gap-2.5 border-b border-border px-3 py-2.5 last:border-b-0">
      <span className={`absolute bottom-0 left-0 top-0 w-[3px] ${accent}`} />
      <span className={`min-w-0 flex-1 truncate font-sans text-[13px] ${nameCls}`}>
        {label}
      </span>
      {isChamp && <span className="shrink-0 text-xs">👑</span>}
      {state === "bye" ? (
        <span className="shrink-0 font-mono text-[9px] tracking-widest text-[color:var(--mp-fg-subtle)]">
          不戦勝
        </span>
      ) : score !== null ? (
        <span className={`shrink-0 font-mono text-[15px] font-bold tabular-nums ${scoreCls}`}>
          {score}
        </span>
      ) : null}
    </div>
  );
}
