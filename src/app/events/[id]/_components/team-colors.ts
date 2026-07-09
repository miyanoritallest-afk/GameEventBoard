/**
 * チームの識別色（Claude Design 案準拠）。ブロック内の並び順（index）で循環割当。
 * マトリクス・順位表・観戦ビューなど、チームを色で識別する箇所で共通利用する
 * （純粋関数なので server / client どちらからでも import できる）。
 */
export const TEAM_COLORS = [
  "#FF6A2B",
  "#22D3EE",
  "#45C08A",
  "#F5B93D",
  "#5B93F0",
  "#A78BFA",
  "#F2685A",
  "#E8637F",
] as const;

export function teamColor(index: number): string {
  return TEAM_COLORS[index % TEAM_COLORS.length];
}
