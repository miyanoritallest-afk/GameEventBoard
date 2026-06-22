import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { findEventById } from "@/lib/repositories/events";
import { listRegistrationsByEvent } from "@/lib/repositories/registrations";
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

  // A: ログイン確認。
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(
      `/login?redirect=${encodeURIComponent(`/events/${id}/registrations`)}`,
    );
  }

  // 管理は uuid 前提。主催者本人以外・存在しないは 404（存在を隠す）。
  const event = await findEventById(id);
  if (!event || event.organizer_id !== user.id) {
    notFound();
  }

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
                discordName: u?.discord_name ?? "-",
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
                />
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
