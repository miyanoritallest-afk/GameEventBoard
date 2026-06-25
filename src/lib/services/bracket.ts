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

// --- 再計算（本戦-5b: 結果入力後の勝者自動進出・下流連鎖リセット） ---

/** 再計算の入力に使う、DB から取った1試合（順序確定のため round/position 必須）。 */
export type StoredMatch = {
  matchId: string;
  round: number;
  position: number;
  teamAId: string | null;
  teamBId: string | null;
};

/** 再計算の入力に使う、1試合の結果（勝者）。引分は winnerTeamId=null（T では奇数BO強制で出ない想定）。 */
export type StoredResult = {
  matchId: string;
  winnerTeamId: string | null;
};

/** 再計算で「あるべき状態」になった1試合。スロット更新と結果無効化の指示を持つ。 */
export type RecomputedMatch = {
  matchId: string;
  round: number;
  position: number;
  /** あるべき上スロット（前ラウンド勝者 or 1回戦のシード or BYE 自動進出）。未確定は null。 */
  teamAId: string | null;
  /** あるべき下スロット。未確定は null。 */
  teamBId: string | null;
  /**
   * この試合の既存結果を削除すべきか。
   * 「結果保存時からスロットのチーム構成が変わった」= winner_team_id が新スロットに居ない、
   * またはスロットが未確定に戻った場合に true。
   */
  shouldClearResult: boolean;
};

/**
 * トーナメント全体を「現在の全結果」から再計算する（本戦-5b・全再計算方式）。
 *
 * 1回戦のチーム配置（シード）を真実の起点とし、結果のある試合の勝者を次ラウンドへ伝播させる。
 * BYE（1回戦で片側 null）は結果なしで自動進出。多段の連鎖（準々→準決→決勝）も
 * 1パスで自然に処理される（上流の結果が消えれば下流スロットも未確定に戻る）。
 *
 * 勝者の進出先: round R / position P の勝者は round R+1 / position ⌊P/2⌋ の
 *   P が偶数なら上スロット(teamA)、奇数なら下スロット(teamB) へ入る（generateBracket と同規則）。
 *
 * 結果の無効化判定（壁打ち確定「チームが変わったら削除」）:
 *   結果のある試合について、再計算後の {teamA, teamB} に winner_team_id が含まれない、
 *   または両スロットが埋まっていない場合、その結果は別チームのもの＝無効として shouldClearResult=true。
 *
 * @param matches 全トーナメント試合（round/position 付き）。
 * @param results 既存の結果（match_id → 勝者）。
 * @returns 各試合の「あるべき」状態（round→position 順）。
 */
export function recomputeBracket(
  matches: StoredMatch[],
  results: StoredResult[],
): RecomputedMatch[] {
  if (matches.length === 0) return [];

  const winnerByMatch = new Map<string, string | null>();
  for (const r of results) winnerByMatch.set(r.matchId, r.winnerTeamId);
  const hasResult = (matchId: string) => winnerByMatch.has(matchId);

  const rounds = Math.max(...matches.map((m) => m.round));
  // round → position → 試合 で引けるようにする。
  const byRoundPos = new Map<string, StoredMatch>();
  for (const m of matches) byRoundPos.set(`${m.round}:${m.position}`, m);

  // 再計算後のスロット（round:position → {teamA, teamB}）。round 昇順で確定させる。
  const slots = new Map<string, { teamAId: string | null; teamBId: string | null }>();

  // 1回戦はシード確定（DB の配置をそのまま採用）。
  for (const m of matches.filter((m) => m.round === 1)) {
    slots.set(`1:${m.position}`, { teamAId: m.teamAId, teamBId: m.teamBId });
  }

  /** その試合の勝者を返す。結果があれば winner、BYE（片側のみ）なら自動進出、なければ null。 */
  const winnerOf = (round: number, position: number): string | null => {
    const key = `${round}:${position}`;
    const slot = slots.get(key);
    if (!slot) return null;
    const m = byRoundPos.get(key);
    if (m && hasResult(m.matchId)) {
      // 結果あり: winner がいまの両スロットに含まれるときだけ有効な勝者として伝播。
      const w = winnerByMatch.get(m.matchId) ?? null;
      if (w !== null && (w === slot.teamAId || w === slot.teamBId)) return w;
      return null; // 引分 or 矛盾（無効化対象）は伝播しない
    }
    // 結果なし: BYE（片側だけ確定）なら自動進出、両方埋まっている実試合は未確定。
    const { teamAId, teamBId } = slot;
    if (teamAId !== null && teamBId === null) return teamAId;
    if (teamBId !== null && teamAId === null) return teamBId;
    return null;
  };

  // round 2 以降を上流から順に確定（上流が確定してから下流の勝者を引くため round 昇順）。
  for (let round = 2; round <= rounds; round++) {
    const count = matches.filter((m) => m.round === round).length;
    for (let pos = 0; pos < count; pos++) {
      const teamAId = winnerOf(round - 1, pos * 2);
      const teamBId = winnerOf(round - 1, pos * 2 + 1);
      slots.set(`${round}:${pos}`, { teamAId, teamBId });
    }
  }

  // 各試合の最終状態 + 結果無効化判定を組み立てる。
  return matches
    .slice()
    .sort((a, b) => a.round - b.round || a.position - b.position)
    .map((m) => {
      const slot = slots.get(`${m.round}:${m.position}`) ?? {
        teamAId: null,
        teamBId: null,
      };
      let shouldClearResult = false;
      if (hasResult(m.matchId)) {
        const w = winnerByMatch.get(m.matchId) ?? null;
        const bothSet = slot.teamAId !== null && slot.teamBId !== null;
        const winnerInSlot =
          w !== null && (w === slot.teamAId || w === slot.teamBId);
        // 両スロット未確定に戻った or 勝者が今のスロットに居ない = チームが変わった → 削除。
        if (!bothSet || !winnerInSlot) shouldClearResult = true;
      }
      return {
        matchId: m.matchId,
        round: m.round,
        position: m.position,
        teamAId: slot.teamAId,
        teamBId: slot.teamBId,
        shouldClearResult,
      };
    });
}

/**
 * トーナメント用に BO を奇数へ補正する（引分を構造的に出さない＝壁打ち確定）。
 * 偶数や 1 未満は直近の妥当な奇数へ寄せる（2→3, 4→5 のように切り上げ。0/1→1）。
 * 上限 15 は CHECK と整合。
 */
export function toOddBestOf(bestOf: number): number {
  let n = Math.floor(bestOf);
  if (n < 1) return 1;
  if (n % 2 === 0) n += 1; // 偶数は1つ上の奇数へ
  if (n > 15) n = 15;
  return n;
}
