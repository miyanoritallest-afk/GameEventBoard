/**
 * 決勝トーナメント（シングルエリミネーション）のブラケット生成ロジック（Service 層・純粋関数）。
 * 実装ガイドライン: 計算・判断は Controller から切り出し、副作用なしでテストする。
 *
 * 正の仕様（壁打ち確定・要件定義書 3.4.1 / 本戦-5a）:
 * - 進出チームを「各ブロック上位N」で抽出し、シード順に並べる。
 *   シード順 = ブロック同順位をシード群にまとめ（各ブロック1位=1群, 2位=2群, ...）、
 *   群内はブロック横断の数値（勝点→得失→POTG）で比較する。
 * - ブラケットサイズ = 進出数以上の最小 2 の累乗。足りない枠は上位シードの BYE（不戦勝）。
 * - 標準シード配置（1 vs 最下位, 2 vs 下から2番目, ... 強者が決勝まで当たらない）。
 * - 1回戦で相手が BYE のチームは 2 回戦へ自動進出した状態でカードを作る。
 *
 * DB には依存しない。入力は進出チームのシード順 id 配列、出力は試合カードの構造。
 */

/** 進出抽出・シード順の入力に使う、1チームのブロック内成績。 */
export type SeedTeam = {
  teamId: string;
  /** 属するブロック（group）id。 */
  groupId: string;
  /** ブロック内順位（1 始まり・同着は同順位を共有）。 */
  rank: number;
  /** シード群内のブロック横断比較に使う数値（大きいほど上位）。 */
  points: number;
  mapDiff: number;
  potg: number;
};

/**
 * 各ブロック上位N を抽出し、シード順（強い順）に並べた team_id 配列を返す。
 *
 * 仕様（壁打ち確定）:
 * - 各ブロックから rank <= advanceCount のチームを進出させる（同着で N を超える場合も全員進出）。
 * - シード順 = ブロック内 rank が小さい順（=シード群）を主キーに、同 rank（同シード群）内は
 *   ブロック横断で points → mapDiff → potg の降順で比較。完全同値は teamId で安定化。
 *
 * 例: A1,B1 が 1 群（その中で強い方が全体シード1）、A2,B2 が 2 群、…と続く。
 */
export function extractSeededTeams(
  teams: SeedTeam[],
  advanceCount: number,
): string[] {
  const advanced = teams.filter((t) => t.rank <= advanceCount);
  const sorted = [...advanced].sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank; // シード群（rank 昇順）
    if (b.points !== a.points) return b.points - a.points;
    if (b.mapDiff !== a.mapDiff) return b.mapDiff - a.mapDiff;
    if (b.potg !== a.potg) return b.potg - a.potg;
    return a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0; // 安定化
  });
  return sorted.map((t) => t.teamId);
}

/** ブラケット上の1試合カード。round は 1 始まり（1=1回戦）。 */
export type BracketMatch = {
  /** ラウンド番号（1=1回戦, 2=2回戦, ...）。決勝が最大ラウンド。 */
  round: number;
  /** 同一ラウンド内の位置（0 始まり・上から順）。matches.bracket_position に保存。 */
  position: number;
  /** 上側スロットのチーム id。未確定（前ラウンド勝者待ち）は null。 */
  teamAId: string | null;
  /** 下側スロットのチーム id。未確定・BYE は null。 */
  teamBId: string | null;
};

/**
 * 進出数以上の最小の 2 の累乗を返す（ブラケットサイズ）。
 * 1 以下は 1（トーナメント不成立だが防御的に 1 を返す）。
 */
export function bracketSize(teamCount: number): number {
  if (teamCount <= 1) return 1;
  let size = 1;
  while (size < teamCount) size *= 2;
  return size;
}

/**
 * 標準シード配置の「シード番号の並び」を生成する。
 * サイズ size（2 の累乗）のブラケットで、上から順に並ぶシード番号（1 始まり）を返す。
 * 例 size=4 → [1, 4, 2, 3]（上半分 1vs4・下半分 2vs3。1 と 2 は決勝で当たる）。
 * 例 size=8 → [1, 8, 4, 5, 2, 7, 3, 6]。
 *
 * 再帰的に作る: 現在の並びを 2 倍に展開する各段で、各シード s を
 * 「s と (現在サイズ*2+1 − s)」のペアに展開する（標準シードの定義）。
 * これで上位シードが反対の山に分かれ、強者が決勝まで当たらない配置になる。
 */
export function seedOrder(size: number): number[] {
  if (size <= 1) return [1];
  let order = [1, 2];
  while (order.length < size) {
    const complement = order.length * 2 + 1;
    const next: number[] = [];
    for (const s of order) {
      next.push(s);
      next.push(complement - s);
    }
    order = next;
  }
  return order;
}

/**
 * シード順の進出チーム id 配列から、シングルエリミのブラケット全試合を生成する。
 *
 * @param seededTeamIds 進出チームをシード順（強い順）に並べた id 配列。
 * @returns 全ラウンドの BracketMatch 配列（round 昇順・position 昇順）。
 *
 * - 進出 2 チーム未満は空配列（トーナメント不成立）。
 * - BYE: ブラケットサイズに満たない枠は上位シードに割り当てる。1回戦で相手が
 *   いない（BYE）チームは、対応する 2 回戦カードへ自動進出させる（teamAId/teamBId に直接セット）。
 * - 全ラウンド分のカードを作る（決勝まで）。未確定スロットは null。
 */
export function generateBracket(seededTeamIds: string[]): BracketMatch[] {
  const teamCount = seededTeamIds.length;
  if (teamCount < 2) return [];

  const size = bracketSize(teamCount);
  const order = seedOrder(size); // 上から並ぶシード番号（1始まり）

  // シード番号 → チーム id（番号がチーム数を超えたら BYE = null）。
  const teamBySeed = (seed: number): string | null =>
    seed <= teamCount ? seededTeamIds[seed - 1] : null;

  const totalRounds = Math.log2(size); // size は 2 の累乗なので整数
  const matches: BracketMatch[] = [];

  // --- 1回戦 ---
  // order を 2 つずつ取って 1 回戦カードにする。position は 0 始まり。
  const firstRound: BracketMatch[] = [];
  for (let i = 0; i < size; i += 2) {
    firstRound.push({
      round: 1,
      position: i / 2,
      teamAId: teamBySeed(order[i]),
      teamBId: teamBySeed(order[i + 1]),
    });
  }
  matches.push(...firstRound);

  // --- 2回戦以降 ---
  // 各ラウンドはカード数が半分になる。2 回戦には、1 回戦が BYE で確定済みの勝者を流し込む。
  let prevRound = firstRound;
  for (let round = 2; round <= totalRounds; round++) {
    const count = size / 2 ** round;
    const cur: BracketMatch[] = [];
    for (let pos = 0; pos < count; pos++) {
      // この 2 回戦カードへ流れ込む 1 回戦カード 2 つ（上側 srcA, 下側 srcB）。
      const srcA = prevRound[pos * 2];
      const srcB = prevRound[pos * 2 + 1];
      cur.push({
        round,
        position: pos,
        // 直前ラウンドが round===2 のときだけ BYE 自動進出を反映する。
        // それ以外は前ラウンドが実試合なので未確定（null）。
        teamAId: round === 2 ? byeWinner(srcA) : null,
        teamBId: round === 2 ? byeWinner(srcB) : null,
      });
    }
    matches.push(...cur);
    prevRound = cur;
  }

  return matches;
}

/**
 * 1回戦カードが BYE（片側が null）なら、相手チーム id を「自動進出の勝者」として返す。
 * 両方埋まっている（実試合）なら未確定 null、両方 null（ありえないが防御）も null。
 */
function byeWinner(m: BracketMatch | undefined): string | null {
  if (!m) return null;
  const { teamAId, teamBId } = m;
  if (teamAId !== null && teamBId === null) return teamAId;
  if (teamBId !== null && teamAId === null) return teamBId;
  return null; // 実試合 or 両 BYE は未確定
}
