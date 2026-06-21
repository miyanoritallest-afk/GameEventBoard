import { describe, it, expect } from "vitest";
import {
  calcScore,
  type ScoringInput,
  type RoleSeasons,
} from "../scoring";

/**
 * スコア算出の網羅単体テスト（docs/スコアリング設計.md の確定仕様）。
 * role_swap 分岐 × 未認定補完3方式 × 端ケース × ボーナス を手計算値で固定する。
 */

const NO_BONUS = { master: 0, gm: 0, champion: 0 };

function input(overrides: Partial<ScoringInput>): ScoringInput {
  return {
    roleSwapAllowed: false,
    grid: [],
    handling: "exclude",
    peak: "none",
    bonus: NO_BONUS,
    ...overrides,
  };
}

function role(name: string, seasons: (number | null)[]): RoleSeasons {
  return { role: name, seasons };
}

describe("role_swap=false（担当ロール1つ）", () => {
  it("担当ロールの直近シーズン平均", () => {
    const r = calcScore(
      input({ roleSwapAllowed: false, grid: [role("dps", [30, 20, 25])] }),
    );
    expect(r.individualScore).toBe(25); // (30+20+25)/3
    expect(r.finalScore).toBe(25);
    expect(r.breakdown.method).toBe("single_role");
  });

  it("一部未認定はその分を除外して平均", () => {
    const r = calcScore(
      input({ roleSwapAllowed: false, grid: [role("dps", [30, null, 20])] }),
    );
    expect(r.individualScore).toBe(25); // (30+20)/2
  });

  it("希望ロールが全シーズン未認定 → score=null（応募可・スコアなし）", () => {
    const r = calcScore(
      input({ roleSwapAllowed: false, grid: [role("tank", [null, null])] }),
    );
    expect(r.individualScore).toBeNull();
    expect(r.finalScore).toBeNull();
  });
});

describe("role_swap=true / exclude（未認定は平均から除外）", () => {
  it("未認定セルを無視して全有効値の平均", () => {
    // tank: 30,30 / dps: 20,未認定 / sup: 10,10 → 有効値 [30,30,20,10,10] avg=20
    const r = calcScore(
      input({
        roleSwapAllowed: true,
        handling: "exclude",
        grid: [
          role("tank", [30, 30]),
          role("dps", [20, null]),
          role("sup", [10, 10]),
        ],
      }),
    );
    expect(r.individualScore).toBe(20);
    expect(r.breakdown.method).toBe("grid");
    expect(r.breakdown.handling).toBe("exclude");
  });
});

describe("role_swap=true / fill_by_season（縦軸=同ロール他シーズン平均で補完）", () => {
  it("未認定セルを同ロールの他シーズン平均で埋める", () => {
    // tank: [30, 未認定] → 行平均30で補完 → [30,30]
    // dps:  [20, 10]                         → [20,10]
    // 全値 [30,30,20,10] avg = 22.5
    const r = calcScore(
      input({
        roleSwapAllowed: true,
        handling: "fill_by_season",
        grid: [role("tank", [30, null]), role("dps", [20, 10])],
      }),
    );
    expect(r.individualScore).toBe(22.5);
  });

  it("同ロールが全シーズン未認定 → その行を除外", () => {
    // tank: [未認定,未認定] → 除外
    // dps:  [20, 10]        → [20,10] avg=15
    const r = calcScore(
      input({
        roleSwapAllowed: true,
        handling: "fill_by_season",
        grid: [role("tank", [null, null]), role("dps", [20, 10])],
      }),
    );
    expect(r.individualScore).toBe(15);
  });
});

describe("role_swap=true / fill_by_role（横軸=同シーズン他ロール平均で補完）", () => {
  it("未認定セルを同シーズンの他ロール平均で埋める", () => {
    // S1: tank30, dps20, sup未認定 → 列平均25で補完 → sup S1=25
    // S2: tank10, dps20, sup30
    // 補完後 [30,20,25, 10,20,30] avg = 22.5
    const r = calcScore(
      input({
        roleSwapAllowed: true,
        handling: "fill_by_role",
        grid: [
          role("tank", [30, 10]),
          role("dps", [20, 20]),
          role("sup", [null, 30]),
        ],
      }),
    );
    expect(r.individualScore).toBe(22.5);
  });

  it("同シーズンが全ロール未認定 → その列を除外", () => {
    // S1: 全未認定 → 列除外
    // S2: tank20, dps10 → [20,10] avg=15
    const r = calcScore(
      input({
        roleSwapAllowed: true,
        handling: "fill_by_role",
        grid: [role("tank", [null, 20]), role("dps", [null, 10])],
      }),
    );
    expect(r.individualScore).toBe(15);
  });
});

describe("全グリッド未認定 → null", () => {
  it("どの方式でも全未認定なら score=null", () => {
    for (const handling of ["exclude", "fill_by_role", "fill_by_season"] as const) {
      const r = calcScore(
        input({
          roleSwapAllowed: true,
          handling,
          grid: [role("tank", [null, null]), role("dps", [null, null])],
        }),
      );
      expect(r.individualScore).toBeNull();
      expect(r.finalScore).toBeNull();
    }
  });
});

describe("ボーナス（peak 到達）", () => {
  it("有効な peak の加点を final_score に足す", () => {
    const r = calcScore(
      input({
        roleSwapAllowed: false,
        grid: [role("dps", [20])],
        peak: "master",
        bonus: { master: 5, gm: 8, champion: 10 },
      }),
    );
    expect(r.individualScore).toBe(20);
    expect(r.finalScore).toBe(25); // 20 + 5
    expect(r.breakdown.bonusApplied).toBe(5);
  });

  it("peak=none は加点なし", () => {
    const r = calcScore(
      input({
        roleSwapAllowed: false,
        grid: [role("dps", [20])],
        peak: "none",
        bonus: { master: 5, gm: 8, champion: 10 },
      }),
    );
    expect(r.finalScore).toBe(20);
  });

  it("base が null なら final も null（ボーナスがあっても）", () => {
    const r = calcScore(
      input({
        roleSwapAllowed: false,
        grid: [role("tank", [null])],
        peak: "champion",
        bonus: { master: 5, gm: 8, champion: 10 },
      }),
    );
    expect(r.finalScore).toBeNull();
  });
});
