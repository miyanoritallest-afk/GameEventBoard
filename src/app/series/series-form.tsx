"use client";

import { useActionState } from "react";
import { createSeries, type CreateSeriesState } from "./actions";

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
      <section className="rounded-2xl border border-border bg-card p-6 shadow-[var(--mp-e1)]">
        <div className="mb-5 flex items-baseline gap-3">
          <span className="font-mono text-xs font-semibold tracking-[0.14em] text-[color:var(--mp-brand)]">
            01
          </span>
          <h2 className="text-base font-extrabold tracking-tight text-foreground">
            基本情報
          </h2>
        </div>

        <div className="flex flex-col gap-[18px]">
          <div>
            <label
              htmlFor="name"
              className="mb-[7px] block text-[13px] font-semibold text-foreground"
            >
              シリーズ名
              <span className="ml-[3px] text-[color:var(--mp-brand)]">*</span>
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              maxLength={100}
              placeholder="例: OSL（社会人OW部リーグ）"
            />
            <p className="mt-[7px] text-[11.5px] leading-relaxed text-[color:var(--mp-fg-muted)]">
              一覧や各開催回に表示される名前です。100 文字まで。
            </p>
            {fe.name && (
              <p className="mt-1 text-xs text-destructive">{fe.name}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="description"
              className="mb-[7px] block text-[13px] font-semibold text-foreground"
            >
              説明
              <span className="ml-1.5 text-[11.5px] font-normal text-[color:var(--mp-fg-subtle)]">
                任意
              </span>
            </label>
            <textarea
              id="description"
              name="description"
              rows={5}
              maxLength={2000}
              placeholder="どんな企画か、どのくらいの頻度で開催するかなど。"
            />
            <p className="mt-[7px] text-[11.5px] leading-relaxed text-[color:var(--mp-fg-muted)]">
              シリーズ詳細ページのヒーローに表示されます。2000 文字まで。
            </p>
            {fe.description && (
              <p className="mt-1 text-xs text-destructive">{fe.description}</p>
            )}
          </div>
        </div>
      </section>

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
