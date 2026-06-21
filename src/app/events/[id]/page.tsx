import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { findEventById, findEventBySlug } from "@/lib/repositories/events";
import { findRegistration } from "@/lib/repositories/registrations";
import { canViewEvent } from "@/lib/services/event-status";
import { isValidEventSlug } from "@/lib/services/event-slug";
import { PublishButton } from "./publish-button";
import { DeleteDraftButton } from "./delete-draft-button";
import { ApplyButton } from "./apply-button";

/** 応募ステータスの日本語ラベル。 */
const REG_STATUS_LABEL: Record<string, string> = {
  pending: "承認待ち",
  approved: "参加確定",
  rejected: "不参加",
  withdrawn: "取り下げ",
};

export const dynamic = "force-dynamic";

/** status を日本語ラベルに（表示用）。 */
const STATUS_LABEL: Record<string, string> = {
  draft: "下書き",
  published: "公開中",
  recruiting: "募集中",
  closed: "募集締切",
  ongoing: "開催中",
  finished: "終了",
};

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
  // URL は公開=slug / 下書き=uuid の2系統。slug 形式なら slug 検索、それ以外は id 検索。
  const event = isValidEventSlug(id)
    ? await findEventBySlug(id)
    : await findEventById(id);
  if (!event) notFound();

  // 可視性: 公開済みは誰でも、下書きは本人のみ。本人以外には存在しないように 404。
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const viewerId = user?.id ?? null;
  if (!canViewEvent(event.status, event.organizer_id, viewerId)) {
    notFound();
  }

  const gameName = (event.games as { name: string } | null)?.name ?? "-";
  const isOrganizer = viewerId !== null && viewerId === event.organizer_id;
  const statusLabel = STATUS_LABEL[event.status] ?? event.status;

  // 応募の状態（ログイン済み・非主催者・公開中のときだけ意味を持つ）。
  const canApply = viewerId !== null && !isOrganizer && event.status !== "draft";
  const myRegistration = canApply
    ? await findRegistration(event.id, viewerId)
    : null;

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-10">
        {event.status === "draft" ? (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            このイベントは下書きです。{isOrganizer ? "内容を確認して公開できます。" : ""}
          </p>
        ) : (
          <p className="rounded-md border border-primary/50 bg-primary/10 px-3 py-2 text-sm text-primary">
            ✓ このイベントは公開されています
          </p>
        )}

        <h1 className="mt-6 text-2xl font-bold">{event.title}</h1>
        <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
          <span className="rounded bg-muted px-2 py-0.5">{gameName}</span>
          <span className="rounded bg-muted px-2 py-0.5">状態: {statusLabel}</span>
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

        {/* 応募導線（非主催者・公開中）。応募済みなら状態表示、未応募なら応募ボタン。 */}
        {canApply &&
          (myRegistration ? (
            <p className="mt-6 rounded-md border border-primary/50 bg-primary/10 px-3 py-2 text-sm text-primary">
              ✓ 応募済み（
              {REG_STATUS_LABEL[myRegistration.status] ?? myRegistration.status}
              ）
            </p>
          ) : (
            <ApplyButton eventId={event.id} />
          ))}

        {isOrganizer && event.status === "draft" && (
          <PublishButton eventId={event.id} />
        )}

        {/* 主催者向けの管理導線（編集はいつでも、削除は下書きのみ）。 */}
        {isOrganizer && (
          <div className="mt-6 flex items-center gap-4">
            <Link
              href={`/events/${event.id}/edit`}
              className="text-sm text-primary hover:underline"
            >
              編集する
            </Link>
            {event.status === "draft" && (
              <DeleteDraftButton eventId={event.id} />
            )}
            {event.status !== "draft" && (
              <Link
                href={`/events/${event.id}/registrations`}
                className="text-sm text-primary hover:underline"
              >
                応募者を見る
              </Link>
            )}
            <Link
              href="/events/mine"
              className="text-sm text-muted-foreground hover:underline"
            >
              自分のイベント一覧
            </Link>
          </div>
        )}

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
