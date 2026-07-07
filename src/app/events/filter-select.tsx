"use client";

import { useRouter } from "next/navigation";

/**
 * 一覧のフィルタ用セレクト（Client 島）。
 * 変更で即クエリ遷移する（フィルタの即時反映）。他のクエリ（tab/sort/game）は preserve で維持。
 * URL クエリ駆動なので、状態は URL が持つ（クライアント状態管理は最小）。
 *
 * XSS 対策: 値は URLSearchParams で組み立て（自前の文字列連結をしない）。
 * dangerouslySetInnerHTML は使わない（ガイドライン遵守）。
 */
export function FilterSelect({
  name,
  value,
  options,
  ariaLabel,
  preserve,
}: {
  name: string;
  value: string;
  options: { value: string; label: string }[];
  ariaLabel: string;
  /** この select 以外に維持したいクエリ（tab/sort/game 等）。空値は落とす。 */
  preserve: Record<string, string | undefined>;
}) {
  const router = useRouter();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(preserve)) {
      if (v) q.set(k, v);
    }
    if (e.target.value) q.set(name, e.target.value);
    else q.delete(name);
    const s = q.toString();
    router.push(s ? `/events?${s}` : "/events");
  }

  return (
    <select
      name={name}
      defaultValue={value}
      onChange={onChange}
      aria-label={ariaLabel}
      className="rounded-lg border border-border bg-[color:var(--mp-surface)] px-3 py-2 text-sm text-foreground"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
