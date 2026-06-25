import { describe, it, expect } from "vitest";
import { snakeDraft, blockName, type DraftTeam } from "../snake-draft";

/**
 * 自動ブロック分け（スネークドラフト）の単体テスト。
 * 確定仕様（要件定義書 3.4.1 / 壁打ち）を手計算値で固定する:
 * - スコア降順 → 蛇行配置で平均強さを均す。
 * - 端数は余りを出さず先頭ブロックが少なくなる形で吸収。
 * - score=null は末尾。安定ソートで入力順を保つ。
 */

/** id とスコアからチームを作る短縮ヘルパ。 */
function team(id: string, score: number | null): DraftTeam {
  return { id, score };
}

describe("snakeDraft — 基本の蛇行配置", () => {
  it("割り切れる: 8チーム4ブロックで各2チーム・強さが均される", () => {
    // スコア 80..10 の8チームを 4 ブロックへ。
    const teams = [
      team("t80", 80),
      team("t70", 70),
      team("t60", 60),
      team("t50", 50),
      team("t40", 40),
      team("t30", 30),
      team("t20", 20),
      team("t10", 10),
    ];
    const blocks = snakeDraft(teams, 4);
    // 0巡目→: A=80,B=70,C=60,D=50 / 1巡目←: A=10,B=20,C=30,D=40
    expect(blocks).toEqual([
      ["t80", "t10"],
      ["t70", "t20"],
      ["t60", "t30"],
      ["t50", "t40"],
    ]);
    // 各ブロックの合計が均等（90）になる＝蛇行の狙いどおり。
    const sums = blocks.map((b) =>
      b.reduce((acc, id) => acc + Number(id.replace("t", "")), 0),
    );
    expect(sums).toEqual([90, 90, 90, 90]);
  });

  it("割り切れない: 15チーム4ブロックで先頭が1少なくなり余りは出ない", () => {
    const teams = Array.from({ length: 15 }, (_, i) =>
      team(`t${i + 1}`, 100 - i),
    ); // t1(100) .. t15(86) スコア降順
    const blocks = snakeDraft(teams, 4);
    // 15 = 3 + 4 + 4 + 4。端数は A が 1 少ない。
    expect(blocks.map((b) => b.length)).toEqual([3, 4, 4, 4]);
    // 全 15 チームが過不足なく配られる（余りなし）。
    expect(blocks.flat().sort()).toEqual(teams.map((t) => t.id).sort());
  });

  it("蛇行の向き: 巡ごとに向きが反転する（15チーム4ブロックの中身）", () => {
    const teams = Array.from({ length: 15 }, (_, i) =>
      team(`t${i + 1}`, 100 - i),
    );
    const blocks = snakeDraft(teams, 4);
    // 0→: A=t1,B=t2,C=t3,D=t4 / 1←: D=t5,C=t6,B=t7,A=t8
    // 2→: A=t9,B=t10,C=t11,D=t12 / 3←: D=t13,C=t14,B=t15
    expect(blocks).toEqual([
      ["t1", "t8", "t9"],
      ["t2", "t7", "t10", "t15"],
      ["t3", "t6", "t11", "t14"],
      ["t4", "t5", "t12", "t13"],
    ]);
  });
});

describe("snakeDraft — スコアの並べ替え", () => {
  it("入力がスコア順でなくても降順に並べてから配る", () => {
    const teams = [
      team("low", 10),
      team("high", 90),
      team("mid", 50),
    ];
    const blocks = snakeDraft(teams, 1);
    // 1ブロックなら降順そのまま。
    expect(blocks).toEqual([["high", "mid", "low"]]);
  });

  it("score=null は最下位として末尾に置く", () => {
    const teams = [
      team("a", 50),
      team("nullX", null),
      team("b", 80),
      team("nullY", null),
    ];
    const blocks = snakeDraft(teams, 1);
    // 降順: b(80), a(50), その後 null は入力順（nullX→nullY）。
    expect(blocks).toEqual([["b", "a", "nullX", "nullY"]]);
  });

  it("全員 null（非 require_score）は入力順のまま均等に蛇行配置", () => {
    const teams = [
      team("t1", null),
      team("t2", null),
      team("t3", null),
      team("t4", null),
      team("t5", null),
    ];
    const blocks = snakeDraft(teams, 2);
    // 入力順のまま 0→: A=t1,B=t2 / 1←: B=t3,A=t4 / 2→: A=t5
    expect(blocks).toEqual([
      ["t1", "t4", "t5"],
      ["t2", "t3"],
    ]);
  });

  it("同スコアは入力順を保つ（安定ソート）", () => {
    const teams = [
      team("first", 50),
      team("second", 50),
      team("third", 50),
    ];
    const blocks = snakeDraft(teams, 1);
    expect(blocks).toEqual([["first", "second", "third"]]);
  });
});

describe("snakeDraft — 端ケース", () => {
  it("N=1 は全チームを1ブロックに（降順）", () => {
    const teams = [team("a", 10), team("b", 30), team("c", 20)];
    expect(snakeDraft(teams, 1)).toEqual([["b", "c", "a"]]);
  });

  it("チーム0件でも blockCount 個の空ブロックを返す", () => {
    expect(snakeDraft([], 3)).toEqual([[], [], []]);
  });

  it("ブロック数がチーム数を上回ると空ブロックが混ざる", () => {
    const teams = [team("a", 50), team("b", 30)];
    // 2チーム3ブロック: A=a, B=b, C=空。
    expect(snakeDraft(teams, 3)).toEqual([["a"], ["b"], []]);
  });

  it("blockCount<1 は空配列", () => {
    expect(snakeDraft([team("a", 1)], 0)).toEqual([]);
    expect(snakeDraft([team("a", 1)], -1)).toEqual([]);
  });
});

describe("blockName — A..Z..AA", () => {
  it("0始まりで A, B, C", () => {
    expect(blockName(0)).toBe("A");
    expect(blockName(1)).toBe("B");
    expect(blockName(25)).toBe("Z");
  });

  it("26以降は AA, AB", () => {
    expect(blockName(26)).toBe("AA");
    expect(blockName(27)).toBe("AB");
  });
});
