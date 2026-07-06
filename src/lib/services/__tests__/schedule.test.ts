import { describe, it, expect } from "vitest";
import { buildScheduleItems, CONSUMED_GRACE_MS } from "../schedule";

/**
 * 日程正規化（純粋関数）の単体テスト。種別分類・濃淡・消化済み判定・並び順を固定する。
 */

const T = (iso: string) => iso; // 可読性用エイリアス

function scrim(over: Partial<Parameters<typeof buildScheduleItems>[0]["scrims"][number]> = {}) {
  return {
    id: "s1",
    teamId: "team-own",
    kind: "scrim" as const,
    scheduledAt: T("2026-07-10T12:00:00.000Z"),
    opponentName: "相手A",
    memo: "よろしく",
    teamName: "自チーム",
    ...over,
  };
}

function match(over: Partial<Parameters<typeof buildScheduleItems>[0]["matches"][number]> = {}) {
  return {
    id: "m1",
    scheduledAt: T("2026-07-10T13:00:00.000Z"),
    streamUrl: null,
    teamAId: "team-own",
    teamBId: "team-x",
    teamAName: "自チーム",
    teamBName: "Xチーム",
    ...over,
  };
}

describe("buildScheduleItems 種別・見出し", () => {
  it("スクリムは vs相手、練習は『練習』、公式戦は対戦カード", () => {
    const items = buildScheduleItems({
      scrims: [
        scrim({ id: "s1", kind: "scrim", opponentName: "相手A" }),
        scrim({ id: "s2", kind: "practice", opponentName: null, scheduledAt: "2026-07-10T11:00:00.000Z" }),
      ],
      matches: [match({ id: "m1" })],
      viewerTeamId: "team-own",
      now: new Date("2026-07-01T00:00:00.000Z"),
    });
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId.s1.kind).toBe("scrim");
    expect(byId.s1.title).toBe("vs 相手A");
    expect(byId.s2.kind).toBe("practice");
    expect(byId.s2.title).toBe("練習");
    expect(byId.m1.kind).toBe("match");
    expect(byId.m1.title).toBe("自チーム vs Xチーム");
  });

  it("相手なしスクリムは『スクリム』", () => {
    const items = buildScheduleItems({
      scrims: [scrim({ opponentName: null })],
      matches: [],
      viewerTeamId: "team-own",
      now: new Date("2026-07-01T00:00:00.000Z"),
    });
    expect(items[0].title).toBe("スクリム");
  });
});

describe("buildScheduleItems 濃淡（emphasis）", () => {
  it("自チームが絡む公式戦は own、絡まないは other", () => {
    const items = buildScheduleItems({
      scrims: [],
      matches: [
        match({ id: "own", teamAId: "team-own", teamBId: "team-x" }),
        match({ id: "other", teamAId: "team-y", teamBId: "team-z", scheduledAt: "2026-07-10T14:00:00.000Z" }),
      ],
      viewerTeamId: "team-own",
      now: new Date("2026-07-01T00:00:00.000Z"),
    });
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId.own.emphasis).toBe("own");
    expect(byId.other.emphasis).toBe("other");
  });

  it("viewerTeamId=null（主催者/観戦者）は全公式戦を own（濃い）にする", () => {
    const items = buildScheduleItems({
      scrims: [],
      matches: [match({ id: "m1", teamAId: "team-y", teamBId: "team-z" })],
      viewerTeamId: null,
      now: new Date("2026-07-01T00:00:00.000Z"),
    });
    expect(items[0].emphasis).toBe("own");
  });

  it("スクリム/練習は常に own・editable、公式戦は editable=false", () => {
    const items = buildScheduleItems({
      scrims: [scrim()],
      matches: [match()],
      viewerTeamId: "team-own",
      now: new Date("2026-07-01T00:00:00.000Z"),
    });
    const byKind = Object.fromEntries(items.map((i) => [i.kind, i]));
    expect(byKind.scrim.emphasis).toBe("own");
    expect(byKind.scrim.editable).toBe(true);
    expect(byKind.match.editable).toBe(false);
  });
});

describe("buildScheduleItems 消化済み（開始+2h）", () => {
  it("開始+2h ちょうどで消化済み、その手前は未消化", () => {
    const start = "2026-07-10T12:00:00.000Z";
    const justConsumed = new Date(new Date(start).getTime() + CONSUMED_GRACE_MS);
    const justBefore = new Date(justConsumed.getTime() - 1000);

    const a = buildScheduleItems({
      scrims: [scrim({ scheduledAt: start })],
      matches: [],
      viewerTeamId: "team-own",
      now: justConsumed,
    });
    expect(a[0].consumed).toBe(true);

    const b = buildScheduleItems({
      scrims: [scrim({ scheduledAt: start })],
      matches: [],
      viewerTeamId: "team-own",
      now: justBefore,
    });
    expect(b[0].consumed).toBe(false);
  });
});

describe("buildScheduleItems 並び順", () => {
  it("未消化は昇順で上、消化済みは降順で下", () => {
    const now = new Date("2026-07-10T12:00:00.000Z");
    const items = buildScheduleItems({
      scrims: [
        scrim({ id: "future-late", scheduledAt: "2026-07-12T12:00:00.000Z" }),
        scrim({ id: "future-soon", scheduledAt: "2026-07-11T12:00:00.000Z" }),
        // now-3h と now-5h（+2h 猶予を超える＝消化済み）
        scrim({ id: "past-recent", scheduledAt: "2026-07-10T07:00:00.000Z" }),
        scrim({ id: "past-old", scheduledAt: "2026-07-10T05:00:00.000Z" }),
      ],
      matches: [],
      viewerTeamId: "team-own",
      now,
    });
    expect(items.map((i) => i.id)).toEqual([
      "future-soon",
      "future-late",
      "past-recent",
      "past-old",
    ]);
  });
});
