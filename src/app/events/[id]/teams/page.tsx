import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { findEventById } from "@/lib/repositories/events";
import { findRegistration } from "@/lib/repositories/registrations";
import {
  listTeamsWithMembers,
  listUnassignedApproved,
} from "@/lib/repositories/teams";
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
  if (!user) {
    redirect(`/login?redirect=${encodeURIComponent(`/events/${id}/teams`)}`);
  }

  // 閲覧は「主催者 or そのイベントの応募者」に開放（self 応募の前提＝PR-3a）。
  // 主催者は編集可、応募者は試算のみ（read-only）。それ以外・存在しないは 404。
  const event = await findEventById(id);
  if (!event) notFound();
  const isOrganizer = event.organizer_id === user.id;
  const myRegistration = isOrganizer
    ? null
    : await findRegistration(event.id, user.id);
  if (!isOrganizer && !myRegistration) {
    notFound();
  }

  const [teamsRaw, unassignedRaw] = await Promise.all([
    listTeamsWithMembers(event.id),
    listUnassignedApproved(event.id),
  ]);

  // DB の戻りをボード用の素直な型へ整形する（クライアントへ渡す最小データ）。
  type RegJoin = {
    id: string;
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
      discordName: u?.discord_name ?? "-",
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

  const unassigned: BoardMember[] = (unassignedRaw ?? []).map((reg) =>
    toBoardMember(reg as unknown as RegJoin, {}),
  );

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      {/* 編成画面は判断材料を横に並べるため広い幅を取る（他ページの max-w-3xl/6xl より広い）。 */}
      <div className="mx-auto max-w-[1600px] px-6 py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">チーム編成</h1>
          <div className="flex items-center gap-4">
            {isOrganizer && (
              <Link
                href={`/events/${event.id}/groups`}
                className="text-sm text-primary hover:underline"
              >
                予選ブロック分けへ →
              </Link>
            )}
            <Link
              href={`/events/${event.slug ?? event.id}`}
              className="text-sm text-muted-foreground hover:underline"
            >
              ← イベントに戻る
            </Link>
          </div>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{event.title}</p>

        <TeamsBoard
          eventId={event.id}
          readOnly={!isOrganizer}
          isOrganizer={isOrganizer}
          selfFormation={event.team_formation === "self"}
          myRegistrationId={myRegistration?.id ?? null}
          showScore={event.require_score}
          roleSwapAllowed={event.role_swap_allowed}
          teamSize={
            (event.games as { team_size: number } | null)?.team_size ?? 5
          }
          teamScoreCap={event.team_score_cap}
          initialTeams={teams}
          initialUnassigned={unassigned}
        />
      </div>
    </div>
  );
}
