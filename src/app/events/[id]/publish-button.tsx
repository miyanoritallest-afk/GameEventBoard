"use client";

import { useState, useTransition } from "react";
import { publishEvent } from "../actions";

/**
 * イベント公開ボタン（クライアント）。
 * Server Action `publishEvent` を呼び、想定内の失敗（戻り値）を画面に表示する。
 * 成功時はサーバー側で revalidatePath され、再描画で公開状態に切り替わる。
 */
export function PublishButton({ eventId }: { eventId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function onPublish() {
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await publishEvent(eventId);
      if (result.error) {
        setError(result.error);
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
      }
    });
  }

  const fieldMessages = Object.values(fieldErrors);

  return (
    <div className="mt-6 rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold">公開する</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        公開すると参加者が応募できるようになります。開催日時・募集締切の設定が必要です（定員は任意）。
      </p>

      {error && (
        <p className="mt-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {fieldMessages.length > 0 && (
        <ul className="mt-2 list-inside list-disc text-sm text-destructive">
          {fieldMessages.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={onPublish}
        disabled={isPending}
        className="mt-4 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        {isPending ? "公開中…" : "イベントを公開"}
      </button>
    </div>
  );
}
