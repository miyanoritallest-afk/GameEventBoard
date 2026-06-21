import type { Database } from "@/lib/supabase/types";

/**
 * 応募（registration）の状態ロジック（Service 層・純粋関数）。
 * event-status.ts と同型。副作用なし・テストの主役。
 *
 * 本 PR の対象（スコアなし最小応募）:
 * - 応募できるのは「公開中（draft 以外）」のイベントのみ。
 * - 承認/却下できるのは「pending」の応募のみ（二重処理を防ぐ）。
 */

export type EventStatus = Database["public"]["Enums"]["event_status"];
export type RegStatus = Database["public"]["Enums"]["reg_status"];

/** 応募できるのは公開中（下書きでない）イベントのみ。 */
export function canRegister(eventStatus: EventStatus): boolean {
  return eventStatus !== "draft";
}

/** 応募不可だった場合の利用者向けメッセージ。 */
export function registerRejectionReason(eventStatus: EventStatus): string {
  if (eventStatus === "draft") {
    return "このイベントはまだ公開されていません。";
  }
  // closed / finished 等、募集フェーズを過ぎた状態は別 PR で締切判定を足す。
  return "このイベントには応募できません。";
}

/** 承認/却下できるのは未処理（pending）の応募のみ。 */
export function canDecide(regStatus: RegStatus): boolean {
  return regStatus === "pending";
}
