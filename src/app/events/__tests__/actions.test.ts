import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * createEvent Server Action の結合テスト（Supabase / Repository / redirect をモック）。
 * 実DB・RLS には触れず、Controller の契約を固定する:
 *  - 認証バイパス対策: 未ログインなら DB に触れず戻り値でエラー。
 *  - マスアサインメント対策: organizer_id / status はサーバー側で固定（入力から取らない）。
 *  - 入力検証 NG は throw せず戻り値（fieldErrors）。
 *  - 日時は JST 入力 → UTC 保存（insertEvent に渡る値で検証）。
 *  - 成功時は /events/:id へ redirect。
 *
 * 注: RLS そのものの検証は対象外（Supabase ローカル環境を要するため別途）。
 */

// --- モック定義（hoist される vi.mock の中で参照するため vi.hoisted を使う）---
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  insertEvent: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
  })),
}));

vi.mock("@/lib/repositories/events", () => ({
  insertEvent: mocks.insertEvent,
}));

vi.mock("next/navigation", () => ({
  // 本物の redirect は例外を投げて以降を中断する。挙動を模してテストでも throw する。
  redirect: (url: string) => {
    mocks.redirect(url);
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

import { createEvent } from "../actions";

// Zod v4 の .uuid() は RFC 4122 準拠（version=4 / variant=8〜b）を要求するため有効な v4 を使う。
const VALID_UUID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

/** FormData を組み立てる小道具（未指定キーは set しない＝formData.get は null を返す）。 */
function buildFormData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function loggedIn() {
  mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
}

function loggedOut() {
  mocks.getUser.mockResolvedValue({ data: { user: null } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.insertEvent.mockResolvedValue({ id: "created-event-id" });
});

describe("createEvent — 認証", () => {
  it("未ログインなら DB に触れずエラーを返す（認証バイパス対策）", async () => {
    loggedOut();
    const result = await createEvent(
      {},
      buildFormData({ title: "大会", gameId: VALID_UUID }),
    );
    expect(result.error).toBe("ログインが必要です。");
    expect(mocks.insertEvent).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe("createEvent — 入力検証", () => {
  it("タイトル未入力なら fieldErrors を返し、DB に触れない", async () => {
    loggedIn();
    const result = await createEvent(
      {},
      buildFormData({ gameId: VALID_UUID }), // title なし
    );
    expect(result.error).toBe("入力内容を確認してください。");
    expect(result.fieldErrors?.title).toBeDefined();
    expect(mocks.insertEvent).not.toHaveBeenCalled();
  });

  it("ゲーム未選択なら fieldErrors を返す", async () => {
    loggedIn();
    const result = await createEvent(
      {},
      buildFormData({ title: "大会" }), // gameId なし
    );
    expect(result.fieldErrors?.gameId).toBeDefined();
    expect(mocks.insertEvent).not.toHaveBeenCalled();
  });
});

describe("createEvent — 成功時の挙動", () => {
  it("organizer_id / status はサーバー側で固定される（マスアサインメント対策）", async () => {
    loggedIn();
    // 攻撃者が status / organizer_id を捻じ込んでも無視されることを確認。
    const fd = buildFormData({
      title: "大会",
      gameId: VALID_UUID,
      status: "published",
      organizer_id: "99999999-9999-9999-9999-999999999999",
    });

    await expect(createEvent({}, fd)).rejects.toThrow(/NEXT_REDIRECT/);

    expect(mocks.insertEvent).toHaveBeenCalledTimes(1);
    const values = mocks.insertEvent.mock.calls[0][0];
    expect(values.organizer_id).toBe(USER_ID);
    expect(values.status).toBe("draft");
  });

  it("JST 入力が UTC(ISO) で保存される（starts_at）", async () => {
    loggedIn();
    const fd = buildFormData({
      title: "大会",
      gameId: VALID_UUID,
      startsAt: "2026-07-01T10:00", // JST 10:00
    });

    await expect(createEvent({}, fd)).rejects.toThrow(/NEXT_REDIRECT/);

    const values = mocks.insertEvent.mock.calls[0][0];
    // JST 10:00 は UTC 01:00。
    expect(values.starts_at).toBe("2026-07-01T01:00:00.000Z");
  });

  it("日程未入力の項目は null で保存される", async () => {
    loggedIn();
    const fd = buildFormData({ title: "大会", gameId: VALID_UUID });

    await expect(createEvent({}, fd)).rejects.toThrow(/NEXT_REDIRECT/);

    const values = mocks.insertEvent.mock.calls[0][0];
    expect(values.starts_at).toBeNull();
    expect(values.ends_at).toBeNull();
    expect(values.recruit_deadline).toBeNull();
    expect(values.description).toBeNull();
  });

  it("作成後 /events/:id にリダイレクトする", async () => {
    loggedIn();
    const fd = buildFormData({ title: "大会", gameId: VALID_UUID });

    await expect(createEvent({}, fd)).rejects.toThrow(/NEXT_REDIRECT/);

    expect(mocks.redirect).toHaveBeenCalledWith("/events/created-event-id");
  });
});
