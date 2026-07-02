"use client";

import { useState, useTransition } from "react";
import { seriesifyEvent } from "@/app/series/actions";

/**
 * 「シリーズ化」ボタン（クライアント）。主催者・series 未所属のイベント詳細に出す。
 * 押すとこのイベントを起点にシリーズを作り、第1回として紐付ける（成功で /series/[id] へ）。
 * 「単発→好評→シリーズ化」の起点（要件定義書 3.5.1）。
 */
export function SeriesifyButton({ eventId }: { eventId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const res = await seriesifyEvent(eventId);
      // 成功時は Server Action 側で redirect する（ここには来ない）。
      if (res?.error) setError(res.error);
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="text-sm text-primary hover:underline disabled:opacity-60"
      >
        {pending ? "シリーズ化中…" : "シリーズ化する"}
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
