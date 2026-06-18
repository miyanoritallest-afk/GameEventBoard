// プロトタイプ用のダミーデータ・型・スコアロジック。
// 認証・DBには繋がない。イメージ確認専用。設計ドキュメントの用語に合わせている。

export type Role = "tank" | "dps" | "support";

export const ROLE_LABEL: Record<Role, string> = {
  tank: "タンク",
  dps: "DPS",
  support: "サポート",
};

// OW2 ランク帯 → スコア（ブロンズ5=1 … チャンピオン1=40 のイメージ）
export const RANK_OPTIONS: { label: string; score: number }[] = [
  { label: "ブロンズ5", score: 1 },
  { label: "ブロンズ1", score: 5 },
  { label: "シルバー3", score: 9 },
  { label: "ゴールド3", score: 15 },
  { label: "プラチナ3", score: 21 },
  { label: "ダイヤ3", score: 27 },
  { label: "マスター3", score: 33 },
  { label: "グランドマスター3", score: 37 },
  { label: "チャンピオン1", score: 40 },
];

export type Player = {
  id: string;
  name: string; // Battle Tag 風
  role: Role;
  finalScore: number; // 個人ファイナルスコア（②）
  position: "regular" | "reserve";
};

// チーム平均スコアの上限（イベント設定: team_score_cap のイメージ）
export const TEAM_SCORE_CAP = 23.0;

// ダミーのチーム（OW2: タンク1 / DPS2 / サポート2 + リザーブ）
export const INITIAL_ROSTER: Player[] = [
  { id: "p1", name: "Raiden#1234", role: "tank", finalScore: 27, position: "regular" },
  { id: "p2", name: "Frost#0001", role: "dps", finalScore: 24, position: "regular" },
  { id: "p3", name: "Vortex#7777", role: "dps", finalScore: 22, position: "regular" },
  { id: "p4", name: "Lumen#2020", role: "support", finalScore: 20, position: "regular" },
  { id: "p5", name: "Echo#5050", role: "support", finalScore: 18, position: "regular" },
  // リザーブ
  { id: "r1", name: "Blaze#3030", role: "dps", finalScore: 31, position: "reserve" },
  { id: "r2", name: "Sage#9090", role: "support", finalScore: 16, position: "reserve" },
];

export function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

// チームスコア = 出場(regular)メンバーの finalScore 平均
export function teamScore(players: Player[]): number {
  const regulars = players.filter((p) => p.position === "regular");
  return average(regulars.map((p) => p.finalScore));
}

// 交代シミュレーション: あるリザーブを「同じロールのレギュラー」と交代した場合の
// チームスコアと上限内かどうかを全候補で算出（DB設計書 4.3 のイメージ）
export type SwapCandidate = {
  outPlayer: Player; // 抜けるレギュラー
  newTeamScore: number;
  withinCap: boolean;
};

export function swapCandidates(
  roster: Player[],
  reserve: Player,
  cap: number,
): SwapCandidate[] {
  const regulars = roster.filter((p) => p.position === "regular");
  // 実際の交代は同ロール同士が基本（OW2のロール構成を保つため）
  return regulars
    .filter((r) => r.role === reserve.role)
    .map((out) => {
      const lineup = regulars.filter((r) => r.id !== out.id).concat(reserve);
      const score = average(lineup.map((p) => p.finalScore));
      return {
        outPlayer: out,
        newTeamScore: score,
        withinCap: score <= cap,
      };
    });
}
