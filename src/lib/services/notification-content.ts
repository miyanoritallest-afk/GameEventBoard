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
  /** 応募が却下された（3.7 の #2）。宛先=応募者本人・直接関係者。 */
  RegistrationRejected: "registration_rejected",
  /** チームが承認された（self確定→成立・3.7 の #3）。宛先=チーム関係者・直接関係者。 */
  TeamApproved: "team_approved",
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
  /**
   * シリーズ運営に招待された（3.7 の #11）。宛先=招待相手本人・直接関係者
   * （フォロー集約不要・宛先を直接引いて notifications を生成）。
   */
  SeriesMemberInvited: "series_member_invited",
  /**
   * 試合が始まる（開始2時間前リマインド・3.7 の #7）。宛先=出場チームのメンバー
   * （個人・直接関係者）。Cron が相対発火（⑦）。アプリ内通知（⑤DM は後続）。
   */
  MatchStartingSoon: "match_starting_soon",
  /**
   * 「本日◯時から各試合」（3.7 の #9）。宛先=全体（告知チャンネルへ Webhook 投稿）。
   * Cron が1日1回発火（④のインフラ流用・⑦）。
   */
  EventMatchesToday: "event_matches_today",
  /**
   * スクリム/練習の予定が登録/変更された（3.7 の #10）。宛先=そのチームのメンバー
   * （個人・直接関係者）。登録/編集した本人は宛先から除外する。アプリ内通知（⑤DM は後続）。
   */
  ScrimScheduled: "scrim_scheduled",
  /**
   * スクリム/練習が始まる（開始2時間前リマインド・3.7 の #8）。宛先=そのチームのメンバー
   * （個人・直接関係者）。#10 と違い登録者も含め全メンバーへ（当日リマインドは本人も対象）。
   * Cron が相対発火（⑦）。アプリ内通知（⑤DM は後続）。試合の #7 と type を分ける。
   */
  ScrimStartingSoon: "scrim_starting_soon",
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
 * #2 応募却下の文面。宛先は応募者本人。link 先は該当イベントページ。
 * 却下は否定的な結果だが、文面はサーバー固定で淡々と（主催者が文言を編集する領域ではない）。
 */
export function buildRegistrationRejectedContent(params: {
  eventId: string;
  eventTitle: string;
}): NotificationContent {
  return {
    title: "応募が承認されませんでした",
    body: `「${params.eventTitle}」への応募は今回は承認されませんでした。`,
    linkUrl: `/events/${params.eventId}`,
  };
}

/**
 * #3 チーム承認（self 確定→成立）。宛先はチームメンバー全員（直接関係者）。
 * link 先はイベントページ。チーム名・イベント名は通知時点の値。
 */
export function buildTeamApprovedContent(params: {
  eventId: string;
  eventTitle: string;
  teamName: string;
}): NotificationContent {
  return {
    title: "チームが承認されました",
    body: `「${params.eventTitle}」でチーム「${params.teamName}」の参加が承認されました。`,
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

/**
 * #11 シリーズ運営への招待。宛先は招待相手本人（直接関係者）。
 * link 先はシリーズ詳細（そこで承認/拒否できる）。招待者名・シリーズ名は通知時点の値を渡す。
 */
export function buildSeriesMemberInvitedContent(params: {
  seriesId: string;
  seriesName: string;
  inviterName: string;
}): NotificationContent {
  return {
    title: "シリーズ運営に招待されました",
    body: `${params.inviterName}さんが「${params.seriesName}」の運営に招待しました。`,
    linkUrl: `/series/${params.seriesId}`,
  };
}

/**
 * ④ Discord 全体告知（Webhook 投稿）の本文を組み立てる純粋関数。
 * 「新しい開催回が公開された」告知を、告知チャンネル向けの1メッセージにする
 * （アプリ内通知の宛先集約とは別レイヤー＝チャンネルに1回投稿する全体向け）。
 *
 * eventUrl は**絶対URL**（Discord のメッセージから踏めるよう呼び出し側が baseUrl と結合して渡す）。
 * イベント名・主催者名は通知時点の値。Discord の content は最大2000字だが、ここは短文なので
 * 上限は気にしない（呼び出し側の値も title/name はフォーム側で長さ制限済み）。
 */
export function buildEventAnnounceWebhookContent(params: {
  eventTitle: string;
  organizerName: string;
  eventUrl: string;
}): string {
  return [
    `📢 **新しいイベントが公開されました**`,
    `**${params.eventTitle}**（主催: ${params.organizerName}）`,
    params.eventUrl,
  ].join("\n");
}

/**
 * UTC(ISO) を JST の「M/D HH:mm」表示に整形する（通知文面用の共通ヘルパ）。
 * 純粋関数（Intl 依存のみ・副作用なし）。null は "未定"。
 */
export function fmtJstDateTime(iso: string | null): string {
  if (!iso) return "未定";
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * #7 試合開始2時間前リマインド。宛先は出場チームのメンバー（個人・アプリ内）。
 * link 先は観戦ビュー（試合の詳細に近い導線）。開始時刻は JST 表示で本文に混ぜる。
 */
export function buildMatchStartingSoonContent(params: {
  eventId: string;
  eventTitle: string;
  scheduledAt: string;
}): NotificationContent {
  return {
    title: "まもなく試合が始まります",
    body: `「${params.eventTitle}」の試合が ${fmtJstDateTime(
      params.scheduledAt,
    )} に始まります（開始2時間前）。`,
    linkUrl: `/events/${params.eventId}/watch`,
  };
}

/**
 * #9 「本日◯時から各試合」の全体告知（Webhook）。宛先は告知チャンネル。
 * 本日そのイベントで最初に始まる試合の時刻を載せる（「本日 HH:mm から各試合！」）。
 * eventUrl は絶対URL（呼び出し側が baseUrl と結合して渡す）。
 */
export function buildEventMatchesTodayWebhookContent(params: {
  eventTitle: string;
  firstMatchAt: string;
  eventUrl: string;
}): string {
  return [
    `⏰ **本日の試合**`,
    `**${params.eventTitle}** は本日 ${fmtJstDateTime(
      params.firstMatchAt,
    )} から試合があります！`,
    params.eventUrl,
  ].join("\n");
}

/** スクリム種別の日本語表示（文面用）。scrim=スクリム / practice=練習。 */
function scrimKindLabel(kind: "scrim" | "practice"): string {
  return kind === "practice" ? "練習" : "スクリム";
}

/**
 * #10 スクリム/練習の予定登録・変更。宛先はそのチームのメンバー（個人・直接関係者）。
 * 種別（スクリム/練習）と開始時刻(JST)を本文に混ぜる。link 先はチームの日程ページ。
 * チーム名は通知時点の値。登録と編集で文面を出し分ける（changed で「追加」/「変更」）。
 */
export function buildScrimScheduledContent(params: {
  eventId: string;
  teamName: string;
  kind: "scrim" | "practice";
  scheduledAt: string;
  changed?: boolean;
}): NotificationContent {
  const label = scrimKindLabel(params.kind);
  const verb = params.changed ? "変更されました" : "追加されました";
  return {
    title: params.changed
      ? `${label}の予定が変更されました`
      : `新しい${label}の予定が追加されました`,
    body: `チーム「${params.teamName}」に ${fmtJstDateTime(
      params.scheduledAt,
    )} の${label}の予定が${verb}。`,
    linkUrl: `/events/${params.eventId}/schedule`,
  };
}

/**
 * #8 スクリム/練習の開始2時間前リマインド。宛先はそのチームのメンバー（個人・アプリ内）。
 * 種別（スクリム/練習）と開始時刻(JST)を本文に混ぜる。link 先はチームの日程ページ。
 * 試合の #7 と type を分け、文面を出し分ける（要件定義書 3.7）。チーム名は通知時点の値。
 */
export function buildScrimStartingSoonContent(params: {
  eventId: string;
  teamName: string;
  kind: "scrim" | "practice";
  scheduledAt: string;
}): NotificationContent {
  const label = scrimKindLabel(params.kind);
  return {
    title: `まもなく${label}が始まります`,
    body: `チーム「${params.teamName}」の${label}が ${fmtJstDateTime(
      params.scheduledAt,
    )} に始まります（開始2時間前）。`,
    linkUrl: `/events/${params.eventId}/schedule`,
  };
}
