import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Cron（⑦ 定期通知）専用 Repository。
 * **service_role クライアント（RLS バイパス）を引数で受け取る**（呼び出し元 Route Handler が
 * CRON_SECRET で保護する前提）。ログインセッションが無い定期処理から、他人の試合・チーム
 * メンバーを跨いで集約するために RLS を越える。生SQL は使わずクエリビルダのみ（SQLi対策）。
 */

type Admin = SupabaseClient<Database>;

/**
 * これから2時間以内に開始し、まだリマインド未送信（notified_at is null）の試合を取得する。
 * scheduled_at が null の試合（未定）は対象外。出場チーム（team_a/team_b）のメンバーの
 * user_id まで埋め込みで辿る（matches→teams→team_members→registrations→users）。
 * 宛先集約・文面生成はオーケストレーション側で行う（ここは取得のみ）。
 */
export async function listMatchesStartingSoon(admin: Admin, now: Date) {
  const horizon = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const { data, error } = await admin
    .from("matches")
    .select(
      `id, event_id, scheduled_at,
       team_a:teams!matches_team_a_id_fkey(id, team_members(registrations(user_id))),
       team_b:teams!matches_team_b_id_fkey(id, team_members(registrations(user_id)))`,
    )
    .is("notified_at", null)
    .not("scheduled_at", "is", null)
    .gte("scheduled_at", now.toISOString())
    .lte("scheduled_at", horizon.toISOString());

  if (error) throw error;
  return data ?? [];
}

/**
 * 試合のリマインド送信済みフラグを立てる（notified_at=now）。二重送信の物理防止。
 * 既に notified_at が入っている行は更新しない（並行実行での二重送信を防ぐ条件付き UPDATE）。
 * 返り値は実際に更新した行数（0 なら別の実行が先に送った）。
 */
export async function markMatchNotified(
  admin: Admin,
  matchId: string,
  now: Date,
): Promise<number> {
  const { data, error } = await admin
    .from("matches")
    .update({ notified_at: now.toISOString() })
    .eq("id", matchId)
    .is("notified_at", null)
    .select("id");

  if (error) throw error;
  return data?.length ?? 0;
}

/**
 * 本日（JST）に scheduled_at がある試合を1件以上持つ、公開済みイベントを取得する（#9）。
 * 「本日◯時から各試合」の全体告知の対象。discord_webhook_url を持つイベントに絞る
 * （投稿先が無いイベントは告知しても skipped になるだけなので取得段で除く）。
 * 返り値は重複排除済みのイベント配列（id/title/discord_webhook_url）。
 */
export async function listEventsWithMatchesToday(
  admin: Admin,
  jstDayStartUtc: Date,
  jstDayEndUtc: Date,
) {
  const { data, error } = await admin
    .from("matches")
    .select(
      "event_id, events!inner(id, title, discord_webhook_url, status)",
    )
    .not("scheduled_at", "is", null)
    .gte("scheduled_at", jstDayStartUtc.toISOString())
    .lt("scheduled_at", jstDayEndUtc.toISOString());

  if (error) throw error;

  // event_id で重複排除。webhook 未設定・非公開は除く（告知の実効性が無い）。
  const seen = new Map<
    string,
    { id: string; title: string; discordWebhookUrl: string }
  >();
  for (const row of data ?? []) {
    const ev = row.events as unknown as {
      id: string;
      title: string;
      discord_webhook_url: string | null;
      status: string;
    } | null;
    if (!ev || ev.status === "draft" || !ev.discord_webhook_url) continue;
    if (!seen.has(ev.id)) {
      seen.set(ev.id, {
        id: ev.id,
        title: ev.title,
        discordWebhookUrl: ev.discord_webhook_url,
      });
    }
  }
  return [...seen.values()];
}

/**
 * 出来事（notification_events）を admin で1件作成し id を返す（Cron 用・RLS バイパス）。
 * dedup_key を渡すと「同じキーの2回目」は既存行を再利用する（find-or-create・1日1回集約）。
 * anon 版（notifications repo）と役割は同じだが、Cron はセッションが無く admin で書く。
 */
export async function adminUpsertNotificationEvent(
  admin: Admin,
  params: {
    type: string;
    sourceType: Database["public"]["Enums"]["follow_target"];
    sourceId: string;
    dedupKey?: string | null;
  },
): Promise<{ id: string }> {
  if (params.dedupKey) {
    const { data: existing, error: selErr } = await admin
      .from("notification_events")
      .select("id")
      .eq("dedup_key", params.dedupKey)
      .maybeSingle();
    if (selErr) throw selErr;
    if (existing) return { id: existing.id };
  }
  const id = crypto.randomUUID();
  const { error } = await admin.from("notification_events").insert({
    id,
    type: params.type,
    source_type: params.sourceType,
    source_id: params.sourceId,
    dedup_key: params.dedupKey ?? null,
  });
  if (error) throw error;
  return { id };
}

/**
 * 通知（notifications）を admin で1件作成する（Cron 用）。二重は UNIQUE(user_id,
 * source_event_id) が弾く（重複コードは無視して成功扱い＝ベストエフォート集約）。
 */
export async function adminInsertNotification(
  admin: Admin,
  params: {
    userId: string;
    sourceEventId: string;
    title: string;
    body?: string | null;
    linkUrl?: string | null;
  },
): Promise<void> {
  const { error } = await admin.from("notifications").insert({
    id: crypto.randomUUID(),
    user_id: params.userId,
    source_event_id: params.sourceEventId,
    title: params.title,
    body: params.body ?? null,
    link_url: params.linkUrl ?? null,
  });
  // 23505 = unique_violation（同じ出来事で既に通知済み）。二重は握って成功扱い。
  if (error && error.code !== "23505") throw error;
}

/**
 * 外部配信（Webhook）の結果を admin で記録する（Cron 用・#9）。
 */
export async function adminInsertDelivery(
  admin: Admin,
  params: {
    status: Database["public"]["Enums"]["delivery_status"];
    targetRef?: string | null;
    error?: string | null;
    sentAt?: string | null;
  },
): Promise<void> {
  const { error } = await admin.from("notification_deliveries").insert({
    channel: "discord_webhook",
    status: params.status,
    target_ref: params.targetRef ?? null,
    error: params.error ?? null,
    sent_at: params.sentAt ?? null,
  });
  if (error) throw error;
}
