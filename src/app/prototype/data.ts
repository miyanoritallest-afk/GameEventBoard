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

// ====== イベント一覧・詳細 用ダミーデータ ======
export type EventTag = "初心者歓迎" | "ランクフリー" | "賞金あり" | "5v5" | "長期リーグ";

export type EventCard = {
  id: string;
  series?: string; // シリーズ名（単発はなし）
  title: string;
  organizer: string;
  startsAt: string; // 表示用文字列
  status: "募集中" | "募集終了" | "開催中" | "終了";
  capacity: number; // チーム数
  applied: number; // 応募済みチーム数
  tags: EventTag[];
  game: string;
};

export const EVENTS: EventCard[] = [
  {
    id: "osl-s3",
    series: "OSL（社会人OW部リーグ）",
    title: "OSL Season3",
    organizer: "Raiden#1234",
    startsAt: "2026/07/05 21:00",
    status: "募集中",
    capacity: 12,
    applied: 8,
    tags: ["長期リーグ", "5v5"],
    game: "Overwatch 2",
  },
  {
    id: "beginner-cup",
    title: "わいわい初心者カップ #4",
    organizer: "Lumen#2020",
    startsAt: "2026/06/28 20:00",
    status: "募集中",
    capacity: 8,
    applied: 3,
    tags: ["初心者歓迎", "ランクフリー", "5v5"],
    game: "Overwatch 2",
  },
  {
    id: "summer-clash",
    title: "Summer Clash 2026",
    organizer: "Frost#0001",
    startsAt: "2026/08/10 19:00",
    status: "募集中",
    capacity: 16,
    applied: 16,
    tags: ["賞金あり", "5v5"],
    game: "Overwatch 2",
  },
  {
    id: "osl-s2",
    series: "OSL（社会人OW部リーグ）",
    title: "OSL Season2",
    organizer: "Raiden#1234",
    startsAt: "2026/03/01 21:00",
    status: "終了",
    capacity: 12,
    applied: 12,
    tags: ["長期リーグ", "5v5"],
    game: "Overwatch 2",
  },
];

// ====== 試合スケジュール・順位表 用ダミーデータ ======
export type Standing = {
  rank: number;
  team: string;
  wins: number;
  losses: number;
  points: number;
};

export const GROUP_A_STANDINGS: Standing[] = [
  { rank: 1, team: "誇り高きOTP", wins: 3, losses: 0, points: 9 },
  { rank: 2, team: "TOXIC HONEY GARDEN", wins: 2, losses: 1, points: 6 },
  { rank: 3, team: "ビジネスごめんなさい", wins: 1, losses: 2, points: 3 },
  { rank: 4, team: "特攻野郎チームA", wins: 0, losses: 3, points: 0 },
];

export type ScheduledMatch = {
  id: string;
  date: string; // 表示用
  time: string;
  phase: "予選グループA" | "予選グループB" | "決勝トーナメント";
  teamA: string;
  teamB: string;
  status: "予定" | "配信あり" | "終了";
  scoreA?: number;
  scoreB?: number;
  streamer?: string;
};

export const MATCHES: ScheduledMatch[] = [
  {
    id: "m1",
    date: "7/12 (土)",
    time: "21:00",
    phase: "予選グループA",
    teamA: "誇り高きOTP",
    teamB: "特攻野郎チームA",
    status: "配信あり",
    streamer: "raiden_tv",
  },
  {
    id: "m2",
    date: "7/12 (土)",
    time: "22:00",
    phase: "予選グループA",
    teamA: "TOXIC HONEY GARDEN",
    teamB: "ビジネスごめんなさい",
    status: "予定",
  },
  {
    id: "m3",
    date: "7/5 (土)",
    time: "21:00",
    phase: "予選グループA",
    teamA: "誇り高きOTP",
    teamB: "ビジネスごめんなさい",
    status: "終了",
    scoreA: 3,
    scoreB: 1,
  },
  {
    id: "m4",
    date: "7/19 (土)",
    time: "21:00",
    phase: "決勝トーナメント",
    teamA: "誇り高きOTP",
    teamB: "TOXIC HONEY GARDEN",
    status: "予定",
  },
];
