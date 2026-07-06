// チーム日程（スクリム/練習/公式戦）ページ。日程カードを縦に並べる。
// スクリム/練習は自チームのメンバー・主催者が閲覧、公式戦は全員が閲覧できる（要件 3.4.3）。

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { findEventById } from "@/lib/repositories/events";
import {
  listEventScrims,
  listEventMatchesForSchedule,
  findViewerTeamId,
} from "@/lib/repositories/scrims";
import { buildScheduleItems } from "@/lib/services/schedule";
import { ScheduleList } from "./schedule-list";

export const dynamic = "force-dynamic";

export default async function SchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const event = await findEventById(id);
  if (!event) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const viewerId = user?.id ?? null;

  // scrims は RLS で認証必須（未ログインは空になる）。matches は公開。
  const [scrims, matches, viewerTeamId] = await Promise.all([
    viewerId ? listEventScrims(id) : Promise.resolve([]),
    listEventMatchesForSchedule(id),
    viewerId
      ? findViewerTeamId({ eventId: id, userId: viewerId })
      : Promise.resolve(null),
  ]);

  const items = buildScheduleItems({
    scrims,
    matches,
    viewerTeamId,
    now: new Date(),
  });

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">日程</h1>
            <p className="mt-1 text-sm text-muted-foreground">{event.title}</p>
          </div>
          <Link
            href={`/events/${event.slug ?? id}`}
            className="shrink-0 text-sm text-muted-foreground hover:underline"
          >
            ← イベントへ
          </Link>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          公式戦（🔴）・スクリム（🔵）・練習（🟢）の予定です。スクリム/練習はチームメンバーなら
          誰でも登録でき、チーム全員に共有されます。
        </p>

        <ScheduleList
          eventId={id}
          items={items}
          canManage={viewerTeamId !== null}
        />
      </div>
    </div>
  );
}
