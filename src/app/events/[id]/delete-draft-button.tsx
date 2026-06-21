"use client";

import { useState, useTransition } from "react";
import { deleteDraftEvent } from "../actions";

/**
 * 下書き削除ボタン（クライアント）。確認ダイアログ後に Server Action を呼ぶ。
 * 成功時はサーバー側で /events/mine へ redirect する。
 */
export function DeleteDraftButton({ eventId }: { eventId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onDelete() {
    if (!window.confirm("この下書きを削除します。よろしいですか？")) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteDraftEvent(eventId);
      // 成功時は redirect されるためここには戻らない。戻った場合はエラー。
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={onDelete}
        disabled={isPending}
        className="text-sm text-destructive hover:underline disabled:opacity-60"
      >
        {isPending ? "削除中…" : "下書きを削除"}
      </button>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
