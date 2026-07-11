import type { EventStatus } from "./event-status";

/**
 * イベント一覧のフィルタ・並び替え・状態表示のロジック（Service 層・純粋関数）。
 * 実装ガイドライン: 判断ロジックは Controller から切り出し、副作用なしでテストする。
 *
 * event_status: draft → published → recruiting → closed → ongoing → finished
 * 一覧のフィルタタブ（4つ）は複数 status をグルーピングして扱う。
 */

/** フィルタタブの種別。URL クエリ ?tab= の許可値でもある。 */
export type EventListTab = "all" | "recruiting" | "ongoing" | "finished";

/** 並び替えの種別。URL クエリ ?sort= の許可値。既定は "soon"（開催日が近い順）。 */
export type EventListSort = "soon" | "new";

/** タブ → 対象 status 群のマッピング。all は「draft 以外の全公開状態」なので空配列（＝絞らない）。 */
const TAB_STATUSES: Record<EventListTab, EventStatus[]> = {
  all: [],
  // 応募を受け付けている段階。
  recruiting: ["published", "recruiting"],
  // 募集を締め切って開催に向かう〜開催中。
  ongoing: ["closed", "ongoing"],
  finished: ["finished"],
};

/** タブの表示ラベル（画面のフィルタタブ用）。 */
export const TAB_LABEL: Record<EventListTab, string> = {
  all: "すべて",
  recruiting: "募集中",
  ongoing: "開催中",
  finished: "終了",
};

/** 不明な文字列を安全に既定タブ（all）へ丸める。URL クエリの検証に使う。 */
export function normalizeTab(raw: string | undefined): EventListTab {
  return raw === "recruiting" || raw === "ongoing" || raw === "finished"
    ? raw
    : "all";
}

/** 不明な文字列を安全に既定ソート（soon）へ丸める。 */
export function normalizeSort(raw: string | undefined): EventListSort {
  return raw === "new" ? "new" : "soon";
}

/**
 * タブに対応する status 群を返す（Repository の filterStatuses に渡す）。
 * all は空配列＝絞り込みなし。
 */
export function statusesForTab(tab: EventListTab): EventStatus[] {
  return TAB_STATUSES[tab];
}

/**
 * 状態一覧から各タブの件数を数える（フィルタタブの件数バッジ用）。
 * all は全件、他は該当 status を含む件数。1回のイベント取得結果から集計する（追加クエリ不要）。
 */
export function countByTab(
  statuses: EventStatus[],
): Record<EventListTab, number> {
  const counts: Record<EventListTab, number> = {
    all: statuses.length,
    recruiting: 0,
    ongoing: 0,
    finished: 0,
  };
  for (const s of statuses) {
    if (TAB_STATUSES.recruiting.includes(s)) counts.recruiting += 1;
    else if (TAB_STATUSES.ongoing.includes(s)) counts.ongoing += 1;
    else if (TAB_STATUSES.finished.includes(s)) counts.finished += 1;
  }
  return counts;
}

/** 状態バッジの見た目（色トーン）。一覧・詳細で共通の意味づけ。 */
export type StatusTone = "success" | "live" | "warning" | "muted" | "draft";

/**
 * status → バッジのトーン。募集中=success、開催中=live、募集締切=warning、終了=muted。
 * published も募集受付中として success。下書き=draft（自分のイベント一覧でのみ現れる）。
 * 想定外の値は muted に倒す。
 */
export function statusTone(status: EventStatus): StatusTone {
  switch (status) {
    case "published":
    case "recruiting":
      return "success";
    case "ongoing":
      return "live";
    case "closed":
      return "warning";
    case "finished":
      return "muted";
    case "draft":
      return "draft";
    default:
      return "muted";
  }
}

/* ─────────────────────────────────────────────────────────────
 * 自分のイベント一覧（/events/mine）専用のフィルタ。
 * 公開一覧（上の TAB_*）と違い、主催者本人の画面なので下書き（draft）を独立タブで扱う。
 * ここは純粋関数のみ（副作用なし）。/events 用の定義とは分離して既存挙動を壊さない。
 * ───────────────────────────────────────────────────────────── */

/** 自分のイベント一覧のタブ種別（URL クエリ ?tab= の許可値）。 */
export type MyEventsTab = "all" | "draft" | "open" | "ended";

/** タブ → 対象 status 群。all は空配列（絞らない）。 */
const MY_TAB_STATUSES: Record<MyEventsTab, EventStatus[]> = {
  all: [],
  draft: ["draft"],
  // 公開中：公開してから終了までの全段階（下書き・終了以外）。
  open: ["published", "recruiting", "closed", "ongoing"],
  ended: ["finished"],
};

/** タブの表示ラベル。 */
export const MY_TAB_LABEL: Record<MyEventsTab, string> = {
  all: "すべて",
  draft: "下書き",
  open: "公開中",
  ended: "終了",
};

/** 不明な文字列を安全に既定タブ（all）へ丸める。 */
export function normalizeMyTab(raw: string | undefined): MyEventsTab {
  return raw === "draft" || raw === "open" || raw === "ended" ? raw : "all";
}

/** タブに対応する status 群を返す（all は空配列＝絞り込みなし）。 */
export function statusesForMyTab(tab: MyEventsTab): EventStatus[] {
  return MY_TAB_STATUSES[tab];
}

/**
 * 状態一覧から各タブの件数を数える（タブの件数バッジ用・追加クエリ不要）。
 */
export function countByMyTab(
  statuses: EventStatus[],
): Record<MyEventsTab, number> {
  const counts: Record<MyEventsTab, number> = {
    all: statuses.length,
    draft: 0,
    open: 0,
    ended: 0,
  };
  for (const s of statuses) {
    if (MY_TAB_STATUSES.draft.includes(s)) counts.draft += 1;
    else if (MY_TAB_STATUSES.open.includes(s)) counts.open += 1;
    else if (MY_TAB_STATUSES.ended.includes(s)) counts.ended += 1;
  }
  return counts;
}
