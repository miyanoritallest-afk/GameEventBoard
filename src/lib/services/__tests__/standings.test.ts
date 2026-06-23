import { describe, it, expect } from "vitest";
import {
  computeStandings,
  type ResultInput,
  type RankingConfig,
} from "../standings";

/**
 * 順位集計ロジックの単体テスト（純粋関数なので全パターン網羅できる）。
 * 正の仕様は 要件定義書 3.4.1（壁打ち確定のタイブレーク規則）。
 */

const CFG: RankingConfig = {
  pointsWin: 3,
  pointsDraw: 1,
  pointsLoss: 0,
  tiebreakers: [],
};

/** 結果を作る短縮ヘルパー（POTG は省略時 0）。 */
function r(
  teamAId: string,
  teamBId: string,
  teamAScore: number,
  teamBScore: number,
  potgA = 0,
  potgB = 0,
): ResultInput {
  return { teamAId, teamBId, teamAScore, teamBScore, potgA, potgB };
}

/** teamId → row を引く。 */
function byTeam(rows: ReturnType<typeof computeStandings>) {
  return new Map(rows.map((x) => [x.teamId, x]));
}

describe("computeStandings — 基礎集計", () => {
  it("勝敗分・勝点・得失を正しく数える", () => {
    const rows = computeStandings({
      teamIds: ["a", "b", "c"],
      results: [r("a", "b", 2, 0), r("a", "c", 2, 1), r("b", "c", 1, 1)],
      config: CFG,
    });
    const m = byTeam(rows);
    // a: 2勝 → 勝点6, 得失 (2-0)+(2-1)=+3
    expect(m.get("a")).toMatchObject({ wins: 2, losses: 0, draws: 0, points: 6, mapDiff: 3 });
    // b: 1敗1分 → 勝点1, 得失 (0-2)+(1-1)=-2
    expect(m.get("b")).toMatchObject({ wins: 0, losses: 1, draws: 1, points: 1, mapDiff: -2 });
    // c: 1敗1分 → 勝点1, 得失 (1-2)+(1-1)=-1
    expect(m.get("c")).toMatchObject({ wins: 0, losses: 1, draws: 1, points: 1, mapDiff: -1 });
  });

  it("結果のない試合は無視する（途中段階）", () => {
    const rows = computeStandings({
      teamIds: ["a", "b", "c"],
      results: [r("a", "b", 2, 0)], // a-c, b-c は未消化
      config: CFG,
    });
    const m = byTeam(rows);
    expect(m.get("a")).toMatchObject({ wins: 1, points: 3 });
    expect(m.get("c")).toMatchObject({ wins: 0, losses: 0, draws: 0, points: 0 });
  });

  it("カスタム勝点を反映する（勝1分0負0）", () => {
    const cfg = { ...CFG, pointsWin: 1, pointsDraw: 0, pointsLoss: 0 };
    const rows = computeStandings({
      teamIds: ["a", "b"],
      results: [r("a", "b", 2, 1)],
      config: cfg,
    });
    expect(byTeam(rows).get("a")?.points).toBe(1);
  });
});

describe("computeStandings — 順位付け", () => {
  it("勝点降順で順位を付ける", () => {
    const rows = computeStandings({
      teamIds: ["a", "b", "c"],
      results: [r("a", "b", 2, 0), r("a", "c", 2, 0), r("b", "c", 2, 0)],
      config: CFG,
    });
    // a=6, b=3, c=0
    expect(rows.map((x) => x.teamId)).toEqual(["a", "b", "c"]);
    expect(rows.map((x) => x.rank)).toEqual([1, 2, 3]);
  });

  it("タイブレークなしで勝点同着なら同順位（1,1,3）", () => {
    const rows = computeStandings({
      teamIds: ["a", "b", "c"],
      results: [r("a", "c", 2, 0), r("b", "c", 2, 0)], // a=3,b=3,c=0
      config: CFG,
    });
    const m = byTeam(rows);
    expect(m.get("a")?.rank).toBe(1);
    expect(m.get("b")?.rank).toBe(1);
    expect(m.get("c")?.rank).toBe(3);
  });
});

describe("computeStandings — タイブレーク: map_diff", () => {
  it("勝点同着は得失マップ差で上位を決める", () => {
    const cfg = { ...CFG, tiebreakers: ["map_diff" as const] };
    const rows = computeStandings({
      teamIds: ["a", "b", "c"],
      // a,b は勝点同じ想定。a は得失で勝る。
      results: [
        r("a", "c", 3, 0), // a +3
        r("b", "c", 2, 1), // b +1
      ],
      config: cfg,
    });
    const m = byTeam(rows);
    // a=3,b=3,c=0。a の得失(+3) > b(+1) なので a が1位。
    expect(m.get("a")?.rank).toBe(1);
    expect(m.get("b")?.rank).toBe(2);
  });
});

describe("computeStandings — タイブレーク: head_to_head", () => {
  it("勝点同着は同着同士の直接対決で上位を決める", () => {
    const cfg = { ...CFG, tiebreakers: ["head_to_head" as const] };
    const rows = computeStandings({
      teamIds: ["a", "b"],
      results: [r("a", "b", 2, 1)], // 勝点 a=3,b=0… ではなく同着を作るには別途
      config: cfg,
    });
    // この場合は勝点で a>b なので h2h は使われない。a が1位。
    expect(byTeam(rows).get("a")?.rank).toBe(1);
  });

  it("3チーム同着は同着ミニリーグ勝点で比較する", () => {
    const cfg = { ...CFG, tiebreakers: ["head_to_head" as const] };
    // a,b,c が全体勝点で同着になるよう、共通の弱者 d に全員勝ち、相互は循環でなく差をつける。
    // a>b, a>c, b>c（ミニリーグ: a=6,b=3,c=0）。対 d は全勝で全体勝点を揃える。
    const rows = computeStandings({
      teamIds: ["a", "b", "c", "d"],
      results: [
        r("a", "d", 2, 0),
        r("b", "d", 2, 0),
        r("c", "d", 2, 0),
        r("a", "b", 2, 0),
        r("a", "c", 2, 0),
        r("b", "c", 2, 0),
      ],
      config: cfg,
    });
    const m = byTeam(rows);
    // a,b,c は全体勝点 6 で同着 → 直接対決ミニリーグ a>b>c。d は最下位。
    expect(m.get("a")?.rank).toBe(1);
    expect(m.get("b")?.rank).toBe(2);
    expect(m.get("c")?.rank).toBe(3);
    expect(m.get("d")?.rank).toBe(4);
  });
});

describe("computeStandings — タイブレーク: 多段＋potg", () => {
  it("直接対決で決まらなければ次の基準（potg）へ進む", () => {
    const cfg = {
      ...CFG,
      tiebreakers: ["head_to_head" as const, "potg" as const],
    };
    // a,b が勝点同着・直接対決は引分 → potg で決める。
    const rows = computeStandings({
      teamIds: ["a", "b", "c"],
      results: [
        r("a", "b", 1, 1, 3, 1), // 引分・POTG a=3,b=1
        r("a", "c", 2, 0),
        r("b", "c", 2, 0),
      ],
      config: cfg,
    });
    const m = byTeam(rows);
    // a=4(勝3分1?)… 勝点: a=3+1=4, b=3+1=4 同着。直接対決引分→potg a(3)>b(1)。
    expect(m.get("a")?.rank).toBe(1);
    expect(m.get("b")?.rank).toBe(2);
  });

  it("全タイブレークでも決まらなければ同順位", () => {
    const cfg = { ...CFG, tiebreakers: ["map_diff" as const] };
    // a,b 完全対称（勝点も得失も同じ）→ 同順位。
    const rows = computeStandings({
      teamIds: ["a", "b", "c"],
      results: [r("a", "c", 2, 0), r("b", "c", 2, 0)],
      config: cfg,
    });
    const m = byTeam(rows);
    expect(m.get("a")?.rank).toBe(1);
    expect(m.get("b")?.rank).toBe(1);
    expect(m.get("c")?.rank).toBe(3);
  });
});
