/**
 * 総当たり（ラウンドロビン）対戦の組み合わせ生成ロジック（Service 層・純粋関数）。
 * 実装ガイドライン: 計算・判断は Controller から切り出し、副作用なしでテストする。
 *
 * 正の仕様は 要件定義書 3.4.1（予選: グループ内総当たり）。
 * - N チームの総当たり = 全ペアの組み合わせ（N×(N-1)/2 試合）。各ペアは1回ずつ。
 * - 「team_a vs team_b」と「team_b vs team_a」は同じ試合（順不同）。
 * - DB には依存しない。入力はチーム id の配列、出力はペアの配列。
 */

/** 対戦カード1件（順不同のペア）。team_a / team_b は入力配列の並び順を保つ。 */
export type MatchPair = { teamAId: string; teamBId: string };

/**
 * チーム id 配列から総当たりの全ペアを生成する。
 * i < j の組み合わせを列挙（重複なし・自己対戦なし）。入力順を保った安定な順序。
 * 1チーム以下なら空配列（ペアが作れない）。重複 id は呼び出し側で除外する前提だが、
 * 念のため一意化してから組み合わせる。
 */
export function roundRobinPairs(teamIds: string[]): MatchPair[] {
  const ids = uniqueInOrder(teamIds);
  const pairs: MatchPair[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      pairs.push({ teamAId: ids[i], teamBId: ids[j] });
    }
  }
  return pairs;
}

/** 2チームのペアを順不同で比較するためのキー（小さい id:大きい id）。重複判定に使う。 */
export function pairKey(teamAId: string, teamBId: string): string {
  return teamAId < teamBId
    ? `${teamAId}:${teamBId}`
    : `${teamBId}:${teamAId}`;
}

/**
 * 既存の対戦カード集合に、指定ペアが（順不同で）既に存在するか。
 * 手動追加・再生成時の重複チェックに使う（アプリ層で弾く＝壁打ち確定）。
 */
export function pairExists(
  existing: MatchPair[],
  teamAId: string,
  teamBId: string,
): boolean {
  const key = pairKey(teamAId, teamBId);
  return existing.some((p) => pairKey(p.teamAId, p.teamBId) === key);
}

/** 配列の重複を除去しつつ順序を保つ。 */
function uniqueInOrder(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
