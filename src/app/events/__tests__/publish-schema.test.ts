import { describe, it, expect } from "vitest";
import { publishEventSchema } from "../schema";

/**
 * 公開時バリデーション（publishEventSchema）の単体テスト。
 * 検証対象は「保存済みイベントの値」（ISO 文字列 / null / 数値）。
 * 下書きで緩めた日程・締切・定員が、公開時には必須化されることを固定する。
 */

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

/** 公開可能な完全入力（保存済み Row 相当）。各テストで上書きして使う。 */
function fullEvent(overrides: Record<string, unknown> = {}) {
  return {
    title: "テスト大会",
    game_id: VALID_UUID,
    starts_at: "2026-07-01T01:00:00.000Z",
    ends_at: "2026-07-01T05:00:00.000Z",
    recruit_deadline: "2026-06-30T12:00:00.000Z",
    capacity: 8,
    ...overrides,
  };
}

describe("publishEventSchema — 公開可能な完全入力", () => {
  it("日程・締切・定員がそろっていれば公開できる", () => {
    expect(publishEventSchema.safeParse(fullEvent()).success).toBe(true);
  });

  it("終了は null でも可（任意）", () => {
    expect(
      publishEventSchema.safeParse(fullEvent({ ends_at: null })).success,
    ).toBe(true);
  });
});

describe("publishEventSchema — 必須項目の欠落", () => {
  it("開催開始が null だと公開できない", () => {
    const result = publishEventSchema.safeParse(fullEvent({ starts_at: null }));
    expect(result.success).toBe(false);
    const msg = result.success
      ? undefined
      : result.error.issues.find((i) => i.path[0] === "starts_at")?.message;
    expect(msg).toBe("開催開始日時を設定してください");
  });

  it("募集締切が null だと公開できない", () => {
    const result = publishEventSchema.safeParse(
      fullEvent({ recruit_deadline: null }),
    );
    expect(result.success).toBe(false);
  });

  it("定員が null（未設定）でも公開できる（公開時も任意）", () => {
    const result = publishEventSchema.safeParse(fullEvent({ capacity: null }));
    expect(result.success).toBe(true);
  });

  it("定員を設定する場合は0以下だと公開できない", () => {
    expect(
      publishEventSchema.safeParse(fullEvent({ capacity: 0 })).success,
    ).toBe(false);
  });
});

describe("publishEventSchema — 期間・締切の整合", () => {
  it("終了が開始より前だと失敗する", () => {
    const result = publishEventSchema.safeParse(
      fullEvent({
        starts_at: "2026-07-01T05:00:00.000Z",
        ends_at: "2026-07-01T01:00:00.000Z",
      }),
    );
    expect(result.success).toBe(false);
  });

  it("募集締切が開始以降だと失敗する", () => {
    const result = publishEventSchema.safeParse(
      fullEvent({
        starts_at: "2026-07-01T01:00:00.000Z",
        recruit_deadline: "2026-07-01T02:00:00.000Z",
      }),
    );
    expect(result.success).toBe(false);
    const msg = result.success
      ? undefined
      : result.error.issues.find((i) => i.path[0] === "recruit_deadline")
          ?.message;
    expect(msg).toBe("募集締切は開催開始より前にしてください");
  });
});
