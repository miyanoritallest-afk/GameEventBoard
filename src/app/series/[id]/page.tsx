// シリーズ詳細: シリーズ情報＋開催回（events）一覧＋フォローボタン。公開（誰でも閲覧可）。
// フォローすると新しい開催回の公開を通知する（③接続）。

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { findSeriesById, listSeriesEvents } from "@/lib/repositories/series";
import { isFollowing } from "@/lib/repositories/follows";
import { FollowButton } from "@/app/events/[id]/follow-button";

export const dynamic = "force-dynamic";

/** UTC(ISO) を JST 表示に整形する。null は "未定"。 */
function fmtJst(iso: string | null): string {
  if (!iso) return "未定";
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

const STATUS_LABEL: Record<string, string> = {
  published: "公開中",
  recruiting: "募集中",
  closed: "募集締切",
  ongoing: "開催中",
  finished: "終了",
};

export default async function SeriesDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const series = await findSeriesById(id);
  if (!series) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const viewerId = user?.id ?? null;

  const [events, following] = await Promise.all([
    listSeriesEvents(series.id),
    viewerId
      ? isFollowing({ followerId: viewerId, targetType: "series", targetId: series.id })
      : Promise.resolve(false),
  ]);

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold">{series.name}</h1>
          <FollowButton
            targetType="series"
            targetId={series.id}
            initialFollowing={following}
            isLoggedIn={viewerId !== null}
            redirectTo={`/series/${series.id}`}
            label="このシリーズ"
          />
        </div>
        {series.description && (
          <p className="mt-3 whitespace-pre-wrap text-sm text-foreground/90">
            {series.description}
          </p>
        )}

        {/* シリーズ運営（本 PR は owner=作成者）向け: 次の開催回を作成（前回設定プリフィル）。 */}
        {viewerId === series.created_by && (
          <div className="mt-4">
            <Link
              href={`/events/new?series=${series.id}`}
              className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              次の開催回を作成
            </Link>
          </div>
        )}

        <section className="mt-8">
          <h2 className="text-sm font-semibold">開催回</h2>
          {events.length === 0 ? (
            <p className="mt-2 rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
              まだ公開された開催回はありません。
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {events.map((e) => (
                <li key={e.id}>
                  <Link
                    href={`/events/${e.slug ?? e.id}`}
                    className="block rounded-xl border border-border bg-card p-5 hover:bg-accent"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{e.title}</span>
                      <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {STATUS_LABEL[e.status] ?? e.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      開催 {fmtJst(e.starts_at)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="mt-8">
          <Link
            href="/series"
            className="text-sm text-muted-foreground hover:underline"
          >
            ← シリーズ一覧へ
          </Link>
        </div>
      </div>
    </div>
  );
}
