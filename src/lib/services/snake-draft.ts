/**
 * 自動ブロック分け（本戦 PR-4）のスネークドラフト割り振りロジック（Service 層・純粋関数）。
 * 実装ガイドライン: 計算・判断は Controller から切り出し、副作用なしでテストする。
 *
 * 正の仕様は 要件定義書 3.4.1（本戦: ブロック分け）。
 * - チームをスコア降順に並べ、蛇行（→ ← → …）で N ブロックへ配る。
 *   蛇行することで各ブロックの平均強さが均される（強い順の単純配分だと A に強豪が偏る）。
 * - 端数は余りを出さず、自然に一部ブロックのチーム数が 1 多い/少ない形で吸収する。
 * - スコア null（非 require_score イベント等）は最下位扱いで末尾に置く。安定ソートで
 *   元の並び（呼び出し側の順＝チーム名順 or 応募順）を保つ。
 * - DB には依存しない。入力はチームの最小表現、出力はブロックごとの team_id 配列。
 */

/** 割り振り対象チームの最小表現（呼び出し側で承認済みチームから組み立てる）。 */
export type DraftTeam = {
  id: string;
  /** チームスコア。未算出（非 require_score・出場者なし等）は null。 */
  score: number | null;
};

/**
 * チームをスコア降順でスネークドラフト配置し、N ブロックの team_id 配列を返す。
 *
 * - blockCount は 1 以上を想定（呼び出し側で 1〜承認チーム数に検証済み）。
 *   防御として 1 未満は空配列、チーム 0 件なら空ブロックを blockCount 個返す。
 * - 並びはスコア降順。score=null は末尾。同スコア・同 null 内は入力順を保つ（安定）。
 * - 蛇行: 0 巡目は 0→N-1、1 巡目は N-1→0、と向きを交互に反転して配る。
 *
 * 返り値は長さ blockCount の配列（各要素が 1 ブロックの team_id 配列）。
 */
export function snakeDraft(
  teams: DraftTeam[],
  blockCount: number,
): string[][] {
  const n = Math.floor(blockCount);
  if (n < 1) return [];

  const blocks: string[][] = Array.from({ length: n }, () => []);

  // スコア降順。null は末尾。安定ソートのため元の index を tie-breaker に使う。
  const sorted = teams
    .map((t, index) => ({ t, index }))
    .sort((a, b) => {
      const sa = a.t.score;
      const sb = b.t.score;
      if (sa === null && sb === null) return a.index - b.index; // 両方 null は入力順
      if (sa === null) return 1; // null は後ろ
      if (sb === null) return -1;
      if (sb !== sa) return sb - sa; // スコア降順
      return a.index - b.index; // 同スコアは入力順
    })
    .map((x) => x.t);

  // 蛇行配置。round ごとに向きを反転する。
  sorted.forEach((team, i) => {
    const round = Math.floor(i / n);
    const posInRound = i % n;
    // 偶数巡は 0→N-1、奇数巡は N-1→0。
    const blockIndex = round % 2 === 0 ? posInRound : n - 1 - posInRound;
    blocks[blockIndex].push(team.id);
  });

  return blocks;
}

/**
 * ブロック名を index から生成する（A, B, C, ... Z, AA, AB, ...）。
 * 自動生成ブロックの命名に使う。Z を超えても破綻しないよう多桁に対応する。
 */
export function blockName(index: number): string {
  let n = index;
  let name = "";
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return name;
}
