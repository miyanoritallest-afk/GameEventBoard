"use client";

import { useState, useTransition } from "react";
import { respondInvite } from "../actions";

/**
 * 招待バナー（クライアント）。被招待者本人（status=invited）にのみ表示する。
 * 承認 → active 化、拒否 → 行削除。作用先は本人の invited 行のみ（DB関数＋RLS が最終防衛）。
 * 承認/拒否後はページを再検証（revalidatePath）して運営一覧に反映される。
 */
export function InviteBanner({ seriesId }: { seriesId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function respond(accept: boolean) {
    setError(null);
    const fd = new FormData();
    fd.set("seriesId", seriesId);
    fd.set("accept", accept ? "true" : "false");
    startTransition(async () => {
      const res = await respondInvite({}, fd);
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="mt-5 flex items-start gap-3.5 rounded-xl border border-[color:var(--mp-warning)]/40 bg-[color:var(--mp-warning)]/[0.1] p-5 shadow-[var(--mp-e1)]">
      <span
        aria-hidden
        className="mt-0.5 flex size-9 flex-none items-center justify-center rounded-full bg-[color:var(--mp-warning)]/15 text-[color:var(--mp-warning)]"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.9}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M19 8v6M22 11h-6" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-heading text-sm font-bold text-foreground">
          このシリーズの運営に招待されています。
        </p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
          承認すると運営メンバーとして、すべての開催回を編集できるようになります。
        </p>
        <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={pending}
            onClick={() => respond(true)}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-[0_0_0_1px_rgba(255,106,43,0.35),0_6px_18px_rgba(255,106,43,0.2)] transition hover:bg-[color:var(--mp-brand-hover)] disabled:opacity-60"
          >
            承認する
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => respond(false)}
            className="rounded-md border border-[color:var(--mp-border-strong)] px-4 py-2 text-sm font-semibold text-muted-foreground transition hover:bg-[color:var(--mp-surface-3)] hover:text-foreground disabled:opacity-60"
          >
            辞退する
          </button>
          {error && <span className="text-xs text-destructive">{error}</span>}
        </div>
      </div>
    </div>
  );
}
