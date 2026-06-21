import { describe, it, expect } from "vitest";
import {
  parseCell,
  buildGrid,
  rolesForEvent,
  parsePeak,
} from "../scored-application";

describe("parseCell", () => {
  it("数値文字列はその数値", () => {
    expect(parseCell("30")).toBe(30);
  });
  it("uncertified / 空 / null は未認定(null)", () => {
    expect(parseCell("uncertified")).toBeNull();
    expect(parseCell("")).toBeNull();
    expect(parseCell(null)).toBeNull();
  });
  it("不正な値は null", () => {
    expect(parseCell("abc")).toBeNull();
  });
});

describe("buildGrid", () => {
  it("ロール→シーズン文字列を Cell グリッドに変換", () => {
    const grid = buildGrid(["tank", "dps"], {
      tank: ["30", "uncertified"],
      dps: ["20", "10"],
    });
    expect(grid).toEqual([
      { role: "tank", seasons: [30, null] },
      { role: "dps", seasons: [20, 10] },
    ]);
  });
});

describe("rolesForEvent", () => {
  it("role_swap=true は全ロール", () => {
    expect(rolesForEvent(true, "dps")).toEqual(["tank", "dps", "support"]);
  });
  it("role_swap=false は希望ロール1つ", () => {
    expect(rolesForEvent(false, "support")).toEqual(["support"]);
  });
});

describe("parsePeak", () => {
  it("有効な peak はそのまま", () => {
    expect(parsePeak("master")).toBe("master");
    expect(parsePeak("champion")).toBe("champion");
  });
  it("不正・未指定は none", () => {
    expect(parsePeak("invalid")).toBe("none");
    expect(parsePeak(null)).toBe("none");
  });
});
