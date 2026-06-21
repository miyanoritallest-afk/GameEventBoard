"use client";

import { useState, useTransition } from "react";
import { registerForEvent } from "../actions";

/**
 * 応募ボタン（クライアント）。Server Action registerForEvent を呼び、
 * 想定内の失敗（戻り値）を画面に表示する。成功時は revalidatePath で再描画。
 */
export function ApplyButton({ eventId }: { eventId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onApply() {
    setError(null);
    startTransition(async () => {
      const result = await registerForEvent(eventId);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="mt-6 rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold">このイベントに応募する</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        参加表明を送ります。主催者の承認後に参加が確定します。
      </p>

      {error && (
        <p className="mt-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={onApply}
        disabled={isPending}
        className="mt-4 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        {isPending ? "応募中…" : "応募する"}
      </button>
    </div>
  );
}
