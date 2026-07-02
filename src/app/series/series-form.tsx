"use client";

import { useActionState } from "react";
import { createSeries, type CreateSeriesState } from "./actions";

/**
 * シリーズ作成フォーム（クライアント）。name 必須・description 任意。
 * 送信は Server Action（createSeries）。fieldErrors を各項目に表示。
 */
export function SeriesForm() {
  const [state, formAction, pending] = useActionState<
    CreateSeriesState,
    FormData
  >(createSeries, {});
  const fe = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="mt-6 space-y-5">
      {state.error && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <div>
        <label htmlFor="name" className="block text-sm font-medium">
          シリーズ名*
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          maxLength={100}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          placeholder="例: OSL（社会人OW部リーグ）"
        />
        {fe.name && <p className="mt-1 text-xs text-destructive">{fe.name}</p>}
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium">
          説明（任意）
        </label>
        <textarea
          id="description"
          name="description"
          rows={4}
          maxLength={2000}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          placeholder="どんな企画か、どのくらいの頻度で開催するかなど。"
        />
        {fe.description && (
          <p className="mt-1 text-xs text-destructive">{fe.description}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        {pending ? "作成中…" : "シリーズを作成"}
      </button>
    </form>
  );
}
