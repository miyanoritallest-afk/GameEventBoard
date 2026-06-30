import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { findEventById } from "@/lib/repositories/events";
import {
  listGroupsWithTeams,
  listUnassignedApprovedTeams,
} from "@/lib/repositories/groups";
import { listGroupMatches } from "@/lib/repositories/matches";
import { teamScore, type MemberScore } from "@/lib/services/team-score";
import { canViewEvent } from "@/lib/services/event-status";
import { GroupsBoard, type BoardGroup, type BoardTeam } from "./groups-board";

export const dynamic = "force-dynamic";

/**
 * 予選ブロック分け画面（本戦 PR-1）。
 * 認証ガードはチーム編成（/teams）と同型:
 * - A: 未ログインは /login へリダイレクト。
 * - 閲覧は「主催者 or そのイベントの応募者」。主催者は編集可、応募者は閲覧のみ（read-only）。
 *   それ以外・存在しないイベントは 404（存在を隠す）。
 *
 * 承認済み（approved）チームを未割当プールに出し、D&D でブロックへ振り分ける。
 * チーム平均スコアは出場メンバーのみで算出（DB設計 4.2）。
 */
export default async function EventGroupsPage({
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
  // 閲覧は「公開済みなら誰でも（観戦者含む）・下書きは主催者のみ」。編集は readOnly で制御。
  if (!canViewEvent(event.status, event.organizer_id, viewerId)) {
    notFound();
  }
  const isOrganizer = viewerId !== null && event.organizer_id === viewerId;

  const [groupsRaw, unassignedRaw, matchesRaw] = await Promise.all([
    listGroupsWithTeams(event.id),
    listUnassignedApprovedTeams(event.id),
    listGroupMatches(event.id),
  ]);

  // 対戦表が1件でも生成済みなら、ブロックの組み替えは事故るのでロックする（⑬）。
  // 生成後に移動すると対戦カードと所属ブロックがズレるため。
  const matchesGenerated = (matchesRaw ?? []).length > 0;

  // DB の戻りをボード用の素直な型へ整形する。チーム平均は出場メンバーのみで算出。
  type TeamJoin = {
    id: string;
    name: string;
    status: string;
    team_members:
      | {
          position: string;
          registrations: {
            final_score: number | null;
            organizer_override_score: number | null;
          } | null;
        }[]
      | null;
  };

  function toBoardTeam(t: TeamJoin): BoardTeam {
    const members: MemberScore[] = (t.team_members ?? []).map((tm) => ({
      id: "",
      position: tm.position === "reserve" ? "reserve" : "regular",
      finalScore: tm.registrations?.final_score ?? null,
      overrideScore: tm.registrations?.organizer_override_score ?? null,
    }));
    return {
      id: t.id,
      name: t.name,
      score: teamScore(members),
    };
  }

  const groups: BoardGroup[] = (groupsRaw ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    teams: (g.group_teams ?? []).map((gt) =>
      toBoardTeam(gt.teams as unknown as TeamJoin),
    ),
  }));

  // 未割当プールは振り分け作業の領域。観戦者（read-only）には見せず、確定したブロックだけ表示する。
  const unassigned: BoardTeam[] = isOrganizer
    ? (unassignedRaw ?? []).map((t) => toBoardTeam(t as unknown as TeamJoin))
    : [];

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1600px] px-6 py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">ブロック分け</h1>
          <div className="flex items-center gap-4">
            {/* 対戦表・順位表への導線は観戦者にも出す（閲覧の全面公開・フェーズB）。 */}
            <Link
              href={`/events/${event.id}/matches`}
              className="text-sm text-primary hover:underline"
            >
              対戦表・順位表へ →
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
              ← イベントに戻る
            </Link>
          </div>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{event.title}</p>

        <GroupsBoard
          eventId={event.id}
          readOnly={!isOrganizer}
          locked={matchesGenerated}
          showScore={event.require_score}
          initialGroups={groups}
          initialUnassigned={unassigned}
        />
      </div>
    </div>
  );
}
