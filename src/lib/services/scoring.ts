/**
 * スコア算出ロジック（Service 層・純粋関数）。docs/スコアリング設計.md が正。
 *
 * 入力は「ロール × シーズン」の2次元グリッド。各セルはスコア値（rank_definitions.score）
 * または null（未認定）。主催者設定（role_swap / 未認定補完方式 / ボーナス）に応じて
 * 個人スコア（base）と個人ファイナルスコア（base + bonus）を算出する。
 *
 * 副作用なし。端ケース（全未認定・補完材料ゼロ）も含めテストで網羅する。
 */

/** 未認定補完方式（主催者がイベントで選択）。 */
export type UncertifiedHandling = "fill_by_role" | "fill_by_season" | "exclude";

/** peak 到達（到達ボーナス用）。 */
export type PeakTier = "none" | "master" | "gm" | "champion";

/** セル = スコア（数値）または null（未認定）。 */
export type Cell = number | null;

/** 1ロール分の入力（直近 declared_seasons シーズン。各セルはスコア or 未認定）。 */
export type RoleSeasons = {
  role: string; // "tank" | "dps" | "support"（表示・breakdown 用に文字列で保持）
  seasons: Cell[];
};

export type ScoringInput = {
  roleSwapAllowed: boolean;
  /** role_swap=true なら全ロール、false なら担当ロール1つ分。 */
  grid: RoleSeasons[];
  handling: UncertifiedHandling;
  /** ボーナス有効時の peak と各加点。無効なら peak='none' か加点0で実質0。 */
  peak: PeakTier;
  bonus: { master: number; gm: number; champion: number };
};

export type ScoringResult = {
  /** 基礎スコア。全グリッド未認定なら null（スコアなし）。 */
  individualScore: number | null;
  /** 個人ファイナルスコア = individualScore + bonus。individualScore が null なら null。 */
  finalScore: number | null;
  breakdown: {
    method: "single_role" | "grid";
    handling?: UncertifiedHandling;
    base: number | null;
    bonusApplied: number;
    peak: PeakTier;
  };
};

/** 配列の平均。空なら null。 */
function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** 小数第2位を四捨五入して第1位までにする（保存・表示の一貫性のため）。 */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** peak に応じたボーナス加点を引く。 */
function bonusFor(
  peak: PeakTier,
  bonus: { master: number; gm: number; champion: number },
): number {
  switch (peak) {
    case "master":
      return bonus.master;
    case "gm":
      return bonus.gm;
    case "champion":
      return bonus.champion;
    default:
      return 0;
  }
}

/** セル配列のうち未認定(null)でない値だけを取り出す。 */
function certified(cells: Cell[]): number[] {
  return cells.filter((c): c is number => c !== null);
}

/**
 * role_swap=false: 担当ロール1つの declared_seasons 分を平均。
 * 全シーズン未認定なら null。
 */
function calcSingleRole(seasons: Cell[]): number | null {
  return average(certified(seasons));
}

/**
 * role_swap=true: グリッドを補完方式で埋めて全有効値を平均。
 * - fill_by_role（横軸）: 各セルが未認定なら同シーズンの他ロール平均で補完。
 *   そのシーズンが全ロール未認定なら、その列は補完不能 → 除外。
 * - fill_by_season（縦軸）: 各セルが未認定なら同ロールの他シーズン平均で補完。
 *   そのロールが全シーズン未認定なら、その行は補完不能 → 除外。
 * - exclude: 未認定セルは平均に含めない。
 */
function calcGrid(grid: RoleSeasons[], handling: UncertifiedHandling): number | null {
  const roleCount = grid.length;
  const seasonCount = Math.max(0, ...grid.map((r) => r.seasons.length));

  if (handling === "exclude") {
    const values = grid.flatMap((r) => certified(r.seasons));
    return average(values);
  }

  if (handling === "fill_by_season") {
    // 各ロール行ごとに、未認定セルを同ロールの他シーズン平均で埋める。
    const values: number[] = [];
    for (const r of grid) {
      const known = certified(r.seasons);
      if (known.length === 0) continue; // 全シーズン未認定 → その行を除外
      const rowAvg = average(known)!;
      for (const cell of r.seasons) {
        values.push(cell === null ? rowAvg : cell);
      }
    }
    return average(values);
  }

  // fill_by_role（横軸）: 各シーズン列ごとに、未認定セルを同シーズンの他ロール平均で埋める。
  const values: number[] = [];
  for (let s = 0; s < seasonCount; s++) {
    const column = grid.map((r) => r.seasons[s] ?? null);
    const known = certified(column);
    if (known.length === 0) continue; // 全ロール未認定 → その列を除外
    const colAvg = average(known)!;
    for (let r = 0; r < roleCount; r++) {
      const cell = grid[r].seasons[s];
      // セルが存在しない（行の長さ不揃い）場合は補完値で埋めない（未入力は無視）。
      if (cell === undefined) continue;
      values.push(cell === null ? colAvg : cell);
    }
  }
  return average(values);
}

/**
 * スコアを算出する。base が null（全未認定）なら final も null。
 */
export function calcScore(input: ScoringInput): ScoringResult {
  const base = input.roleSwapAllowed
    ? calcGrid(input.grid, input.handling)
    : calcSingleRole(input.grid[0]?.seasons ?? []);

  const bonusApplied = bonusFor(input.peak, input.bonus);

  // スコアは小数第2位を四捨五入して第1位まで（保存値・表示・振り分けを一貫させる）。
  const individualScore = base === null ? null : round1(base);
  const finalScore = base === null ? null : round1(base + bonusApplied);

  return {
    individualScore,
    finalScore,
    breakdown: {
      method: input.roleSwapAllowed ? "grid" : "single_role",
      handling: input.roleSwapAllowed ? input.handling : undefined,
      base: individualScore,
      bonusApplied,
      peak: input.peak,
    },
  };
}
