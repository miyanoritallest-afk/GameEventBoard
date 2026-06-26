import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * registerForEvent / decideRegistration の結合テスト
 * （Supabase / Repositories / revalidatePath をモック）。
 *
 * 応募フロー固有のセキュリティを固定する:
 *  - なりすまし防止: insert に渡る user_id は常にセッションの user.id。
 *  - IDOR(2テーブル跨ぎ): 他人のイベントの応募は承認/却下できない。
 *  - 主催者は自分のイベントに応募できない。
 *  - 1ユーザー1応募: 既存応募があれば弾く。
 *  - 状態遷移: 公開中のみ応募可 / pending のみ承認・却下可。
 */

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  findEventById: vi.fn(),
  findRegistration: vi.fn(),
  insertRegistration: vi.fn(),
  findRegistrationWithEvent: vi.fn(),
  decideRegistrationRepo: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })),
}));

vi.mock("@/lib/repositories/events", () => ({
  findEventById: mocks.findEventById,
  insertEvent: vi.fn(),
  publishEvent: vi.fn(),
  slugExists: vi.fn(),
  updateEvent: vi.fn(),
  deleteDraftEvent: vi.fn(),
}));

vi.mock("@/lib/repositories/registrations", () => ({
  findRegistration: mocks.findRegistration,
  insertRegistration: mocks.insertRegistration,
  findRegistrationWithEvent: mocks.findRegistrationWithEvent,
  decideRegistration: mocks.decideRegistrationRepo,
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { registerForEvent, decideRegistration } from "../actions";

const APPLICANT = "11111111-1111-4111-8111-111111111111";
const ORGANIZER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const EVENT_ID = "44444444-4444-4444-4444-444444444444";
const REG_ID = "55555555-5555-4555-8555-555555555555";

function publishedEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    organizer_id: ORGANIZER,
    status: "published",
    slug: "event-abc234",
    ...overrides,
  };
}

function loginAs(id: string) {
  mocks.getUser.mockResolvedValue({ data: { user: { id } } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findRegistration.mockResolvedValue(null); // 未応募が既定
  mocks.insertRegistration.mockResolvedValue({ ok: true, id: REG_ID });
  mocks.decideRegistrationRepo.mockResolvedValue({
    id: REG_ID,
    status: "approved",
  });
});

describe("registerForEvent — 認証・認可・状態", () => {
  it("未ログインなら DB に触れずエラー", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const result = await registerForEvent(EVENT_ID, "のり");
    expect(result.error).toBe("ログインが必要です。");
    expect(mocks.findEventById).not.toHaveBeenCalled();
    expect(mocks.insertRegistration).not.toHaveBeenCalled();
  });

  it("主催者本人は自分のイベントに応募できない", async () => {
    loginAs(ORGANIZER);
    mocks.findEventById.mockResolvedValue(publishedEvent());
    const result = await registerForEvent(EVENT_ID, "のり");
    expect(result.error).toContain("主催者は");
    expect(mocks.insertRegistration).not.toHaveBeenCalled();
  });

  it("下書きイベントには応募できない", async () => {
    loginAs(APPLICANT);
    mocks.findEventById.mockResolvedValue(publishedEvent({ status: "draft" }));
    const result = await registerForEvent(EVENT_ID, "のり");
    expect(result.error).toBeDefined();
    expect(mocks.insertRegistration).not.toHaveBeenCalled();
  });

  it("存在しないイベントはエラー", async () => {
    loginAs(APPLICANT);
    mocks.findEventById.mockResolvedValue(null);
    const result = await registerForEvent(EVENT_ID, "のり");
    expect(result.error).toContain("見つかりません");
  });

  it("登録名が空なら弾き、insert しない（必須）", async () => {
    loginAs(APPLICANT);
    mocks.findEventById.mockResolvedValue(publishedEvent());
    const result = await registerForEvent(EVENT_ID, "   "); // trim 後に空
    expect(result.error).toContain("登録名");
    expect(mocks.insertRegistration).not.toHaveBeenCalled();
  });
});

describe("registerForEvent — 重複・なりすまし・成功", () => {
  it("すでに応募済みなら弾き、insert しない", async () => {
    loginAs(APPLICANT);
    mocks.findEventById.mockResolvedValue(publishedEvent());
    mocks.findRegistration.mockResolvedValue({ id: REG_ID, status: "pending" });
    const result = await registerForEvent(EVENT_ID, "のり");
    expect(result.error).toContain("応募済み");
    expect(mocks.insertRegistration).not.toHaveBeenCalled();
  });

  it("insert に渡る user_id はセッションの user.id（なりすまし防止）・登録名も保存", async () => {
    loginAs(APPLICANT);
    mocks.findEventById.mockResolvedValue(publishedEvent());
    const result = await registerForEvent(EVENT_ID, "  のり  ");
    expect(result.error).toBeUndefined();
    expect(mocks.insertRegistration).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      userId: APPLICANT,
      displayName: "のり", // trim されてスナップショット保存
    });
    expect(mocks.revalidatePath).toHaveBeenCalled();
  });

  it("UNIQUE 競合（duplicate）でも応募済みエラーを返す", async () => {
    loginAs(APPLICANT);
    mocks.findEventById.mockResolvedValue(publishedEvent());
    mocks.insertRegistration.mockResolvedValue({ ok: false, duplicate: true });
    const result = await registerForEvent(EVENT_ID, "のり");
    expect(result.error).toContain("応募済み");
  });
});

describe("decideRegistration — 認可(IDOR)・状態・成功", () => {
  it("未ログインなら DB に触れずエラー", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const result = await decideRegistration(REG_ID, "approve");
    expect(result.error).toBe("ログインが必要です。");
    expect(mocks.findRegistrationWithEvent).not.toHaveBeenCalled();
  });

  it("他人のイベントの応募は承認できない（IDOR）", async () => {
    loginAs(OTHER); // 主催者でも応募者でもない第三者
    mocks.findRegistrationWithEvent.mockResolvedValue({
      id: REG_ID,
      status: "pending",
      event_id: EVENT_ID,
      events: { id: EVENT_ID, organizer_id: ORGANIZER },
    });
    const result = await decideRegistration(REG_ID, "approve");
    expect(result.error).toContain("権限がありません");
    expect(mocks.decideRegistrationRepo).not.toHaveBeenCalled();
  });

  it("存在しない応募も同一の権限なし応答", async () => {
    loginAs(ORGANIZER);
    mocks.findRegistrationWithEvent.mockResolvedValue(null);
    const result = await decideRegistration(REG_ID, "approve");
    expect(result.error).toContain("権限がありません");
    expect(mocks.decideRegistrationRepo).not.toHaveBeenCalled();
  });

  it("pending 以外は処理できない", async () => {
    loginAs(ORGANIZER);
    mocks.findRegistrationWithEvent.mockResolvedValue({
      id: REG_ID,
      status: "approved",
      event_id: EVENT_ID,
      events: { id: EVENT_ID, organizer_id: ORGANIZER },
    });
    const result = await decideRegistration(REG_ID, "approve");
    expect(result.error).toContain("処理済み");
    expect(mocks.decideRegistrationRepo).not.toHaveBeenCalled();
  });

  it("主催者が承認すると approved に更新し revalidate", async () => {
    loginAs(ORGANIZER);
    mocks.findRegistrationWithEvent.mockResolvedValue({
      id: REG_ID,
      status: "pending",
      event_id: EVENT_ID,
      events: { id: EVENT_ID, organizer_id: ORGANIZER },
    });
    const result = await decideRegistration(REG_ID, "approve");
    expect(result.error).toBeUndefined();
    expect(mocks.decideRegistrationRepo).toHaveBeenCalledWith({
      registrationId: REG_ID,
      expectedStatus: "pending",
      nextStatus: "approved",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      `/events/${EVENT_ID}/registrations`,
    );
  });

  it("却下は rejected を渡す", async () => {
    loginAs(ORGANIZER);
    mocks.findRegistrationWithEvent.mockResolvedValue({
      id: REG_ID,
      status: "pending",
      event_id: EVENT_ID,
      events: { id: EVENT_ID, organizer_id: ORGANIZER },
    });
    await decideRegistration(REG_ID, "reject");
    expect(mocks.decideRegistrationRepo).toHaveBeenCalledWith(
      expect.objectContaining({ nextStatus: "rejected" }),
    );
  });

  it("Repository が null（競合）ならエラー", async () => {
    loginAs(ORGANIZER);
    mocks.findRegistrationWithEvent.mockResolvedValue({
      id: REG_ID,
      status: "pending",
      event_id: EVENT_ID,
      events: { id: EVENT_ID, organizer_id: ORGANIZER },
    });
    mocks.decideRegistrationRepo.mockResolvedValue(null);
    const result = await decideRegistration(REG_ID, "approve");
    expect(result.error).toContain("もう一度");
  });
});
