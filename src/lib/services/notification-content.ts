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
