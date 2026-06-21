import type { Database } from "@/lib/supabase/types";

/**
 * イベントの状態遷移ロジック（Service 層・純粋関数）。
 * 実装ガイドライン: 複雑/重要なロジックは Controller から切り出し、副作用なしでテストする。
 *
 * event_status: draft → published → recruiting → closed → ongoing → finished
 * 本 PR では「公開」= draft → published の1遷移のみを扱う。
 * 他の遷移（募集開始など）は、それぞれの機能実装時に本ファイルへ追加する。
 */

export type EventStatus = Database["public"]["Enums"]["event_status"];

/** 公開できるのは下書きのときだけ。これ以外からの公開は不正（二重公開・終了後の再公開を防ぐ）。 */
export function canPublish(status: EventStatus): boolean {
  return status === "draft";
}

/**
 * 詳細ページの閲覧可否（純粋関数）。RLS 0005 と同じルールをアプリ層でも持つ。
 * - 公開済み（draft 以外）は誰でも閲覧可。
 * - 下書き（draft）は主催者本人のみ。
 * viewerId は未ログインなら null。
 */
export function canViewEvent(
  status: EventStatus,
  organizerId: string,
  viewerId: string | null,
): boolean {
  if (status !== "draft") return true;
  return viewerId !== null && viewerId === organizerId;
}

/** 公開不可だった場合に、状態に応じた利用者向けメッセージを返す。 */
export function publishRejectionReason(status: EventStatus): string {
  if (status === "published" || status === "recruiting") {
    return "このイベントはすでに公開されています。";
  }
  // closed / ongoing / finished 等、公開フェーズを過ぎた状態。
  return "このイベントは公開できる状態ではありません。";
}
