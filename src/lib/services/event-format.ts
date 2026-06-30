import type { Database } from "@/lib/supabase/types";

/**
 * イベント形式（events.format）の画面出し分けロジック（Service 層・純粋関数）。
 * 実装ガイドライン: 形式判定はDB詳細・観戦ビュー・各board（ブロック分け/対戦表/決勝T）の
 * 複数箇所で使うため、ここに一元化して副作用なしでテストする。
 *
 * event_format:
 *   - round_robin                  … 総当たりのみ（予選あり・決勝Tなし）
 *   - tournament                   … トーナメントのみ（予選なし・決勝Tあり）
 *   - round_robin_then_tournament  … 総当たり→決勝T（予選あり・決勝Tあり。既定＝従来挙動）
 */

export type EventFormat = Database["public"]["Enums"]["event_format"];

/**
 * この形式が「予選（ブロック分け・予選対戦表・予選順位）」を持つか。
 * 総当たりを含む形式（round_robin / round_robin_then_tournament）だけが true。
 */
export function hasGroupStage(format: EventFormat): boolean {
  return (
    format === "round_robin" || format === "round_robin_then_tournament"
  );
}

/**
 * この形式が「決勝トーナメント」を持つか。
 * トーナメントを含む形式（tournament / round_robin_then_tournament）だけが true。
 */
export function hasTournamentStage(format: EventFormat): boolean {
  return (
    format === "tournament" || format === "round_robin_then_tournament"
  );
}

/** 形式の日本語ラベル（フォームの選択肢と同じ表記で統一）。 */
export function eventFormatLabel(format: EventFormat): string {
  switch (format) {
    case "round_robin":
      return "総当たりのみ";
    case "tournament":
      return "トーナメントのみ";
    case "round_robin_then_tournament":
      return "総当たり → 決勝トーナメント";
  }
}
