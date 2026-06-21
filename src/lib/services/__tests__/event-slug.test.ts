import { describe, it, expect } from "vitest";
import {
  generateEventSlug,
  generateSlugSuffix,
  isValidEventSlug,
  type RandomFn,
} from "../event-slug";

/**
 * slug 生成ロジックの単体テスト（純粋関数。乱数源を差し替えて決定的に検証）。
 */

/** 常に同じ値を返す乱数源（先頭文字に固定される）。 */
const zero: RandomFn = () => 0;
/** 呼ぶたびに与えた数列を順に返す乱数源。 */
function seq(values: number[]): RandomFn {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("generateSlugSuffix", () => {
  it("既定で6桁を生成する", () => {
    expect(generateSlugSuffix(6, zero)).toHaveLength(6);
  });

  it("長さを指定できる", () => {
    expect(generateSlugSuffix(10, zero)).toHaveLength(10);
  });

  it("乱数源が0なら先頭文字（2）が並ぶ", () => {
    // ALPHABET = "23456789abc..." の先頭は "2"。
    expect(generateSlugSuffix(4, zero)).toBe("2222");
  });

  it("紛らわしい文字（0,1,o,l,i）を含まない", () => {
    const suffix = generateSlugSuffix(50, seq([0, 0.2, 0.4, 0.6, 0.8, 0.99]));
    expect(suffix).not.toMatch(/[01oli]/);
  });
});

describe("generateEventSlug", () => {
  it("event- プレフィックス付きで生成する", () => {
    expect(generateEventSlug(zero)).toBe("event-222222");
  });

  it("生成結果は isValidEventSlug を満たす", () => {
    expect(isValidEventSlug(generateEventSlug(Math.random))).toBe(true);
  });
});

describe("isValidEventSlug", () => {
  it("正しい形式を受理する（許可文字のみ・6桁）", () => {
    expect(isValidEventSlug("event-a2b3c4")).toBe(true);
  });

  it("プレフィックス無し・桁数違い・禁止文字は拒否する", () => {
    expect(isValidEventSlug("a2b3c4")).toBe(false); // prefix なし
    expect(isValidEventSlug("event-abc")).toBe(false); // 桁不足
    expect(isValidEventSlug("event-a2b3c4d5")).toBe(false); // 桁過多
    expect(isValidEventSlug("event-0o1li2")).toBe(false); // 禁止文字(0,o,1,l,i)
  });
});
