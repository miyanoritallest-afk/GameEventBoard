import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { findEventById, findEventBySlug } from "@/lib/repositories/events";
import { findRegistration } from "@/lib/repositories/registrations";
import { findDiscordName, findBattleTag } from "@/lib/repositories/users";
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

  // 登録名欄の既定＝Discord名、バトルタグ欄の既定＝保存済み battle_tag
  // （登録済みなら自動で埋まる）。
  const [discordName, battleTag] = await Promise.all([
    findDiscordName(user.id),
    findBattleTag(user.id),
  ]);

  const useBonus =
    event.bonus_master > 0 || event.bonus_gm > 0 || event.bonus_champion > 0;

  return (
    <div className="theme-matchpoint min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[720px] px-6 py-10">
        {/* パンくず */}
        <nav className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
          <Link href="/events" className="hover:text-foreground">
            イベント一覧
          </Link>
          <span className="text-[color:var(--mp-fg-subtle)]">/</span>
          <Link
            href={detailHref}
            className="max-w-[16rem] truncate hover:text-foreground"
          >
            {event.title}
          </Link>
          <span className="text-[color:var(--mp-fg-subtle)]">/</span>
          <span className="text-foreground">応募</span>
        </nav>

        {/* ヒーロー */}
        <p className="mt-6 flex items-center gap-[9px] font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--mp-accent)] before:h-0.5 before:w-[22px] before:bg-[color:var(--mp-accent)] before:content-['']">
          参加者エントリー
        </p>
        <h1 className="mt-2.5 text-3xl font-extrabold tracking-tight text-foreground">
          <span className="text-[color:var(--mp-brand)]">{event.title}</span>{" "}
          に応募
        </h1>
        <p className="mt-3 max-w-[600px] text-sm text-muted-foreground">
          希望ロールとランクを申告します。スコアは自動算出され、主催者の承認後に参加が確定します。
        </p>

        <ApplyForm
          eventId={event.id}
          defaultDisplayName={discordName ?? ""}
          defaultBattleTag={battleTag ?? ""}
          roleSwapAllowed={event.role_swap_allowed}
          declaredSeasons={event.declared_seasons}
          useBonus={useBonus}
        />
      </div>
    </div>
  );
}
