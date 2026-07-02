/**
 * 通知の文面生成（Service 層・純粋関数）。副作用なし・テストの主役。
 *
 * 要件定義書 3.7 のカタログに沿い、type ごとの title / body / link_url を
 * **サーバー側で固定生成**する（マスアサインメント対策＝入力から取らない）。
 * 主催者や参加者が文面を編集する領域ではない。文言はここが唯一の正。
 *
 * 出来事の source_type / source_id は notification_events に記録する
 * （フォロー集約 3.6.1 の宛先起点。本 PR では #1 のみ）。
 */

/** 通知イベント種別（要件定義書 3.7）。文字列はこの定数を唯一の正とする。 */
export const NotificationType = {
  /** 応募が承認された（参加確定）。宛先=応募者本人・直接関係者。 */
  RegistrationApproved: "registration_approved",
  /**
   * 新しい開催回が公開された（＝新シーズン告知。単発イベント含む）。
   * 宛先=シリーズ／主催者フォロワー・フォロー集約（3.7 の #4）。
   * 本 PR では主催者(user)フォロワー分のみ生成（series は⑥で追加）。
   */
  SeriesSeasonAnnounced: "series_season_announced",
  /**
   * 日程が確定/更新された。宛先=event フォロワー・フォロー集約（3.7 の #5）。
   * 短期イベント（主催者が日程を組んだ/変えた）を対象に1日1回集約（本 PR）。
   */
  EventScheduleConfirmed: "event_schedule_confirmed",
  /**
   * 結果・順位が更新された。宛先=event フォロワー・フォロー集約（3.7 の #6）。
   * 試合ごとではなくイベント単位・1日1回に集約（dedup_key）。
   */
  EventResultUpdated: "event_result_updated",
} as const;

export type NotificationTypeValue =
  (typeof NotificationType)[keyof typeof NotificationType];

export type NotificationContent = {
  title: string;
  body: string | null;
  linkUrl: string;
};

/**
 * #1 応募承認の文面。宛先は応募者本人。link 先は参加確定したイベントページ。
 * イベント名はスナップショットではなく通知時点の title を渡す（呼び出し側が取得）。
 */
export function buildRegistrationApprovedContent(params: {
  eventId: string;
  eventTitle: string;
}): NotificationContent {
  return {
    title: "応募が承認されました",
    body: `「${params.eventTitle}」への参加が承認されました。`,
    linkUrl: `/events/${params.eventId}`,
  };
}

/**
 * #4 新しい開催回の公開。宛先はフォロワー（本 PR は主催者フォロワー）。
 * link 先は公開されたイベントページ。主催者名・イベント名は通知時点の値を渡す。
 */
export function buildSeriesSeasonAnnouncedContent(params: {
  eventId: string;
  eventTitle: string;
  organizerName: string;
}): NotificationContent {
  return {
    title: "新しいイベントが公開されました",
    body: `${params.organizerName}さんが「${params.eventTitle}」を公開しました。`,
    linkUrl: `/events/${params.eventId}`,
  };
}

/**
 * #5 日程が確定/更新された。宛先は event フォロワー。link 先はイベントページ。
 * 1日1回集約なので文面は「日程が更新されました」（具体の日時は本文に混ぜず、詳細は遷移先で）。
 */
export function buildEventScheduleConfirmedContent(params: {
  eventId: string;
  eventTitle: string;
}): NotificationContent {
  return {
    title: "イベントの日程が更新されました",
    body: `「${params.eventTitle}」の日程が更新されました。詳細をご確認ください。`,
    linkUrl: `/events/${params.eventId}`,
  };
}

/**
 * #6 結果・順位が更新された。宛先は event フォロワー。link 先は観戦ビュー（結果を見る導線）。
 * 1日1回集約なので「結果が更新されました」（何試合かは問わずその日の更新をまとめる）。
 */
export function buildEventResultUpdatedContent(params: {
  eventId: string;
  eventTitle: string;
}): NotificationContent {
  return {
    title: "結果が更新されました",
    body: `「${params.eventTitle}」の結果・順位が更新されました。`,
    linkUrl: `/events/${params.eventId}/watch`,
  };
}
