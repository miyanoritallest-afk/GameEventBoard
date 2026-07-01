import { describe, it, expect } from "vitest";
import {
  NotificationType,
  buildRegistrationApprovedContent,
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
