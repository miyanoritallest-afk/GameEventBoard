import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { findEventById, findEventBySlug } from "@/lib/repositories/events";
import { findRegistration } from "@/lib/repositories/registrations";
import { canViewEvent } from "@/lib/services/event-status";
import { isValidEventSlug } from "@/lib/services/event-slug";
import { ApplyForm } from "./apply-form";

export const dynamic = "force-dynamic";

export default async function ApplyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const event = isValidEventSlug(id)
    ? await findEventBySlug(id)
    : await findEventById(id);
  if (!event) notFound();

  // A: ログイン確認。
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?redirect=${encodeURIComponent(`/events/${id}/apply`)}`);
  }

  // 可視性（下書きは本人のみ）。
  if (!canViewEvent(event.status, event.organizer_id, user.id)) notFound();

  const detailHref = `/events/${event.slug ?? event.id}`;

  // 応募できない条件は詳細へ戻す（出し分けと整合）。
  // - 主催者本人 / 非公開 / スコアなしイベント / 応募済み。
  if (event.organizer_id === user.id) redirect(detailHref);
  if (event.status === "draft") redirect(detailHref);
  if (!event.require_score) redirect(detailHref); // スコアなしは即時応募ルート
  const existing = await findRegistration(event.id, user.id);
  if (existing) redirect(detailHref);

  const useBonus =
    event.bonus_master > 0 || event.bonus_gm > 0 || event.bonus_champion > 0;

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <Link
          href={detailHref}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← イベントに戻る
        </Link>
        <h1 className="mt-2 text-2xl font-bold">{event.title} に応募</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          希望ロールとランクを申告します。スコアは自動算出され、主催者の承認後に参加が確定します。
        </p>

        <ApplyForm
          eventId={event.id}
          roleSwapAllowed={event.role_swap_allowed}
          declaredSeasons={event.declared_seasons}
          useBonus={useBonus}
        />
      </div>
    </div>
  );
}
