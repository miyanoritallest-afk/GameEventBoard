import { describe, it, expect } from "vitest";
import {
  NotificationType,
  buildRegistrationApprovedContent,
  buildSeriesSeasonAnnouncedContent,
  buildEventScheduleConfirmedContent,
  buildEventResultUpdatedContent,
  buildSeriesMemberInvitedContent,
  buildEventAnnounceWebhookContent,
  buildMatchStartingSoonContent,
  buildEventMatchesTodayWebhookContent,
  buildRegistrationRejectedContent,
  buildTeamApprovedContent,
  buildScrimScheduledContent,
  buildScrimStartingSoonContent,
  fmtJstDateTime,
} from "../notification-content";

/**
 * 通知の文面生成（純粋関数）の単体テスト。
 * 文面はサーバー固定生成なので、type と文言・link を固定する。
 */

describe("NotificationType", () => {
  it("応募承認の type 文字列は要件定義書 3.7 の registration_approved", () => {
    expect(NotificationType.RegistrationApproved).toBe("registration_approved");
  });
});

describe("buildRegistrationApprovedContent", () => {
  it("イベント名を本文に埋め込み、link はイベントページを指す", () => {
    const c = buildRegistrationApprovedContent({
      eventId: "e-123",
      eventTitle: "OSL Season2",
    });
    expect(c.title).toBe("応募が承認されました");
    expect(c.body).toContain("OSL Season2");
    expect(c.linkUrl).toBe("/events/e-123");
  });

  it("イベント名が入力由来でも文面はサーバー固定の枠に収まる（title は固定）", () => {
    const c = buildRegistrationApprovedContent({
      eventId: "e-9",
      eventTitle: "<script>alert(1)</script>",
    });
    // title は固定文言（イベント名を混ぜない）。body の name は React 側で自動エスケープされる。
    expect(c.title).toBe("応募が承認されました");
    expect(c.linkUrl).toBe("/events/e-9");
  });
});

describe("buildRegistrationRejectedContent (#2)", () => {
  it("却下の固定 title・イベント名を本文に埋め、link はイベントページ", () => {
    const c = buildRegistrationRejectedContent({
      eventId: "e-2",
      eventTitle: "OSL Season2",
    });
    expect(c.title).toBe("応募が承認されませんでした");
    expect(c.body).toContain("OSL Season2");
    expect(c.linkUrl).toBe("/events/e-2");
  });
});

describe("buildTeamApprovedContent (#3)", () => {
  it("チーム名・イベント名を本文に埋め、link はイベントページ", () => {
    const c = buildTeamApprovedContent({
      eventId: "e-3",
      eventTitle: "OSL Season2",
      teamName: "チームA",
    });
    expect(c.title).toBe("チームが承認されました");
    expect(c.body).toContain("OSL Season2");
    expect(c.body).toContain("チームA");
    expect(c.linkUrl).toBe("/events/e-3");
  });
});

describe("NotificationType.SeriesSeasonAnnounced", () => {
  it("type 文字列は要件定義書 3.7 の series_season_announced", () => {
    expect(NotificationType.SeriesSeasonAnnounced).toBe(
      "series_season_announced",
    );
  });
});

describe("buildSeriesSeasonAnnouncedContent", () => {
  it("主催者名とイベント名を本文に埋め、link はイベントページを指す", () => {
    const c = buildSeriesSeasonAnnouncedContent({
      eventId: "e-1",
      eventTitle: "OSL Season3",
      organizerName: "のり",
    });
    expect(c.title).toBe("新しいイベントが公開されました");
    expect(c.body).toContain("OSL Season3");
    expect(c.body).toContain("のり");
    expect(c.linkUrl).toBe("/events/e-1");
  });
});

describe("イベントフォロワー向け type 文字列", () => {
  it("#5/#6 は 3.7 カタログの type", () => {
    expect(NotificationType.EventScheduleConfirmed).toBe(
      "event_schedule_confirmed",
    );
    expect(NotificationType.EventResultUpdated).toBe("event_result_updated");
  });
});

describe("buildEventScheduleConfirmedContent", () => {
  it("イベント名を本文に埋め、link はイベントページを指す", () => {
    const c = buildEventScheduleConfirmedContent({
      eventId: "e-2",
      eventTitle: "OSL Season2",
    });
    expect(c.title).toBe("イベントの日程が更新されました");
    expect(c.body).toContain("OSL Season2");
    expect(c.linkUrl).toBe("/events/e-2");
  });
});

describe("buildEventResultUpdatedContent", () => {
  it("イベント名を本文に埋め、link は観戦ビューを指す", () => {
    const c = buildEventResultUpdatedContent({
      eventId: "e-3",
      eventTitle: "OSL Season2",
    });
    expect(c.title).toBe("結果が更新されました");
    expect(c.body).toContain("OSL Season2");
    expect(c.linkUrl).toBe("/events/e-3/watch");
  });
});

describe("NotificationType.SeriesMemberInvited", () => {
  it("type 文字列は要件定義書 3.7 #11 の series_member_invited", () => {
    expect(NotificationType.SeriesMemberInvited).toBe("series_member_invited");
  });
});

describe("buildSeriesMemberInvitedContent", () => {
  it("招待者名とシリーズ名を本文に埋め、link はシリーズ詳細（承認先）を指す", () => {
    const c = buildSeriesMemberInvitedContent({
      seriesId: "s-1",
      seriesName: "OSL",
      inviterName: "のり",
    });
    expect(c.title).toBe("シリーズ運営に招待されました");
    expect(c.body).toContain("OSL");
    expect(c.body).toContain("のり");
    expect(c.linkUrl).toBe("/series/s-1");
  });
});

describe("buildEventAnnounceWebhookContent", () => {
  it("イベント名・主催者名・絶対URLを含む Discord 告知文を作る", () => {
    const msg = buildEventAnnounceWebhookContent({
      eventTitle: "OSL Season3",
      organizerName: "のり",
      eventUrl: "https://example.com/events/e-1",
    });
    expect(msg).toContain("OSL Season3");
    expect(msg).toContain("のり");
    expect(msg).toContain("https://example.com/events/e-1");
    // 告知チャンネル向けの1メッセージ（改行区切りの複数行）。
    expect(msg.split("\n").length).toBeGreaterThanOrEqual(3);
  });
});

describe("fmtJstDateTime", () => {
  it("UTC を JST（+9h）で M/D HH:mm に整形する", () => {
    // 2026-07-03T12:00Z → JST 21:00
    const s = fmtJstDateTime("2026-07-03T12:00:00.000Z");
    expect(s).toContain("21:00");
    expect(s).toContain("7/3");
  });
  it("null は未定", () => {
    expect(fmtJstDateTime(null)).toBe("未定");
  });
});

describe("NotificationType #7/#9", () => {
  it("type 文字列は 3.7 カタログの match_starting_soon / event_matches_today", () => {
    expect(NotificationType.MatchStartingSoon).toBe("match_starting_soon");
    expect(NotificationType.EventMatchesToday).toBe("event_matches_today");
  });
});

describe("buildMatchStartingSoonContent", () => {
  it("イベント名と開始時刻(JST)を本文に埋め、link は観戦ビュー", () => {
    const c = buildMatchStartingSoonContent({
      eventId: "e-1",
      eventTitle: "OSL Season2",
      scheduledAt: "2026-07-03T12:00:00.000Z",
    });
    expect(c.title).toBe("まもなく試合が始まります");
    expect(c.body).toContain("OSL Season2");
    expect(c.body).toContain("21:00");
    expect(c.linkUrl).toBe("/events/e-1/watch");
  });
});

describe("buildEventMatchesTodayWebhookContent", () => {
  it("イベント名・最初の試合時刻(JST)・絶対URLを含む告知文を作る", () => {
    const msg = buildEventMatchesTodayWebhookContent({
      eventTitle: "OSL Season2",
      firstMatchAt: "2026-07-03T12:00:00.000Z",
      eventUrl: "https://example.com/events/e-1",
    });
    expect(msg).toContain("OSL Season2");
    expect(msg).toContain("21:00");
    expect(msg).toContain("https://example.com/events/e-1");
  });
});

describe("NotificationType.ScrimScheduled (#10)", () => {
  it("type 文字列は要件定義書 3.7 #10 の scrim_scheduled", () => {
    expect(NotificationType.ScrimScheduled).toBe("scrim_scheduled");
  });
});

describe("buildScrimScheduledContent (#10)", () => {
  it("スクリム登録: チーム名・開始時刻(JST)を本文に埋め、link は日程ページ", () => {
    const c = buildScrimScheduledContent({
      eventId: "e-10",
      teamName: "チームA",
      kind: "scrim",
      scheduledAt: "2026-07-03T12:00:00.000Z",
    });
    expect(c.title).toBe("新しいスクリムの予定が追加されました");
    expect(c.body).toContain("チームA");
    expect(c.body).toContain("21:00");
    expect(c.body).toContain("スクリム");
    expect(c.linkUrl).toBe("/events/e-10/schedule");
  });

  it("練習は文面が「練習」で出し分けられる", () => {
    const c = buildScrimScheduledContent({
      eventId: "e-10",
      teamName: "チームA",
      kind: "practice",
      scheduledAt: "2026-07-03T12:00:00.000Z",
    });
    expect(c.title).toBe("新しい練習の予定が追加されました");
    expect(c.body).toContain("練習");
    expect(c.body).not.toContain("スクリム");
  });

  it("changed=true は「変更されました」の文面になる", () => {
    const c = buildScrimScheduledContent({
      eventId: "e-10",
      teamName: "チームA",
      kind: "scrim",
      scheduledAt: "2026-07-03T12:00:00.000Z",
      changed: true,
    });
    expect(c.title).toBe("スクリムの予定が変更されました");
    expect(c.body).toContain("変更されました");
  });
});

describe("NotificationType.ScrimStartingSoon (#8)", () => {
  it("type 文字列は要件定義書 3.7 #8 の scrim_starting_soon", () => {
    expect(NotificationType.ScrimStartingSoon).toBe("scrim_starting_soon");
  });
});

describe("buildScrimStartingSoonContent (#8)", () => {
  it("スクリム: チーム名・開始時刻(JST)を本文に埋め、link は日程ページ", () => {
    const c = buildScrimStartingSoonContent({
      eventId: "e-8",
      teamName: "チームA",
      kind: "scrim",
      scheduledAt: "2026-07-03T12:00:00.000Z",
    });
    expect(c.title).toBe("まもなくスクリムが始まります");
    expect(c.body).toContain("チームA");
    expect(c.body).toContain("21:00");
    expect(c.body).toContain("スクリム");
    expect(c.body).toContain("開始2時間前");
    expect(c.linkUrl).toBe("/events/e-8/schedule");
  });

  it("練習は文面が「練習」で出し分けられる", () => {
    const c = buildScrimStartingSoonContent({
      eventId: "e-8",
      teamName: "チームA",
      kind: "practice",
      scheduledAt: "2026-07-03T12:00:00.000Z",
    });
    expect(c.title).toBe("まもなく練習が始まります");
    expect(c.body).toContain("練習");
    expect(c.body).not.toContain("スクリム");
  });
});
