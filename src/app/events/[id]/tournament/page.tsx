import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { findEventById } from "@/lib/repositories/events";
import { findRegistration } from "@/lib/repositories/registrations";
import { listTournamentMatches } from "@/lib/repositories/matches";
import { listMatchResultsByEvent } from "@/lib/repositories/match-results";
import { listCaptainTeamIds } from "@/lib/repositories/teams";
import {
  computeBlockSeeds,
  computeTournamentOnlySeeds,
} from "@/lib/repositories/tournament";
import {
  extractSeededTeams,
  seedTournamentOnly,
  tournamentPodium,
  computeRoundBoGroups,
  type SeedTeam,
} from "@/lib/services/bracket";
import type { TiebreakerKey } from "@/lib/services/standings";
import { canViewEvent } from "@/lib/services/event-status";
import {
  hasGroupStage,
  hasTournamentStage,
  tournamentStageLabel,
} from "@/lib/services/event-format";
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
  // 形式による出し分け（PR-2）。決勝Tを持たない形式（総当たりのみ）では
  // 決勝トーナメントページ自体が存在しないものとして 404。
  if (!hasTournamentStage(event.format)) notFound();
  // 予選を持つ形式のときだけ「対戦表・順位表へ」の導線を出す。
  const showMatchesLink = hasGroupStage(event.format);
  // トーナメントの呼称（単独なら「トーナメント」・予選ありなら「決勝トーナメント」）。
  const tournamentLabel = tournamentStageLabel(event.format);
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

  // シードのプレビューと teamNameById は形式で取得経路が変わる（PR-3）。
  // - 予選を持つ形式: 予選順位（computeBlockSeeds）→ extractSeededTeams。順位機能 OFF は空。
  // - トーナメントのみ形式: approved チーム全員（computeTournamentOnlySeeds）→ seedTournamentOnly。
  const groupStage = hasGroupStage(event.format);
  const [tournamentRaw, resultsRaw, captainTeamIds, blockSeedData, tournamentOnlyData] =
    await Promise.all([
      listTournamentMatches(event.id),
      listMatchResultsByEvent(event.id),
      // 結果入力の出し分け用: 閲覧者が代表のチーム id（主催者は空でよい）。
      myRegistration
        ? listCaptainTeamIds({ eventId: event.id, registrationId: myRegistration.id })
        : Promise.resolve<string[]>([]),
      groupStage && event.ranking_enabled
        ? computeBlockSeeds({ eventId: event.id, config })
        : Promise.resolve<{ seeds: SeedTeam[]; teamNameById: Map<string, string> }>(
            { seeds: [], teamNameById: new Map() },
          ),
      groupStage
        ? Promise.resolve({ seeds: [], teamNameById: new Map<string, string>() })
        : computeTournamentOnlySeeds(event.id),
    ]);

  // teamNameById は両経路を合算（ブラケット表示・表彰台で id→name 解決に使う）。
  const teamNameById = new Map<string, string>([
    ...blockSeedData.teamNameById,
    ...tournamentOnlyData.teamNameById,
  ]);
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
  const tMatchRows = (tournamentRaw ?? []) as TMatchRow[];
  // 最終ラウンド（3位決定戦の判定に使う）。3位決定戦は最終round・position=1 に置かれる。
  const maxRound = tMatchRows.reduce((n, m) => Math.max(n, m.round ?? 1), 0);
  const matches: BoardBracketMatch[] = tMatchRows.map((m) => {
    const result = resultByMatch.get(m.id) ?? null;
    const round = m.round ?? 1;
    const position = m.bracket_position ?? 0;
    // 結果入力できるのは「主催者 or この試合のどちらかのチームの代表」。
    const canReport =
      isOrganizer ||
      (m.team_a_id != null && captainTeamIdSet.has(m.team_a_id)) ||
      (m.team_b_id != null && captainTeamIdSet.has(m.team_b_id));
    return {
      id: m.id,
      round,
      position,
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
      // 3位決定戦（最終ラウンド・position=1）。ブラケット本線から分離して扱う。
      isThirdPlace: maxRound >= 2 && round === maxRound && position === 1,
    };
  });

  // 生成前のシード順プレビュー（主催者向け補助）。形式で抽出方法が変わる（PR-3）。
  // - 予選あり: 現在の進出数設定で各ブロック上位N を抽出。
  // - トーナメントのみ: approved 全員を score 降順／作成順で並べる（進出数は使わない）。
  const currentAdvance = event.tournament_advance_count || 2;
  const previewSeededIds = groupStage
    ? extractSeededTeams(blockSeedData.seeds, currentAdvance)
    : seedTournamentOnly(tournamentOnlyData.seeds);
  const previewSeeded = previewSeededIds.map((teamId, i) => ({
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

  // ラウンド別 BO 編集グループ（PR-4）。結果のあるラウンドは locked。主催者にだけ意味を持つ。
  const roundBoGroups = computeRoundBoGroups(
    matches.map((m) => ({
      round: m.round,
      position: m.position,
      bestOf: m.bestOf,
      hasResult: m.hasResult,
    })),
  );

  // ヒーロー用の派生値（対戦表画面と同じ作法）。
  const gameName = (event.games as { name: string } | null)?.name ?? "-";
  const roleLabel = isOrganizer
    ? "Organizer"
    : myRegistration !== null
      ? "Participant"
      : "Viewer";
  // 参加チーム数（ブラケットに実在する一意なチーム）。
  const teamCount = new Set(
    matches.flatMap((m) => [m.teamAId, m.teamBId]).filter((id): id is string => id !== null),
  ).size;
  const roundCount = matches.reduce((n, m) => Math.max(n, m.round), 0);
  // 決着（優勝が確定しているか）。
  const champion = podium.champion;

  return (
    <div className="theme-matchpoint min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1600px] px-6 py-8">
        {/* パンくず（イベント一覧 → イベント名 → 決勝トーナメント）。 */}
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
          <span className="text-foreground">{tournamentLabel}</span>
        </nav>

        {/* ヒーロー：ラベル＋タイトル＋イベント名、ゲームチップ、進捗、導線。 */}
        <header className="mt-5 rounded-2xl border border-border bg-card p-6 shadow-[var(--mp-e2)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-xs font-semibold tracking-widest text-[color:var(--mp-accent)]">
                <span className="h-px w-6 bg-[color:var(--mp-accent)]" />
                BRACKET
                <span className="text-[color:var(--mp-fg-subtle)]">·</span>
                <span className="text-[color:var(--mp-fg-subtle)]">{roleLabel}</span>
              </p>
              <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
                {tournamentLabel}
              </h1>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {event.title}
              </p>
            </div>

            {/* 導線（観戦者にも出す・フェーズB）。 */}
            <div className="flex shrink-0 flex-col items-end gap-1.5 text-sm">
              {showMatchesLink && (
                <Link
                  href={`/events/${event.id}/matches`}
                  className="text-[color:var(--mp-brand)] underline-offset-2 hover:underline"
                >
                  ← 対戦表・順位表へ
                </Link>
              )}
              <Link
                href={`/events/${event.id}/watch`}
                className="text-muted-foreground hover:text-foreground"
              >
                観戦ビューへ →
              </Link>
              <Link
                href={`/events/${event.slug ?? event.id}`}
                className="text-muted-foreground hover:text-foreground"
              >
                イベントに戻る
              </Link>
            </div>
          </div>

          {/* チップ: ゲーム / 参加数 / ラウンド数 / 決着状況。 */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-[color:var(--mp-surface-2)] px-3 py-1 text-xs font-medium text-muted-foreground">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[color:var(--mp-danger)]" />
              {gameName}
            </span>
            {teamCount > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-[color:var(--mp-surface-2)] px-3 py-1 text-xs font-medium text-muted-foreground">
                参加{" "}
                <span className="font-semibold text-foreground tabular-nums">
                  {teamCount}
                </span>
                チーム
              </span>
            )}
            {roundCount > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-[color:var(--mp-surface-2)] px-3 py-1 text-xs font-medium text-muted-foreground">
                ラウンド{" "}
                <span className="font-semibold text-foreground tabular-nums">
                  {roundCount}
                </span>
              </span>
            )}
            {champion ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--mp-gold)]/32 bg-[color:var(--mp-gold)]/10 px-3 py-1 text-xs font-medium text-[color:var(--mp-gold)]">
                🏆 優勝 <span className="font-semibold">{champion}</span>
              </span>
            ) : (
              roundCount > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-[color:var(--mp-surface-2)] px-3 py-1 text-xs font-medium text-muted-foreground">
                  決着 <span className="font-semibold text-foreground">進行中</span>
                </span>
              )
            )}
          </div>
        </header>

        <TournamentBoard
          eventId={event.id}
          readOnly={!isOrganizer}
          rankingEnabled={event.ranking_enabled}
          groupStage={groupStage}
          usePotg={usePotg}
          swapEnabled={swapEnabled}
          podium={podium}
          initialAdvanceCount={currentAdvance}
          previewSeeded={previewSeeded}
          roundBoGroups={roundBoGroups}
          initialMatches={matches}
        />
      </div>
    </div>
  );
}
