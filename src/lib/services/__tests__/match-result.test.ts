import { describe, it, expect } from "vitest";
import {
  decideWinner,
  validateBoScore,
  validatePotg,
  describeBestOf,
  mapsPlayed,
  normalizeReplayCodes,
} from "../match-result";

/**
 * 勝者判定ロジックの単体テスト（純粋関数なので網羅できる）。
 * 正の仕様は DB設計書 3.15（match_results）。
 */

describe("decideWinner", () => {
  it("team_a のスコアが大きければ team_a の勝ち", () => {
    expect(
      decideWinner({ teamAId: "a", teamBId: "b", teamAScore: 2, teamBScore: 1 }),
    ).toEqual({ winnerTeamId: "a", isDraw: false });
  });

  it("team_b のスコアが大きければ team_b の勝ち", () => {
    expect(
      decideWinner({ teamAId: "a", teamBId: "b", teamAScore: 0, teamBScore: 2 }),
    ).toEqual({ winnerTeamId: "b", isDraw: false });
  });

  it("同点は引分（winner なし）", () => {
    expect(
      decideWinner({ teamAId: "a", teamBId: "b", teamAScore: 2, teamBScore: 2 }),
    ).toEqual({ winnerTeamId: null, isDraw: true });
  });

  it("0-0 も引分", () => {
    expect(
      decideWinner({ teamAId: "a", teamBId: "b", teamAScore: 0, teamBScore: 0 }),
    ).toEqual({ winnerTeamId: null, isDraw: true });
  });
});

/**
 * BO スコア妥当性の単体テスト（実機フィードバック⑤・厳格＋偶数BO例外）。
 * 「過半数ちょうどで即終了」を強制し、あり得ない入力を弾く。
 */
describe("validateBoScore", () => {
  const ok = (bestOf: number, a: number, b: number) =>
    validateBoScore({ bestOf, teamAScore: a, teamBScore: b }).ok;

  it("BO5 は 3-0 / 3-1 / 3-2（とその逆）のみ妥当", () => {
    expect(ok(5, 3, 0)).toBe(true);
    expect(ok(5, 3, 1)).toBe(true);
    expect(ok(5, 3, 2)).toBe(true);
    expect(ok(5, 0, 3)).toBe(true);
    expect(ok(5, 2, 3)).toBe(true);
  });

  it("BO5 の 2-1 / 0-0 / 4-1 / 2-0 / 3-3 は不正", () => {
    expect(ok(5, 2, 1)).toBe(false); // 勝者が過半数未満
    expect(ok(5, 0, 0)).toBe(false); // 奇数BOで引分不可
    expect(ok(5, 4, 1)).toBe(false); // 勝者が過半数超過（即終了のはず）
    expect(ok(5, 2, 0)).toBe(false); // 勝者が過半数未満
    expect(ok(5, 3, 3)).toBe(false); // 両者過半数はあり得ない
  });

  it("BO3 は 2-0 / 2-1（とその逆）のみ妥当", () => {
    expect(ok(3, 2, 0)).toBe(true);
    expect(ok(3, 2, 1)).toBe(true);
    expect(ok(3, 0, 2)).toBe(true);
    expect(ok(3, 1, 2)).toBe(true);
    expect(ok(3, 1, 0)).toBe(false); // 過半数未満
    expect(ok(3, 1, 1)).toBe(false); // 奇数BOで引分不可
  });

  it("BO1 は 1-0 / 0-1 のみ", () => {
    expect(ok(1, 1, 0)).toBe(true);
    expect(ok(1, 0, 1)).toBe(true);
    expect(ok(1, 0, 0)).toBe(false);
  });

  it("偶数BO（BO4）は全4マップ消化＝合計4（引分 2-2・決着 4-0/3-1）", () => {
    expect(ok(4, 2, 2)).toBe(true); // 引分
    expect(ok(4, 4, 0)).toBe(true);
    expect(ok(4, 0, 4)).toBe(true);
    expect(ok(4, 3, 1)).toBe(true);
    expect(ok(4, 1, 3)).toBe(true);
    expect(ok(4, 1, 1)).toBe(false); // 合計が4でない
    expect(ok(4, 3, 0)).toBe(false); // 合計が4でない（全消化していない）
    expect(ok(4, 3, 2)).toBe(false); // 合計が4でない
    expect(ok(4, 2, 1)).toBe(false); // 合計が4でない
  });

  it("偶数BO（BO2）は全2マップ消化＝合計2（1-1 引分・2-0 決着）", () => {
    expect(ok(2, 1, 1)).toBe(true);
    expect(ok(2, 2, 0)).toBe(true);
    expect(ok(2, 0, 2)).toBe(true);
    expect(ok(2, 1, 0)).toBe(false); // まだ1マップ残っている＝あり得ない
    expect(ok(2, 0, 0)).toBe(false);
  });
});

/** POTG は毎マップ選出 → 合計が総マップ数と一致（実機フィードバック⑤）。 */
describe("validatePotg", () => {
  const ok = (a: number, b: number, pa: number, pb: number) =>
    validatePotg({ teamAScore: a, teamBScore: b, potgA: pa, potgB: pb }).ok;

  it("POTG 合計が総マップ数と一致すれば妥当", () => {
    expect(ok(3, 1, 3, 1)).toBe(true); // 4マップ → POTG 4
    expect(ok(3, 1, 2, 2)).toBe(true); // 振り分けは自由
    expect(ok(2, 2, 4, 0)).toBe(true);
  });

  it("POTG 合計が総マップ数と一致しなければ不正", () => {
    expect(ok(3, 1, 0, 0)).toBe(false); // 0-0 は総4と不一致
    expect(ok(3, 0, 2, 0)).toBe(false); // 総3に対し2
    expect(ok(3, 2, 3, 3)).toBe(false); // 総5に対し6
  });
});

/** BO の説明文（UI ツールチップ用・④）。 */
describe("describeBestOf", () => {
  it("奇数BOは過半数先取の表記", () => {
    expect(describeBestOf(3)).toBe("3マップ中2本先取");
    expect(describeBestOf(5)).toBe("5マップ中3本先取");
    expect(describeBestOf(1)).toBe("1マップ中1本先取");
  });

  it("偶数BOは全マップ消化・引分ありの表記", () => {
    expect(describeBestOf(2)).toBe("全2マップ・引分あり");
    expect(describeBestOf(4)).toBe("全4マップ・引分あり");
  });
});

/** リプレイコード欄数＝行われたマップ数（フェーズA）。 */
describe("mapsPlayed", () => {
  it("両者スコアの合計", () => {
    expect(mapsPlayed(2, 1)).toBe(3); // BO3 決着
    expect(mapsPlayed(3, 0)).toBe(3); // BO5 ストレート
    expect(mapsPlayed(2, 2)).toBe(4); // BO4 引分
    expect(mapsPlayed(0, 0)).toBe(0); // 未入力
  });
  it("負値・小数は防御的に丸める", () => {
    expect(mapsPlayed(-1, 2)).toBe(1);
    expect(mapsPlayed(2.7, 1.2)).toBe(3);
  });
});

/** リプレイコードの保存用正規化（フェーズA）。 */
describe("normalizeReplayCodes", () => {
  it("マップ数に長さを揃える（多い分は捨て、足りない分は空文字）", () => {
    expect(normalizeReplayCodes(["AAA", "BBB", "CCC", "DDD"], 3)).toEqual([
      "AAA",
      "BBB",
      "CCC",
    ]);
    expect(normalizeReplayCodes(["AAA"], 3)).toEqual(["AAA", "", ""]);
  });
  it("各要素をトリムする", () => {
    expect(normalizeReplayCodes([" AAA ", "  "], 2)).toEqual(["AAA", ""]);
  });
  it("マップ数0なら空配列", () => {
    expect(normalizeReplayCodes(["AAA"], 0)).toEqual([]);
  });
});
