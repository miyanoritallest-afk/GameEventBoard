import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { findEventById } from "@/lib/repositories/events";
import { findRegistration } from "@/lib/repositories/registrations";
import { listTournamentMatches } from "@/lib/repositories/matches";
import { computeBlockSeeds } from "@/lib/repositories/tournament";
import { extractSeededTeams, type SeedTeam } from "@/lib/services/bracket";
import type { TiebreakerKey } from "@/lib/services/standings";
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
  if (!user) {
    redirect(`/login?redirect=${encodeURIComponent(`/events/${id}/tournament`)}`);
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

  const config = {
    pointsWin: event.points_win,
    pointsDraw: event.points_draw,
    pointsLoss: event.points_loss,
    tiebreakers: (event.tiebreakers ?? []) as TiebreakerKey[],
  };

  const [tournamentRaw, seedData] = await Promise.all([
    listTournamentMatches(event.id),
    event.ranking_enabled
      ? computeBlockSeeds({ eventId: event.id, config })
      : Promise.resolve<{ seeds: SeedTeam[]; teamNameById: Map<string, string> }>(
          { seeds: [], teamNameById: new Map() },
        ),
  ]);

  const { seeds, teamNameById } = seedData;

  // 既存ブラケット（生成済みなら表示）。
  type TMatchRow = {
    id: string;
    team_a_id: string | null;
    team_b_id: string | null;
    round: number | null;
    bracket_position: number | null;
  };
  const matches: BoardBracketMatch[] = ((tournamentRaw ?? []) as TMatchRow[]).map(
    (m) => ({
      id: m.id,
      round: m.round ?? 1,
      position: m.bracket_position ?? 0,
      teamAId: m.team_a_id,
      teamBId: m.team_b_id,
      teamAName: m.team_a_id ? teamNameById.get(m.team_a_id) ?? null : null,
      teamBName: m.team_b_id ? teamNameById.get(m.team_b_id) ?? null : null,
    }),
  );

  // 現在の進出数設定で抽出されるシード順チーム（生成前のプレビュー・主催者向け補助）。
  const currentAdvance = event.tournament_advance_count || 2;
  const previewSeeded = extractSeededTeams(seeds, currentAdvance).map((teamId, i) => ({
    seed: i + 1,
    teamId,
    teamName: teamNameById.get(teamId) ?? "-",
  }));

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1400px] px-6 py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">決勝トーナメント</h1>
          <div className="flex items-center gap-4">
            {isOrganizer && (
              <Link
                href={`/events/${event.id}/matches`}
                className="text-sm text-primary hover:underline"
              >
                ← 対戦表・順位表へ
              </Link>
            )}
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
          initialAdvanceCount={currentAdvance}
          previewSeeded={previewSeeded}
          initialMatches={matches}
        />
      </div>
    </div>
  );
}
