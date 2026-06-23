/**
 * 順位集計ロジック（Service 層・純粋関数）。本戦の見せ場。
 * 実装ガイドライン: 計算・判断は Controller から切り出し、副作用なしでテストする。
 *
 * 正の仕様（壁打ち確定・要件定義書 3.4.1）:
 * - ブロック単位で、結果のある試合のみ集計する。
 * - 各チーム: 勝/敗/分・勝点（カスタム points_win/draw/loss）・得失マップ差（全試合合計）・
 *   POTG 数（全試合合計）。
 * - 並び順: ①勝点（降順） → ② tiebreakers を先頭から順に評価。
 *   - head_to_head: 同着チーム同士の「ミニリーグ勝点」で比較（引分は決着つかず次へ）。
 *   - map_diff: 全試合合計の得失マップ差（降順）。
 *   - potg: 全試合合計の POTG 数（降順）。
 * - 全タイブレークを使っても決着しなければ同順位（rank を共有。次は人数分飛ばす）。
 *
 * DB に依存しないよう、入力は最小限（チーム一覧・試合結果・順位設定）で受ける。
 */

export type TiebreakerKey = "head_to_head" | "map_diff" | "potg";

/** 集計に使う1試合の結果（結果が入っている試合のみ渡す）。 */
export type ResultInput = {
  teamAId: string;
  teamBId: string;
  teamAScore: number; // 取マップ数
  teamBScore: number;
  potgA: number; // POTG 取得数（potg 不使用イベントは 0）
  potgB: number;
};

/** 順位集計の設定（events 由来）。 */
export type RankingConfig = {
  pointsWin: number;
  pointsDraw: number;
  pointsLoss: number;
  tiebreakers: TiebreakerKey[];
};

/** 1チームの集計行（順位表の1行）。 */
export type StandingRow = {
  teamId: string;
  wins: number;
  losses: number;
  draws: number;
  points: number;
  /** 得失マップ差（全試合合計＝取マップ − 失マップ）。 */
  mapDiff: number;
  /** 全試合合計の POTG 数。 */
  potg: number;
  /** 1始まりの順位（同着は同順位を共有）。 */
  rank: number;
};

/** 空の集計行を作る。 */
function emptyAgg(teamId: string) {
  return { teamId, wins: 0, losses: 0, draws: 0, mapDiff: 0, potg: 0 };
}

type Agg = ReturnType<typeof emptyAgg>;

/**
 * チーム一覧と結果から各チームの基礎集計（勝敗分・得失・POTG）を作る。
 * 結果のある試合のみ渡す前提。両チームが teamIds に含まれる試合だけ数える。
 */
function aggregate(
  teamIds: string[],
  results: ResultInput[],
): Map<string, Agg> {
  const set = new Set(teamIds);
  const agg = new Map<string, Agg>();
  for (const id of teamIds) agg.set(id, emptyAgg(id));

  for (const r of results) {
    if (!set.has(r.teamAId) || !set.has(r.teamBId)) continue;
    const a = agg.get(r.teamAId)!;
    const b = agg.get(r.teamBId)!;

    a.mapDiff += r.teamAScore - r.teamBScore;
    b.mapDiff += r.teamBScore - r.teamAScore;
    a.potg += r.potgA;
    b.potg += r.potgB;

    if (r.teamAScore > r.teamBScore) {
      a.wins += 1;
      b.losses += 1;
    } else if (r.teamBScore > r.teamAScore) {
      b.wins += 1;
      a.losses += 1;
    } else {
      a.draws += 1;
      b.draws += 1;
    }
  }
  return agg;
}

/** 勝点を算出する。 */
function points(agg: Agg, cfg: RankingConfig): number {
  return (
    agg.wins * cfg.pointsWin +
    agg.draws * cfg.pointsDraw +
    agg.losses * cfg.pointsLoss
  );
}

/**
 * 同着グループ（teamIds）について、head_to_head のミニリーグ勝点を返す。
 * 同着チーム同士の試合だけを抽出し、その中での勝点を計算する。
 */
function headToHeadPoints(
  tiedTeamIds: string[],
  results: ResultInput[],
  cfg: RankingConfig,
): Map<string, number> {
  const mini = aggregate(tiedTeamIds, results);
  const pts = new Map<string, number>();
  for (const id of tiedTeamIds) pts.set(id, points(mini.get(id)!, cfg));
  return pts;
}

/**
 * 同着グループを 1 つのタイブレーク基準で比較する比較関数を返す（降順 = 上位が先）。
 * head_to_head はグループ内ミニリーグ勝点、map_diff/potg は全試合合計値で比較。
 * 値が同じなら 0（決着つかず）。
 */
function tiebreakComparator(
  key: TiebreakerKey,
  tiedTeamIds: string[],
  results: ResultInput[],
  cfg: RankingConfig,
  fullAgg: Map<string, Agg>,
): (a: string, b: string) => number {
  if (key === "head_to_head") {
    const h2h = headToHeadPoints(tiedTeamIds, results, cfg);
    return (a, b) => (h2h.get(b) ?? 0) - (h2h.get(a) ?? 0);
  }
  if (key === "map_diff") {
    return (a, b) => fullAgg.get(b)!.mapDiff - fullAgg.get(a)!.mapDiff;
  }
  // potg
  return (a, b) => fullAgg.get(b)!.potg - fullAgg.get(a)!.potg;
}

/**
 * 同着グループ（同勝点）の中を tiebreakers の順で再帰的に並べ替える。
 * 1 基準で差がつくサブグループに分割し、まだ同着のサブグループは次の基準で並べる。
 * 全基準を使い切っても残った同着はそのまま（順序不定でも rank を共有させる）。
 */
function orderTied(
  tiedTeamIds: string[],
  tiebreakers: TiebreakerKey[],
  results: ResultInput[],
  cfg: RankingConfig,
  fullAgg: Map<string, Agg>,
): string[] {
  if (tiedTeamIds.length <= 1 || tiebreakers.length === 0) {
    return tiedTeamIds;
  }
  const [key, ...rest] = tiebreakers;
  const cmp = tiebreakComparator(key, tiedTeamIds, results, cfg, fullAgg);
  const sorted = [...tiedTeamIds].sort(cmp);

  // この基準で値が等しいものをサブグループにまとめ、残りの基準で再帰的に並べる。
  const out: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && cmp(sorted[i], sorted[j]) === 0) j++;
    const sub = sorted.slice(i, j);
    out.push(...(sub.length > 1 ? orderTied(sub, rest, results, cfg, fullAgg) : sub));
    i = j;
  }
  return out;
}

/** 同順位判定: 2チームが「勝点も全タイブレークも差がつかない」か。 */
function fullyTied(
  a: string,
  b: string,
  tiebreakers: TiebreakerKey[],
  results: ResultInput[],
  cfg: RankingConfig,
  fullAgg: Map<string, Agg>,
): boolean {
  if (points(fullAgg.get(a)!, cfg) !== points(fullAgg.get(b)!, cfg)) {
    return false;
  }
  for (const key of tiebreakers) {
    // head_to_head はこの 2 チーム間のミニリーグで比較する。
    const cmp = tiebreakComparator(key, [a, b], results, cfg, fullAgg);
    if (cmp(a, b) !== 0) return false;
  }
  return true;
}

/**
 * 順位表を計算する。チーム一覧と結果（結果ありのみ）、順位設定を受け取り、
 * StandingRow[] を順位順（上位が先）で返す。同着は同順位を共有する。
 */
export function computeStandings(params: {
  teamIds: string[];
  results: ResultInput[];
  config: RankingConfig;
}): StandingRow[] {
  const { teamIds, results, config } = params;
  const fullAgg = aggregate(teamIds, results);

  // 1. 勝点で降順。同勝点グループに分けて tiebreakers で並べ替える。
  const byPoints = [...teamIds].sort(
    (a, b) => points(fullAgg.get(b)!, config) - points(fullAgg.get(a)!, config),
  );

  const ordered: string[] = [];
  let i = 0;
  while (i < byPoints.length) {
    let j = i + 1;
    while (
      j < byPoints.length &&
      points(fullAgg.get(byPoints[i])!, config) ===
        points(fullAgg.get(byPoints[j])!, config)
    ) {
      j++;
    }
    const group = byPoints.slice(i, j);
    ordered.push(
      ...(group.length > 1
        ? orderTied(group, config.tiebreakers, results, config, fullAgg)
        : group),
    );
    i = j;
  }

  // 2. rank を付与（隣と完全同着なら前と同じ rank、そうでなければ通し番号）。
  const rows: StandingRow[] = [];
  let currentRank = 0;
  for (let k = 0; k < ordered.length; k++) {
    const id = ordered[k];
    const a = fullAgg.get(id)!;
    const prev = k > 0 ? ordered[k - 1] : null;
    if (
      prev &&
      fullyTied(prev, id, config.tiebreakers, results, config, fullAgg)
    ) {
      // 前と同順位（rank を据え置き）。
    } else {
      currentRank = k + 1; // 同着で飛んだぶんを反映（1,1,3 のように）。
    }
    rows.push({
      teamId: id,
      wins: a.wins,
      losses: a.losses,
      draws: a.draws,
      points: points(a, config),
      mapDiff: a.mapDiff,
      potg: a.potg,
      rank: currentRank,
    });
  }
  return rows;
}
