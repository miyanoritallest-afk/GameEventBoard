import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { findEventById } from "@/lib/repositories/events";
import { listRegistrationsByEvent } from "@/lib/repositories/registrations";
import { canViewEvent } from "@/lib/services/event-status";
import {
  RegistrationRow,
  type RegistrationRowData,
} from "./registration-row";

export const dynamic = "force-dynamic";

/** UTC(ISO) を JST 表示に整形する。 */
function fmtJst(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function EventRegistrationsPage({
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

  // 閲覧は「公開済みなら誰でも（観戦者含む）・下書きは主催者のみ」（フェーズB）。
  // 操作系（承認・スコア）は主催者のみ（RegistrationRow が isOrganizer で出し分け）。
  const event = await findEventById(id);
  if (!event) notFound();
  if (!canViewEvent(event.status, event.organizer_id, viewerId)) {
    notFound();
  }
  const isOrganizer = viewerId !== null && event.organizer_id === viewerId;

  const registrations = await listRegistrationsByEvent(event.id);

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">応募者一覧</h1>
          <Link
            href={`/events/${event.slug ?? event.id}`}
            className="text-sm text-muted-foreground hover:underline"
          >
            ← イベントに戻る
          </Link>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{event.title}</p>
        {!isOrganizer && (
          <p className="mt-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            参加者として閲覧しています。チーム編成の参考にできます（承認・スコア操作は主催者のみ）。
          </p>
        )}

        {registrations.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">
            まだ応募がありません。
          </p>
        ) : (
          <ul className="mt-6 space-y-3">
            {registrations.map((reg) => {
              const u = reg.users as {
                discord_name: string;
                discord_avatar_url: string | null;
                battle_tag: string | null;
              } | null;
              const row: RegistrationRowData = {
                id: reg.id,
                status: reg.status,
                createdAtLabel: fmtJst(reg.created_at),
                // 登録名（公開表示名）優先。未設定なら Discord 名にフォールバック。
                discordName: reg.display_name ?? u?.discord_name ?? "-",
                battleTag: u?.battle_tag ?? null,
                preferredRole: reg.preferred_role,
                preferredRoles: [
                  reg.preferred_role_1,
                  reg.preferred_role_2,
                  reg.preferred_role_3,
                ],
                individualScore: reg.individual_score,
                finalScore: reg.final_score,
                overrideScore: reg.organizer_override_score,
                breakdown:
                  (reg.score_breakdown as RegistrationRowData["breakdown"]) ??
                  null,
              };
              // スコアレスイベント（require_score=false）はスコア列・上書きを出さない。
              return (
                <RegistrationRow
                  key={reg.id}
                  reg={row}
                  showScore={event.require_score}
                  canManage={isOrganizer}
                />
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
