import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { findEventById } from "@/lib/repositories/events";
import { findRegistration } from "@/lib/repositories/registrations";
import { listGroupsWithTeams } from "@/lib/repositories/groups";
import { listGroupMatches } from "@/lib/repositories/matches";
import {
  MatchesBoard,
  type BoardGroup,
  type BoardMatch,
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

  const [groupsRaw, matchesRaw] = await Promise.all([
    listGroupsWithTeams(event.id),
    listGroupMatches(event.id),
  ]);

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

  // ブロックごとに試合を束ねる。
  const matchesByGroup = new Map<string, BoardMatch[]>();
  for (const m of matchesRaw ?? []) {
    if (!m.group_id) continue;
    const arr = matchesByGroup.get(m.group_id) ?? [];
    arr.push({
      id: m.id,
      teamAId: m.team_a_id,
      teamBId: m.team_b_id,
      teamAName: m.team_a_id ? teamNameById.get(m.team_a_id) ?? null : null,
      teamBName: m.team_b_id ? teamNameById.get(m.team_b_id) ?? null : null,
    });
    matchesByGroup.set(m.group_id, arr);
  }

  const groups: BoardGroup[] = ((groupsRaw ?? []) as unknown as GroupJoin[]).map(
    (g) => ({
      id: g.id,
      name: g.name,
      teams: (g.group_teams ?? [])
        .filter((gt) => gt.teams)
        .map((gt) => ({
          id: gt.teams!.id,
          name: gt.teams!.name,
        })),
      matches: matchesByGroup.get(g.id) ?? [],
    }),
  );

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1200px] px-6 py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">予選対戦表</h1>
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
              href={`/events/${event.slug ?? event.id}`}
              className="text-sm text-muted-foreground hover:underline"
            >
              イベントに戻る
            </Link>
          </div>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{event.title}</p>

        <MatchesBoard readOnly={!isOrganizer} initialGroups={groups} />
      </div>
    </div>
  );
}
