import { describe, it, expect } from "vitest";
import {
  bracketSize,
  seedOrder,
  generateBracket,
  extractSeededTeams,
  seedTournamentOnly,
  recomputeBracket,
  toOddBestOf,
  tournamentPodium,
  type SeedTeam,
  type TournamentSeedTeam,
  type BracketMatch,
  type StoredMatch,
  type StoredResult,
} from "../bracket";

/**
 * 決勝トーナメント（シングルエリミ）ブラケット生成の単体テスト。
 * 確定仕様（要件定義書 3.4.1 / 本戦-5a 壁打ち）を手計算値で固定する。
 */

describe("bracketSize — 進出数以上の最小2の累乗", () => {
  it("2の累乗はそのまま", () => {
    expect(bracketSize(2)).toBe(2);
    expect(bracketSize(4)).toBe(4);
    expect(bracketSize(8)).toBe(8);
  });

  it("中途半端な数は次の2の累乗へ切り上げ", () => {
    expect(bracketSize(3)).toBe(4);
    expect(bracketSize(5)).toBe(8);
    expect(bracketSize(6)).toBe(8);
    expect(bracketSize(9)).toBe(16);
  });

  it("1以下は1（防御）", () => {
    expect(bracketSize(1)).toBe(1);
    expect(bracketSize(0)).toBe(1);
  });
});

describe("seedOrder — 標準シードの並び", () => {
  it("size=2 は [1,2]", () => {
    expect(seedOrder(2)).toEqual([1, 2]);
  });

  it("size=4 は [1,4,2,3]（1vs4 上半分, 2vs3 下半分）", () => {
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
  });

  it("size=8 は [1,8,4,5,2,7,3,6]", () => {
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it("1位と2位は反対の山に入る（最後の決勝で当たる）", () => {
    const order = seedOrder(8);
    const pos1 = order.indexOf(1);
    const pos2 = order.indexOf(2);
    // 上半分(0..3) と 下半分(4..7) に分かれる。
    expect(pos1 < 4).toBe(true);
    expect(pos2 >= 4).toBe(true);
  });
});

describe("generateBracket — 2の累乗（BYEなし）", () => {
  it("4チーム: 1回戦2試合＋決勝1試合、シード配置どおり", () => {
    const teams = ["s1", "s2", "s3", "s4"]; // シード順
    const b = generateBracket(teams);
    // order=[1,4,2,3] → 1回戦: 1vs4(上半分), 2vs3(下半分) / 決勝: 未確定
    expect(b).toEqual<BracketMatch[]>([
      { round: 1, position: 0, teamAId: "s1", teamBId: "s4" },
      { round: 1, position: 1, teamAId: "s2", teamBId: "s3" },
      { round: 2, position: 0, teamAId: null, teamBId: null },
    ]);
  });

  it("8チーム: 1回戦4・準決勝2・決勝1の計7試合", () => {
    const teams = Array.from({ length: 8 }, (_, i) => `s${i + 1}`);
    const b = generateBracket(teams);
    const byRound = (r: number) => b.filter((m) => m.round === r).length;
    expect(byRound(1)).toBe(4);
    expect(byRound(2)).toBe(2);
    expect(byRound(3)).toBe(1);
    expect(b.length).toBe(7);
    // 1回戦の先頭は seedOrder の [1,8] → s1 vs s8。
    expect(b[0]).toEqual({
      round: 1,
      position: 0,
      teamAId: "s1",
      teamBId: "s8",
    });
  });
});

describe("generateBracket — BYE（不戦勝）あり", () => {
  it("6チーム8枠: 上位2シードが1回戦BYE→準決勝へ自動進出", () => {
    const teams = ["s1", "s2", "s3", "s4", "s5", "s6"]; // 6チーム → size 8
    const b = generateBracket(teams);

    // size=8, seedOrder=[1,8,4,5,2,7,3,6]。7,8番はBYE(null)。
    // 1回戦: (1,8)→s1 BYE / (4,5)=s4vs s5 / (2,7)→s2 BYE / (3,6)=s3vs s6
    const r1 = b.filter((m) => m.round === 1);
    expect(r1[0]).toEqual({ round: 1, position: 0, teamAId: "s1", teamBId: null });
    expect(r1[1]).toEqual({ round: 1, position: 1, teamAId: "s4", teamBId: "s5" });
    expect(r1[2]).toEqual({ round: 1, position: 2, teamAId: "s2", teamBId: null });
    expect(r1[3]).toEqual({ round: 1, position: 3, teamAId: "s3", teamBId: "s6" });

    // 準決勝(round2): pos0 は r1[0](s1 BYE)とr1[1](実試合)から → s1 自動進出・相手待ち。
    const r2 = b.filter((m) => m.round === 2);
    expect(r2[0]).toEqual({ round: 2, position: 0, teamAId: "s1", teamBId: null });
    // pos1 は r1[2](s2 BYE)とr1[3](実試合)から → s2 自動進出・相手待ち。
    expect(r2[1]).toEqual({ round: 2, position: 1, teamAId: "s2", teamBId: null });

    // 決勝(round3)は未確定。
    expect(b.filter((m) => m.round === 3)).toEqual([
      { round: 3, position: 0, teamAId: null, teamBId: null },
    ]);
  });

  it("3チーム4枠: 1位がBYE、2vs3が1回戦、決勝で合流", () => {
    const teams = ["s1", "s2", "s3"];
    const b = generateBracket(teams);
    // size=4, seedOrder=[1,4,2,3]。4番はBYE。
    const r1 = b.filter((m) => m.round === 1);
    expect(r1[0]).toEqual({ round: 1, position: 0, teamAId: "s1", teamBId: null });
    expect(r1[1]).toEqual({ round: 1, position: 1, teamAId: "s2", teamBId: "s3" });
    // 決勝: s1 自動進出、相手は s2vs s3 の勝者待ち。
    expect(b.filter((m) => m.round === 2)).toEqual([
      { round: 2, position: 0, teamAId: "s1", teamBId: null },
    ]);
  });
});

describe("generateBracket — 端ケース", () => {
  it("2チームは決勝1試合のみ", () => {
    expect(generateBracket(["a", "b"])).toEqual([
      { round: 1, position: 0, teamAId: "a", teamBId: "b" },
    ]);
  });

  it("1チーム以下は空（不成立）", () => {
    expect(generateBracket(["only"])).toEqual([]);
    expect(generateBracket([])).toEqual([]);
  });
});

describe("extractSeededTeams — 進出抽出とシード順", () => {
  function team(
    teamId: string,
    groupId: string,
    rank: number,
    points: number,
    mapDiff = 0,
    potg = 0,
  ): SeedTeam {
    return { teamId, groupId, rank, points, mapDiff, potg };
  }

  it("各ブロック上位2を抽出し、シード群(rank)→群内は勝点降順で並べる", () => {
    const teams = [
      team("A1", "A", 1, 9),
      team("A2", "A", 2, 6),
      team("A3", "A", 3, 3), // 進出外
      team("B1", "B", 1, 7),
      team("B2", "B", 2, 5),
      team("B3", "B", 3, 1), // 進出外
    ];
    const seeded = extractSeededTeams(teams, 2);
    // 1群(rank1): A1(9) > B1(7) / 2群(rank2): A2(6) > B2(5)
    expect(seeded).toEqual(["A1", "B1", "A2", "B2"]);
  });

  it("rank が同着で N を超えても全員進出する", () => {
    const teams = [
      team("A1", "A", 1, 9),
      team("A2a", "A", 2, 5),
      team("A2b", "A", 2, 5), // 2位同着
      team("B1", "B", 1, 8),
    ];
    // advanceCount=2 だが A は 2 位が 2 チーム同着 → 両方進出。
    const seeded = extractSeededTeams(teams, 2);
    expect(seeded).toContain("A2a");
    expect(seeded).toContain("A2b");
    expect(seeded.length).toBe(4);
    // 先頭2つは1群（A1,B1の順＝9>8）。
    expect(seeded.slice(0, 2)).toEqual(["A1", "B1"]);
  });

  it("群内タイブレーク: 勝点同じなら得失→POTGの降順", () => {
    const teams = [
      team("A1", "A", 1, 6, 5, 2),
      team("B1", "B", 1, 6, 5, 3), // 勝点・得失同じ、POTG多い
      team("C1", "C", 1, 6, 8, 0), // 得失が一番大きい
    ];
    const seeded = extractSeededTeams(teams, 1);
    // 勝点同→得失降順: C1(8) 先頭。A1とB1は得失同→POTG降順: B1(3)>A1(2)。
    expect(seeded).toEqual(["C1", "B1", "A1"]);
  });

  it("進出数を満たすチームがいなければ空", () => {
    const teams = [team("A3", "A", 3, 1)];
    expect(extractSeededTeams(teams, 2)).toEqual([]);
  });
});

describe("seedTournamentOnly — トーナメントのみ形式のシード順", () => {
  const t = (
    teamId: string,
    score: number | null,
    order: number,
  ): TournamentSeedTeam => ({ teamId, score, order });

  it("スコアあり: score 降順（強い順）", () => {
    const teams = [t("A", 20, 0), t("B", 30, 1), t("C", 25, 2)];
    expect(seedTournamentOnly(teams)).toEqual(["B", "C", "A"]);
  });

  it("スコアなし（全て null）: 作成順（order 昇順）", () => {
    const teams = [t("C", null, 2), t("A", null, 0), t("B", null, 1)];
    expect(seedTournamentOnly(teams)).toEqual(["A", "B", "C"]);
  });

  it("同スコアは作成順で安定化", () => {
    const teams = [t("B", 25, 1), t("A", 25, 0), t("C", 25, 2)];
    expect(seedTournamentOnly(teams)).toEqual(["A", "B", "C"]);
  });

  it("スコアあり・なし混在: スコアありを上位、なしは作成順で後ろ", () => {
    const teams = [t("X", null, 0), t("Y", 30, 3), t("Z", null, 1)];
    // Y(スコアあり)が先頭、残り X,Z はスコアなしなので作成順 X(0) < Z(1)。
    expect(seedTournamentOnly(teams)).toEqual(["Y", "X", "Z"]);
  });

  it("空配列は空", () => {
    expect(seedTournamentOnly([])).toEqual([]);
  });

  it("元配列を破壊しない（純粋）", () => {
    const teams = [t("A", 10, 0), t("B", 20, 1)];
    const snapshot = teams.map((x) => x.teamId);
    seedTournamentOnly(teams);
    expect(teams.map((x) => x.teamId)).toEqual(snapshot);
  });
});

describe("recomputeBracket — 勝者の自動進出と下流リセット", () => {
  /** 4チーム（BYEなし）のブラケット試合を作る。round1: m1=(a vs b), m2=(c vs d) / 決勝 m3。 */
  function bracket4(): StoredMatch[] {
    return [
      { matchId: "m1", round: 1, position: 0, teamAId: "a", teamBId: "b" },
      { matchId: "m2", round: 1, position: 1, teamAId: "c", teamBId: "d" },
      { matchId: "m3", round: 2, position: 0, teamAId: null, teamBId: null },
    ];
  }

  it("結果なしなら決勝スロットは未確定のまま", () => {
    const out = recomputeBracket(bracket4(), []);
    const final = out.find((m) => m.matchId === "m3")!;
    expect(final.teamAId).toBeNull();
    expect(final.teamBId).toBeNull();
    expect(out.every((m) => !m.shouldClearResult)).toBe(true);
  });

  it("1回戦の勝者が決勝の上/下スロットへ進出する", () => {
    const results: StoredResult[] = [
      { matchId: "m1", winnerTeamId: "a" }, // position0 の勝者 → 決勝 teamA
      { matchId: "m2", winnerTeamId: "d" }, // position1 の勝者 → 決勝 teamB
    ];
    const out = recomputeBracket(bracket4(), results);
    const final = out.find((m) => m.matchId === "m3")!;
    expect(final.teamAId).toBe("a");
    expect(final.teamBId).toBe("d");
  });

  it("1回戦を修正して勝者が変わると決勝スロットも変わる（決勝に結果なし）", () => {
    const results: StoredResult[] = [
      { matchId: "m1", winnerTeamId: "b" }, // a→b に修正
      { matchId: "m2", winnerTeamId: "c" },
    ];
    const out = recomputeBracket(bracket4(), results);
    const final = out.find((m) => m.matchId === "m3")!;
    expect(final.teamAId).toBe("b");
    expect(final.teamBId).toBe("c");
    expect(final.shouldClearResult).toBe(false); // 決勝に結果はないので削除なし
  });

  it("修正で決勝のチームが変わったら決勝の結果は無効化（削除指示）", () => {
    // 既存: m1勝者=a, m2勝者=c → 決勝 a vs c、決勝結果 winner=a。
    // 修正: m1勝者を b に変更 → 決勝スロットが b vs c になり、winner=a は居なくなる。
    const matches = bracket4();
    const results: StoredResult[] = [
      { matchId: "m1", winnerTeamId: "b" },
      { matchId: "m2", winnerTeamId: "c" },
      { matchId: "m3", winnerTeamId: "a" }, // 旧スロット(a vs c)で a が勝った記録
    ];
    const out = recomputeBracket(matches, results);
    const final = out.find((m) => m.matchId === "m3")!;
    expect(final.teamAId).toBe("b");
    expect(final.teamBId).toBe("c");
    expect(final.shouldClearResult).toBe(true); // a は新スロットに居ない → 無効化
  });

  it("勝者が決勝スロットに残っていれば決勝結果は保持", () => {
    // m1勝者=a のまま、m2勝者を c→d に変更。決勝は a vs d。決勝winner=a は残るので保持。
    const matches = bracket4();
    const results: StoredResult[] = [
      { matchId: "m1", winnerTeamId: "a" },
      { matchId: "m2", winnerTeamId: "d" },
      { matchId: "m3", winnerTeamId: "a" },
    ];
    const out = recomputeBracket(matches, results);
    const final = out.find((m) => m.matchId === "m3")!;
    expect(final.shouldClearResult).toBe(false);
  });

  it("多段連鎖: 準々決勝の修正で準決勝・決勝の結果が連鎖無効化", () => {
    // 8チーム3ラウンド。準々(r1)4試合, 準決(r2)2試合, 決勝(r3)1試合。
    const matches: StoredMatch[] = [
      { matchId: "q1", round: 1, position: 0, teamAId: "a", teamBId: "b" },
      { matchId: "q2", round: 1, position: 1, teamAId: "c", teamBId: "d" },
      { matchId: "q3", round: 1, position: 2, teamAId: "e", teamBId: "f" },
      { matchId: "q4", round: 1, position: 3, teamAId: "g", teamBId: "h" },
      { matchId: "s1", round: 2, position: 0, teamAId: null, teamBId: null },
      { matchId: "s2", round: 2, position: 1, teamAId: null, teamBId: null },
      { matchId: "f1", round: 3, position: 0, teamAId: null, teamBId: null },
    ];
    // 既存: q1=a,q2=c,q3=e,q4=g → s1(a vs c), s2(e vs g)。s1=a,s2=e → f1(a vs e), f1=a。
    // 修正: q1 を b 勝ちに。s1 は b vs c になり、s1結果winner=a は無効 → s1削除。
    //       s1が消えると f1 の上スロットが未確定 → f1結果winner=a も無効 → f1削除。
    const results: StoredResult[] = [
      { matchId: "q1", winnerTeamId: "b" }, // 修正
      { matchId: "q2", winnerTeamId: "c" },
      { matchId: "q3", winnerTeamId: "e" },
      { matchId: "q4", winnerTeamId: "g" },
      { matchId: "s1", winnerTeamId: "a" }, // 旧スロットの記録（無効になる）
      { matchId: "s2", winnerTeamId: "e" },
      { matchId: "f1", winnerTeamId: "a" }, // 旧スロットの記録（連鎖で無効）
    ];
    const out = recomputeBracket(matches, results);
    const byId = (id: string) => out.find((m) => m.matchId === id)!;

    expect(byId("s1").teamAId).toBe("b");
    expect(byId("s1").teamBId).toBe("c");
    expect(byId("s1").shouldClearResult).toBe(true); // a が居ない
    // s1の結果が無効化される＝f1上スロットは未確定に戻る。
    expect(byId("f1").teamAId).toBeNull();
    expect(byId("f1").teamBId).toBe("e"); // s2側は健在
    expect(byId("f1").shouldClearResult).toBe(true); // 両スロット未確定 → 無効
  });

  it("BYE: 1回戦で相手がいないチームは結果なしで次ラウンドへ自動進出", () => {
    // 3チーム4枠。m1=(s1 vs BYE), m2=(s2 vs s3), 決勝f。
    const matches: StoredMatch[] = [
      { matchId: "m1", round: 1, position: 0, teamAId: "s1", teamBId: null },
      { matchId: "m2", round: 1, position: 1, teamAId: "s2", teamBId: "s3" },
      { matchId: "f", round: 2, position: 0, teamAId: null, teamBId: null },
    ];
    // m1 は BYE（結果なし）、m2 に s2 勝ちを入力。
    const out = recomputeBracket(matches, [{ matchId: "m2", winnerTeamId: "s2" }]);
    const final = out.find((m) => m.matchId === "f")!;
    expect(final.teamAId).toBe("s1"); // BYE 自動進出
    expect(final.teamBId).toBe("s2"); // m2 の勝者
  });

  it("空配列は空を返す", () => {
    expect(recomputeBracket([], [])).toEqual([]);
  });
});

describe("toOddBestOf — トーナメントは奇数BO強制", () => {
  it("奇数はそのまま", () => {
    expect(toOddBestOf(3)).toBe(3);
    expect(toOddBestOf(5)).toBe(5);
    expect(toOddBestOf(1)).toBe(1);
  });
  it("偶数は1つ上の奇数へ", () => {
    expect(toOddBestOf(2)).toBe(3);
    expect(toOddBestOf(4)).toBe(5);
  });
  it("0以下は1、上限15", () => {
    expect(toOddBestOf(0)).toBe(1);
    expect(toOddBestOf(-2)).toBe(1);
    expect(toOddBestOf(14)).toBe(15);
    expect(toOddBestOf(16)).toBe(15);
  });
});

describe("generateBracket — 3位決定戦オプション", () => {
  it("thirdPlace=true で最終roundに position=1 の3位決定戦を追加", () => {
    const b = generateBracket(["s1", "s2", "s3", "s4"], { thirdPlace: true });
    // 4チーム: round1=2試合(準決勝), round2=決勝(pos0)＋3位決定戦(pos1)。
    const r2 = b.filter((m) => m.round === 2);
    expect(r2.length).toBe(2);
    expect(r2.find((m) => m.position === 0)).toBeTruthy(); // 決勝
    const third = r2.find((m) => m.position === 1)!; // 3位決定戦
    expect(third.teamAId).toBeNull();
    expect(third.teamBId).toBeNull();
  });

  it("thirdPlace 未指定なら3位決定戦は作らない（従来どおり）", () => {
    const b = generateBracket(["s1", "s2", "s3", "s4"]);
    expect(b.filter((m) => m.round === 2).length).toBe(1); // 決勝のみ
  });

  it("2チーム（準決勝なし）は thirdPlace=true でも作らない", () => {
    const b = generateBracket(["a", "b"], { thirdPlace: true });
    expect(b).toEqual([
      { round: 1, position: 0, teamAId: "a", teamBId: "b" },
    ]);
  });
});

describe("recomputeBracket — 3位決定戦への敗者進出", () => {
  /** 4チーム＋3位決定戦のブラケット。準決勝 sf1/sf2, 決勝 f, 3位決定戦 tp。 */
  function bracketWithThird(): StoredMatch[] {
    return [
      { matchId: "sf1", round: 1, position: 0, teamAId: "a", teamBId: "b" },
      { matchId: "sf2", round: 1, position: 1, teamAId: "c", teamBId: "d" },
      { matchId: "f", round: 2, position: 0, teamAId: null, teamBId: null },
      { matchId: "tp", round: 2, position: 1, teamAId: null, teamBId: null },
    ];
  }

  it("準決勝の勝者は決勝、敗者は3位決定戦へ", () => {
    const results: StoredResult[] = [
      { matchId: "sf1", winnerTeamId: "a" }, // 敗者 b
      { matchId: "sf2", winnerTeamId: "c" }, // 敗者 d
    ];
    const out = recomputeBracket(bracketWithThird(), results);
    const f = out.find((m) => m.matchId === "f")!;
    const tp = out.find((m) => m.matchId === "tp")!;
    expect(f.teamAId).toBe("a");
    expect(f.teamBId).toBe("c");
    expect(tp.teamAId).toBe("b"); // sf1 の敗者
    expect(tp.teamBId).toBe("d"); // sf2 の敗者
  });

  it("準決勝の修正で勝者が変わると決勝・3位決定戦の両方が連鎖無効化", () => {
    // 既存: sf1=a,sf2=c → 決勝(a vs c)=a, 3位決定戦(b vs d)=b。
    // 修正: sf1 を b 勝ちに。決勝は b vs c、3位決定戦は a vs d になり、両方の旧結果が無効。
    const results: StoredResult[] = [
      { matchId: "sf1", winnerTeamId: "b" }, // 修正（敗者が a に）
      { matchId: "sf2", winnerTeamId: "c" },
      { matchId: "f", winnerTeamId: "a" }, // 旧決勝(a vs c)の記録
      { matchId: "tp", winnerTeamId: "b" }, // 旧3位決定戦(b vs d)の記録
    ];
    const out = recomputeBracket(bracketWithThird(), results);
    const f = out.find((m) => m.matchId === "f")!;
    const tp = out.find((m) => m.matchId === "tp")!;
    expect(f.teamAId).toBe("b");
    expect(f.teamBId).toBe("c");
    expect(f.shouldClearResult).toBe(true); // a は新スロットに居ない
    expect(tp.teamAId).toBe("a"); // 新しい sf1 敗者
    expect(tp.teamBId).toBe("d");
    expect(tp.shouldClearResult).toBe(true); // b は新スロットに居ない
  });

  it("準決勝が片方未入力なら3位決定戦のスロットは片側だけ確定", () => {
    const results: StoredResult[] = [{ matchId: "sf1", winnerTeamId: "a" }];
    const out = recomputeBracket(bracketWithThird(), results);
    const tp = out.find((m) => m.matchId === "tp")!;
    expect(tp.teamAId).toBe("b"); // sf1 敗者
    expect(tp.teamBId).toBeNull(); // sf2 未確定
  });
});

describe("tournamentPodium — 表彰台", () => {
  function bracketWithThird(): StoredMatch[] {
    return [
      { matchId: "sf1", round: 1, position: 0, teamAId: "a", teamBId: "b" },
      { matchId: "sf2", round: 1, position: 1, teamAId: "c", teamBId: "d" },
      { matchId: "f", round: 2, position: 0, teamAId: "a", teamBId: "c" },
      { matchId: "tp", round: 2, position: 1, teamAId: "b", teamBId: "d" },
    ];
  }

  it("決勝確定で優勝・準優勝、3位決定戦勝者が3位", () => {
    const results: StoredResult[] = [
      { matchId: "sf1", winnerTeamId: "a" },
      { matchId: "sf2", winnerTeamId: "c" },
      { matchId: "f", winnerTeamId: "a" },
      { matchId: "tp", winnerTeamId: "d" },
    ];
    const podium = tournamentPodium(bracketWithThird(), results);
    expect(podium.champion).toBe("a");
    expect(podium.runnerUp).toBe("c");
    expect(podium.third).toEqual(["d"]); // 3位決定戦の勝者
  });

  it("3位決定戦なしなら準決勝敗者2チームが3位タイ", () => {
    // 3位決定戦カードを持たない4チームブラケット。
    const matches: StoredMatch[] = [
      { matchId: "sf1", round: 1, position: 0, teamAId: "a", teamBId: "b" },
      { matchId: "sf2", round: 1, position: 1, teamAId: "c", teamBId: "d" },
      { matchId: "f", round: 2, position: 0, teamAId: "a", teamBId: "c" },
    ];
    const results: StoredResult[] = [
      { matchId: "sf1", winnerTeamId: "a" }, // 敗者 b
      { matchId: "sf2", winnerTeamId: "c" }, // 敗者 d
      { matchId: "f", winnerTeamId: "a" },
    ];
    const podium = tournamentPodium(matches, results);
    expect(podium.champion).toBe("a");
    expect(podium.runnerUp).toBe("c");
    expect(podium.third.sort()).toEqual(["b", "d"]); // 3位タイ
  });

  it("決勝未確定なら優勝・準優勝は null", () => {
    const matches: StoredMatch[] = [
      { matchId: "f", round: 1, position: 0, teamAId: "a", teamBId: "b" },
    ];
    const podium = tournamentPodium(matches, []);
    expect(podium.champion).toBeNull();
    expect(podium.runnerUp).toBeNull();
    expect(podium.third).toEqual([]);
  });

  it("空配列は全て null/空", () => {
    expect(tournamentPodium([], [])).toEqual({
      champion: null,
      runnerUp: null,
      third: [],
    });
  });
});
