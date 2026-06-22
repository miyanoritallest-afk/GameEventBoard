import { describe, it, expect } from "vitest";
import {
  effectiveScore,
  teamScore,
  isOverCap,
  swapCandidates,
  type MemberScore,
} from "../team-score";

/**
 * チームスコア算出ロジックの単体テスト（純粋関数なので副作用なしで網羅できる）。
 * 正の仕様は DB設計書 4.2 / 4.3。
 */

function m(
  id: string,
  position: "regular" | "reserve",
  finalScore: number | null,
  overrideScore: number | null = null,
): MemberScore {
  return { id, position, finalScore, overrideScore };
}

describe("effectiveScore", () => {
  it("override があれば override を優先する", () => {
    expect(effectiveScore(m("a", "regular", 20, 25))).toBe(25);
  });

  it("override が null なら final を使う", () => {
    expect(effectiveScore(m("a", "regular", 20, null))).toBe(20);
  });

  it("両方 null なら null", () => {
    expect(effectiveScore(m("a", "regular", null, null))).toBeNull();
  });

  it("override が 0 でも override を採用する（0 は有効値）", () => {
    expect(effectiveScore(m("a", "regular", 20, 0))).toBe(0);
  });
});

describe("teamScore", () => {
  it("regular の実効スコア平均を返す（reserve は含めない）", () => {
    const members = [
      m("a", "regular", 27),
      m("b", "regular", 22),
      m("c", "regular", 20),
      m("r", "reserve", 31), // 平均に含めない
    ];
    expect(teamScore(members)).toBe((27 + 22 + 20) / 3);
  });

  it("override を優先して平均する", () => {
    const members = [
      m("a", "regular", 20, 30), // 実効 30
      m("b", "regular", 10), // 実効 10
    ];
    expect(teamScore(members)).toBe(20);
  });

  it("スコア不明（実効 null）の regular は平均から除外する", () => {
    const members = [
      m("a", "regular", 20),
      m("b", "regular", null), // 除外
    ];
    expect(teamScore(members)).toBe(20);
  });

  it("出場メンバーが 0 人なら null", () => {
    expect(teamScore([m("r", "reserve", 31)])).toBeNull();
  });

  it("全員スコア不明なら null", () => {
    expect(teamScore([m("a", "regular", null)])).toBeNull();
  });
});

describe("isOverCap", () => {
  it("score が cap を超えていれば true", () => {
    expect(isOverCap(23.6, 23.0)).toBe(true);
  });

  it("score が cap 以内なら false（等しい場合も含む）", () => {
    expect(isOverCap(22.4, 23.0)).toBe(false);
    expect(isOverCap(23.0, 23.0)).toBe(false);
  });

  it("cap 未設定（null）なら常に false（上限なし）", () => {
    expect(isOverCap(100, null)).toBe(false);
  });

  it("score が null（出場者なし等）なら false", () => {
    expect(isOverCap(null, 23.0)).toBe(false);
  });
});

describe("swapCandidates", () => {
  // レギュラー: a=27, b=22, c=20（平均 23.0）/ リザーブ: r=18
  const members = [
    m("a", "regular", 27),
    m("b", "regular", 22),
    m("c", "regular", 20),
    m("r", "reserve", 18),
  ];

  it("各レギュラーと交代した場合のスコアを全候補返す", () => {
    const cands = swapCandidates(members, "r", 23.0);
    expect(cands).toHaveLength(3); // a/b/c の3通り
    const byOut = Object.fromEntries(cands.map((c) => [c.outId, c]));
    // a を r に交代: (18+22+20)/3 = 20.0
    expect(byOut.a.newTeamScore).toBeCloseTo(20.0);
    expect(byOut.a.withinCap).toBe(true);
    // b を r に交代: (27+18+20)/3 ≈ 21.67
    expect(byOut.b.newTeamScore).toBeCloseTo(65 / 3);
    expect(byOut.b.withinCap).toBe(true);
  });

  it("交代後に cap 超過する候補は withinCap=false", () => {
    // 高スコアのリザーブを出すと超過するケース
    const withHighReserve = [
      m("a", "regular", 20),
      m("b", "regular", 20),
      m("c", "regular", 20),
      m("hr", "reserve", 40),
    ];
    const cands = swapCandidates(withHighReserve, "hr", 23.0);
    // どれと交代しても (40+20+20)/3 ≈ 26.67 > 23.0
    for (const c of cands) {
      expect(c.newTeamScore).toBeCloseTo(80 / 3);
      expect(c.withinCap).toBe(false);
    }
  });

  it("cap 未設定なら全候補 withinCap=true", () => {
    const cands = swapCandidates(members, "r", null);
    expect(cands.every((c) => c.withinCap)).toBe(true);
  });

  it("存在しないリザーブ id なら空配列", () => {
    expect(swapCandidates(members, "nope", 23.0)).toEqual([]);
  });
});
