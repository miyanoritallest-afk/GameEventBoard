import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import {
  listMatchesStartingSoon,
  markMatchNotified,
  listEventsWithMatchesToday,
  adminUpsertNotificationEvent,
  adminInsertNotification,
  adminInsertDelivery,
} from "@/lib/repositories/cron";
import { aggregateRecipients } from "@/lib/services/notification-fanout";
import {
  NotificationType,
  buildMatchStartingSoonContent,
  buildEventMatchesTodayWebhookContent,
} from "@/lib/services/notification-content";
import { postToDiscordWebhook } from "@/lib/notifications/discord";

/**
 * Cron（⑦ 定期通知）のオーケストレーション。**admin クライアント（RLS バイパス）** を受け取り、
 * Route Handler（CRON_SECRET 保護）からのみ呼ぶ。文面は Service（純粋）、DB は cron Repository。
 * 各件はベストエフォート（1件の失敗が全体を止めない）。
 */

type Admin = SupabaseClient<Database>;

/** JST の日付キー（YYYY-MM-DD）。1日1回集約の dedup_key・当日範囲の算出に使う。 */
function jstDateKey(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** アプリの絶対URLベース（Discord リンク用・④と同じ規則）。 */
function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
    /\/+$/,
    "",
  );
}

/** Webhook 投稿先識別（host のみ・トークン非保存）。 */
function webhookTargetRef(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

/**
 * 埋め込み結果（team_a/team_b → team_members → registrations → user_id）から
 * 出場メンバーの user_id を集める。null や欠損は落とす。
 */
function collectMatchMemberIds(match: {
  team_a: unknown;
  team_b: unknown;
}): string[] {
  const ids: string[] = [];
  for (const team of [match.team_a, match.team_b]) {
    const t = team as {
      team_members?: { registrations?: { user_id?: string } | null }[];
    } | null;
    for (const m of t?.team_members ?? []) {
      const uid = m.registrations?.user_id;
      if (uid) ids.push(uid);
    }
  }
  return ids;
}

export type MatchReminderResult = {
  matchesConsidered: number;
  notificationsCreated: number;
  errors: number;
};

/**
 * #7 試合開始2時間前リマインド。2時間以内に始まる未通知の試合を拾い、出場メンバーへ
 * アプリ内通知を作り、matches.notified_at を立てる（二重送信の物理防止）。
 * 出来事は試合単位（source_type='event'・source_id=event_id）。notifications の UNIQUE と
 * notified_at の条件付き UPDATE で二重を防ぐ。
 */
export async function runMatchReminders(
  admin: Admin,
  now: Date = new Date(),
): Promise<MatchReminderResult> {
  const matches = await listMatchesStartingSoon(admin, now);
  let created = 0;
  let errors = 0;

  for (const match of matches) {
    try {
      // 先に notified_at を立てて枠を取る（並行実行での二重送信を防ぐ）。負けたらスキップ。
      const claimed = await markMatchNotified(admin, match.id, now);
      if (claimed === 0) continue;

      const recipients = aggregateRecipients([collectMatchMemberIds(match)], []);
      if (recipients.length === 0) continue;

      const { id: sourceEventId } = await adminUpsertNotificationEvent(admin, {
        type: NotificationType.MatchStartingSoon,
        sourceType: "event",
        sourceId: match.event_id,
        // 試合単位で1回。試合IDをキーに含め、同じ試合の再送を弾く。
        dedupKey: `match:${match.id}:${NotificationType.MatchStartingSoon}`,
      });
      const content = buildMatchStartingSoonContent({
        eventId: match.event_id,
        eventTitle: await eventTitle(admin, match.event_id),
        scheduledAt: match.scheduled_at as string,
      });
      for (const userId of recipients) {
        await adminInsertNotification(admin, {
          userId,
          sourceEventId,
          title: content.title,
          body: content.body,
          linkUrl: content.linkUrl,
        });
        created += 1;
      }
    } catch (e) {
      errors += 1;
      console.error(`[runMatchReminders] 試合 ${match.id} の通知に失敗:`, e);
    }
  }
  return { matchesConsidered: matches.length, notificationsCreated: created, errors };
}

/** イベント名を admin で引く（#7 の文面用・小さなヘルパ）。 */
async function eventTitle(admin: Admin, eventId: string): Promise<string> {
  const { data } = await admin
    .from("events")
    .select("title")
    .eq("id", eventId)
    .maybeSingle();
  return data?.title ?? "イベント";
}

export type TodayAnnounceResult = {
  eventsConsidered: number;
  sent: number;
  failed: number;
  skipped: number;
};

/**
 * #9 「本日◯時から各試合」の全体告知（Webhook）。本日 JST に試合があり webhook を持つ
 * 公開イベントを拾い、告知チャンネルへ投稿する。dedup_key で1日1回に集約（同日2回目は
 * 既存の出来事を再利用し、notification_deliveries には投稿の実結果を記録する）。
 */
export async function runTodayMatchAnnounce(
  admin: Admin,
  now: Date = new Date(),
): Promise<TodayAnnounceResult> {
  // JST の当日 [00:00, 翌00:00) を UTC で表す。
  const key = jstDateKey(now);
  const dayStartUtc = new Date(`${key}T00:00:00+09:00`);
  const dayEndUtc = new Date(dayStartUtc.getTime() + 24 * 60 * 60 * 1000);

  const events = await listEventsWithMatchesToday(admin, dayStartUtc, dayEndUtc);
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const ev of events) {
    try {
      const dedupKey = `event:${ev.id}:${NotificationType.EventMatchesToday}:${key}`;
      // 同日2回目は既存出来事を再利用（1日1回）。ここで新規なら初回＝投稿する。
      const before = await hasEventForKey(admin, dedupKey);
      await adminUpsertNotificationEvent(admin, {
        type: NotificationType.EventMatchesToday,
        sourceType: "event",
        sourceId: ev.id,
        dedupKey,
      });
      if (before) {
        skipped += 1; // 本日分は投稿済み。二重投稿しない。
        continue;
      }

      const firstMatchAt = await firstMatchAtToday(
        admin,
        ev.id,
        dayStartUtc,
        dayEndUtc,
      );
      const content = buildEventMatchesTodayWebhookContent({
        eventTitle: ev.title,
        firstMatchAt: firstMatchAt ?? dayStartUtc.toISOString(),
        eventUrl: `${appBaseUrl()}/events/${ev.id}`,
      });
      const result = await postToDiscordWebhook(ev.discordWebhookUrl, content);
      if (result.ok) {
        await adminInsertDelivery(admin, {
          status: "sent",
          targetRef: webhookTargetRef(ev.discordWebhookUrl),
          sentAt: new Date().toISOString(),
        });
        sent += 1;
      } else {
        await adminInsertDelivery(admin, {
          status: "failed",
          targetRef: webhookTargetRef(ev.discordWebhookUrl),
          error: result.error,
        });
        failed += 1;
      }
    } catch (e) {
      failed += 1;
      console.error(`[runTodayMatchAnnounce] イベント ${ev.id} の告知に失敗:`, e);
    }
  }
  return { eventsConsidered: events.length, sent, failed, skipped };
}

/** dedup_key の出来事が既にあるか（#9 の「本日投稿済み」判定）。 */
async function hasEventForKey(admin: Admin, dedupKey: string): Promise<boolean> {
  const { data } = await admin
    .from("notification_events")
    .select("id")
    .eq("dedup_key", dedupKey)
    .maybeSingle();
  return !!data;
}

/** そのイベントの本日 JST 最初の試合時刻（無ければ null）。 */
async function firstMatchAtToday(
  admin: Admin,
  eventId: string,
  dayStartUtc: Date,
  dayEndUtc: Date,
): Promise<string | null> {
  const { data } = await admin
    .from("matches")
    .select("scheduled_at")
    .eq("event_id", eventId)
    .not("scheduled_at", "is", null)
    .gte("scheduled_at", dayStartUtc.toISOString())
    .lt("scheduled_at", dayEndUtc.toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.scheduled_at ?? null;
}
