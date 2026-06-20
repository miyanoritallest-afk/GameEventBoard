import Link from "next/link";
import { notFound } from "next/navigation";
import { findEventById } from "@/lib/repositories/events";

export const dynamic = "force-dynamic";

/** UTC(ISO) を JST 表示に整形する。null は "未設定"。 */
function fmtJst(iso: string | null): string {
  if (!iso) return "未設定";
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const event = await findEventById(id);
  if (!event) notFound();

  const gameName = (event.games as { name: string } | null)?.name ?? "-";

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <p className="rounded-md border border-primary/50 bg-primary/10 px-3 py-2 text-sm text-primary">
          ✓ イベントを作成しました（下書き）
        </p>

        <h1 className="mt-6 text-2xl font-bold">{event.title}</h1>
        <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
          <span className="rounded bg-muted px-2 py-0.5">{gameName}</span>
          <span className="rounded bg-muted px-2 py-0.5">状態: {event.status}</span>
        </div>

        {event.description && (
          <p className="mt-4 whitespace-pre-wrap text-sm text-foreground/90">
            {event.description}
          </p>
        )}

        <dl className="mt-6 grid grid-cols-1 gap-3 rounded-xl border border-border bg-card p-5 text-sm sm:grid-cols-2">
          <Row label="開催開始" value={fmtJst(event.starts_at)} />
          <Row label="開催終了" value={fmtJst(event.ends_at)} />
          <Row label="募集締切" value={fmtJst(event.recruit_deadline)} />
          <Row
            label="定員（チーム数）"
            value={event.capacity != null ? String(event.capacity) : "未設定"}
          />
          <Row
            label="ロールスワップ"
            value={event.role_swap_allowed ? "許可" : "不可"}
          />
          <Row label="申告シーズン数" value={String(event.declared_seasons)} />
          <Row
            label="到達ボーナス"
            value={`マスター+${event.bonus_master} / GM+${event.bonus_gm} / チャンピオン+${event.bonus_champion}`}
          />
        </dl>

        <div className="mt-6">
          <Link
            href="/events/new"
            className="text-sm text-muted-foreground hover:underline"
          >
            ← もう1件作成する
          </Link>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
