import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { findEventById } from "@/lib/repositories/events";
import { listGames } from "@/lib/repositories/games";
import { findDiscordName } from "@/lib/repositories/users";
import type { EventFormDefaults } from "../../event-form";
import { EditEventForm } from "./edit-event-form";

export const dynamic = "force-dynamic";

/** UTC(ISO) を datetime-local 形式の JST 文字列（"YYYY-MM-DDTHH:mm"）へ。null は ""。 */
function utcIsoToJstLocal(iso: string | null): string {
  if (!iso) return "";
  // JST 表示の各パーツを取り出して datetime-local 形式に組み立てる。
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export default async function EditEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // A: ログイン確認（未ログインは /login へ）。
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?redirect=${encodeURIComponent(`/events/${id}/edit`)}`);
  }

  // 編集は uuid 前提（管理導線からのみ遷移）。本人以外・存在しないなら 404。
  const event = await findEventById(id);
  if (!event || event.organizer_id !== user.id) {
    notFound();
  }

  const [games, discordName] = await Promise.all([
    listGames(),
    findDiscordName(user.id),
  ]);

  const defaults: EventFormDefaults = {
    title: event.title,
    gameId: event.game_id,
    // 保存済みの登録名。未設定（null）なら EventForm 側で discordName を初期表示。
    organizerDisplayName: event.organizer_display_name ?? undefined,
    description: event.description ?? "",
    startsAt: utcIsoToJstLocal(event.starts_at),
    endsAt: utcIsoToJstLocal(event.ends_at),
    recruitDeadline: utcIsoToJstLocal(event.recruit_deadline),
    capacity: event.capacity != null ? String(event.capacity) : "",
    format: event.format,
    requireScore: event.require_score,
    uncertifiedHandling: event.uncertified_handling,
    roleSwapAllowed: event.role_swap_allowed,
    declaredSeasons: event.declared_seasons,
    bonusMaster: event.bonus_master,
    bonusGm: event.bonus_gm,
    bonusChampion: event.bonus_champion,
    teamScoreCap: event.team_score_cap ?? undefined,
    rankingEnabled: event.ranking_enabled,
    pointsWin: event.points_win,
    pointsDraw: event.points_draw,
    pointsLoss: event.points_loss,
    tiebreakers: (event.tiebreakers ?? []) as (
      | "head_to_head"
      | "map_diff"
      | "potg"
    )[],
    groupBestOf: event.group_best_of,
    tournamentThirdPlace: event.tournament_third_place,
  };

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-2xl font-bold">イベントを編集</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          内容を変更して保存します。公開URL（slug）は変わりません。
        </p>
        <EditEventForm
          eventId={event.id}
          games={games}
          defaultValues={defaults}
          discordName={discordName ?? ""}
        />
      </div>
    </div>
  );
}
