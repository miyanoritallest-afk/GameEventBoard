/**
 * OVERWATCH のランク↔スコア定義（純粋ロジック）。
 *
 * DB の rank_definitions（seed.sql）と同一ルールで 40 段階を生成する。
 * - 用途: 応募フォームのランク選択肢、スコア算出時の label→score 変換（後続 PR-B/D）。
 * - seed.sql とこのファイルは「同じ規則」を持つ。値がずれないよう本テストで固定する。
 *
 * 体系: 8帯（ブロンズ〜チャンピオン）× ディビジョン 5〜1 = 40。
 * スコアは線形 1〜40（ブロンズ5=1 … チャンピオン1=40）。
 * ディビジョンは 5 が最下位・1 が最上位（OW2 仕様）。
 * 未認定は本マスタに含めない（数値のあるランクのみ）。アプリ層で別途扱う。
 */

/** 低い帯から順に。index がそのまま帯の序列（0=ブロンズ）。 */
export const OVERWATCH_TIERS = [
  "ブロンズ",
  "シルバー",
  "ゴールド",
  "プラチナ",
  "ダイヤ",
  "マスター",
  "グランドマスター",
  "チャンピオン",
] as const;

/** ディビジョンは 5（最下位）〜1（最上位）。 */
export const DIVISIONS = [5, 4, 3, 2, 1] as const;

export type RankDefinition = {
  tier: string;
  division: number;
  label: string; // 例: "ブロンズ5"
  score: number; // 1〜40
  sortOrder: number; // 1〜40（score と同値）
};

/**
 * OVERWATCH の rank_definitions 40 件を生成する（seed と同一ルール）。
 * 低い順（score 昇順）で返す。
 */
export function buildOverwatchRankDefinitions(): RankDefinition[] {
  const defs: RankDefinition[] = [];
  OVERWATCH_TIERS.forEach((tier, ord) => {
    for (const division of DIVISIONS) {
      // ord*5 + (5-division) + 1 → ブロンズ5=1 … チャンピオン1=40
      const score = ord * 5 + (5 - division) + 1;
      defs.push({
        tier,
        division,
        label: `${tier}${division}`,
        score,
        sortOrder: score,
      });
    }
  });
  return defs.sort((a, b) => a.score - b.score);
}

/**
 * スコア値からランク名（label）へ逆引きする（算出根拠の表示用）。
 * 補完で生じる非整数スコア（例 22.5）は最も近い段階のラベルにする。
 * null は未認定。一致する段階が無ければ score を文字列で返す。
 */
export function scoreToRankLabel(score: number | null): string {
  if (score === null) return "未認定";
  const defs = buildOverwatchRankDefinitions();
  // 最も近いスコアのラベル（補完値は段階の中間になりうるため）。
  let nearest = defs[0];
  for (const d of defs) {
    if (Math.abs(d.score - score) < Math.abs(nearest.score - score)) {
      nearest = d;
    }
  }
  // 補完で中間値のときは「ダイヤ3 相当」と分かるよう近似表記。
  return nearest.score === score ? nearest.label : `${nearest.label}相当`;
}
