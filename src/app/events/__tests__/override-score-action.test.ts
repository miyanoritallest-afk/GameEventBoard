import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * overrideRegistrationScore の結合テスト（Supabase/Repository/revalidatePath をモック）。
 * 固定: 認可（2テーブル跨ぎ所有権=IDOR）・上書き値の検証・クリア（null）・成功更新。
 */

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  findRegistrationWithEvent: vi.fn(),
  setOverrideScore: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })),
}));

vi.mock("@/lib/repositories/registrations", () => ({
  findRegistration: vi.fn(),
  insertRegistration: vi.fn(),
  findRegistrationWithEvent: mocks.findRegistrationWithEvent,
  decideRegistration: vi.fn(),
  setOverrideScore: mocks.setOverrideScore,
}));

vi.mock("@/lib/repositories/events", () => ({
  findEventById: vi.fn(),
  findEventBySlug: vi.fn(),
  insertEvent: vi.fn(),
  publishEvent: vi.fn(),
  slugExists: vi.fn(),
  updateEvent: vi.fn(),
  deleteDraftEvent: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { overrideRegistrationScore } from "../actions";

const ORGANIZER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const EVENT_ID = "44444444-4444-4444-4444-444444444444";
const REG_ID = "55555555-5555-4555-8555-555555555555";

function regWithEvent(organizerId: string) {
  return {
    id: REG_ID,
    status: "pending",
    event_id: EVENT_ID,
    events: { id: EVENT_ID, organizer_id: organizerId },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setOverrideScore.mockResolvedValue({
    id: REG_ID,
    organizer_override_score: 28,
  });
});

describe("overrideRegistrationScore — 認可", () => {
  it("未ログインは弾く", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const r = await overrideRegistrationScore(REG_ID, "28");
    expect(r.error).toBe("ログインが必要です。");
    expect(mocks.setOverrideScore).not.toHaveBeenCalled();
  });

  it("他人のイベントの応募は上書きできない（IDOR）", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: OTHER } } });
    mocks.findRegistrationWithEvent.mockResolvedValue(regWithEvent(ORGANIZER));
    const r = await overrideRegistrationScore(REG_ID, "28");
    expect(r.error).toContain("権限がありません");
    expect(mocks.setOverrideScore).not.toHaveBeenCalled();
  });

  it("存在しない応募も同一応答", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: ORGANIZER } } });
    mocks.findRegistrationWithEvent.mockResolvedValue(null);
    const r = await overrideRegistrationScore(REG_ID, "28");
    expect(r.error).toContain("権限がありません");
  });
});

describe("overrideRegistrationScore — 値検証・成功", () => {
  beforeEach(() => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: ORGANIZER } } });
    mocks.findRegistrationWithEvent.mockResolvedValue(regWithEvent(ORGANIZER));
  });

  it("数値を渡すと setOverrideScore に数値が渡る", async () => {
    const r = await overrideRegistrationScore(REG_ID, "28");
    expect(r.error).toBeUndefined();
    expect(mocks.setOverrideScore).toHaveBeenCalledWith({
      registrationId: REG_ID,
      score: 28,
    });
    expect(mocks.revalidatePath).toHaveBeenCalled();
  });

  it("空文字はクリア（null）", async () => {
    await overrideRegistrationScore(REG_ID, "");
    expect(mocks.setOverrideScore).toHaveBeenCalledWith({
      registrationId: REG_ID,
      score: null,
    });
  });

  it("負数・非数値はエラー（更新しない）", async () => {
    const neg = await overrideRegistrationScore(REG_ID, "-5");
    expect(neg.error).toContain("0以上");
    const nan = await overrideRegistrationScore(REG_ID, "abc");
    expect(nan.error).toContain("0以上");
    expect(mocks.setOverrideScore).not.toHaveBeenCalled();
  });
});
