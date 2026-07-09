import { describe, it, expect } from "vitest";
import { createDraftEventSchema } from "../schema";

/**
 * イベント下書き作成スキーマの単体テスト。
 * 検証の主眼は「2段階バリデーション」の下書き側の契約:
 *  - 必須はタイトル・ゲームのみ。日程/説明/定員などは未入力で通る。
 *  - HTML フォーム由来の null / 空文字を preprocess が正しく正規化する。
 *  - 期間・締切の整合 refine は「両方そろったときだけ」働く。
 */

// Zod v4 の .uuid() は RFC 4122 準拠（version=4 / variant=8〜b）を要求するため有効な v4 を使う。
const VALID_UUID = "11111111-1111-4111-8111-111111111111";

/** 下書きの最小有効入力（タイトル・ゲームのみ）。各テストで上書きして使う。 */
function baseInput(overrides: Record<string, unknown> = {}) {
  return { title: "テスト大会", gameId: VALID_UUID, ...overrides };
}

describe("createDraftEventSchema — 必須項目", () => {
  it("タイトルとゲームだけで成功する（下書きは最小入力で保存できる）", () => {
    const result = createDraftEventSchema.safeParse(baseInput());
    expect(result.success).toBe(true);
  });

  it("タイトル未入力（null）は失敗する", () => {
    const result = createDraftEventSchema.safeParse(baseInput({ title: null }));
    expect(result.success).toBe(false);
    const issue = result.success
      ? undefined
      : result.error.issues.find((i) => i.path[0] === "title");
    expect(issue?.message).toBe("タイトルを入力してください");
  });

  it("タイトルが空白のみは trim 後に空となり失敗する", () => {
    const result = createDraftEventSchema.safeParse(baseInput({ title: "   " }));
    expect(result.success).toBe(false);
  });

  it("タイトルが80文字超は失敗する", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({ title: "あ".repeat(81) }),
    );
    expect(result.success).toBe(false);
  });

  it("ゲーム未選択（null）は失敗する", () => {
    const result = createDraftEventSchema.safeParse(baseInput({ gameId: null }));
    expect(result.success).toBe(false);
  });

  it("ゲームIDが UUID 形式でないと失敗する", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({ gameId: "not-a-uuid" }),
    );
    expect(result.success).toBe(false);
    const issue = result.success
      ? undefined
      : result.error.issues.find((i) => i.path[0] === "gameId");
    expect(issue?.message).toBe("ゲームを選択してください");
  });
});

describe("createDraftEventSchema — 任意項目の正規化", () => {
  it("説明が null でも通り、空文字に正規化される", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({ description: null }),
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.description).toBe("");
  });

  it("説明は trim される", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({ description: "  こんにちは  " }),
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.description).toBe("こんにちは");
  });

  it("日程系（startsAt/endsAt/recruitDeadline）は未入力で通る", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({ startsAt: null, endsAt: null, recruitDeadline: null }),
    );
    expect(result.success).toBe(true);
  });

  it("定員は空文字なら未設定として通る", () => {
    const result = createDraftEventSchema.safeParse(baseInput({ capacity: "" }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.capacity).toBe("");
  });

  it("定員は文字列の数値を数値に強制変換する", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({ capacity: "8" }),
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.capacity).toBe(8);
  });

  it("定員が0以下は失敗する", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({ capacity: "0" }),
    );
    expect(result.success).toBe(false);
  });
});

describe("createDraftEventSchema — スコアリング設定の既定値", () => {
  it("申告シーズン数は未入力なら 3 に既定化される", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({ declaredSeasons: "" }),
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.declaredSeasons).toBe(3);
  });

  it("ボーナス各種は未入力なら 0 に既定化される", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({ bonusMaster: "", bonusGm: "", bonusChampion: "" }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bonusMaster).toBe(0);
      expect(result.data.bonusGm).toBe(0);
      expect(result.data.bonusChampion).toBe(0);
    }
  });

  it("申告シーズン数が範囲外（11）は失敗する", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({ declaredSeasons: "11" }),
    );
    expect(result.success).toBe(false);
  });
});

describe("createDraftEventSchema — チームスコア上限（B-1）", () => {
  it("未指定なら空文字（＝上限なし）として通る", () => {
    const result = createDraftEventSchema.safeParse(baseInput());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.teamScoreCap).toBe("");
  });

  it("空文字は未設定（上限なし）として通る", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({ teamScoreCap: "" }),
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.teamScoreCap).toBe("");
  });

  it("1〜40 の整数を数値に強制変換して受理する", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({ teamScoreCap: "23" }),
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.teamScoreCap).toBe(23);
  });

  it("境界値 1 と 40 は通る", () => {
    expect(
      createDraftEventSchema.safeParse(baseInput({ teamScoreCap: "1" })).success,
    ).toBe(true);
    expect(
      createDraftEventSchema.safeParse(baseInput({ teamScoreCap: "40" }))
        .success,
    ).toBe(true);
  });

  it("0 は失敗する（下限割れ）", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({ teamScoreCap: "0" }),
    );
    expect(result.success).toBe(false);
  });

  it("41 は失敗する（上限超え）", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({ teamScoreCap: "41" }),
    );
    expect(result.success).toBe(false);
  });

  it("小数は失敗する（整数のみ）", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({ teamScoreCap: "23.5" }),
    );
    expect(result.success).toBe(false);
  });
});

describe("createDraftEventSchema — スコア計算設定（PR-C）", () => {
  it("requireScore は未指定なら true に既定化される", () => {
    const result = createDraftEventSchema.safeParse(baseInput());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.requireScore).toBe(true);
  });

  it("requireScore=false を受理する（スコアなしイベント）", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({ requireScore: false }),
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.requireScore).toBe(false);
  });

  it("uncertifiedHandling は未指定なら exclude に既定化される", () => {
    const result = createDraftEventSchema.safeParse(baseInput());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.uncertifiedHandling).toBe("exclude");
  });

  it("uncertifiedHandling は3方式を受理する", () => {
    for (const h of ["fill_by_role", "fill_by_season", "exclude"] as const) {
      const result = createDraftEventSchema.safeParse(
        baseInput({ uncertifiedHandling: h }),
      );
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.uncertifiedHandling).toBe(h);
    }
  });

  it("uncertifiedHandling が不正な値は失敗する", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({ uncertifiedHandling: "invalid" }),
    );
    expect(result.success).toBe(false);
  });
});

describe("createDraftEventSchema — 期間・締切の整合（両方そろったときだけ）", () => {
  it("開始のみ指定（終了なし）は整合チェックされず通る", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({ startsAt: "2026-07-01T10:00" }),
    );
    expect(result.success).toBe(true);
  });

  it("終了が開始より前だと失敗する", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({ startsAt: "2026-07-01T10:00", endsAt: "2026-07-01T09:00" }),
    );
    expect(result.success).toBe(false);
    const issue = result.success
      ? undefined
      : result.error.issues.find((i) => i.path[0] === "endsAt");
    expect(issue?.message).toBe("開催終了は開始日時以降にしてください");
  });

  it("終了が開始と同時刻なら通る（以降を許容）", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({ startsAt: "2026-07-01T10:00", endsAt: "2026-07-01T10:00" }),
    );
    expect(result.success).toBe(true);
  });

  it("募集締切が開始以降だと失敗する", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({
        startsAt: "2026-07-01T10:00",
        recruitDeadline: "2026-07-01T10:00",
      }),
    );
    expect(result.success).toBe(false);
    const issue = result.success
      ? undefined
      : result.error.issues.find((i) => i.path[0] === "recruitDeadline");
    expect(issue?.message).toBe("募集締切は開催開始より前にしてください");
  });

  it("募集締切が開始より前なら通る", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({
        startsAt: "2026-07-01T10:00",
        recruitDeadline: "2026-06-30T23:59",
      }),
    );
    expect(result.success).toBe(true);
  });

  it("開始がないと締切だけ指定しても整合チェックされず通る", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({ recruitDeadline: "2026-06-30T23:59" }),
    );
    expect(result.success).toBe(true);
  });
});

describe("createDraftEventSchema — 順位設定（本戦-3b）", () => {
  it("順位設定は未指定なら既定値（無効・勝3分1負0・空）になる", () => {
    const result = createDraftEventSchema.safeParse(baseInput());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rankingEnabled).toBe(false);
      expect(result.data.pointsWin).toBe(3);
      expect(result.data.pointsDraw).toBe(1);
      expect(result.data.pointsLoss).toBe(0);
      expect(result.data.tiebreakers).toEqual([]);
    }
  });

  it("勝点は文字列の数値を受理する", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({ rankingEnabled: true, pointsWin: "2", pointsDraw: "1", pointsLoss: "0" }),
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.pointsWin).toBe(2);
  });

  it("勝点が範囲外（100）は失敗する", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({ pointsWin: "100" }),
    );
    expect(result.success).toBe(false);
  });

  it("勝点が負数は失敗する", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({ pointsLoss: "-1" }),
    );
    expect(result.success).toBe(false);
  });

  it("tiebreakers はカンマ区切り文字列を順序付き配列に正規化する", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({ tiebreakers: "head_to_head,map_diff,potg" }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tiebreakers).toEqual([
        "head_to_head",
        "map_diff",
        "potg",
      ]);
    }
  });

  it("tiebreakers の空文字は空配列になる", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({ tiebreakers: "" }),
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tiebreakers).toEqual([]);
  });

  it("tiebreakers に不正値が混ざると失敗する", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({ tiebreakers: "head_to_head,invalid" }),
    );
    expect(result.success).toBe(false);
  });

  it("tiebreakers の重複は失敗する", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({ tiebreakers: "map_diff,map_diff" }),
    );
    expect(result.success).toBe(false);
    const issue = result.success
      ? undefined
      : result.error.issues.find((i) => i.path[0] === "tiebreakers");
    expect(issue?.message).toBe("タイブレーク基準が重複しています");
  });
});

describe("createDraftEventSchema — 予選BO（本戦-3d）", () => {
  it("groupBestOf は未指定なら 3 に既定化される", () => {
    const result = createDraftEventSchema.safeParse(baseInput());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.groupBestOf).toBe(3);
  });

  it("groupBestOf は文字列の数値を受理する", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({ groupBestOf: "5" }),
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.groupBestOf).toBe(5);
  });

  it("groupBestOf は上限 7（e-sports 実務の最大 BO7）まで受理する", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({ groupBestOf: "7" }),
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.groupBestOf).toBe(7);
  });

  it("groupBestOf が上限超え（8）は失敗する", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({ groupBestOf: "8" }),
    );
    expect(result.success).toBe(false);
  });

  it("groupBestOf が0以下は失敗する", () => {
    const result = createDraftEventSchema.safeParse(
      baseInput({ groupBestOf: "0" }),
    );
    expect(result.success).toBe(false);
  });
});
