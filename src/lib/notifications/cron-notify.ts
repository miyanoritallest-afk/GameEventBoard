import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import {
  listMatchesStartingSoon,
  listScrimsStartingSoon,
  markMatchNotified,
  listEventsWithMatchesToday,
  adminUpsertNotificationEvent,
  adminInsertNotification,
  adminInsertDelivery,
  listDiscordTargetsForUsers,
} from "@/lib/repositories/cron";
import type { DiscordDmTarget } from "@/lib/repositories/cron";
import { aggregateRecipients } from "@/lib/services/notification-fanout";
import {
  NotificationType,
  buildMatchStartingSoonContent,
  buildScrimStartingSoonContent,
  buildEventMatchesTodayWebhookContent,
  buildDirectMessageContent,
} from "@/lib/services/notification-content";
import type { NotificationContent } from "@/lib/services/notification-content";
import { postToDiscordWebhook, sendDiscordDM } from "@/lib/notifications/discord";

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
 * リマインド（#7/#8）で作った個人通知を、opt-in 済みユーザーへ Discord DM でも送る（ベスト
 * エフォート）。アプリ内通知（アプリ内は本命）は既に作られている前提で、その上乗せ配信。
 *
 * - Bot トークン未設定なら**何もしない**（feature 無効時に users 取得や skipped 行を溜めない）。
 * - 宛先ごとに discord_id・opt-in を admin で引き、opt-in=false / discord_id 無しは送らない。
 * - 送信の成否は notification_deliveries に channel='discord_dm' で記録し、失敗は握って続行。
 * - target_ref には discord_id（snowflake・秘匿情報ではない）を入れ、失敗の切り分けに使う。
 *
 * notificationIds は user_id → notification_id の Map（通知作成時に採番したもの）。DM 配信を
 * 個人通知に紐づける。id を引けなかった宛先（二重集約で既存 id 不明）は notification_id=null で
 * 記録する（配信の事実は残す）。
 *
 * **この関数は例外を投げない**（内部で全て握る）。呼び出し側（リマインド本体）の try は個人通知
 * 作成の失敗を数える枠であり、DM 上乗せの失敗（users 取得の一時エラー含む）をそこに混ぜない。
 * 混ぜると #8 は出来事が既に記録済みで次回 skip され、DM が二度と飛ばなくなる（本体を巻き添え）。
 */
async function sendReminderDMs(
  admin: Admin,
  content: NotificationContent,
  recipients: string[],
  notificationIds: Map<string, string | null>,
): Promise<void> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  // トークン未設定＝feature 無効。users 取得も skipped 行の記録もせず即戻る
  // （毎 Cron・毎リマインドの無駄クエリと notification_deliveries の skipped 洪水を防ぐ）。
  if (!botToken) return;

  // users 取得の一時エラーはここで握る（本体の errors に混ぜない・下記の巻き添え防止）。
  let targets: Map<string, DiscordDmTarget>;
  try {
    targets = await listDiscordTargetsForUsers(admin, recipients);
  } catch (e) {
    console.error("[sendReminderDMs] DM 宛先(users)の取得に失敗。DM は見送る:", e);
    return;
  }
  const dmText = buildDirectMessageContent(content, appBaseUrl());

  for (const userId of recipients) {
    const target: DiscordDmTarget | undefined = targets.get(userId);
    // discord_id が無い / opt-out は送信対象外（skip・記録もしない＝ノイズを増やさない）。
    if (!target || !target.optIn) continue;

    const notificationId = notificationIds.get(userId) ?? null;
    try {
      const result = await sendDiscordDM(botToken, target.discordId, dmText);
      if (result.ok) {
        await adminInsertDelivery(admin, {
          channel: "discord_dm",
          status: "sent",
          notificationId,
          targetRef: target.discordId,
          sentAt: new Date().toISOString(),
        });
      } else if (result.skipped) {
        // 送信条件未達（opt-in 済みだが送れない稀ケース）。送らなかった事実だけ残す。
        await adminInsertDelivery(admin, {
          channel: "discord_dm",
          status: "skipped",
          notificationId,
          targetRef: target.discordId,
          error: result.reason,
        });
      } else {
        await adminInsertDelivery(admin, {
          channel: "discord_dm",
          status: "failed",
          notificationId,
          targetRef: target.discordId,
          error: result.error,
        });
      }
    } catch (e) {
      // delivery 記録自体の失敗も握る（DM 上乗せがリマインド本体を巻き添えにしない）。
      console.error(`[sendReminderDMs] DM 配信の記録に失敗 (user=${userId}):`, e);
    }
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
      const notificationIds = new Map<string, string | null>();
      for (const userId of recipients) {
        const { id } = await adminInsertNotification(admin, {
          userId,
          sourceEventId,
          title: content.title,
          body: content.body,
          linkUrl: content.linkUrl,
        });
        notificationIds.set(userId, id);
        created += 1;
      }
      // アプリ内通知の上乗せとして DM を送る（ベストエフォート・DM 失敗は握る）。
      await sendReminderDMs(admin, content, recipients, notificationIds);
    } catch (e) {
      errors += 1;
      console.error(`[runMatchReminders] 試合 ${match.id} の通知に失敗:`, e);
    }
  }
  return { matchesConsidered: matches.length, notificationsCreated: created, errors };
}

/**
 * スクリム埋め込み結果（team→team_members→registrations→user_id）から
 * チームメンバーの user_id を集める。null や欠損は落とす。
 */
function collectScrimMemberIds(team: unknown): string[] {
  const t = team as {
    team_members?: { registrations?: { user_id?: string } | null }[];
  } | null;
  const ids: string[] = [];
  for (const m of t?.team_members ?? []) {
    const uid = m.registrations?.user_id;
    if (uid) ids.push(uid);
  }
  return ids;
}

export type ScrimReminderResult = {
  scrimsConsidered: number;
  notificationsCreated: number;
  skipped: number;
  errors: number;
};

/**
 * #8 スクリム/練習開始2時間前リマインド。2時間以内に始まるスクリムを拾い、チームメンバー
 * へアプリ内通知を作る。#7 と違い scrims に notified_at 列は無い（列追加なし方針）ので、
 * 二重送信は #9 と同じ dedup_key の before-check で防ぐ：既に同キーの出来事があれば送信済み
 * とみなし skip。notifications の UNIQUE が最終防衛。出来事は event 単位
 * （source_type='event'・source_id=event_id）。#10 と違い登録者も宛先に含む。
 *
 * dedup_key には **開始時刻(scheduled_at)を含める**（`scrim:<id>:<type>:<scheduled_at>`）。
 * 主催者が開始時刻を変更したら別キーになり、変更後の2時間前に再びリマインドが飛ぶ
 * （#10 が時刻変更を通知する設計と揃える）。時刻が同じ間は同キーで二重送信を防ぐ。
 *
 * 宛先(recipients)の空チェックは **出来事を作る前** に行う。先に出来事を記録してしまうと、
 * リマインド判定時にメンバー0人だった場合に以降ずっと skip され、後からメンバーが増えても
 * 通知が飛ばなくなるため（宛先確定を出来事作成より先に置く）。
 */
export async function runScrimReminders(
  admin: Admin,
  now: Date = new Date(),
): Promise<ScrimReminderResult> {
  const scrims = await listScrimsStartingSoon(admin, now);
  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const scrim of scrims) {
    try {
      const team = scrim.teams as {
        name: string;
        event_id: string;
      } | null;
      if (!team) continue;

      // 宛先を先に確定。0人なら出来事を作らず見送る（後からメンバーが増えたら次回拾う）。
      const recipients = aggregateRecipients(
        [collectScrimMemberIds(scrim.teams)],
        [],
      );
      if (recipients.length === 0) continue;

      // 開始時刻込みのキー。時刻変更後は別キー＝再リマインド、同時刻なら二重送信を防ぐ。
      const dedupKey = `scrim:${scrim.id}:${NotificationType.ScrimStartingSoon}:${scrim.scheduled_at}`;
      // 既に同キーの出来事があれば送信済み。ここで確定するので upsert は初回だけに絞れる。
      if (await hasEventForKey(admin, dedupKey)) {
        skipped += 1; // このスクリム（この開始時刻）は送信済み。二重送信しない。
        continue;
      }

      const { id: sourceEventId } = await adminUpsertNotificationEvent(admin, {
        type: NotificationType.ScrimStartingSoon,
        sourceType: "event",
        sourceId: team.event_id,
        dedupKey,
      });

      const content = buildScrimStartingSoonContent({
        eventId: team.event_id,
        teamName: team.name,
        kind: scrim.kind,
        scheduledAt: scrim.scheduled_at as string,
      });
      const notificationIds = new Map<string, string | null>();
      for (const userId of recipients) {
        const { id } = await adminInsertNotification(admin, {
          userId,
          sourceEventId,
          title: content.title,
          body: content.body,
          linkUrl: content.linkUrl,
        });
        notificationIds.set(userId, id);
        created += 1;
      }
      // アプリ内通知の上乗せとして DM を送る（ベストエフォート・DM 失敗は握る）。
      await sendReminderDMs(admin, content, recipients, notificationIds);
    } catch (e) {
      errors += 1;
      console.error(`[runScrimReminders] スクリム ${scrim.id} の通知に失敗:`, e);
    }
  }
  return {
    scrimsConsidered: scrims.length,
    notificationsCreated: created,
    skipped,
    errors,
  };
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
