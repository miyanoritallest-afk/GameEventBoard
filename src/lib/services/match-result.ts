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

/** スコア妥当性チェックの結果。ok=false のとき message に理由（UI 表示用）。 */
export type ScoreValidation = { ok: true } | { ok: false; message: string };

/**
 * BO（best_of＝1試合の最大マップ数）に対してスコアの組み合わせが妥当か検証する（純粋関数）。
 *
 * 正の仕様（壁打ち確定・2026-06-24 実機フィードバック⑤）:
 * - 奇数BO（引分なし）: 「過半数を先取したら即終了」。勝者の取得マップ数は過半数ちょうど。
 *   勝者 = (best_of + 1) / 2、敗者 = 0〜(勝者 - 1)。合計は可変。
 *   例 BO5 → 勝者 3 固定。3-0 / 3-1 / 3-2（とその逆）のみ。BO3 → 2-0 / 2-1。
 * - 偶数BO（引分あり）: 「全 best_of マップを消化」。両者の合計は必ず best_of。
 *   引分 = best_of/2 - best_of/2、決着 = 勝者 > 敗者 かつ 合計 best_of。
 *   例 BO4 → 4-0 / 3-1、引分 2-2。BO2 → 2-0、引分 1-1。
 * - これにより BO5 の 2-1 / 0-0 / 4-1、BO2 の 1-0 のような「あり得ない」入力を弾く。
 *
 * 入力スコアは事前に非負整数であること（Zod で担保）を前提とする。
 */
export function validateBoScore(params: {
  bestOf: number;
  teamAScore: number;
  teamBScore: number;
}): ScoreValidation {
  const { bestOf, teamAScore: a, teamBScore: b } = params;
  const isEven = bestOf % 2 === 0;

  if (isEven) {
    // 偶数BO: 全マップ消化＝合計は必ず best_of。引分は best_of/2 同士のみ。
    if (a + b !== bestOf) {
      return {
        ok: false,
        message: `BO${bestOf}は全${bestOf}マップ消化します（合計が${bestOf}になる組み合わせのみ）。`,
      };
    }
    return { ok: true };
  }

  // 奇数BO: 過半数先取で即終了。勝者は過半数ちょうど・敗者は 0〜(勝者-1)・引分なし。
  const winScore = (bestOf + 1) / 2;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (a === b) {
    return { ok: false, message: `BO${bestOf}は奇数のため引分になりません。` };
  }
  if (hi !== winScore) {
    return {
      ok: false,
      message: `BO${bestOf}の勝者は${winScore}マップ先取で決まります（${winScore}-x）。`,
    };
  }
  if (lo > winScore - 1) {
    return {
      ok: false,
      message: `BO${bestOf}では敗者の取得マップは${winScore - 1}以下です。`,
    };
  }
  return { ok: true };
}

/**
 * POTG 入力が妥当か検証する（純粋関数）。
 * 正の仕様: POTG は毎マップ必ず1つ選出される → POTG 数の合計は総マップ数（両者スコア合計）と一致。
 * tiebreakers に potg が無いイベント（POTG 欄を出さない）は検証しない側で 0/0 のまま通す。
 */
export function validatePotg(params: {
  teamAScore: number;
  teamBScore: number;
  potgA: number;
  potgB: number;
}): ScoreValidation {
  const totalMaps = params.teamAScore + params.teamBScore;
  if (params.potgA + params.potgB !== totalMaps) {
    return {
      ok: false,
      message: `POTGは毎マップ選出されます。合計が総マップ数（${totalMaps}）と一致しません。`,
    };
  }
  return { ok: true };
}

/**
 * BO の意味を日本語で説明する（UI のツールチップ・補足表示用・⑦/④）。
 * 「BO3」だけでは初見で伝わらないため、勝敗ルールを文章で添える。
 * - 奇数BO: 過半数先取で決着（引分なし）。例 BO3 → 「3マップ中2本先取」。
 * - 偶数BO: 全マップ消化（引分あり）。例 BO4 → 「全4マップ・引分あり」。
 */
export function describeBestOf(bestOf: number): string {
  if (bestOf % 2 === 0) {
    return `全${bestOf}マップ・引分あり`;
  }
  const winScore = (bestOf + 1) / 2;
  return `${bestOf}マップ中${winScore}本先取`;
}
