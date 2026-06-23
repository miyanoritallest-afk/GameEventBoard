import { describe, it, expect } from "vitest";
import { decideWinner } from "../match-result";

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
