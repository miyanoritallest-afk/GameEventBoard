import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { findEventById, findEventBySlug } from "@/lib/repositories/events";
import { findRegistration } from "@/lib/repositories/registrations";
import { findDiscordName, findBattleTag } from "@/lib/repositories/users";
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

  // 主催者の表示名。登録名（organizer_display_name）優先・未設定なら Discord 名。
  const organizerName =
    event.organizer_display_name ??
    (event.organizer as { discord_name: string } | null)?.discord_name ??
    "-";

  // 応募の状態（ログイン済み・非主催者・公開中のときだけ意味を持つ）。
  const canApply = viewerId !== null && !isOrganizer && event.status !== "draft";
  const myRegistration = canApply
    ? await findRegistration(event.id, viewerId)
    : null;

  // スコアなし即時応募フォームの既定値（登録名=Discord名・バトルタグ=保存済み値）。
  // 未応募・スコアなしイベントのときだけ意味を持つ。
  const showInlineApply =
    canApply && !myRegistration && !event.require_score && viewerId !== null;
  const [discordName, battleTag] = showInlineApply
    ? await Promise.all([findDiscordName(viewerId), findBattleTag(viewerId)])
    : [null, null];

  // 本戦ページ（ブロック分け/対戦表・順位表/トーナメント）への導線を出す条件。
  // フェーズB: 公開済みなら観戦者（非ログイン・非参加者）にも導線を出す（閲覧の全面公開）。
  // 下書きでは本戦が始まらないので出さない。
  const canViewTournament = event.status !== "draft";

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
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="rounded bg-muted px-2 py-0.5">{gameName}</span>
          <span className="rounded bg-muted px-2 py-0.5">状態: {statusLabel}</span>
          <span className="rounded bg-muted px-2 py-0.5">主催: {organizerName}</span>
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

        {/* 応募導線（非主催者・公開中）。応募済みなら状態表示。
            未応募は、スコアあり(require_score)なら専用フォームへ誘導、なしなら即時応募。 */}
        {canApply &&
          (myRegistration ? (
            <div className="mt-6 rounded-md border border-primary/50 bg-primary/10 px-3 py-2 text-sm text-primary">
              <p>
                ✓ 応募済み（
                {REG_STATUS_LABEL[myRegistration.status] ??
                  myRegistration.status}
                ）
              </p>
              {/* 応募者は他の応募者を見て編成を試算できる（self 応募の前提）。 */}
              <div className="mt-2 flex items-center gap-4">
                <Link
                  href={`/events/${event.id}/registrations`}
                  className="text-xs underline hover:no-underline"
                >
                  応募者一覧を見る
                </Link>
                <Link
                  href={`/events/${event.id}/teams`}
                  className="text-xs underline hover:no-underline"
                >
                  チーム編成を試算する
                </Link>
              </div>
            </div>
          ) : event.require_score ? (
            <div className="mt-6 rounded-xl border border-border bg-card p-5">
              <h2 className="text-sm font-semibold">このイベントに応募する</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                希望ロールとランクを申告して応募します。
              </p>
              <Link
                href={`/events/${event.id}/apply`}
                className="mt-4 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                応募フォームへ
              </Link>
            </div>
          ) : (
            <ApplyButton
              eventId={event.id}
              defaultDisplayName={discordName ?? ""}
              defaultBattleTag={battleTag ?? ""}
            />
          ))}

        {/* 本戦セクション（ブロック分け・対戦表・順位表への導線）。
            主催者・応募者の双方に同じ導線を出して一元化する。各ページ側で
            主催者=編集可 / 応募者=閲覧のみ（read-only）に出し分く。 */}
        {canViewTournament && (
          <section className="mt-6 rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold">本戦</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              ブロックの組み分けと、対戦表・順位表を確認できます。
              {!isOrganizer && "（閲覧のみ）"}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href={`/events/${event.id}/watch`}
                className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                観戦ビューでまとめて見る →
              </Link>
              <Link
                href={`/events/${event.id}/groups`}
                className="inline-flex items-center rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted/50"
              >
                ブロック分けを見る →
              </Link>
              <Link
                href={`/events/${event.id}/matches`}
                className="inline-flex items-center rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted/50"
              >
                対戦表・順位表を見る →
              </Link>
            </div>
          </section>
        )}

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
            {event.status !== "draft" && (
              <Link
                href={`/events/${event.id}/teams`}
                className="text-sm text-primary hover:underline"
              >
                チーム編成
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
