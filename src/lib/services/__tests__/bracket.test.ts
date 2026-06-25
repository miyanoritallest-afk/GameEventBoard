import { describe, it, expect } from "vitest";
import {
  bracketSize,
  seedOrder,
  generateBracket,
  extractSeededTeams,
  type SeedTeam,
  type BracketMatch,
} from "../bracket";

/**
 * 決勝トーナメント（シングルエリミ）ブラケット生成の単体テスト。
 * 確定仕様（要件定義書 3.4.1 / 本戦-5a 壁打ち）を手計算値で固定する。
 */

describe("bracketSize — 進出数以上の最小2の累乗", () => {
  it("2の累乗はそのまま", () => {
    expect(bracketSize(2)).toBe(2);
    expect(bracketSize(4)).toBe(4);
    expect(bracketSize(8)).toBe(8);
  });

  it("中途半端な数は次の2の累乗へ切り上げ", () => {
    expect(bracketSize(3)).toBe(4);
    expect(bracketSize(5)).toBe(8);
    expect(bracketSize(6)).toBe(8);
    expect(bracketSize(9)).toBe(16);
  });

  it("1以下は1（防御）", () => {
    expect(bracketSize(1)).toBe(1);
    expect(bracketSize(0)).toBe(1);
  });
});

describe("seedOrder — 標準シードの並び", () => {
  it("size=2 は [1,2]", () => {
    expect(seedOrder(2)).toEqual([1, 2]);
  });

  it("size=4 は [1,4,2,3]（1vs4 上半分, 2vs3 下半分）", () => {
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
  });

  it("size=8 は [1,8,4,5,2,7,3,6]", () => {
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it("1位と2位は反対の山に入る（最後の決勝で当たる）", () => {
    const order = seedOrder(8);
    const pos1 = order.indexOf(1);
    const pos2 = order.indexOf(2);
    // 上半分(0..3) と 下半分(4..7) に分かれる。
    expect(pos1 < 4).toBe(true);
    expect(pos2 >= 4).toBe(true);
  });
});

describe("generateBracket — 2の累乗（BYEなし）", () => {
  it("4チーム: 1回戦2試合＋決勝1試合、シード配置どおり", () => {
    const teams = ["s1", "s2", "s3", "s4"]; // シード順
    const b = generateBracket(teams);
    // order=[1,4,2,3] → 1回戦: 1vs4(上半分), 2vs3(下半分) / 決勝: 未確定
    expect(b).toEqual<BracketMatch[]>([
      { round: 1, position: 0, teamAId: "s1", teamBId: "s4" },
      { round: 1, position: 1, teamAId: "s2", teamBId: "s3" },
      { round: 2, position: 0, teamAId: null, teamBId: null },
    ]);
  });

  it("8チーム: 1回戦4・準決勝2・決勝1の計7試合", () => {
    const teams = Array.from({ length: 8 }, (_, i) => `s${i + 1}`);
    const b = generateBracket(teams);
    const byRound = (r: number) => b.filter((m) => m.round === r).length;
    expect(byRound(1)).toBe(4);
    expect(byRound(2)).toBe(2);
    expect(byRound(3)).toBe(1);
    expect(b.length).toBe(7);
    // 1回戦の先頭は seedOrder の [1,8] → s1 vs s8。
    expect(b[0]).toEqual({
      round: 1,
      position: 0,
      teamAId: "s1",
      teamBId: "s8",
    });
  });
});

describe("generateBracket — BYE（不戦勝）あり", () => {
  it("6チーム8枠: 上位2シードが1回戦BYE→準決勝へ自動進出", () => {
    const teams = ["s1", "s2", "s3", "s4", "s5", "s6"]; // 6チーム → size 8
    const b = generateBracket(teams);

    // size=8, seedOrder=[1,8,4,5,2,7,3,6]。7,8番はBYE(null)。
    // 1回戦: (1,8)→s1 BYE / (4,5)=s4vs s5 / (2,7)→s2 BYE / (3,6)=s3vs s6
    const r1 = b.filter((m) => m.round === 1);
    expect(r1[0]).toEqual({ round: 1, position: 0, teamAId: "s1", teamBId: null });
    expect(r1[1]).toEqual({ round: 1, position: 1, teamAId: "s4", teamBId: "s5" });
    expect(r1[2]).toEqual({ round: 1, position: 2, teamAId: "s2", teamBId: null });
    expect(r1[3]).toEqual({ round: 1, position: 3, teamAId: "s3", teamBId: "s6" });

    // 準決勝(round2): pos0 は r1[0](s1 BYE)とr1[1](実試合)から → s1 自動進出・相手待ち。
    const r2 = b.filter((m) => m.round === 2);
    expect(r2[0]).toEqual({ round: 2, position: 0, teamAId: "s1", teamBId: null });
    // pos1 は r1[2](s2 BYE)とr1[3](実試合)から → s2 自動進出・相手待ち。
    expect(r2[1]).toEqual({ round: 2, position: 1, teamAId: "s2", teamBId: null });

    // 決勝(round3)は未確定。
    expect(b.filter((m) => m.round === 3)).toEqual([
      { round: 3, position: 0, teamAId: null, teamBId: null },
    ]);
  });

  it("3チーム4枠: 1位がBYE、2vs3が1回戦、決勝で合流", () => {
    const teams = ["s1", "s2", "s3"];
    const b = generateBracket(teams);
    // size=4, seedOrder=[1,4,2,3]。4番はBYE。
    const r1 = b.filter((m) => m.round === 1);
    expect(r1[0]).toEqual({ round: 1, position: 0, teamAId: "s1", teamBId: null });
    expect(r1[1]).toEqual({ round: 1, position: 1, teamAId: "s2", teamBId: "s3" });
    // 決勝: s1 自動進出、相手は s2vs s3 の勝者待ち。
    expect(b.filter((m) => m.round === 2)).toEqual([
      { round: 2, position: 0, teamAId: "s1", teamBId: null },
    ]);
  });
});

describe("generateBracket — 端ケース", () => {
  it("2チームは決勝1試合のみ", () => {
    expect(generateBracket(["a", "b"])).toEqual([
      { round: 1, position: 0, teamAId: "a", teamBId: "b" },
    ]);
  });

  it("1チーム以下は空（不成立）", () => {
    expect(generateBracket(["only"])).toEqual([]);
    expect(generateBracket([])).toEqual([]);
  });
});

describe("extractSeededTeams — 進出抽出とシード順", () => {
  function team(
    teamId: string,
    groupId: string,
    rank: number,
    points: number,
    mapDiff = 0,
    potg = 0,
  ): SeedTeam {
    return { teamId, groupId, rank, points, mapDiff, potg };
  }

  it("各ブロック上位2を抽出し、シード群(rank)→群内は勝点降順で並べる", () => {
    const teams = [
      team("A1", "A", 1, 9),
      team("A2", "A", 2, 6),
      team("A3", "A", 3, 3), // 進出外
      team("B1", "B", 1, 7),
      team("B2", "B", 2, 5),
      team("B3", "B", 3, 1), // 進出外
    ];
    const seeded = extractSeededTeams(teams, 2);
    // 1群(rank1): A1(9) > B1(7) / 2群(rank2): A2(6) > B2(5)
    expect(seeded).toEqual(["A1", "B1", "A2", "B2"]);
  });

  it("rank が同着で N を超えても全員進出する", () => {
    const teams = [
      team("A1", "A", 1, 9),
      team("A2a", "A", 2, 5),
      team("A2b", "A", 2, 5), // 2位同着
      team("B1", "B", 1, 8),
    ];
    // advanceCount=2 だが A は 2 位が 2 チーム同着 → 両方進出。
    const seeded = extractSeededTeams(teams, 2);
    expect(seeded).toContain("A2a");
    expect(seeded).toContain("A2b");
    expect(seeded.length).toBe(4);
    // 先頭2つは1群（A1,B1の順＝9>8）。
    expect(seeded.slice(0, 2)).toEqual(["A1", "B1"]);
  });

  it("群内タイブレーク: 勝点同じなら得失→POTGの降順", () => {
    const teams = [
      team("A1", "A", 1, 6, 5, 2),
      team("B1", "B", 1, 6, 5, 3), // 勝点・得失同じ、POTG多い
      team("C1", "C", 1, 6, 8, 0), // 得失が一番大きい
    ];
    const seeded = extractSeededTeams(teams, 1);
    // 勝点同→得失降順: C1(8) 先頭。A1とB1は得失同→POTG降順: B1(3)>A1(2)。
    expect(seeded).toEqual(["C1", "B1", "A1"]);
  });

  it("進出数を満たすチームがいなければ空", () => {
    const teams = [team("A3", "A", 3, 1)];
    expect(extractSeededTeams(teams, 2)).toEqual([]);
  });
});
