import { describe, it, expect } from "vitest";
import {
  dateToLocalInput,
  localInputToDate,
  formatLocalInputForDisplay,
  HOUR_OPTIONS,
  MINUTE_STEPS,
} from "../datetime-local";

/**
 * datetime-local 互換変換の単体テスト。
 * 最重要: 出力形式が "YYYY-MM-DDTHH:mm"（datetime-local と同一）であること。
 * これが崩れると Server Action の jstLocalToUtcIso が壊れる。
 */

describe("dateToLocalInput", () => {
  it("Date を YYYY-MM-DDTHH:mm に整形する（ゼロ埋め）", () => {
    // 2026-08-01 20:05（ローカル値そのまま）
    const d = new Date(2026, 7, 1, 20, 5);
    expect(dateToLocalInput(d)).toBe("2026-08-01T20:05");
  });

  it("1桁の月日時分をゼロ埋めする", () => {
    const d = new Date(2026, 0, 3, 9, 7);
    expect(dateToLocalInput(d)).toBe("2026-01-03T09:07");
  });
});

describe("localInputToDate", () => {
  it("正しい文字列を Date に戻す（往復一致）", () => {
    const s = "2026-08-01T20:15";
    const d = localInputToDate(s);
    expect(d).not.toBeNull();
    expect(dateToLocalInput(d as Date)).toBe(s);
  });

  it("秒付きでも分まで解釈する", () => {
    const d = localInputToDate("2026-08-01T20:15:30");
    expect(dateToLocalInput(d as Date)).toBe("2026-08-01T20:15");
  });

  it("空・不正なら null", () => {
    expect(localInputToDate("")).toBeNull();
    expect(localInputToDate(null)).toBeNull();
    expect(localInputToDate("not-a-date")).toBeNull();
  });
});

describe("formatLocalInputForDisplay", () => {
  it("表示用 YYYY/MM/DD HH:mm に整形する", () => {
    expect(formatLocalInputForDisplay("2026-08-01T20:00")).toBe(
      "2026/08/01 20:00",
    );
  });

  it("空なら空文字", () => {
    expect(formatLocalInputForDisplay("")).toBe("");
    expect(formatLocalInputForDisplay(null)).toBe("");
  });
});

describe("選択肢", () => {
  it("分は15分刻みの4つ", () => {
    expect(MINUTE_STEPS).toEqual(["00", "15", "30", "45"]);
  });

  it("時は00〜23の24個", () => {
    expect(HOUR_OPTIONS).toHaveLength(24);
    expect(HOUR_OPTIONS[0]).toBe("00");
    expect(HOUR_OPTIONS[23]).toBe("23");
  });
});
