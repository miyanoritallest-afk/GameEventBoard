import { describe, it, expect } from "vitest";
import {
  buildOverwatchRankDefinitions,
  OVERWATCH_TIERS,
} from "../overwatch-ranks";

/**
 * ランク定義生成の単体テスト。seed.sql と同一ルール（40段階・線形1〜40）を固定する。
 * ここがずれると DB seed とアプリの選択肢・スコア変換が食い違うため、契約として守る。
 */

const defs = buildOverwatchRankDefinitions();

describe("buildOverwatchRankDefinitions — 件数・構造", () => {
  it("8帯 × ディビジョン5 = 40件", () => {
    expect(defs).toHaveLength(40);
    expect(OVERWATCH_TIERS).toHaveLength(8);
  });

  it("label は一意（UNIQUE(game_id, label) に対応）", () => {
    const labels = new Set(defs.map((d) => d.label));
    expect(labels.size).toBe(40);
  });
});

describe("buildOverwatchRankDefinitions — スコアの線形性", () => {
  it("score は 1〜40 を過不足なく持つ", () => {
    const scores = defs.map((d) => d.score).sort((a, b) => a - b);
    expect(scores).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
  });

  it("最下位はブロンズ5=1、最上位はチャンピオン1=40", () => {
    const bronze5 = defs.find((d) => d.label === "ブロンズ5");
    const champion1 = defs.find((d) => d.label === "チャンピオン1");
    expect(bronze5?.score).toBe(1);
    expect(champion1?.score).toBe(40);
  });

  it("同一帯ではディビジョンが小さい(=上位)ほどスコアが高い", () => {
    const gold5 = defs.find((d) => d.label === "ゴールド5")!;
    const gold1 = defs.find((d) => d.label === "ゴールド1")!;
    expect(gold1.score).toBeGreaterThan(gold5.score);
    // ゴールド(ord2): 5→11, 1→15
    expect(gold5.score).toBe(11);
    expect(gold1.score).toBe(15);
  });

  it("sortOrder は score と一致する", () => {
    for (const d of defs) expect(d.sortOrder).toBe(d.score);
  });
});

describe("buildOverwatchRankDefinitions — 帯の境界", () => {
  it("帯が上がるとスコアが連続して上がる（ブロンズ1=5 の次はシルバー5=6）", () => {
    const bronze1 = defs.find((d) => d.label === "ブロンズ1")!;
    const silver5 = defs.find((d) => d.label === "シルバー5")!;
    expect(bronze1.score).toBe(5);
    expect(silver5.score).toBe(6);
  });
});
