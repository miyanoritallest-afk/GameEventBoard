import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * updateEvent / deleteDraftEvent Server Action の結合テスト
 * （Supabase / Repository / redirect / revalidatePath をモック）。
 *
 * 固定する契約:
 *  - 認証: 未ログインは DB に触れず戻り値でエラー。
 *  - 認可(IDOR): 他人/存在しないイベントは同一の権限なし応答で、更新しない。
 *  - 検証: 入力不正なら fieldErrors を返し更新しない（updateのみ）。
 *  - 楽観ロック: Repository が null を返したら戻り値でエラー（update）。
 *  - 成功: update は更新しリダイレクト、delete は削除しリダイレクト。
 *  - 削除: 0 件（公開済み/他人）なら戻り値でエラー。
 */

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  findEventById: vi.fn(),
  updateEventRepo: vi.fn(),
  deleteDraftEventRepo: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })),
}));

vi.mock("@/lib/repositories/events", () => ({
  findEventById: mocks.findEventById,
  insertEvent: vi.fn(),
  publishEvent: vi.fn(),
  slugExists: vi.fn(),
  updateEvent: mocks.updateEventRepo,
  deleteDraftEvent: mocks.deleteDraftEventRepo,
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    mocks.redirect(url);
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

import { updateEvent, deleteDraftEvent } from "../actions";

const USER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ID = "33333333-3333-4333-8333-333333333333";
const EVENT_ID = "44444444-4444-4444-4444-444444444444";
const GAME_ID = "11111111-1111-4111-8111-111111111111";
const SLUG = "event-abc234";

function ownedEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    organizer_id: USER_ID,
    status: "draft",
    version: 0,
    slug: null,
    title: "元タイトル",
    game_id: GAME_ID,
    current_count: 0,
    ...overrides,
  };
}

function validForm(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("title", "新タイトル");
  fd.set("gameId", GAME_ID);
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

function loggedIn() {
  mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateEventRepo.mockResolvedValue({ ...ownedEvent(), version: 1 });
  mocks.deleteDraftEventRepo.mockResolvedValue(1);
});

describe("updateEvent — 認証・認可", () => {
  it("未ログインなら DB に触れずエラー", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const result = await updateEvent(EVENT_ID, {}, validForm());
    expect(result.error).toBe("ログインが必要です。");
    expect(mocks.findEventById).not.toHaveBeenCalled();
    expect(mocks.updateEventRepo).not.toHaveBeenCalled();
  });

  it("他人のイベントは権限なしで弾き、更新しない", async () => {
    loggedIn();
    mocks.findEventById.mockResolvedValue(ownedEvent({ organizer_id: OTHER_ID }));
    const result = await updateEvent(EVENT_ID, {}, validForm());
    expect(result.error).toBe("このイベントを編集する権限がありません。");
    expect(mocks.updateEventRepo).not.toHaveBeenCalled();
  });

  it("存在しないイベントも同一の権限なし応答", async () => {
    loggedIn();
    mocks.findEventById.mockResolvedValue(null);
    const result = await updateEvent(EVENT_ID, {}, validForm());
    expect(result.error).toBe("このイベントを編集する権限がありません。");
    expect(mocks.updateEventRepo).not.toHaveBeenCalled();
  });
});

describe("updateEvent — 検証・楽観ロック・成功", () => {
  it("タイトル未入力なら fieldErrors を返し更新しない", async () => {
    loggedIn();
    mocks.findEventById.mockResolvedValue(ownedEvent());
    const fd = new FormData();
    fd.set("gameId", GAME_ID); // title なし
    const result = await updateEvent(EVENT_ID, {}, fd);
    expect(result.fieldErrors?.title).toBeDefined();
    expect(mocks.updateEventRepo).not.toHaveBeenCalled();
  });

  it("マスアサインメント: status / organizer_id を捻じ込んでも Repository に渡さない", async () => {
    loggedIn();
    mocks.findEventById.mockResolvedValue(ownedEvent());
    const fd = validForm({ status: "published", organizer_id: OTHER_ID });
    await expect(updateEvent(EVENT_ID, {}, fd)).rejects.toThrow(/NEXT_REDIRECT/);
    const passed = mocks.updateEventRepo.mock.calls[0][0];
    expect(passed.values).not.toHaveProperty("status");
    expect(passed.values).not.toHaveProperty("organizer_id");
    expect(passed.values).not.toHaveProperty("slug");
    expect(passed.values.title).toBe("新タイトル");
  });

  it("Repository が null（version 競合）ならエラーを返す", async () => {
    loggedIn();
    mocks.findEventById.mockResolvedValue(ownedEvent());
    mocks.updateEventRepo.mockResolvedValue(null);
    const result = await updateEvent(EVENT_ID, {}, validForm());
    expect(result.error).toContain("もう一度");
  });

  it("成功時は slug があれば slug へ、なければ id へリダイレクト", async () => {
    loggedIn();
    mocks.findEventById.mockResolvedValue(ownedEvent({ slug: SLUG }));
    await expect(updateEvent(EVENT_ID, {}, validForm())).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    expect(mocks.redirect).toHaveBeenCalledWith(`/events/${SLUG}`);
  });
});

describe("updateEvent — 定員の下限制約（既存応募者を締め出さない）", () => {
  it("公開後、現在の承認済みチーム数を下回る定員は fieldErrors で拒否し更新しない", async () => {
    loggedIn();
    mocks.findEventById.mockResolvedValue(
      ownedEvent({ status: "published", current_count: 8 }),
    );
    const result = await updateEvent(EVENT_ID, {}, validForm({ capacity: "6" }));
    expect(result.fieldErrors?.capacity).toContain("8");
    expect(mocks.updateEventRepo).not.toHaveBeenCalled();
  });

  it("公開後、定員 = 現在数（境界）は締め出さないので許可", async () => {
    loggedIn();
    mocks.findEventById.mockResolvedValue(
      ownedEvent({ status: "published", current_count: 8, slug: SLUG }),
    );
    await expect(
      updateEvent(EVENT_ID, {}, validForm({ capacity: "8" })),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(mocks.updateEventRepo).toHaveBeenCalled();
  });

  it("下書き中は現在数を下回る定員でも許可（制約は公開後のみ）", async () => {
    loggedIn();
    // 下書きでは current_count は実質 0 だが、あえて 5 が入っていても制約しないことを確認。
    mocks.findEventById.mockResolvedValue(
      ownedEvent({ status: "draft", current_count: 5, slug: SLUG }),
    );
    await expect(
      updateEvent(EVENT_ID, {}, validForm({ capacity: "2" })),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(mocks.updateEventRepo).toHaveBeenCalled();
  });
});

describe("deleteDraftEvent", () => {
  it("未ログインなら DB に触れずエラー", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const result = await deleteDraftEvent(EVENT_ID);
    expect(result?.error).toBe("ログインが必要です。");
    expect(mocks.deleteDraftEventRepo).not.toHaveBeenCalled();
  });

  it("削除 0 件（公開済み/他人）ならエラー", async () => {
    loggedIn();
    mocks.deleteDraftEventRepo.mockResolvedValue(0);
    const result = await deleteDraftEvent(EVENT_ID);
    expect(result?.error).toContain("削除できません");
  });

  it("成功時は /events/mine へリダイレクト", async () => {
    loggedIn();
    mocks.deleteDraftEventRepo.mockResolvedValue(1);
    await expect(deleteDraftEvent(EVENT_ID)).rejects.toThrow(/NEXT_REDIRECT/);
    expect(mocks.redirect).toHaveBeenCalledWith("/events/mine");
  });
});
