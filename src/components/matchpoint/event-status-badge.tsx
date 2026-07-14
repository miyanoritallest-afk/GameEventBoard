import type { EventStatus } from "@/lib/services/event-status";
import { statusTone, type StatusTone } from "@/lib/services/event-list-filter";

/**
 * イベントの状態バッジ（トーン別）。live は pulse、success は ✓、draft は ✎＋破線。
 * トップ（/）・イベント一覧（/events）・自分のイベント（/events/mine）で共有。
 * draft は自分のイベント一覧でのみ現れる（公開一覧では出ない）が、上位互換として対応する。
 *
 * ※ registrations（登録 status）・series・events/[id]・teams のバッジは
 *   status 体系や API が異なる別物のため、これには寄せない（各画面のローカル定義のまま）。
 */

const STATUS_LABEL: Record<string, string> = {
  draft: "下書き",
  published: "募集中",
  recruiting: "募集中",
  closed: "募集締切",
  ongoing: "開催中",
  finished: "終了",
};

function toneColor(tone: StatusTone): string {
  switch (tone) {
    case "success":
      return "var(--mp-success)";
    case "live":
      return "var(--mp-live)";
    case "warning":
      return "var(--mp-warning)";
    case "draft":
      return "var(--mp-accent)";
    default:
      return "var(--mp-fg-subtle)";
  }
}

export function EventStatusBadge({ status }: { status: EventStatus }) {
  const tone = statusTone(status);
  const label = STATUS_LABEL[status] ?? status;
  const color = toneColor(tone);
  const prefix = tone === "success" ? "✓ " : tone === "draft" ? "✎ " : "";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{
        color,
        backgroundColor: `color-mix(in oklab, ${color} 12%, transparent)`,
        border: `1px ${tone === "draft" ? "dashed" : "solid"} color-mix(in oklab, ${color} 38%, transparent)`,
      }}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${tone === "live" ? "animate-pulse" : ""}`}
        style={{ backgroundColor: color }}
      />
      {prefix}
      {label}
    </span>
  );
}
