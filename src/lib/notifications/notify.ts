import {
  insertNotificationEvent,
  upsertNotificationEvent,
  insertNotification,
} from "@/lib/repositories/notifications";
import { listFollowerIds } from "@/lib/repositories/follows";
import { aggregateRecipients } from "@/lib/services/notification-fanout";
import {
  buildSeriesMemberInvitedContent,
  NotificationType,
} from "@/lib/services/notification-content";
import type { NotificationContent } from "@/lib/services/notification-content";

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
