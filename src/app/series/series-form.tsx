"use client";

import { useActionState } from "react";
import { createSeries, type CreateSeriesState } from "./actions";
import { FormCard, FormField } from "@/components/matchpoint/form-card";

/**
 * シリーズ作成フォーム（クライアント）。name 必須・description 任意。
 * 送信は Server Action（createSeries）。fieldErrors を各項目に表示。
 *
 * デザイン: event-form と同じ .mp-form スコープ＋番号付きカード。
 */
export function SeriesForm() {
  const [state, formAction, pending] = useActionState<
    CreateSeriesState,
    FormData
  >(createSeries, {});
  const fe = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="mp-form mt-8 flex flex-col gap-5">
      {state.error && (
        <p className="rounded-xl border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {state.error}
        </p>
      )}

      {/* ══════ 01 基本情報 ══════ */}
      <FormCard n="01" title="基本情報">
        <FormField
          label="シリーズ名"
          required
          error={fe.name}
          hint="一覧や各開催回に表示される名前です。100 文字まで。"
        >
          <input
            name="name"
            type="text"
            required
            maxLength={100}
            placeholder="例: OSL（社会人OW部リーグ）"
          />
        </FormField>

        <FormField
          label="説明"
          opt="任意"
          error={fe.description}
          hint="シリーズ詳細ページのヒーローに表示されます。2000 文字まで。"
        >
          <textarea
            name="description"
            rows={5}
            maxLength={2000}
            placeholder="どんな企画か、どのくらいの頻度で開催するかなど。"
          />
        </FormField>
      </FormCard>

      <div className="mt-1">
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-primary px-4 py-3.5 text-sm font-bold text-primary-foreground shadow-[0_0_0_1px_rgba(255,106,43,0.35),0_8px_22px_rgba(255,106,43,0.22)] transition hover:bg-[color:var(--mp-brand-hover)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "作成中…" : "この内容で作成する"}
        </button>
        <p className="mt-3 text-center text-[11.5px] text-[color:var(--mp-fg-subtle)]">
          作成すると、あなたがオーナーのシリーズとして登録されます。
        </p>
      </div>
    </form>
  );
}
