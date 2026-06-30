import { describe, it, expect } from "vitest";
import {
  hasGroupStage,
  hasTournamentStage,
  eventFormatLabel,
  groupStageLabel,
  tournamentStageLabel,
  type EventFormat,
} from "../event-format";

/**
 * イベント形式の出し分けロジックの単体テスト（純粋関数）。
 * 3形式 × 2ステージ（予選/決勝T）の真理値を網羅する。
 */

const ALL_FORMATS: EventFormat[] = [
  "round_robin",
  "tournament",
  "round_robin_then_tournament",
];

describe("hasGroupStage", () => {
  it("総当たりを含む形式は予選あり", () => {
    expect(hasGroupStage("round_robin")).toBe(true);
    expect(hasGroupStage("round_robin_then_tournament")).toBe(true);
  });

  it("トーナメントのみは予選なし", () => {
    expect(hasGroupStage("tournament")).toBe(false);
  });
});

describe("hasTournamentStage", () => {
  it("トーナメントを含む形式は決勝Tあり", () => {
    expect(hasTournamentStage("tournament")).toBe(true);
    expect(hasTournamentStage("round_robin_then_tournament")).toBe(true);
  });

  it("総当たりのみは決勝Tなし", () => {
    expect(hasTournamentStage("round_robin")).toBe(false);
  });
});

describe("ステージの組み合わせ", () => {
  it("どの形式も予選・決勝Tの少なくとも一方は持つ（空の形式はない）", () => {
    for (const f of ALL_FORMATS) {
      expect(hasGroupStage(f) || hasTournamentStage(f)).toBe(true);
    }
  });

  it("round_robin_then_tournament だけが両ステージを持つ", () => {
    const both = ALL_FORMATS.filter(
      (f) => hasGroupStage(f) && hasTournamentStage(f),
    );
    expect(both).toEqual(["round_robin_then_tournament"]);
  });
});

describe("groupStageLabel", () => {
  it("決勝Tを後段に持つ形式では『予選』", () => {
    expect(groupStageLabel("round_robin_then_tournament")).toBe("予選");
  });

  it("総当たりで完結する形式では『総当たり』", () => {
    expect(groupStageLabel("round_robin")).toBe("総当たり");
  });
});

describe("tournamentStageLabel", () => {
  it("前段に予選を持つ形式では『決勝トーナメント』", () => {
    expect(tournamentStageLabel("round_robin_then_tournament")).toBe(
      "決勝トーナメント",
    );
  });

  it("トーナメント単独の形式では『トーナメント』", () => {
    expect(tournamentStageLabel("tournament")).toBe("トーナメント");
  });
});

describe("eventFormatLabel", () => {
  it("全形式に日本語ラベルがある", () => {
    for (const f of ALL_FORMATS) {
      expect(eventFormatLabel(f)).toBeTruthy();
    }
  });

  it("形式ごとに表記が異なる", () => {
    const labels = ALL_FORMATS.map(eventFormatLabel);
    expect(new Set(labels).size).toBe(ALL_FORMATS.length);
  });
});
