/**
 * チームスコア算出ロジック（Service 層・純粋関数）。
 * 実装ガイドライン: 計算・判断は Controller から切り出し、副作用なしでテストする。
 *
 * 正の仕様は DB設計書 4.2 / 4.3:
 * - ③チームスコア = 出場（regular）メンバーの実効 final_score の平均。
 *   実効スコア = organizer_override_score ?? final_score（運営の上書きを優先）。
 * - リザーブ（reserve）は平均に含めない。
 * - events.team_score_cap と比較して上限超過を判定。
 * - 交代シミュレーション（4.3）は PR-2 の編成画面で使う（本ファイルに同居させ、
 *   DB 非依存の純粋関数としてテスト可能にしておく）。
 *
 * DB に依存しないよう、入力は最小限のメンバー表現（MemberScore）で受ける。
 */

export type MemberPosition = "regular" | "reserve";

/** スコア算出に必要な最小のメンバー表現（呼び出し側で team_members から組み立てる）。 */
export type MemberScore = {
  id: string;
  position: MemberPosition;
  /** ②個人ファイナルスコア。未算出（スコアなしイベント等）は null。 */
  finalScore: number | null;
  /** 運営によるスコア上書き。設定時はこちらを優先。 */
  overrideScore: number | null;
};

/** 実効スコア = override ?? final（DB設計書 4.2）。どちらも null なら null。 */
export function effectiveScore(member: MemberScore): number | null {
  return member.overrideScore ?? member.finalScore;
}

/** 数値配列の平均。空配列は null（「メンバーがいない＝平均なし」を 0 と区別する）。 */
function average(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * チームスコア = 出場（regular）メンバーの実効スコア平均。
 * リザーブは含めない。スコアが算出できないメンバー（実効 null）は平均から除外する。
 * 出場メンバーが 0 人、または全員スコア不明なら null（「上限内」とも「超過」とも判定しない）。
 */
export function teamScore(members: MemberScore[]): number | null {
  const scores = members
    .filter((m) => m.position === "regular")
    .map(effectiveScore)
    .filter((s): s is number => s !== null);
  return average(scores);
}

/**
 * 上限超過の判定。cap が未設定（null）なら常に false（上限なし＝超過しない）。
 * score が null（出場者なし等）なら判定不能として false。
 */
export function isOverCap(
  score: number | null,
  cap: number | null,
): boolean {
  if (cap === null || score === null) return false;
  return score > cap;
}

/**
 * 交代シミュレーション（DB設計書 4.3・PR-2 で使用）。
 * 「あるリザーブを出す場合、どのレギュラーと交代すれば team_score_cap 以内か」を全候補算出する。
 * 仕様の擬似コードは全レギュラー総当たり。OW2 のロール構成維持が必要かは PR-2 で要確認
 * （同ロール限定に絞るか否か。現時点は仕様どおり総当たりで提示する）。
 */
export type SwapCandidate = {
  /** 抜けるレギュラーのメンバー id。 */
  outId: string;
  /** 入るリザーブのメンバー id。 */
  inId: string;
  /** 交代後のチームスコア（null なら算出不能）。 */
  newTeamScore: number | null;
  /** cap 以内なら true（cap 未設定時も true）。 */
  withinCap: boolean;
};

export function swapCandidates(
  members: MemberScore[],
  reserveId: string,
  cap: number | null,
): SwapCandidate[] {
  const reserve = members.find((m) => m.id === reserveId);
  if (!reserve) return [];
  const regulars = members.filter((m) => m.position === "regular");

  return regulars.map((out) => {
    // 仮編成 = 現レギュラー − out + reserve。
    const lineup: MemberScore[] = regulars
      .filter((r) => r.id !== out.id)
      .concat({ ...reserve, position: "regular" });
    const score = teamScore(lineup);
    return {
      outId: out.id,
      inId: reserve.id,
      newTeamScore: score,
      withinCap: !isOverCap(score, cap),
    };
  });
}
