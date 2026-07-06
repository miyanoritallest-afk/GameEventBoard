"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { DateTimePicker } from "@/components/datetime-picker";
import { utcIsoToJstLocal } from "@/lib/datetime-local";
import { createScrim, editScrim, removeScrim, type ScrimState } from "./actions";
import type { ScheduleItem, ScheduleKind } from "@/lib/services/schedule";

/**
 * 日程リスト（クライアント）。未消化を上に、消化済みを下に薄く表示する。
 * canManage（自チームがある＝メンバー）なら「予定を追加」と各スクリム/練習の編集/削除を出す。
 * 種別で色分け（公式戦🔴/スクリム🔵/練習🟢）、他チームの公式戦は emphasis='other' で控えめ。
 */

const KIND_META: Record<
  ScheduleKind,
  { label: string; dot: string; ring: string }
> = {
  match: { label: "公式戦", dot: "bg-red-500", ring: "border-l-red-500" },
  scrim: { label: "スクリム", dot: "bg-blue-500", ring: "border-l-blue-500" },
  practice: {
    label: "練習",
    dot: "bg-emerald-500",
    ring: "border-l-emerald-500",
  },
};

/** UTC ISO を JST の「M/D(曜) HH:mm」に整形（表示用）。 */
function fmtJst(iso: string): string {
  const d = new Date(iso);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const w = ["日", "月", "火", "水", "木", "金", "土"][jst.getUTCDay()];
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}(${w}) ${p2(
    jst.getUTCHours(),
  )}:${p2(jst.getUTCMinutes())}`;
}

type DialogState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; item: ScheduleItem };

export function ScheduleList({
  eventId,
  items,
  canManage,
}: {
  eventId: string;
  items: ScheduleItem[];
  canManage: boolean;
}) {
  const [dialog, setDialog] = useState<DialogState>({ mode: "closed" });

  const upcoming = items.filter((i) => !i.consumed);
  const consumed = items.filter((i) => i.consumed);

  return (
    <div className="mt-6">
      {canManage && (
        <button
          type="button"
          onClick={() => setDialog({ mode: "create" })}
          className="mb-4 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          ＋ 予定を追加
        </button>
      )}

      {upcoming.length === 0 && consumed.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          まだ予定はありません。
        </p>
      ) : (
        <ul className="space-y-2">
          {upcoming.map((item) => (
            <ScheduleCard
              key={`${item.kind}-${item.id}`}
              eventId={eventId}
              item={item}
              onEdit={() => setDialog({ mode: "edit", item })}
            />
          ))}
        </ul>
      )}

      {consumed.length > 0 && (
        <div className="mt-6">
          <h2 className="text-xs font-semibold text-muted-foreground">
            消化済み
          </h2>
          <ul className="mt-2 space-y-2 opacity-50">
            {consumed.map((item) => (
              <ScheduleCard
                key={`${item.kind}-${item.id}`}
                eventId={eventId}
                item={item}
                onEdit={() => setDialog({ mode: "edit", item })}
              />
            ))}
          </ul>
        </div>
      )}

      {dialog.mode !== "closed" && (
        <ScrimDialog
          eventId={eventId}
          editing={dialog.mode === "edit" ? dialog.item : null}
          onClose={() => setDialog({ mode: "closed" })}
        />
      )}
    </div>
  );
}

/** 日程カード1枚。種別の色・濃淡・消化済みを反映。スクリム/練習は編集/削除を出す。 */
function ScheduleCard({
  eventId,
  item,
  onEdit,
}: {
  eventId: string;
  item: ScheduleItem;
  onEdit: () => void;
}) {
  const meta = KIND_META[item.kind];
  // 他チームの公式戦は控えめ（薄いグレー・主張を抑える）。
  const muted = item.emphasis === "other";

  return (
    <li
      className={`rounded-xl border border-l-4 bg-card p-4 ${meta.ring} ${
        muted ? "opacity-70" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
            <span className="text-xs text-muted-foreground">{meta.label}</span>
            {item.teamName && (
              <span className="truncate text-xs text-muted-foreground">
                ・{item.teamName}
              </span>
            )}
          </div>
          <p className="mt-1 font-medium">{item.title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {fmtJst(item.scheduledAt)}
          </p>
          {item.memo && (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {item.memo}
            </p>
          )}
          {item.streamUrl && (
            <a
              href={item.streamUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-xs text-primary hover:underline"
            >
              配信を見る
            </a>
          )}
        </div>
        {item.editable && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onEdit}
              className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
            >
              編集
            </button>
            <DeleteButton eventId={eventId} scrimId={item.id} />
          </div>
        )}
      </div>
    </li>
  );
}

function DeleteButton({
  eventId,
  scrimId,
}: {
  eventId: string;
  scrimId: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  function handleDelete() {
    if (!confirm("この予定を削除しますか？")) return;
    setError(null);
    startTransition(async () => {
      const res = await removeScrim(eventId, scrimId);
      if (res.error) setError(res.error);
    });
  }
  return (
    <>
      <button
        type="button"
        onClick={handleDelete}
        disabled={pending}
        className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-60"
      >
        削除
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </>
  );
}

const initialState: ScrimState = {};

/** 登録/編集ダイアログ（共用）。editing があれば編集、無ければ新規。 */
function ScrimDialog({
  eventId,
  editing,
  onClose,
}: {
  eventId: string;
  editing: ScheduleItem | null;
  onClose: () => void;
}) {
  const action = editing
    ? editScrim.bind(null, eventId, editing.id)
    : createScrim.bind(null, eventId);
  const [state, formAction, pending] = useActionState(action, initialState);
  // 種別の初期値（編集時は既存 kind、新規は scrim）。編集時のみ相手初期値を持つ。
  const [kind, setKind] = useState<"scrim" | "practice">(
    editing && editing.kind !== "match" ? editing.kind : "scrim",
  );

  // 成功したら閉じる（レンダリング中に親 setState を呼ばないよう useEffect で）。
  useEffect(() => {
    if (state.success) onClose();
  }, [state.success, onClose]);

  const defaultDateTime = editing ? utcIsoToJstLocal(editing.scheduledAt) : "";
  // 編集時の相手初期値: title が "vs 〇〇" なら 〇〇 を取り出す（スクリムのみ）。
  const defaultOpponent =
    editing && editing.kind === "scrim" && editing.title.startsWith("vs ")
      ? editing.title.slice(3)
      : "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-card p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold">
          {editing ? "予定を編集" : "予定を追加"}
        </h2>
        <form action={formAction} className="mt-3 space-y-3">
          <div>
            <span className="text-xs text-muted-foreground">種別</span>
            <div className="mt-1 flex gap-2">
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="radio"
                  name="kind"
                  value="scrim"
                  checked={kind === "scrim"}
                  onChange={() => setKind("scrim")}
                />
                スクリム
              </label>
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="radio"
                  name="kind"
                  value="practice"
                  checked={kind === "practice"}
                  onChange={() => setKind("practice")}
                />
                練習
              </label>
            </div>
          </div>

          <div>
            <span className="text-xs text-muted-foreground">日時</span>
            <div className="mt-1">
              <DateTimePicker name="scheduledAt" defaultValue={defaultDateTime} />
            </div>
          </div>

          {kind === "scrim" && (
            <div>
              <span className="text-xs text-muted-foreground">相手（任意）</span>
              <input
                name="opponentName"
                type="text"
                defaultValue={defaultOpponent}
                maxLength={60}
                placeholder="例: 〇〇チーム"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
          )}

          <div>
            <span className="text-xs text-muted-foreground">メモ（任意）</span>
            <textarea
              name="memo"
              defaultValue={editing?.memo ?? ""}
              maxLength={500}
              rows={2}
              placeholder="集合時間・使用マップなど"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </div>

          {state.error && (
            <p className="text-xs text-destructive">{state.error}</p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {editing ? "保存" : "追加"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
