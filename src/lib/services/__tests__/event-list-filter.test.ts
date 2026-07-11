import { describe, it, expect } from "vitest";
import {
  normalizeTab,
  normalizeSort,
  statusesForTab,
  countByTab,
  statusTone,
  TAB_LABEL,
  normalizeMyTab,
  statusesForMyTab,
  countByMyTab,
  MY_TAB_LABEL,
} from "../event-list-filter";
import type { EventStatus } from "../event-status";

/**
 * イベント一覧のフィルタ・並び替え・状態表示ロジックの単体テスト（純粋関数）。
 * URL クエリ由来の値を安全な既定値へ丸める normalize と、タブ↔status 群の対応を固定する。
 */

describe("normalizeTab", () => {
  it("既知のタブはそのまま通す", () => {
    expect(normalizeTab("recruiting")).toBe("recruiting");
    expect(normalizeTab("ongoing")).toBe("ongoing");
    expect(normalizeTab("finished")).toBe("finished");
  });

  it("未知・未指定・不正値は既定タブ all に丸める（URL クエリの安全弁）", () => {
    expect(normalizeTab(undefined)).toBe("all");
    expect(normalizeTab("all")).toBe("all");
    expect(normalizeTab("")).toBe("all");
    expect(normalizeTab("'; DROP TABLE events; --")).toBe("all");
    expect(normalizeTab("draft")).toBe("all"); // 下書きは一覧に出さない
  });
});

describe("normalizeSort", () => {
  it("new はそのまま、それ以外は既定 soon に丸める", () => {
    expect(normalizeSort("new")).toBe("new");
    expect(normalizeSort("soon")).toBe("soon");
    expect(normalizeSort(undefined)).toBe("soon");
    expect(normalizeSort("bogus")).toBe("soon");
  });
});

describe("statusesForTab", () => {
  it("all は空配列（絞り込みなし）", () => {
    expect(statusesForTab("all")).toEqual([]);
  });

  it("募集中 = published / recruiting", () => {
    expect(statusesForTab("recruiting")).toEqual(["published", "recruiting"]);
  });

  it("開催中 = closed / ongoing", () => {
    expect(statusesForTab("ongoing")).toEqual(["closed", "ongoing"]);
  });

  it("終了 = finished", () => {
    expect(statusesForTab("finished")).toEqual(["finished"]);
  });

  it("draft はどのタブにも含まれない（一覧の母集合は公開状態のみ）", () => {
    const allTabStatuses = [
      ...statusesForTab("recruiting"),
      ...statusesForTab("ongoing"),
      ...statusesForTab("finished"),
    ];
    expect(allTabStatuses).not.toContain("draft");
  });
});

describe("countByTab", () => {
  it("各タブに status を振り分けて数える。all は全件", () => {
    const statuses: EventStatus[] = [
      "published",
      "recruiting",
      "closed",
      "ongoing",
      "finished",
      "finished",
    ];
    const counts = countByTab(statuses);
    expect(counts.all).toBe(6);
    expect(counts.recruiting).toBe(2); // published + recruiting
    expect(counts.ongoing).toBe(2); // closed + ongoing
    expect(counts.finished).toBe(2);
  });

  it("空配列なら全て 0", () => {
    const counts = countByTab([]);
    expect(counts).toEqual({ all: 0, recruiting: 0, ongoing: 0, finished: 0 });
  });

  it("タブ件数の合計（all 除く）は全件数に一致する（振り分けの網羅性）", () => {
    const statuses: EventStatus[] = [
      "published",
      "closed",
      "ongoing",
      "finished",
    ];
    const c = countByTab(statuses);
    expect(c.recruiting + c.ongoing + c.finished).toBe(c.all);
  });
});

describe("statusTone", () => {
  it("募集受付中は success、開催中は live、締切は warning、終了は muted", () => {
    expect(statusTone("published")).toBe("success");
    expect(statusTone("recruiting")).toBe("success");
    expect(statusTone("ongoing")).toBe("live");
    expect(statusTone("closed")).toBe("warning");
    expect(statusTone("finished")).toBe("muted");
  });

  it("下書きは draft トーン（自分のイベント一覧でのみ現れる）", () => {
    expect(statusTone("draft")).toBe("draft");
  });
});

describe("TAB_LABEL", () => {
  it("4タブの日本語ラベルが揃っている", () => {
    expect(TAB_LABEL.all).toBe("すべて");
    expect(TAB_LABEL.recruiting).toBe("募集中");
    expect(TAB_LABEL.ongoing).toBe("開催中");
    expect(TAB_LABEL.finished).toBe("終了");
  });
});

/* ── 自分のイベント一覧（/events/mine）専用のフィルタ ── */

describe("normalizeMyTab", () => {
  it("既知のタブ（draft/open/ended）はそのまま通す", () => {
    expect(normalizeMyTab("draft")).toBe("draft");
    expect(normalizeMyTab("open")).toBe("open");
    expect(normalizeMyTab("ended")).toBe("ended");
  });

  it("未知・未指定・不正値は既定タブ all に丸める", () => {
    expect(normalizeMyTab(undefined)).toBe("all");
    expect(normalizeMyTab("all")).toBe("all");
    expect(normalizeMyTab("")).toBe("all");
    expect(normalizeMyTab("recruiting")).toBe("all"); // /events 用の値は無効
    expect(normalizeMyTab("'; DROP TABLE events; --")).toBe("all");
  });
});

describe("statusesForMyTab", () => {
  it("all は空配列（絞り込みなし）", () => {
    expect(statusesForMyTab("all")).toEqual([]);
  });

  it("下書き = draft のみ", () => {
    expect(statusesForMyTab("draft")).toEqual(["draft"]);
  });

  it("公開中 = published / recruiting / closed / ongoing（下書き・終了以外）", () => {
    expect(statusesForMyTab("open")).toEqual([
      "published",
      "recruiting",
      "closed",
      "ongoing",
    ]);
  });

  it("終了 = finished", () => {
    expect(statusesForMyTab("ended")).toEqual(["finished"]);
  });
});

describe("countByMyTab", () => {
  it("各タブに status を振り分けて数える。all は全件・draft を含む", () => {
    const statuses: EventStatus[] = [
      "draft",
      "draft",
      "published",
      "recruiting",
      "closed",
      "ongoing",
      "finished",
    ];
    const counts = countByMyTab(statuses);
    expect(counts.all).toBe(7);
    expect(counts.draft).toBe(2);
    expect(counts.open).toBe(4); // published + recruiting + closed + ongoing
    expect(counts.ended).toBe(1);
  });

  it("空配列なら全て 0", () => {
    expect(countByMyTab([])).toEqual({ all: 0, draft: 0, open: 0, ended: 0 });
  });

  it("タブ件数の合計（all 除く）は全件数に一致する（振り分けの網羅性）", () => {
    const statuses: EventStatus[] = [
      "draft",
      "published",
      "ongoing",
      "finished",
    ];
    const c = countByMyTab(statuses);
    expect(c.draft + c.open + c.ended).toBe(c.all);
  });
});

describe("MY_TAB_LABEL", () => {
  it("4タブの日本語ラベルが揃っている", () => {
    expect(MY_TAB_LABEL.all).toBe("すべて");
    expect(MY_TAB_LABEL.draft).toBe("下書き");
    expect(MY_TAB_LABEL.open).toBe("公開中");
    expect(MY_TAB_LABEL.ended).toBe("終了");
  });
});
