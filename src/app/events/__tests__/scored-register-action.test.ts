import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * registerWithScore（スコアあり応募）の結合テスト。
 * calcScore は実物を使い（純粋関数）、Supabase/Repository/redirect はモック。
 * 固定する契約: なりすまし防止（user_id固定）・IDOR・require_score 限定・重複・
 * スコアのスナップショット保存（計算値が insert に渡る）。
 */

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  findEventById: vi.fn(),
  findRegistration: vi.fn(),
  insertRegistration: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })),
}));

vi.mock("@/lib/repositories/events", () => ({
  findEventById: mocks.findEventById,
  findEventBySlug: vi.fn(),
  insertEvent: vi.fn(),
  publishEvent: vi.fn(),
  slugExists: vi.fn(),
  updateEvent: vi.fn(),
  deleteDraftEvent: vi.fn(),
}));

vi.mock("@/lib/repositories/registrations", () => ({
  findRegistration: mocks.findRegistration,
  insertRegistration: mocks.insertRegistration,
  findRegistrationWithEvent: vi.fn(),
  decideRegistration: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    mocks.redirect(url);
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

import { registerWithScore } from "../actions";

const APPLICANT = "11111111-1111-4111-8111-111111111111";
const ORGANIZER = "22222222-2222-4222-8222-222222222222";
const EVENT_ID = "44444444-4444-4444-4444-444444444444";

function scoredEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    organizer_id: ORGANIZER,
    status: "published",
    slug: "event-abc234",
    require_score: true,
    role_swap_allowed: false,
    declared_seasons: 2,
    uncertified_handling: "exclude",
    bonus_master: 0,
    bonus_gm: 0,
    bonus_champion: 0,
    ...overrides,
  };
}

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** 希望ロール第1〜第3（第1=指定、残り2つを自動で埋める）。 */
function withRoles(
  first: "tank" | "dps" | "support",
  extra: Record<string, string> = {},
) {
  const order = ["tank", "dps", "support"].filter((r) => r !== first);
  return form({
    // 登録名は必須項目。既定で有効値を入れておく（個別テストは extra で上書き）。
    displayName: "のり",
    preferredRole1: first,
    preferredRole2: order[0],
    preferredRole3: order[1],
    ...extra,
  });
}

function loginAs(id: string) {
  mocks.getUser.mockResolvedValue({ data: { user: { id } } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findRegistration.mockResolvedValue(null);
  mocks.insertRegistration.mockResolvedValue({ ok: true, id: "reg-1" });
});

describe("registerWithScore — 認可・前提", () => {
  it("未ログインは弾く", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const r = await registerWithScore(EVENT_ID, {}, form({}));
    expect(r.error).toBe("ログインが必要です。");
    expect(mocks.insertRegistration).not.toHaveBeenCalled();
  });

  it("主催者は応募不可", async () => {
    loginAs(ORGANIZER);
    mocks.findEventById.mockResolvedValue(scoredEvent());
    const r = await registerWithScore(EVENT_ID, {}, withRoles("dps"));
    expect(r.error).toContain("主催者は");
    expect(mocks.insertRegistration).not.toHaveBeenCalled();
  });

  it("require_score=false のイベントは弾く（即時応募ルート）", async () => {
    loginAs(APPLICANT);
    mocks.findEventById.mockResolvedValue(scoredEvent({ require_score: false }));
    const r = await registerWithScore(EVENT_ID, {}, withRoles("dps"));
    expect(r.error).toContain("スコア入力なし");
    expect(mocks.insertRegistration).not.toHaveBeenCalled();
  });

  it("応募済みは弾く", async () => {
    loginAs(APPLICANT);
    mocks.findEventById.mockResolvedValue(scoredEvent());
    mocks.findRegistration.mockResolvedValue({ id: "reg-x", status: "pending" });
    const r = await registerWithScore(EVENT_ID, {}, withRoles("dps"));
    expect(r.error).toContain("応募済み");
    expect(mocks.insertRegistration).not.toHaveBeenCalled();
  });

  it("希望ロール未選択は fieldErrors", async () => {
    loginAs(APPLICANT);
    mocks.findEventById.mockResolvedValue(scoredEvent());
    const r = await registerWithScore(EVENT_ID, {}, form({}));
    expect(r.fieldErrors?.preferredRole1).toBeDefined();
    expect(mocks.insertRegistration).not.toHaveBeenCalled();
  });

  it("登録名が空は fieldErrors（必須）", async () => {
    loginAs(APPLICANT);
    mocks.findEventById.mockResolvedValue(scoredEvent());
    const fd = withRoles("dps", { displayName: "   " }); // trim 後に空
    const r = await registerWithScore(EVENT_ID, {}, fd);
    expect(r.fieldErrors?.displayName).toBeDefined();
    expect(mocks.insertRegistration).not.toHaveBeenCalled();
  });
});

describe("registerWithScore — 算出とスナップショット", () => {
  it("role_swap=false: 担当ロールの平均が保存される（なりすまし防止: user_id固定）", async () => {
    loginAs(APPLICANT);
    mocks.findEventById.mockResolvedValue(scoredEvent());
    // dps シーズン2列: 30, 20 → 平均25
    const fd = withRoles("dps", {
      rank_dps_0: "30",
      rank_dps_1: "20",
      // 攻撃者が user_id を捻じ込んでも無視される
      user_id: "99999999-9999-4999-8999-999999999999",
    });
    await expect(registerWithScore(EVENT_ID, {}, fd)).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    const passed = mocks.insertRegistration.mock.calls[0][0];
    expect(passed.userId).toBe(APPLICANT);
    expect(passed.displayName).toBe("のり"); // 登録名が trim されてスナップショット保存
    expect(passed.preferredRole1).toBe("dps");
    expect(passed.individualScore).toBe(25);
    expect(passed.finalScore).toBe(25);
  });

  it("role_swap=true: 全ロール平均（exclude）が保存される", async () => {
    loginAs(APPLICANT);
    mocks.findEventById.mockResolvedValue(
      scoredEvent({ role_swap_allowed: true, declared_seasons: 1 }),
    );
    // tank30 / dps20 / sup10 → 平均20
    const fd = withRoles("tank", {
      rank_tank_0: "30",
      rank_dps_0: "20",
      rank_support_0: "10",
    });
    await expect(registerWithScore(EVENT_ID, {}, fd)).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    const passed = mocks.insertRegistration.mock.calls[0][0];
    expect(passed.individualScore).toBe(20);
  });

  it("ボーナス有効時は final に加点される", async () => {
    loginAs(APPLICANT);
    mocks.findEventById.mockResolvedValue(
      scoredEvent({ bonus_master: 5, declared_seasons: 1 }),
    );
    const fd = withRoles("dps", {
      rank_dps_0: "20",
      peak: "master",
    });
    await expect(registerWithScore(EVENT_ID, {}, fd)).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    const passed = mocks.insertRegistration.mock.calls[0][0];
    expect(passed.individualScore).toBe(20);
    expect(passed.finalScore).toBe(25); // 20 + 5
  });

  it("全未認定なら score=null で保存（応募は通る）", async () => {
    loginAs(APPLICANT);
    mocks.findEventById.mockResolvedValue(scoredEvent());
    const fd = withRoles("dps", {
      rank_dps_0: "uncertified",
      rank_dps_1: "uncertified",
    });
    await expect(registerWithScore(EVENT_ID, {}, fd)).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    const passed = mocks.insertRegistration.mock.calls[0][0];
    expect(passed.individualScore).toBeNull();
    expect(passed.finalScore).toBeNull();
  });
});
