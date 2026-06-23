/**
 * 試合結果のスコアから勝者を判定するロジック（Service 層・純粋関数）。
 * 実装ガイドライン: 計算・判断は Controller から切り出し、副作用なしでテストする。
 *
 * 正の仕様は 要件定義書 3.4.1 / DB設計書 3.15（match_results）。
 * - スコアは「取ったマップ数」（OW2 のマップ先取制）。
 * - team_a_score > team_b_score なら team_a の勝ち、逆なら team_b の勝ち。
 * - 同点（2-2 等）は引分 → 勝者なし（null）。
 * - winner はクライアントから受け取らず、この関数でサーバー側が算出して固定する
 *   （マスアサインメント対策）。
 *
 * DB に依存しないよう、入力はスコアと両チーム id のみで受ける。
 */

/** 勝者判定の結果。引分は winnerTeamId=null。 */
export type WinnerResult = {
  winnerTeamId: string | null;
  isDraw: boolean;
};

/**
 * 取マップ数から勝者を決める。
 * team_a / team_b の id を渡し、スコアの大きい方の id を勝者として返す。同点は引分。
 */
export function decideWinner(params: {
  teamAId: string;
  teamBId: string;
  teamAScore: number;
  teamBScore: number;
}): WinnerResult {
  if (params.teamAScore > params.teamBScore) {
    return { winnerTeamId: params.teamAId, isDraw: false };
  }
  if (params.teamBScore > params.teamAScore) {
    return { winnerTeamId: params.teamBId, isDraw: false };
  }
  return { winnerTeamId: null, isDraw: true };
}
