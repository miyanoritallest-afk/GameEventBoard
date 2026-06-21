import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * publishEvent Server Action の結合テスト（Supabase / Repository / revalidatePath をモック）。
 * 公開フロー固有の防御を固定する:
 *  - 認証: 未ログインは DB に触れず戻り値でエラー。
 *  - 認可(IDOR): 他人のイベント・存在しないイベントは同一の「権限なし」応答で、DB 更新しない。
 *  - 状態遷移: draft 以外は公開しない（二重公開防止）。
 *  - 必須化: 日程・締切・定員が未設定なら fieldErrors を返し、更新しない。
 *  - 楽観ロック: Repository が null（競合）を返したら戻り値でエラー。
 *  - 成功: published に更新し revalidatePath を呼ぶ。
 */

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  findEventById: vi.fn(),
  publishEventRepo: vi.fn(),
  slugExists: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
  })),
}));

vi.mock("@/lib/repositories/events", () => ({
  findEventById: mocks.findEventById,
  insertEvent: vi.fn(),
  publishEvent: mocks.publishEventRepo,
  slugExists: mocks.slugExists,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

import { publishEvent } from "../actions";

const USER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ID = "33333333-3333-4333-8333-333333333333";
const EVENT_ID = "44444444-4444-4444-4444-444444444444";
const GAME_ID = "11111111-1111-4111-8111-111111111111";

/** 公開可能な保存済みイベント（draft・必須そろい）。各テストで上書きして使う。 */
function draftEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    organizer_id: USER_ID,
    status: "draft",
    version: 0,
    title: "テスト大会",
    game_id: GAME_ID,
    starts_at: "2026-07-01T01:00:00.000Z",
    ends_at: "2026-07-01T05:00:00.000Z",
    recruit_deadline: "2026-06-30T12:00:00.000Z",
    capacity: 8,
    ...overrides,
  };
}

function loggedIn() {
  mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
}

beforeEach(() => {
  vi.clearAllMocks();
  // 既定: slug は未使用（1回目の採番で成功する）。
  mocks.slugExists.mockResolvedValue(false);
  // 既定: 公開成功（version インクリメント済みの行を返す）。
  mocks.publishEventRepo.mockResolvedValue({
    ...draftEvent(),
    status: "published",
    version: 1,
  });
});

describe("publishEvent — 認証", () => {
  it("未ログインなら DB に触れずエラー", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const result = await publishEvent(EVENT_ID);
    expect(result.error).toBe("ログインが必要です。");
    expect(mocks.findEventById).not.toHaveBeenCalled();
    expect(mocks.publishEventRepo).not.toHaveBeenCalled();
  });
});

describe("publishEvent — 認可（IDOR）", () => {
  it("他人のイベントは権限なしで弾き、更新しない", async () => {
    loggedIn();
    mocks.findEventById.mockResolvedValue(
      draftEvent({ organizer_id: OTHER_ID }),
    );
    const result = await publishEvent(EVENT_ID);
    expect(result.error).toBe("このイベントを公開する権限がありません。");
    expect(mocks.publishEventRepo).not.toHaveBeenCalled();
  });

  it("存在しないイベントも同一の権限なし応答（列挙を防ぐ）", async () => {
    loggedIn();
    mocks.findEventById.mockResolvedValue(null);
    const result = await publishEvent(EVENT_ID);
    expect(result.error).toBe("このイベントを公開する権限がありません。");
    expect(mocks.publishEventRepo).not.toHaveBeenCalled();
  });
});

describe("publishEvent — 状態遷移", () => {
  it("すでに公開済みなら公開しない", async () => {
    loggedIn();
    mocks.findEventById.mockResolvedValue(draftEvent({ status: "published" }));
    const result = await publishEvent(EVENT_ID);
    expect(result.error).toContain("すでに公開");
    expect(mocks.publishEventRepo).not.toHaveBeenCalled();
  });

  it("終了済みなど公開フェーズ外なら公開しない", async () => {
    loggedIn();
    mocks.findEventById.mockResolvedValue(draftEvent({ status: "finished" }));
    const result = await publishEvent(EVENT_ID);
    expect(result.error).toContain("公開できる状態ではありません");
    expect(mocks.publishEventRepo).not.toHaveBeenCalled();
  });
});

describe("publishEvent — 公開時の必須化", () => {
  it("日程未設定なら fieldErrors を返し、更新しない", async () => {
    loggedIn();
    mocks.findEventById.mockResolvedValue(draftEvent({ starts_at: null }));
    const result = await publishEvent(EVENT_ID);
    expect(result.error).toBe("公開には未設定の項目があります。");
    expect(result.fieldErrors?.starts_at).toBeDefined();
    expect(mocks.publishEventRepo).not.toHaveBeenCalled();
  });

  it("定員未設定でも公開できる（定員は公開時も任意）", async () => {
    loggedIn();
    mocks.findEventById.mockResolvedValue(draftEvent({ capacity: null }));
    const result = await publishEvent(EVENT_ID);
    expect(result.error).toBeUndefined();
    expect(mocks.publishEventRepo).toHaveBeenCalledTimes(1);
  });
});

describe("publishEvent — 成功・楽観ロック", () => {
  it("成功時は published に更新し revalidatePath を呼ぶ", async () => {
    loggedIn();
    mocks.findEventById.mockResolvedValue(draftEvent());
    const result = await publishEvent(EVENT_ID);
    expect(result.error).toBeUndefined();
    expect(mocks.publishEventRepo).toHaveBeenCalledWith({
      id: EVENT_ID,
      organizerId: USER_ID,
      expectedVersion: 0,
      slug: expect.stringMatching(/^event-[0-9a-z]{6}$/),
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/events/${EVENT_ID}`);
  });

  it("slug が衝突したら別 slug でリトライして公開できる", async () => {
    loggedIn();
    mocks.findEventById.mockResolvedValue(draftEvent());
    // 1回目は使用済み、2回目は空き。
    mocks.slugExists
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const result = await publishEvent(EVENT_ID);
    expect(result.error).toBeUndefined();
    expect(mocks.slugExists).toHaveBeenCalledTimes(2);
    expect(mocks.publishEventRepo).toHaveBeenCalledTimes(1);
  });

  it("Repository が null（version 競合）を返したらエラーを返す", async () => {
    loggedIn();
    mocks.findEventById.mockResolvedValue(draftEvent());
    mocks.publishEventRepo.mockResolvedValue(null);
    const result = await publishEvent(EVENT_ID);
    expect(result.error).toContain("もう一度");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
