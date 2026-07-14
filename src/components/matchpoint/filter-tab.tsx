import Link from "next/link";

/**
 * 一覧画面のフィルタタブ（件数バッジ付き）。active でブランド強調。
 * イベント一覧（/events）・自分のイベント（/events/mine）で共有。
 */
export function FilterTab({
  label,
  count,
  active,
  href,
}: {
  label: string;
  count: number;
  active: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
        active
          ? "bg-[color:var(--mp-brand)]/15 text-[color:var(--mp-brand)]"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
      <span
        className={`font-mono text-xs tabular-nums ${
          active
            ? "text-[color:var(--mp-brand)]"
            : "text-[color:var(--mp-fg-subtle)]"
        }`}
      >
        {count}
      </span>
    </Link>
  );
}
