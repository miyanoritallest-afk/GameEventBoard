import { describe, it, expect } from "vitest";
import {
  roundRobinPairs,
  pairKey,
  pairExists,
  type MatchPair,
} from "../round-robin";

/**
 * 総当たり組み合わせ生成の単体テスト（純粋関数なので網羅できる）。
 * 正の仕様は 要件定義書 3.4.1（予選: グループ内総当たり）。
 */

describe("roundRobinPairs", () => {
  it("4チームは 6 ペア（N×(N-1)/2）", () => {
    const pairs = roundRobinPairs(["a", "b", "c", "d"]);
    expect(pairs).toHaveLength(6);
  });

  it("5チームは 10 ペア", () => {
    expect(roundRobinPairs(["a", "b", "c", "d", "e"])).toHaveLength(10);
  });

  it("各ペアは1回ずつ・自己対戦なし", () => {
    const pairs = roundRobinPairs(["a", "b", "c"]);
    const keys = pairs.map((p) => pairKey(p.teamAId, p.teamBId));
    expect(new Set(keys).size).toBe(keys.length); // 重複なし
    expect(pairs.every((p) => p.teamAId !== p.teamBId)).toBe(true);
    expect(new Set(keys)).toEqual(new Set(["a:b", "a:c", "b:c"]));
  });

  it("入力順を保った安定な順序（i<j）", () => {
    const pairs = roundRobinPairs(["a", "b", "c"]);
    expect(pairs).toEqual<MatchPair[]>([
      { teamAId: "a", teamBId: "b" },
      { teamAId: "a", teamBId: "c" },
      { teamAId: "b", teamBId: "c" },
    ]);
  });

  it("1チーム以下は 0 ペア", () => {
    expect(roundRobinPairs(["a"])).toHaveLength(0);
    expect(roundRobinPairs([])).toHaveLength(0);
  });

  it("重複 id は一意化してから組み合わせる", () => {
    expect(roundRobinPairs(["a", "a", "b"])).toEqual<MatchPair[]>([
      { teamAId: "a", teamBId: "b" },
    ]);
  });
});

describe("pairKey", () => {
  it("順不同で同じキーになる", () => {
    expect(pairKey("a", "b")).toBe(pairKey("b", "a"));
  });
});

describe("pairExists", () => {
  const existing: MatchPair[] = [
    { teamAId: "a", teamBId: "b" },
    { teamAId: "c", teamBId: "d" },
  ];

  it("順不同で既存を検知する", () => {
    expect(pairExists(existing, "b", "a")).toBe(true);
    expect(pairExists(existing, "a", "b")).toBe(true);
  });

  it("無いペアは false", () => {
    expect(pairExists(existing, "a", "c")).toBe(false);
  });
});
