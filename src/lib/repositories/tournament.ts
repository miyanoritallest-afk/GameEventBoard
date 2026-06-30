import { createClient } from "@/lib/supabase/server";
import { listGroupsWithTeams } from "@/lib/repositories/groups";
import { listGroupMatches } from "@/lib/repositories/matches";
import { listMatchResultsByEvent } from "@/lib/repositories/match-results";
import { listTeamsWithMembers } from "@/lib/repositories/teams";
import { computeStandings, type TiebreakerKey } from "@/lib/services/standings";
import { teamScore, type MemberScore } from "@/lib/services/team-score";
import type {
  SeedTeam,
  TournamentSeedTeam,
  StoredMatch,
  StoredResult,
} from "@/lib/services/bracket";

/**
 * 決勝トーナメント（本戦-5a）の進出シード算出に必要なデータをまとめて取得し、
 * ブロックごとの順位（standings）を計算して SeedTeam[] にして返す。
 *
 * ブラケット生成（Server Action）と進出チームの表示（page）の両方で使う共通処理。
 * 順位集計は予選と同じ `computeStandings`（純粋関数）を流用する。
 * 結果のある試合のみで集計し、ブロック内順位（rank）と横断比較用の数値を持たせる。
 */
export async function computeBlockSeeds(params: {
  eventId: string;
  config: {
    pointsWin: number;
    pointsDraw: number;
    pointsLoss: number;
    tiebreakers: TiebreakerKey[];
  };
}): Promise<{ seeds: SeedTeam[]; teamNameById: Map<string, string> }> {
  const [groupsRaw, matchesRaw, resultsRaw] = await Promise.all([
    listGroupsWithTeams(params.eventId),
    listGroupMatches(params.eventId),
    listMatchResultsByEvent(params.eventId),
  ]);

  type GroupTeamJoin = {
    team_id: string;
    teams: { id: string; name: string } | null;
  };
  type GroupJoin = {
    id: string;
    name: string;
    group_teams: GroupTeamJoin[] | null;
  };
  type MatchRow = {
    id: string;
    group_id: string | null;
    team_a_id: string | null;
    team_b_id: string | null;
  };
  type ResultRow = {
    match_id: string;
    team_a_score: number;
    team_b_score: number;
    potg_a: number;
    potg_b: number;
  };

  const teamNameById = new Map<string, string>();
  for (const g of (groupsRaw ?? []) as unknown as GroupJoin[]) {
    for (const gt of g.group_teams ?? []) {
      if (gt.teams) teamNameById.set(gt.teams.id, gt.teams.name);
    }
  }

  const matchById = new Map<string, MatchRow>();
  for (const m of (matchesRaw ?? []) as MatchRow[]) matchById.set(m.id, m);
  const resultRows = (resultsRaw ?? []) as unknown as ResultRow[];

  const seeds: SeedTeam[] = [];
  for (const g of (groupsRaw ?? []) as unknown as GroupJoin[]) {
    const teamIds = (g.group_teams ?? [])
      .filter((gt) => gt.teams)
      .map((gt) => gt.teams!.id);
    if (teamIds.length === 0) continue;
    const teamIdSet = new Set(teamIds);

    // このブロックの「結果あり・両チームともブロック所属」の試合だけ集計する。
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
      teamIds,
      results: groupResults,
      config: params.config,
    });
    for (const row of rows) {
      seeds.push({
        teamId: row.teamId,
        groupId: g.id,
        rank: row.rank,
        points: row.points,
        mapDiff: row.mapDiff,
        potg: row.potg,
      });
    }
  }

  return { seeds, teamNameById };
}

/**
 * トーナメントのみ形式（予選なし）の進出シード母集団を取得する（PR-3）。
 * 予選順位が無いので、approved チーム全員を母集団とし、各チームの
 * チームスコア（regular 実効 final_score 平均・スコアなしは null）と作成順を持たせる。
 *
 * シード順の決定（スコア降順 / 作成順）は純粋関数 `seedTournamentOnly` 側で行う。
 * ここは DB 取得とチームスコア算出だけを担う。
 */
export async function computeTournamentOnlySeeds(
  eventId: string,
): Promise<{ seeds: TournamentSeedTeam[]; teamNameById: Map<string, string> }> {
  const teamsRaw = await listTeamsWithMembers(eventId);

  type MemberJoin = {
    position: string;
    registrations: {
      final_score: number | null;
      organizer_override_score: number | null;
    } | null;
  };
  type TeamJoin = {
    id: string;
    name: string;
    status: string;
    team_members: MemberJoin[] | null;
  };

  const teamNameById = new Map<string, string>();
  const seeds: TournamentSeedTeam[] = [];
  // listTeamsWithMembers は created_at 昇順で返るので、配列の添字をそのまま作成順に使う。
  let order = 0;
  for (const t of (teamsRaw ?? []) as unknown as TeamJoin[]) {
    // 出場対象は承認済みチームのみ（pending/rejected は本戦に出さない）。
    if (t.status !== "approved") continue;
    teamNameById.set(t.id, t.name);
    const members: MemberScore[] = (t.team_members ?? []).map((tm) => ({
      id: "",
      position: tm.position === "reserve" ? "reserve" : "regular",
      finalScore: tm.registrations?.final_score ?? null,
      overrideScore: tm.registrations?.organizer_override_score ?? null,
    }));
    seeds.push({ teamId: t.id, score: teamScore(members), order: order++ });
  }

  return { seeds, teamNameById };
}

/**
 * 再計算（本戦-5b）の入力に使う、トーナメント全試合＋結果（勝者）を取得する。
 * recomputeBracket の StoredMatch / StoredResult に整形して返す。
 */
export async function fetchTournamentForRecompute(
  eventId: string,
): Promise<{ matches: StoredMatch[]; results: StoredResult[] }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("matches")
    .select(
      "id, round, bracket_position, team_a_id, team_b_id, match_results(winner_team_id)",
    )
    .eq("event_id", eventId)
    .eq("phase", "tournament");
  if (error) throw error;

  const matches: StoredMatch[] = [];
  const results: StoredResult[] = [];
  for (const m of data ?? []) {
    matches.push({
      matchId: m.id,
      round: m.round ?? 1,
      position: m.bracket_position ?? 0,
      teamAId: m.team_a_id,
      teamBId: m.team_b_id,
    });
    // match_results は match_id が PK の 1:1 関係のため、Supabase は配列ではなく
    // 単一オブジェクト（結果なしは null）で返す。両方の形に念のため対応する。
    const mrRaw = m.match_results as
      | { winner_team_id: string | null }
      | { winner_team_id: string | null }[]
      | null;
    const mr = Array.isArray(mrRaw) ? (mrRaw[0] ?? null) : mrRaw;
    if (mr) {
      results.push({ matchId: m.id, winnerTeamId: mr.winner_team_id });
    }
  }

  return { matches, results };
}
