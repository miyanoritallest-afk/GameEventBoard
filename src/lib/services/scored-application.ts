import type { Cell, RoleSeasons, PeakTier } from "./scoring";

/**
 * スコアあり応募フォームの入力を、scoring.ts の calcScore へ渡す形へ整える純粋ロジック。
 *
 * フォームのグリッドは「ロール × シーズン」のセル文字列で来る:
 *   - 数値文字列（rank_definitions.score） → そのスコア
 *   - "uncertified" → 未認定（null）
 * これを RoleSeasons[]（Cell=number|null）に変換する。
 *
 * 対象ロール:
 *   - role_swap=true  → 全ロール（tank/dps/support）
 *   - role_swap=false → 希望ロール1つ
 */

export const ALL_ROLES = ["tank", "dps", "support"] as const;
export type Role = (typeof ALL_ROLES)[number];

/** "uncertified" または数値文字列を Cell に変換する。不正は null（未認定扱い）。 */
export function parseCell(raw: string | null | undefined): Cell {
  if (raw == null || raw === "" || raw === "uncertified") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * フォームから取り出した「ロール→シーズン配列」のセル文字列を RoleSeasons[] に変換する。
 * cellsByRole: { tank: ["30","uncertified",...], ... } の形。
 */
export function buildGrid(
  roles: readonly string[],
  cellsByRole: Record<string, (string | null)[]>,
): RoleSeasons[] {
  return roles.map((role) => ({
    role,
    seasons: (cellsByRole[role] ?? []).map((c) => parseCell(c)),
  }));
}

/** イベント設定から、入力対象のロール一覧を決める。 */
export function rolesForEvent(
  roleSwapAllowed: boolean,
  preferredRole: Role,
): readonly string[] {
  return roleSwapAllowed ? ALL_ROLES : [preferredRole];
}

/** peak 文字列の検証（不正は 'none'）。 */
export function parsePeak(raw: string | null | undefined): PeakTier {
  if (raw === "master" || raw === "gm" || raw === "champion") return raw;
  return "none";
}

/**
 * 第1・第2希望から第3希望（残り1ロール）を自動決定する純粋関数。
 * OW は3ロール固定なので、第1・第2が異なれば第3は一意に定まる。
 * first === second（不正）や該当なしのときは null。
 */
export function deriveThirdRole(
  first: Role | null,
  second: Role | null,
): Role | null {
  if (!first || !second || first === second) return null;
  return ALL_ROLES.find((r) => r !== first && r !== second) ?? null;
}
