"use client";

import { useActionState } from "react";
import { updateBattleTag, type UpdateBattleTagState } from "./actions";

/**
 * バトルタグ編集フォーム（クライアント）。マイページのプロフィール編集。
 * 既定値は保存済みの battle_tag。空で保存すると「未登録に戻す」。
 */
export function BattleTagForm({
  defaultBattleTag,
}: {
  defaultBattleTag: string;
}) {
  const [state, formAction, pending] = useActionState<
    UpdateBattleTagState,
    FormData
  >(updateBattleTag, {});
  const fe = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="mt-2">
      <label className="mb-1 block text-sm font-medium" htmlFor="battleTag">
        バトルタグ
      </label>
      <p className="mb-2 text-xs text-muted-foreground">
        イベント応募時に必要です。登録しておくと応募フォームに自動で入力されます。
      </p>
      <div className="flex items-center gap-2">
        <input
          id="battleTag"
          name="battleTag"
          type="text"
          defaultValue={defaultBattleTag}
          maxLength={32}
          placeholder="例: Player#12345"
          className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "保存中..." : "保存"}
        </button>
      </div>
      {fe.battleTag && (
        <p className="mt-1 text-xs text-destructive">{fe.battleTag}</p>
      )}
      {state.error && !fe.battleTag && (
        <p className="mt-1 text-xs text-destructive">{state.error}</p>
      )}
      {state.ok && (
        <p className="mt-1 text-xs text-primary">バトルタグを保存しました。</p>
      )}
    </form>
  );
}
