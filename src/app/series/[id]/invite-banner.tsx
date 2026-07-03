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
    <div className="mt-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
      <p className="text-sm font-medium">
        このシリーズの運営に招待されています。
      </p>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => respond(true)}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          承認する
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => respond(false)}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-60"
        >
          辞退する
        </button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    </div>
  );
}
