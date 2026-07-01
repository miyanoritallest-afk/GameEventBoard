import { describe, it, expect } from "vitest";
import { aggregateRecipients } from "../notification-fanout";

/**
 * 宛先集約・重複排除（3.6.1）の単体テスト。純粋関数・全分岐。
 */

describe("aggregateRecipients", () => {
  it("単一集合はそのまま返す", () => {
    expect(aggregateRecipients([["a", "b", "c"]])).toEqual(["a", "b", "c"]);
  });

  it("複数集合を和集合し、ユーザー単位で重複排除する（1人1通）", () => {
    // シリーズフォロワー ∪ 主催者フォロワー。b が両方にいても1回だけ。
    const result = aggregateRecipients([
      ["a", "b"],
      ["b", "c"],
    ]);
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("同一集合内の重複も排除する", () => {
    expect(aggregateRecipients([["a", "a", "b"]])).toEqual(["a", "b"]);
  });

  it("除外ユーザー（出来事を起こした本人）は宛先から除く", () => {
    expect(aggregateRecipients([["a", "b", "c"]], ["b"])).toEqual(["a", "c"]);
  });

  it("除外は複数指定でき、和集合後に効く", () => {
    const result = aggregateRecipients(
      [
        ["a", "b"],
        ["c", "d"],
      ],
      ["a", "d"],
    );
    expect(result).toEqual(["b", "c"]);
  });

  it("空集合・全除外は空配列", () => {
    expect(aggregateRecipients([])).toEqual([]);
    expect(aggregateRecipients([["a"]], ["a"])).toEqual([]);
  });

  it("順序は入力順・初出優先で安定", () => {
    const result = aggregateRecipients([
      ["c", "a"],
      ["b", "a"],
    ]);
    expect(result).toEqual(["c", "a", "b"]);
  });
});
