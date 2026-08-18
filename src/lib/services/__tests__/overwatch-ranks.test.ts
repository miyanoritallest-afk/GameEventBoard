import { describe, it, expect } from "vitest";
import {
  buildOverwatchRankDefinitions,
  scoreToRankLabel,
  scoreToRankAbbrev,
  OVERWATCH_TIERS,
} from "../overwatch-ranks";

/**
 * ランク定義生成の単体テスト。seed.sql と同一ルール（45段階・線形1〜45）を固定する。
 * ここがずれると DB seed とアプリの選択肢・スコア変換が食い違うため、契約として守る。
 *
 * エメラルド（プラチナとダイヤの間・マイグレーション 0038）追加後の値を固定する。
 */

const defs = buildOverwatchRankDefinitions();

describe("buildOverwatchRankDefinitions — 件数・構造", () => {
  it("9帯 × ディビジョン5 = 45件", () => {
    expect(defs).toHaveLength(45);
    expect(OVERWATCH_TIERS).toHaveLength(9);
  });

  it("label は一意（UNIQUE(game_id, label) に対応）", () => {
    const labels = new Set(defs.map((d) => d.label));
    expect(labels.size).toBe(45);
  });
});

describe("buildOverwatchRankDefinitions — スコアの線形性", () => {
  it("score は 1〜45 を過不足なく持つ", () => {
    const scores = defs.map((d) => d.score).sort((a, b) => a - b);
    expect(scores).toEqual(Array.from({ length: 45 }, (_, i) => i + 1));
  });

  it("最下位はブロンズ5=1、最上位はチャンピオン1=45", () => {
    const bronze5 = defs.find((d) => d.label === "ブロンズ5");
    const champion1 = defs.find((d) => d.label === "チャンピオン1");
    expect(bronze5?.score).toBe(1);
    expect(champion1?.score).toBe(45);
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

  it("エメラルドはプラチナとダイヤの間（プラチナ1=20 → エメラルド5=21 … 1=25 → ダイヤ5=26）", () => {
    const platinum1 = defs.find((d) => d.label === "プラチナ1")!;
    const emerald5 = defs.find((d) => d.label === "エメラルド5")!;
    const emerald1 = defs.find((d) => d.label === "エメラルド1")!;
    const diamond5 = defs.find((d) => d.label === "ダイヤ5")!;
    expect(platinum1.score).toBe(20);
    expect(emerald5.score).toBe(21);
    expect(emerald1.score).toBe(25);
    expect(diamond5.score).toBe(26);
  });

  it("エメラルド新設でプラチナ以下は不変・ダイヤ以上は一律 +5（0038 の再採番と一致）", () => {
    // 0038 は既存 DB の「ダイヤ以上」に +5 する。生成側もその結果と一致すること。
    expect(defs.find((d) => d.label === "ブロンズ5")!.score).toBe(1); // 旧 1
    expect(defs.find((d) => d.label === "ゴールド3")!.score).toBe(13); // 旧 13
    expect(defs.find((d) => d.label === "プラチナ1")!.score).toBe(20); // 旧 20
    expect(defs.find((d) => d.label === "ダイヤ3")!.score).toBe(28); // 旧 23
    expect(defs.find((d) => d.label === "マスター1")!.score).toBe(35); // 旧 30
    expect(defs.find((d) => d.label === "チャンピオン1")!.score).toBe(45); // 旧 40
  });

  it("帯の序列は上位から チャンピオン > GM > マスター > ダイヤ > エメラルド > プラチナ", () => {
    const scoreOf = (label: string) =>
      defs.find((d) => d.label === label)!.score;
    const order = [
      "チャンピオン5",
      "グランドマスター5",
      "マスター5",
      "ダイヤ5",
      "エメラルド5",
      "プラチナ5",
    ].map(scoreOf);
    // 上位ほどスコアが高い＝降順に並んでいること。
    expect(order).toEqual([...order].sort((a, b) => b - a));
  });
});

describe("scoreToRankLabel — スコア→ランク名の逆引き", () => {
  it("整数スコアは対応するラベル", () => {
    expect(scoreToRankLabel(1)).toBe("ブロンズ5");
    expect(scoreToRankLabel(45)).toBe("チャンピオン1");
    expect(scoreToRankLabel(23)).toBe("エメラルド3");
  });

  it("null は未認定", () => {
    expect(scoreToRankLabel(null)).toBe("未認定");
  });

  it("補完で生じた中間値は『相当』表記（最も近い段階）", () => {
    // 22.5 は最も近い 22 or 23 のラベル＋相当。
    expect(scoreToRankLabel(22.5)).toContain("相当");
  });
});

describe("scoreToRankAbbrev — スコア→ランク略称（上限ガイド用）", () => {
  it("帯の略称＋ディビジョンを返す", () => {
    expect(scoreToRankAbbrev(1)).toBe("B5"); // ブロンズ5
    expect(scoreToRankAbbrev(28)).toBe("D3"); // ダイヤ3
    expect(scoreToRankAbbrev(45)).toBe("C1"); // チャンピオン1
    expect(scoreToRankAbbrev(26)).toBe("D5"); // ダイヤ5
  });

  it("エメラルドは E 略称（ord4: 5→21 … 1→25）", () => {
    expect(scoreToRankAbbrev(21)).toBe("E5");
    expect(scoreToRankAbbrev(25)).toBe("E1");
  });

  it("グランドマスターは2文字略称（GM）", () => {
    // GM は ord7: 5→36 … 1→40。
    expect(scoreToRankAbbrev(36)).toBe("GM5");
    expect(scoreToRankAbbrev(40)).toBe("GM1");
  });

  it("null は未認定", () => {
    expect(scoreToRankAbbrev(null)).toBe("未認定");
  });
});
