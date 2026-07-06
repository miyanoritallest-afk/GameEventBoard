import {
  insertNotificationEvent,
  upsertNotificationEvent,
  insertNotification,
  insertDelivery,
} from "@/lib/repositories/notifications";
import { listFollowerIds } from "@/lib/repositories/follows";
import { findTeamForNotify } from "@/lib/repositories/teams";
import { aggregateRecipients } from "@/lib/services/notification-fanout";
import {
  buildSeriesMemberInvitedContent,
  buildEventAnnounceWebhookContent,
  buildTeamApprovedContent,
  buildScrimScheduledContent,
  NotificationType,
} from "@/lib/services/notification-content";
import type { NotificationContent } from "@/lib/services/notification-content";
import { postToDiscordWebhook } from "@/lib/notifications/discord";

/**
 * 通知のアプリケーションサービス（クロス Controller のオーケストレーション）。
 * Repository（DB）＋純粋 Service（集約・文面）を束ねる。Service は repository を
 * import しない純粋関数、という既存規律を保つため、ここに置く（Controller から呼ぶ）。
 *
 * ベストエフォート前提: 呼び出し側の Controller が try/catch で握り、業務（結果入力・
 * 編集）の成否を通知失敗で巻き添えにしない。
 */

/** JST の日付文字列（YYYY-MM-DD）。1日1回集約の dedup_key に使う。 */
function jstDateKey(now: Date = new Date()): string {
  // UTC+9 に寄せてから日付部分だけ取る。
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

/**
 * event フォロワーへ通知する（#5 日程更新・#6 結果更新で共用）。
 * - dedup_key で「1イベント・1種別・1日1回」に集約（同じ日の2回目は同じ出来事を再利用し、
 *   notifications の UNIQUE(user_id, source_event_id) が2通目を弾く）。
 * - 宛先＝event フォロワー（重複排除・除外ユーザーを除く）。宛先ゼロなら何もしない。
 * - 各宛先は並列・独立生成（1件失敗が他を巻き込まない）。
 *
 * excludeUserId には「その操作をした本人」を渡す（例: 結果を入力した代表・編集した主催者）。
 */
export async function notifyEventFollowers(params: {
  eventId: string;
  type: string;
  content: NotificationContent;
  excludeUserId?: string | null;
}): Promise<void> {
  const followers = await listFollowerIds({
    targetType: "event",
    targetId: params.eventId,
  });
  const recipients = aggregateRecipients(
    [followers],
    params.excludeUserId ? [params.excludeUserId] : [],
  );
  if (recipients.length === 0) return;

  // 1イベント・1種別・1日1回の出来事（find-or-create）。
  const dedupKey = `event:${params.eventId}:${params.type}:${jstDateKey()}`;
  const { id: sourceEventId } = await upsertNotificationEvent({
    type: params.type,
    sourceType: "event",
    sourceId: params.eventId,
    dedupKey,
  });

  const results = await Promise.allSettled(
    recipients.map((userId) =>
      insertNotification({
        userId,
        sourceEventId,
        title: params.content.title,
        body: params.content.body,
        linkUrl: params.content.linkUrl,
      }),
    ),
  );
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    console.error(
      `[notifyEventFollowers] ${failed.length}/${recipients.length} 件の通知生成に失敗（type=${params.type}）`,
      (failed[0] as PromiseRejectedResult).reason,
    );
  }
}

/**
 * #11 シリーズ運営への招待を招待相手本人へ通知する（直接関係者・3.7 の #11）。
 * フォロー集約は不要（宛先が招待相手1人に一意に決まる）。出来事は招待ごとに1つ生成する
 * （日程/結果のような1日1回集約はしない）。source は series。
 *
 * ベストエフォート: 呼び出し側（招待 Action）が try/catch で握り、招待成功を通知失敗で
 * 巻き添えにしない。招待ごとに新しい source_event_id を採番するため、招待→拒否→再招待では
 * 通知が都度届く（UNIQUE(user_id, source_event_id) は同一出来事の重複のみ弾く＝集約はしない）。
 * これは意図通り（「また招待された」を毎回知らせる）。
 */
export async function notifySeriesMemberInvited(params: {
  seriesId: string;
  seriesName: string;
  inviteeUserId: string;
  inviterName: string;
}): Promise<void> {
  const content = buildSeriesMemberInvitedContent({
    seriesId: params.seriesId,
    seriesName: params.seriesName,
    inviterName: params.inviterName,
  });

  const { id: sourceEventId } = await insertNotificationEvent({
    type: NotificationType.SeriesMemberInvited,
    sourceType: "series",
    sourceId: params.seriesId,
  });

  await insertNotification({
    userId: params.inviteeUserId,
    sourceEventId,
    title: content.title,
    body: content.body,
    linkUrl: content.linkUrl,
  });
}

/**
 * アプリの絶対URLのベース。Discord メッセージ内リンクは絶対URLでなければ踏めないため、
 * env（NEXT_PUBLIC_APP_URL）から解決する。未設定なら開発用に localhost:3000 へフォールバック
 * （本番デプロイ時は NEXT_PUBLIC_APP_URL を設定する）。末尾スラッシュは落とす。
 */
function appBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

/** Webhook の投稿先識別（トークンを保存しないよう host だけ）。記録用。 */
function webhookTargetRef(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

/**
 * ④ イベント公開の全体告知を Discord 告知チャンネル（Webhook）へ投稿する。
 * アプリ内通知（notifyEventPublished の宛先集約）とは別レイヤー＝チャンネルに1回投稿する
 * 全体向け。webhookUrl が無ければ投稿せず skipped を記録する。
 *
 * ベストエフォート: 呼び出し側（publishEvent）が try/catch で握り、公開の成功を配信失敗で
 * 巻き添えにしない。結果は notification_deliveries に sent/failed/skipped で残す（再送は⑦Cron）。
 */
export async function announceEventPublishedToWebhook(params: {
  eventId: string;
  eventTitle: string;
  organizerName: string;
  webhookUrl: string | null;
}): Promise<void> {
  // URL 未設定＝投稿しない。skipped として記録（「送らなかった」を可視化）。
  if (!params.webhookUrl) {
    await insertDelivery({ channel: "discord_webhook", status: "skipped" });
    return;
  }

  const content = buildEventAnnounceWebhookContent({
    eventTitle: params.eventTitle,
    organizerName: params.organizerName,
    eventUrl: `${appBaseUrl()}/events/${params.eventId}`,
  });

  const result = await postToDiscordWebhook(params.webhookUrl, content);
  const targetRef = webhookTargetRef(params.webhookUrl);
  if (result.ok) {
    await insertDelivery({
      channel: "discord_webhook",
      status: "sent",
      targetRef,
      sentAt: new Date().toISOString(),
    });
  } else {
    await insertDelivery({
      channel: "discord_webhook",
      status: "failed",
      targetRef,
      error: result.error,
    });
  }
}

/**
 * #3 チーム承認（self 確定→成立）を、そのチームのメンバー全員へ通知する（直接関係者）。
 * 宛先はチームメンバーの user_id 集合（aggregateRecipients で重複排除）。1出来事＝1チーム承認。
 * 二重は notifications の UNIQUE(user_id, source_event_id) が弾く。
 *
 * ベストエフォート: 呼び出し側（approveTeam）が try/catch で握り、承認を通知失敗で
 * 巻き添えにしない。宛先ゼロ（メンバー不在）なら何もしない。
 */
export async function notifyTeamApproved(teamId: string): Promise<void> {
  const team = await findTeamForNotify(teamId);
  if (!team) return;

  const recipients = aggregateRecipients([team.memberUserIds], []);
  if (recipients.length === 0) return;

  const { id: sourceEventId } = await insertNotificationEvent({
    type: NotificationType.TeamApproved,
    sourceType: "event",
    sourceId: team.eventId,
  });
  const content = buildTeamApprovedContent({
    eventId: team.eventId,
    eventTitle: team.eventTitle,
    teamName: team.teamName,
  });

  const results = await Promise.allSettled(
    recipients.map((userId) =>
      insertNotification({
        userId,
        sourceEventId,
        title: content.title,
        body: content.body,
        linkUrl: content.linkUrl,
      }),
    ),
  );
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    console.error(
      `[notifyTeamApproved] ${failed.length}/${recipients.length} 件の通知生成に失敗`,
      (failed[0] as PromiseRejectedResult).reason,
    );
  }
}

/**
 * #10 スクリム/練習の予定登録・変更を、そのチームのメンバーへ通知する（直接関係者・3.7 の #10）。
 * 宛先＝チームメンバーの user_id 集合から「登録/編集した本人（actorUserId）」を除いた集合
 * （自分の操作で自分に通知が来る冗長さを避ける）。1操作＝1出来事を都度採番する（insert）ので、
 * 登録・変更のたびに通知が届く（#11 と同じ「都度知らせる」方針。1日1回集約はしない）。
 * source は event（scrim は team 経由で event に紐づく＝日程ページで確認する）。
 *
 * ベストエフォート: 呼び出し側（createScrim/editScrim）が try/catch で握り、登録/編集の成功を
 * 通知失敗で巻き添えにしない。宛先ゼロ（本人しかいない等）なら何もしない。二重は
 * notifications の UNIQUE(user_id, source_event_id) が最終防衛。
 */
export async function notifyScrimScheduled(params: {
  teamId: string;
  actorUserId: string;
  kind: "scrim" | "practice";
  scheduledAt: string;
  changed?: boolean;
}): Promise<void> {
  const team = await findTeamForNotify(params.teamId);
  if (!team) return;

  const recipients = aggregateRecipients(
    [team.memberUserIds],
    [params.actorUserId],
  );
  if (recipients.length === 0) return;

  const { id: sourceEventId } = await insertNotificationEvent({
    type: NotificationType.ScrimScheduled,
    sourceType: "event",
    sourceId: team.eventId,
  });
  const content = buildScrimScheduledContent({
    eventId: team.eventId,
    teamName: team.teamName,
    kind: params.kind,
    scheduledAt: params.scheduledAt,
    changed: params.changed,
  });

  const results = await Promise.allSettled(
    recipients.map((userId) =>
      insertNotification({
        userId,
        sourceEventId,
        title: content.title,
        body: content.body,
        linkUrl: content.linkUrl,
      }),
    ),
  );
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    console.error(
      `[notifyScrimScheduled] ${failed.length}/${recipients.length} 件の通知生成に失敗（changed=${!!params.changed}）`,
      (failed[0] as PromiseRejectedResult).reason,
    );
  }
}
