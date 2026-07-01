/**
 * 出来事→通知の宛先集約・重複排除（Service 層・純粋関数）。副作用なし・テストの主役。
 *
 * 要件定義書 3.6.1 の核心: 「誰がフォローしているか」ではなく「何が起きたか（出来事）」を
 * 起点に、複数のフォロワー集合を和集合して**ユーザー単位で重複排除**し、1人1通にする。
 * 複数対象（例: シリーズ＋主催者）を同一ユーザーがフォローしていても通知は1通。
 *
 * ここは純粋に「宛先 user_id の集合を決める」だけ。DB 取得（フォロワー列挙）は Repository、
 * 実際の生成（notifications INSERT）は Controller が行う。DB 側の UNIQUE(user_id,
 * source_event_id) が最終防衛（この純粋関数がすり抜けても二重生成は物理的に起きない）。
 */

/**
 * 複数のフォロワー集合を和集合＋重複排除し、除外ユーザー（通常は出来事を起こした本人）を
 * 除いた宛先 user_id 配列を返す。順序は入力順・初出優先で安定させる（テスト容易性）。
 */
export function aggregateRecipients(
  followerSets: string[][],
  excludeUserIds: string[] = [],
): string[] {
  const exclude = new Set(excludeUserIds);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const set of followerSets) {
    for (const userId of set) {
      if (exclude.has(userId)) continue;
      if (seen.has(userId)) continue;
      seen.add(userId);
      result.push(userId);
    }
  }
  return result;
}
