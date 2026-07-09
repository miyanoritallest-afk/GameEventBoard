/**
 * トーナメントのラウンド番号 → ラベル（最終ラウンド=決勝, その前=準決勝…）。
 * 決勝トーナメント詳細（tournament）と観戦ビュー（watch）で同じ呼称を使うため共通化する
 * （純粋関数なので server / client どちらからでも import できる）。
 */
export function roundLabel(round: number, totalRounds: number): string {
  const fromLast = totalRounds - round; // 0=決勝, 1=準決勝, 2=準々決勝
  if (fromLast === 0) return "決勝";
  if (fromLast === 1) return "準決勝";
  if (fromLast === 2) return "準々決勝";
  return `${round}回戦`;
}
