import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { findEventById } from "@/lib/repositories/events";
import { findRegistration } from "@/lib/repositories/registrations";
import { listTournamentMatches } from "@/lib/repositories/matches";
import { listMatchResultsByEvent } from "@/lib/repositories/match-results";
import { listCaptainTeamIds } from "@/lib/repositories/teams";
import { computeBlockSeeds } from "@/lib/repositories/tournament";
import {
  extractSeededTeams,
  tournamentPodium,
  type SeedTeam,
} from "@/lib/services/bracket";
import type { TiebreakerKey } from "@/lib/services/standings";
import { canViewEvent } from "@/lib/services/event-status";
import { utcIsoToJstLocal } from "@/lib/datetime-local";
import {
  TournamentBoard,
  type BoardBracketMatch,
} from "./tournament-board";

export const dynamic = "force-dynamic";

/**
 * 決勝トーナメント画面（本戦-5a）。
 * 認証ガードはブロック分け/対戦表と同型:
 * - A: 未ログインは /login へリダイレクト。
 * - 閲覧は「主催者 or そのイベントの応募者」。主催者は生成可、応募者は閲覧のみ（read-only）。
 *
 * 各ブロック上位N をシードに、シングルエリミのブラケットを生成・表示する。
 * 結果入力・勝者の自動進出は本戦-5b。
 */
export default async function EventTournamentPage({
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

  const event = await findEventById(id);
  if (!event) notFound();
  // 閲覧は「公開済みなら誰でも（観戦者含む）・下書きは主催者のみ」。編集は readOnly/canReport で制御。
  if (!canViewEvent(event.status, event.organizer_id, viewerId)) {
    notFound();
  }
  const isOrganizer = viewerId !== null && event.organizer_id === viewerId;
  const myRegistration =
    isOrganizer || viewerId === null
      ? null
      : await findRegistration(event.id, viewerId);

  const config = {
    pointsWin: event.points_win,
    pointsDraw: event.points_draw,
    pointsLoss: event.points_loss,
    tiebreakers: (event.tiebreakers ?? []) as TiebreakerKey[],
  };

  const usePotg = config.tiebreakers.includes("potg");

  const [tournamentRaw, resultsRaw, captainTeamIds, seedData] = await Promise.all([
    listTournamentMatches(event.id),
    listMatchResultsByEvent(event.id),
    // 結果入力の出し分け用: 閲覧者が代表のチーム id（主催者は空でよい）。
    myRegistration
      ? listCaptainTeamIds({ eventId: event.id, registrationId: myRegistration.id })
      : Promise.resolve<string[]>([]),
    event.ranking_enabled
      ? computeBlockSeeds({ eventId: event.id, config })
      : Promise.resolve<{ seeds: SeedTeam[]; teamNameById: Map<string, string> }>(
          { seeds: [], teamNameById: new Map() },
        ),
  ]);

  const { seeds, teamNameById } = seedData;
  const captainTeamIdSet = new Set(captainTeamIds);

  // 試合 id → 結果（スコア・勝者・POTG・リプレイ）。
  type ResultRow = {
    match_id: string;
    team_a_score: number;
    team_b_score: number;
    winner_team_id: string | null;
    potg_a: number;
    potg_b: number;
    replay_codes: string[] | null;
  };
  const resultByMatch = new Map<string, ResultRow>();
  for (const r of (resultsRaw ?? []) as unknown as ResultRow[]) {
    resultByMatch.set(r.match_id, r);
  }

  // 既存ブラケット（生成済みなら表示）。結果・入力可否を載せる。
  type TMatchRow = {
    id: string;
    team_a_id: string | null;
    team_b_id: string | null;
    round: number | null;
    bracket_position: number | null;
    best_of: number;
    scheduled_at?: string | null;
    stream_url?: string | null;
    streamer_name?: string | null;
  };
  const matches: BoardBracketMatch[] = ((tournamentRaw ?? []) as TMatchRow[]).map(
    (m) => {
      const result = resultByMatch.get(m.id) ?? null;
      // 結果入力できるのは「主催者 or この試合のどちらかのチームの代表」。
      const canReport =
        isOrganizer ||
        (m.team_a_id != null && captainTeamIdSet.has(m.team_a_id)) ||
        (m.team_b_id != null && captainTeamIdSet.has(m.team_b_id));
      return {
        id: m.id,
        round: m.round ?? 1,
        position: m.bracket_position ?? 0,
        teamAId: m.team_a_id,
        teamBId: m.team_b_id,
        teamAName: m.team_a_id ? teamNameById.get(m.team_a_id) ?? null : null,
        teamBName: m.team_b_id ? teamNameById.get(m.team_b_id) ?? null : null,
        teamAScore: result?.team_a_score ?? null,
        teamBScore: result?.team_b_score ?? null,
        winnerTeamId: result?.winner_team_id ?? null,
        potgA: result?.potg_a ?? 0,
        potgB: result?.potg_b ?? 0,
        bestOf: m.best_of,
        hasResult: result !== null,
        canReport,
        replayCodes: result?.replay_codes ?? [],
        scheduledAtLocal: utcIsoToJstLocal(m.scheduled_at ?? null),
        streamUrl: m.stream_url ?? null,
        streamerName: m.streamer_name ?? null,
        isOrganizer,
      };
    },
  );

  // 現在の進出数設定で抽出されるシード順チーム（生成前のプレビュー・主催者向け補助）。
  const currentAdvance = event.tournament_advance_count || 2;
  const previewSeeded = extractSeededTeams(seeds, currentAdvance).map((teamId, i) => ({
    seed: i + 1,
    teamId,
    teamName: teamNameById.get(teamId) ?? "-",
  }));

  // 表彰台（優勝・準優勝・3位）。決勝・準決勝・3位決定戦の結果から算出する。
  const podiumRaw = tournamentPodium(
    matches.map((m) => ({
      matchId: m.id,
      round: m.round,
      position: m.position,
      teamAId: m.teamAId,
      teamBId: m.teamBId,
    })),
    matches
      .filter((m) => m.hasResult)
      .map((m) => ({ matchId: m.id, winnerTeamId: m.winnerTeamId })),
  );
  const podium = {
    champion: podiumRaw.champion
      ? teamNameById.get(podiumRaw.champion) ?? null
      : null,
    runnerUp: podiumRaw.runnerUp
      ? teamNameById.get(podiumRaw.runnerUp) ?? null
      : null,
    third: podiumRaw.third.map((id) => teamNameById.get(id) ?? "-"),
  };

  // 結果が1件もなければ1回戦の手動入れ替え（D&D）を許可する（壁打ち確定）。
  const swapEnabled = isOrganizer && matches.some((m) => m.hasResult) === false;

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1400px] px-6 py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">決勝トーナメント</h1>
          <div className="flex items-center gap-4">
            {/* ナビゲーションは観戦者にも出す（閲覧の全面公開・フェーズB）。 */}
            <Link
              href={`/events/${event.id}/matches`}
              className="text-sm text-primary hover:underline"
            >
              ← 対戦表・順位表へ
            </Link>
            <Link
              href={`/events/${event.id}/watch`}
              className="text-sm text-muted-foreground hover:underline"
            >
              観戦ビューへ
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

        <TournamentBoard
          eventId={event.id}
          readOnly={!isOrganizer}
          rankingEnabled={event.ranking_enabled}
          usePotg={usePotg}
          swapEnabled={swapEnabled}
          podium={podium}
          initialAdvanceCount={currentAdvance}
          previewSeeded={previewSeeded}
          initialMatches={matches}
        />
      </div>
    </div>
  );
}
