"use client";

import { useActionState } from "react";
import { createEvent, type CreateEventState } from "../actions";
import { DateTimePicker } from "@/components/datetime-picker";

type GameOption = { id: string; name: string };

const initialState: CreateEventState = {};

export function NewEventForm({ games }: { games: GameOption[] }) {
  const [state, formAction, pending] = useActionState(createEvent, initialState);
  const fe = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="mt-6 space-y-6">
      {state.error && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      {/* 基本情報 */}
      <Field label="タイトル" required error={fe.title}>
        <input
          name="title"
          type="text"
          maxLength={80}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </Field>

      <Field label="ゲーム" required error={fe.gameId}>
        <select
          name="gameId"
          defaultValue={games[0]?.id ?? ""}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="説明（任意）" error={fe.description}>
        <textarea
          name="description"
          rows={4}
          maxLength={2000}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </Field>

      {/* 開催期間 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="開催開始（JST）" required error={fe.startsAt}>
          <DateTimePicker name="startsAt" />
        </Field>
        <Field label="開催終了（JST）" required error={fe.endsAt}>
          <DateTimePicker name="endsAt" />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="募集締切（任意・JST）" error={fe.recruitDeadline}>
          <DateTimePicker name="recruitDeadline" />
        </Field>
        <Field label="定員（チーム数・任意）" error={fe.capacity}>
          <input
            name="capacity"
            type="number"
            min={1}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </Field>
      </div>

      {/* スコアリング設定 */}
      <fieldset className="rounded-xl border border-border bg-card p-4">
        <legend className="px-1 text-sm font-semibold">スコアリング設定</legend>

        <label className="mt-2 flex items-center gap-2 text-sm">
          <input name="roleSwapAllowed" type="checkbox" className="size-4" />
          ロールスワップを許可する（複数ロールのランク申告）
        </label>

        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="申告シーズン数" error={fe.declaredSeasons}>
            <input
              name="declaredSeasons"
              type="number"
              min={1}
              max={10}
              defaultValue={3}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>
          <Field label="ボーナス: マスター" error={fe.bonusMaster}>
            <input
              name="bonusMaster"
              type="number"
              min={0}
              max={10}
              step="0.5"
              defaultValue={0}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>
          <Field label="ボーナス: GM" error={fe.bonusGm}>
            <input
              name="bonusGm"
              type="number"
              min={0}
              max={10}
              step="0.5"
              defaultValue={0}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>
          <Field label="ボーナス: チャンピオン" error={fe.bonusChampion}>
            <input
              name="bonusChampion"
              type="number"
              min={0}
              max={10}
              step="0.5"
              defaultValue={0}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>
        </div>
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? "作成中..." : "この内容で作成する（下書き）"}
      </button>
    </form>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
