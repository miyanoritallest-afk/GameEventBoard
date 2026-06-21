"use client";

import { useState, useTransition } from "react";
import { decideRegistration } from "../../actions";

/**
 * 応募の承認/却下ボタン（クライアント）。pending の応募にのみ表示する。
 * decideRegistration を呼び、想定内の失敗（戻り値）を表示。成功は revalidatePath で再描画。
 */
export function DecideButtons({ registrationId }: { registrationId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function decide(decision: "approve" | "reject") {
    setError(null);
    startTransition(async () => {
      const result = await decideRegistration(registrationId, decision);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => decide("approve")}
          disabled={isPending}
          className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          承認
        </button>
        <button
          type="button"
          onClick={() => decide("reject")}
          disabled={isPending}
          className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-muted disabled:opacity-60"
        >
          却下
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
