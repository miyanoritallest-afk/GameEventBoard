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
 *
 * デザイン: .theme-matchpoint。日付ブロック＋種別左帯の行カード＋登録/編集モーダル（.mp-form）。
 */

/** 種別ごとの色・ラベル・絵文字。色は案のスケジュール識別色（ロール色とは別物）。 */
const KIND_META: Record<
  ScheduleKind,
  { label: string; emoji: string; color: string }
> = {
  match: { label: "公式戦", emoji: "🔴", color: "#F2596B" },
  scrim: { label: "スクリム", emoji: "🔵", color: "#4C9BE8" },
  practice: { label: "練習", emoji: "🟢", color: "#3FD08A" },
};

/** UTC ISO を JST の日付パーツに分解（日付ブロック表示用）。 */
function jstParts(iso: string) {
  const d = new Date(iso);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const w = ["日", "月", "火", "水", "木", "金", "土"][jst.getUTCDay()];
  const p2 = (n: number) => String(n).padStart(2, "0");
  return {
    md: `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}`,
    dow: w,
    tm: `${p2(jst.getUTCHours())}:${p2(jst.getUTCMinutes())}`,
    yr: String(jst.getUTCFullYear()),
  };
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
  const isEmpty = items.length === 0;

  return (
    <div className="mt-8">
      {/* ツールバー：予定を追加（メンバーのみ） */}
      {canManage && !isEmpty && (
        <div className="mb-1 flex justify-end">
          <button
            type="button"
            onClick={() => setDialog({ mode: "create" })}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-[0_0_0_1px_rgba(255,106,43,0.35),0_6px_18px_rgba(255,106,43,0.2)] transition hover:bg-[color:var(--mp-brand-hover)]"
          >
            <PlusIcon />
            予定を追加
          </button>
        </div>
      )}

      {isEmpty ? (
        <EmptyState
          canManage={canManage}
          onAdd={() => setDialog({ mode: "create" })}
        />
      ) : (
        <>
          {/* 未消化 */}
          <SectionHead title="未消化" count={upcoming.length} sub="開始が早い順" />
          {upcoming.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[color:var(--mp-border-strong)] bg-card px-5 py-8 text-center text-sm text-muted-foreground">
              未消化の予定はありません。これから始まる予定がここに表示されます。
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
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

          {/* 消化済み（薄く） */}
          {consumed.length > 0 && (
            <div className="mt-6 opacity-60">
              <SectionHead
                title="消化済み"
                count={consumed.length}
                sub="開始が新しい順"
                done
              />
              <ul className="flex flex-col gap-3">
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
        </>
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

/** セクション見出し（未消化 / 消化済み）。 */
function SectionHead({
  title,
  count,
  sub,
  done,
}: {
  title: string;
  count: number;
  sub: string;
  done?: boolean;
}) {
  return (
    <div className="mb-3.5 mt-6 flex items-baseline gap-2.5 first:mt-0">
      <span
        aria-hidden
        className="relative top-0.5 h-4 w-[3px] rounded-sm"
        style={{
          background: done ? "var(--mp-fg-subtle)" : "var(--mp-brand)",
        }}
      />
      <h2
        className={`text-[15px] font-extrabold tracking-tight ${
          done ? "text-muted-foreground" : "text-foreground"
        }`}
      >
        {title}
      </h2>
      <span className="font-mono text-[13px] font-semibold tabular-nums text-[color:var(--mp-fg-subtle)]">
        ({count})
      </span>
      <span className="ml-auto text-xs text-[color:var(--mp-fg-subtle)]">
        {sub}
      </span>
    </div>
  );
}

/** 日程カード1枚。日付ブロック＋種別の左帯/色ドット/バッジ。スクリム/練習は編集/削除。 */
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
  const w = jstParts(item.scheduledAt);
  // 他チームの公式戦は控えめ（薄く）。
  const foreign = item.emphasis === "other";
  // 公式戦（自チーム）は「自動生成（編集不可）」を明示する。
  const isOwnMatch = item.kind === "match" && !foreign;

  return (
    <li
      className={`relative flex items-center gap-4 overflow-hidden rounded-xl border border-border bg-card p-4 pl-[22px] shadow-[var(--mp-e1)] transition hover:border-[color:var(--mp-border-strong)] ${
        foreign ? "opacity-50 hover:opacity-70" : ""
      }`}
    >
      {/* 種別の左アクセント帯 */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: meta.color }}
      />

      {/* 日付ブロック */}
      <div className="flex w-[92px] flex-none flex-col gap-0.5">
        <span className="flex items-baseline gap-1.5">
          <span className="font-mono text-[19px] font-semibold leading-none tabular-nums text-foreground">
            {w.md}
          </span>
          <span className="text-[11px] text-muted-foreground">({w.dow})</span>
        </span>
        <span className="mt-0.5 font-mono text-[13px] tabular-nums text-muted-foreground">
          {w.tm}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-[color:var(--mp-fg-subtle)]">
          {w.yr}
        </span>
      </div>

      <span aria-hidden className="w-px self-stretch bg-border" />

      {/* メイン */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold"
            style={{
              color: meta.color,
              backgroundColor: `color-mix(in oklab, ${meta.color} 12%, transparent)`,
              border: `1px solid color-mix(in oklab, ${meta.color} 30%, transparent)`,
            }}
          >
            <span
              aria-hidden
              className="size-[7px] rounded-full"
              style={{
                background: meta.color,
                boxShadow: `0 0 7px color-mix(in oklab, ${meta.color} 60%, transparent)`,
              }}
            />
            {meta.emoji} {meta.label}
          </span>
          {item.teamName && (
            <span className="truncate text-xs text-muted-foreground">
              <span className="text-foreground">{item.teamName}</span>
            </span>
          )}
        </div>

        <p className="font-heading text-base font-bold leading-tight text-foreground">
          {item.title}
        </p>

        {item.memo && (
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            {item.memo}
          </p>
        )}

        {item.streamUrl && (
          <a
            href={item.streamUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-1.5 text-xs font-semibold text-[color:var(--mp-live)] hover:text-[color:var(--mp-accent)] hover:underline"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.9}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="m10 8 6 4-6 4V8z" />
              <rect x="2" y="4" width="20" height="16" rx="3" />
            </svg>
            {item.consumed ? "アーカイブを見る" : "配信を見る"}
          </a>
        )}
      </div>

      {/* アクション */}
      <div className="flex flex-none items-center gap-2">
        {item.editable ? (
          <>
            <button
              type="button"
              onClick={onEdit}
              aria-label="編集"
              title="編集"
              className="flex size-[34px] items-center justify-center rounded-md border border-[color:var(--mp-border-strong)] bg-[color:var(--mp-surface-3)] text-foreground transition hover:bg-[color:var(--mp-surface-2)]"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.9}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
              </svg>
            </button>
            <DeleteButton eventId={eventId} scrimId={item.id} />
          </>
        ) : isOwnMatch ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-[color:var(--mp-fg-subtle)]">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.9}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <rect x="4" y="11" width="16" height="9" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            自動生成
          </span>
        ) : null}
      </div>
    </li>
  );
}

function PlusIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
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
        aria-label="削除"
        title="削除"
        className="flex size-[34px] items-center justify-center rounded-md border border-[color:var(--mp-border-strong)] text-muted-foreground transition hover:border-[color:var(--mp-danger)]/40 hover:bg-[color:var(--mp-danger)]/12 hover:text-[color:var(--mp-danger)] disabled:opacity-60"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.9}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        </svg>
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </>
  );
}

/** 空状態（予定ゼロ）。 */
function EmptyState({
  canManage,
  onAdd,
}: {
  canManage: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-[color:var(--mp-border-strong)] bg-card px-6 py-16 text-center">
      <span
        aria-hidden
        className="mb-4 flex size-14 items-center justify-center rounded-full border border-border bg-[color:var(--mp-surface-3)] text-[color:var(--mp-fg-subtle)]"
      >
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      </span>
      <h3 className="text-base font-bold text-foreground">
        まだ予定はありません。
      </h3>
      <p className="mt-2 max-w-[360px] text-sm text-muted-foreground">
        スクリムや練習の予定を追加すると、開始が早い順にここへ並びます。公式戦は対戦表を生成すると自動で表示されます。
      </p>
      {canManage && (
        <button
          type="button"
          onClick={onAdd}
          className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-[color:var(--mp-brand-hover)]"
        >
          <PlusIcon />
          予定を追加
        </button>
      )}
    </div>
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
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/[0.66] p-6 backdrop-blur-[6px] sm:p-14"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="mp-form w-full max-w-[520px] overflow-hidden rounded-2xl border border-[color:var(--mp-border-strong)] bg-card shadow-[var(--mp-e3)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-start gap-3.5 border-b border-border bg-gradient-to-b from-[color:var(--mp-surface-2)] to-transparent px-[22px] py-[18px]">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--mp-accent)]">
              {editing ? "Edit schedule" : "New schedule"}
            </p>
            <p className="mt-1.5 font-heading text-lg font-extrabold text-foreground">
              {editing ? "予定を編集" : "予定を追加"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="flex size-8 flex-none items-center justify-center rounded-md border border-border text-muted-foreground transition hover:bg-[color:var(--mp-surface-3)] hover:text-foreground"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form action={formAction} className="flex flex-col gap-[18px] px-[22px] py-5">
          {/* 種別（セグメント風トグル） */}
          <div>
            <label className="mb-2 block text-[13px] font-semibold text-foreground">
              種別<span className="ml-[3px] text-[color:var(--mp-brand)]">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <KindOption
                value="scrim"
                checked={kind === "scrim"}
                onChange={() => setKind("scrim")}
                color={KIND_META.scrim.color}
                title="🔵 スクリム"
                desc="他チームとの練習試合"
              />
              <KindOption
                value="practice"
                checked={kind === "practice"}
                onChange={() => setKind("practice")}
                color={KIND_META.practice.color}
                title="🟢 練習"
                desc="チーム内の練習枠"
              />
            </div>
          </div>

          {/* 日時 */}
          <div>
            <label className="mb-2 block text-[13px] font-semibold text-foreground">
              日時
              <span className="ml-1.5 text-[11.5px] font-normal text-[color:var(--mp-fg-subtle)]">
                JST
              </span>
              <span className="ml-[3px] text-[color:var(--mp-brand)]">*</span>
            </label>
            <DateTimePicker name="scheduledAt" defaultValue={defaultDateTime} />
          </div>

          {/* 相手（スクリムのみ） */}
          {kind === "scrim" && (
            <div>
              <label className="mb-2 block text-[13px] font-semibold text-foreground">
                相手
                <span className="ml-1.5 text-[11.5px] font-normal text-[color:var(--mp-fg-subtle)]">
                  任意
                </span>
              </label>
              <input
                name="opponentName"
                type="text"
                defaultValue={defaultOpponent}
                maxLength={60}
                placeholder="例: 〇〇チーム"
              />
              <p className="mt-[7px] text-[11.5px] leading-relaxed text-[color:var(--mp-fg-muted)]">
                相手チーム名。空欄なら「スクリム」とだけ表示されます。
              </p>
            </div>
          )}

          {/* メモ */}
          <div>
            <label className="mb-2 block text-[13px] font-semibold text-foreground">
              メモ
              <span className="ml-1.5 text-[11.5px] font-normal text-[color:var(--mp-fg-subtle)]">
                任意
              </span>
            </label>
            <textarea
              name="memo"
              defaultValue={editing?.memo ?? ""}
              maxLength={500}
              rows={2}
              placeholder="集合時間・使用マップ・VC など"
            />
          </div>

          {state.error && (
            <p className="text-xs text-destructive">{state.error}</p>
          )}

          {/* フッター */}
          <div className="-mx-[22px] -mb-5 mt-1 flex items-center justify-end gap-2.5 border-t border-border bg-[color:var(--mp-surface-2)] px-[22px] py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-muted-foreground transition hover:bg-[color:var(--mp-surface-3)] hover:text-foreground"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-[0_0_0_1px_rgba(255,106,43,0.35),0_6px_18px_rgba(255,106,43,0.2)] transition hover:bg-[color:var(--mp-brand-hover)] disabled:opacity-60"
            >
              {editing ? "保存" : "追加"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** 種別のセグメント選択肢（ラジオ＋色ドット＋説明）。 */
function KindOption({
  value,
  checked,
  onChange,
  color,
  title,
  desc,
}: {
  value: "scrim" | "practice";
  checked: boolean;
  onChange: () => void;
  color: string;
  title: string;
  desc: string;
}) {
  return (
    <label className="relative cursor-pointer">
      <input
        type="radio"
        name="kind"
        value={value}
        checked={checked}
        onChange={onChange}
        className="peer sr-only"
      />
      <span
        className="flex items-center gap-2.5 rounded-md border border-[color:var(--mp-border-strong)] bg-[color:var(--mp-surface-3)] px-3.5 py-2.5 transition peer-checked:bg-[color:var(--mp-surface-2)] peer-focus-visible:shadow-[0_0_0_3px_rgba(255,106,43,0.22)]"
        style={
          checked
            ? { borderColor: color, boxShadow: `0 0 0 1px ${color}` }
            : undefined
        }
      >
        <span
          aria-hidden
          className="size-[9px] flex-none rounded-full"
          style={{
            background: color,
            boxShadow: `0 0 8px color-mix(in oklab, ${color} 60%, transparent)`,
          }}
        />
        <span className="flex flex-col gap-px leading-tight">
          <span className="text-[13.5px] font-bold text-foreground">
            {title}
          </span>
          <span className="text-[10.5px] text-muted-foreground">{desc}</span>
        </span>
      </span>
    </label>
  );
}
