import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { findEventById } from "@/lib/repositories/events";
import { findRegistration } from "@/lib/repositories/registrations";
import { listGroupsWithTeams } from "@/lib/repositories/groups";
import { listGroupMatches } from "@/lib/repositories/matches";
import { listMatchResultsByEvent } from "@/lib/repositories/match-results";
import { listCaptainTeamIds } from "@/lib/repositories/teams";
import { computeStandings } from "@/lib/services/standings";
import { utcIsoToJstLocal } from "@/lib/datetime-local";
import {
  MatchesBoard,
  type BoardGroup,
  type BoardMatch,
  type BoardStanding,
} from "./matches-board";

export const dynamic = "force-dynamic";

/**
 * 予選対戦表画面（本戦 PR-2）。
 * 認証ガードはブロック分け（/groups）と同型:
 * - A: 未ログインは /login へリダイレクト。
 * - 閲覧は「主催者 or そのイベントの応募者」。主催者は編集可、応募者は閲覧のみ（read-only）。
 *
 * ブロックごとに、所属チームの総当たり対戦カードを生成・追加・削除する。
 * 日時・配信・結果入力は後続PR（本戦-3/5）。
 */
export default async function EventMatchesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?redirect=${encodeURIComponent(`/events/${id}/matches`)}`);
  }

  const event = await findEventById(id);
  if (!event) notFound();
  const isOrganizer = event.organizer_id === user.id;
  const myRegistration = isOrganizer
    ? null
    : await findRegistration(event.id, user.id);
  if (!isOrganizer && !myRegistration) {
    notFound();
  }

  const [groupsRaw, matchesRaw, resultsRaw, captainTeamIds] = await Promise.all([
    listGroupsWithTeams(event.id),
    listGroupMatches(event.id),
    listMatchResultsByEvent(event.id),
    // 結果入力の出し分け用: 閲覧者が代表のチーム id（主催者は空でよい）。
    myRegistration
      ? listCaptainTeamIds({
          eventId: event.id,
          registrationId: myRegistration.id,
        })
      : Promise.resolve<string[]>([]),
  ]);

  // 試合 id → 結果（スコア・勝者・POTG）。
  type ResultRow = {
    match_id: string;
    team_a_score: number;
    team_b_score: number;
    winner_team_id: string | null;
    potg_a: number;
    potg_b: number;
    replay_codes: string[] | null;
  };
  const resultRows = (resultsRaw ?? []) as unknown as ResultRow[];
  const resultByMatch = new Map<string, ResultRow>();
  for (const r of resultRows) {
    resultByMatch.set(r.match_id, r);
  }
  const captainTeamIdSet = new Set(captainTeamIds);

  // 順位設定（events 由来）。potg 入力欄の出し分け・順位表の表示に使う。
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
  const usePotg = rankingConfig.tiebreakers.includes("potg");

  // ブロックの所属チーム（id→name）を引けるようにする。
  type GroupTeamJoin = {
    team_id: string;
    teams: { id: string; name: string; status: string } | null;
  };
  type GroupJoin = {
    id: string;
    name: string;
    group_teams: GroupTeamJoin[] | null;
  };

  const teamNameById = new Map<string, string>();
  for (const g of (groupsRaw ?? []) as unknown as GroupJoin[]) {
    for (const gt of g.group_teams ?? []) {
      if (gt.teams) teamNameById.set(gt.teams.id, gt.teams.name);
    }
  }

  // match_id → 試合行（順位集計で結果と対戦カードを突き合わせるため）。
  type MatchRow = {
    id: string;
    group_id: string | null;
    team_a_id: string | null;
    team_b_id: string | null;
    scheduled_at?: string | null;
    stream_url?: string | null;
    streamer_name?: string | null;
  };
  const matchById = new Map<string, MatchRow>();
  for (const m of (matchesRaw ?? []) as MatchRow[]) matchById.set(m.id, m);

  // ブロックごとに試合を束ねる。
  const matchesByGroup = new Map<string, BoardMatch[]>();
  for (const m of (matchesRaw ?? []) as MatchRow[]) {
    if (!m.group_id) continue;
    const arr = matchesByGroup.get(m.group_id) ?? [];
    const result = resultByMatch.get(m.id) ?? null;
    // 結果入力できるのは「主催者 or この試合のどちらかのチームの代表」。
    const canReport =
      isOrganizer ||
      (m.team_a_id != null && captainTeamIdSet.has(m.team_a_id)) ||
      (m.team_b_id != null && captainTeamIdSet.has(m.team_b_id));
    arr.push({
      id: m.id,
      teamAId: m.team_a_id,
      teamBId: m.team_b_id,
      teamAName: m.team_a_id ? teamNameById.get(m.team_a_id) ?? null : null,
      teamBName: m.team_b_id ? teamNameById.get(m.team_b_id) ?? null : null,
      teamAScore: result?.team_a_score ?? null,
      teamBScore: result?.team_b_score ?? null,
      winnerTeamId: result?.winner_team_id ?? null,
      potgA: result?.potg_a ?? 0,
      potgB: result?.potg_b ?? 0,
      bestOf: (m as { best_of?: number }).best_of ?? 3,
      hasResult: result !== null,
      canReport,
      replayCodes: result?.replay_codes ?? [],
      scheduledAtLocal: utcIsoToJstLocal(m.scheduled_at ?? null),
      streamUrl: m.stream_url ?? null,
      streamerName: m.streamer_name ?? null,
      isOrganizer,
    });
    matchesByGroup.set(m.group_id, arr);
  }

  const groups: BoardGroup[] = ((groupsRaw ?? []) as unknown as GroupJoin[]).map(
    (g) => {
      const teams = (g.group_teams ?? [])
        .filter((gt) => gt.teams)
        .map((gt) => ({ id: gt.teams!.id, name: gt.teams!.name }));

      // 順位表（順位機能 ON のときだけ計算）。ブロック内の結果ありの試合で集計。
      let standings: BoardStanding[] = [];
      if (event.ranking_enabled) {
        const teamIds = teams.map((t) => t.id);
        const teamIdSet = new Set(teamIds);
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
        standings = computeStandings({
          teamIds,
          results: groupResults,
          config: rankingConfig,
        }).map((row) => ({
          ...row,
          teamName: teamNameById.get(row.teamId) ?? "-",
        }));
      }

      return {
        id: g.id,
        name: g.name,
        teams,
        matches: matchesByGroup.get(g.id) ?? [],
        standings,
      };
    },
  );

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1200px] px-6 py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">対戦表・順位表</h1>
          <div className="flex items-center gap-4">
            {isOrganizer && (
              <Link
                href={`/events/${event.id}/groups`}
                className="text-sm text-primary hover:underline"
              >
                ← ブロック分けへ
              </Link>
            )}
            <Link
              href={`/events/${event.id}/tournament`}
              className="text-sm text-primary hover:underline"
            >
              決勝トーナメントへ →
            </Link>
            <Link
              href={`/events/${event.slug ?? event.id}`}
              className="text-sm text-muted-foreground hover:underline"
            >
              イベントに戻る
            </Link>
          </div>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{event.title}</p>

        <MatchesBoard
          readOnly={!isOrganizer}
          rankingEnabled={event.ranking_enabled}
          usePotg={usePotg}
          initialGroups={groups}
        />
      </div>
    </div>
  );
}
