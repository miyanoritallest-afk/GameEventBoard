import { describe, it, expect } from "vitest";
import {
  canRegister,
  canDecide,
  registerRejectionReason,
  type EventStatus,
  type RegStatus,
} from "../registration-status";

/**
 * 応募の状態ロジックの単体テスト（純粋関数・全分岐）。
 */

describe("canRegister", () => {
  it("公開中（draft 以外）は応募できる", () => {
    for (const s of [
      "published",
      "recruiting",
      "closed",
      "ongoing",
      "finished",
    ] as EventStatus[]) {
      expect(canRegister(s)).toBe(true);
    }
  });

  it("下書きには応募できない", () => {
    expect(canRegister("draft")).toBe(false);
  });
});

describe("registerRejectionReason", () => {
  it("下書きは『まだ公開されていません』", () => {
    expect(registerRejectionReason("draft")).toContain("公開されていません");
  });

  it("その他は『応募できません』", () => {
    expect(registerRejectionReason("finished")).toContain("応募できません");
  });
});

describe("canDecide", () => {
  it("pending のときだけ承認/却下できる", () => {
    expect(canDecide("pending")).toBe(true);
  });

  it("pending 以外は処理できない", () => {
    for (const s of ["approved", "rejected", "withdrawn"] as RegStatus[]) {
      expect(canDecide(s)).toBe(false);
    }
  });
});
