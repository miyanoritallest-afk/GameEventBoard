import { describe, it, expect } from "vitest";
import {
  canPublish,
  canViewEvent,
  publishRejectionReason,
  type EventStatus,
} from "../event-status";

/**
 * 状態遷移ロジックの単体テスト（純粋関数なので副作用なしで網羅できる）。
 * 本 PR の対象は「公開」= draft → published の1遷移。
 */

describe("canPublish", () => {
  it("draft からは公開できる", () => {
    expect(canPublish("draft")).toBe(true);
  });

  it("draft 以外からは公開できない", () => {
    const others: EventStatus[] = [
      "published",
      "recruiting",
      "closed",
      "ongoing",
      "finished",
    ];
    for (const s of others) {
      expect(canPublish(s)).toBe(false);
    }
  });
});

describe("publishRejectionReason", () => {
  it("公開済み・募集中は『すでに公開』メッセージ", () => {
    expect(publishRejectionReason("published")).toContain("すでに公開");
    expect(publishRejectionReason("recruiting")).toContain("すでに公開");
  });

  it("公開フェーズを過ぎた状態は『公開できる状態ではない』メッセージ", () => {
    for (const s of ["closed", "ongoing", "finished"] as EventStatus[]) {
      expect(publishRejectionReason(s)).toContain("公開できる状態ではありません");
    }
  });
});

describe("canViewEvent", () => {
  const OWNER = "owner-id";
  const OTHER = "other-id";

  it("公開済み（draft 以外）は誰でも閲覧可（未ログイン含む）", () => {
    for (const s of [
      "published",
      "recruiting",
      "closed",
      "ongoing",
      "finished",
    ] as EventStatus[]) {
      expect(canViewEvent(s, OWNER, null)).toBe(true);
      expect(canViewEvent(s, OWNER, OTHER)).toBe(true);
    }
  });

  it("下書きは主催者本人のみ閲覧可", () => {
    expect(canViewEvent("draft", OWNER, OWNER)).toBe(true);
  });

  it("下書きは他人・未ログインには見せない", () => {
    expect(canViewEvent("draft", OWNER, OTHER)).toBe(false);
    expect(canViewEvent("draft", OWNER, null)).toBe(false);
  });
});
