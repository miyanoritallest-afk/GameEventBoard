"use client";

import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  dateToLocalInput,
  localInputToDate,
  formatLocalInputForDisplay,
  HOUR_OPTIONS,
  MINUTE_STEPS,
} from "@/lib/datetime-local";
import { cn } from "@/lib/utils";

/**
 * 日時ピッカー（カレンダー＋時刻、確定/キャンセル導線つき）。
 *
 * ネイティブ <input type="datetime-local"> を置き換える。利用者からの要望:
 * 「カレンダー外クリックでしか確定できず不便」→ 明示的な確定/キャンセルボタンを用意。
 *
 * フォーム連携: 値は hidden input（name 指定）に "YYYY-MM-DDTHH:mm" 形式で出す。
 * 形式は datetime-local と同一なので Server Action / Zod は変更不要。
 *
 * 時刻は 15 分刻み（00/15/30/45）。これも従来の step=900 の意図を踏襲。
 */
export function DateTimePicker({
  name,
  defaultValue = "",
  id,
}: {
  name: string;
  defaultValue?: string;
  id?: string;
}) {
  // 確定済みの値（フォームに送られる正）。
  const [value, setValue] = React.useState<string>(defaultValue);
  const [open, setOpen] = React.useState(false);

  // ポップアップ内の編集中（ドラフト）状態。確定するまで value には反映しない。
  const initial = localInputToDate(defaultValue);
  const [draftDate, setDraftDate] = React.useState<Date | undefined>(
    initial ?? undefined,
  );
  const [draftHour, setDraftHour] = React.useState<string>(
    initial ? String(initial.getHours()).padStart(2, "0") : "20",
  );
  const [draftMinute, setDraftMinute] = React.useState<string>(
    initial ? nearestStep(initial.getMinutes()) : "00",
  );

  // ポップアップを開くたびに、現在の確定値からドラフトを作り直す。
  function syncDraftFromValue() {
    const d = localInputToDate(value);
    setDraftDate(d ?? undefined);
    setDraftHour(d ? String(d.getHours()).padStart(2, "0") : "20");
    setDraftMinute(d ? nearestStep(d.getMinutes()) : "00");
  }

  function handleOpenChange(next: boolean) {
    if (next) syncDraftFromValue();
    setOpen(next);
  }

  function handleConfirm() {
    if (!draftDate) {
      // 日付未選択なら未設定として扱う（任意項目を空に戻せる）。
      setValue("");
      setOpen(false);
      return;
    }
    const d = new Date(draftDate);
    d.setHours(Number(draftHour), Number(draftMinute), 0, 0);
    setValue(dateToLocalInput(d));
    setOpen(false);
  }

  function handleClear() {
    setValue("");
    setOpen(false);
  }

  const display = formatLocalInputForDisplay(value);

  return (
    <>
      {/* フォーム送信値。形式は datetime-local 互換。 */}
      <input type="hidden" name={name} value={value} />

      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              id={id}
              className={cn(
                "w-full justify-start text-left font-normal",
                !value && "text-muted-foreground",
              )}
            >
              <CalendarIcon className="mr-2 size-4" />
              {display || "日時を選択"}
            </Button>
          }
        />
        <PopoverContent align="start" className="w-auto">
          <Calendar
            mode="single"
            selected={draftDate}
            onSelect={setDraftDate}
            autoFocus
          />

          <div className="flex items-center justify-center gap-2 px-1">
            <select
              aria-label="時"
              value={draftHour}
              onChange={(e) => setDraftHour(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            >
              {HOUR_OPTIONS.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
            <span className="text-sm text-muted-foreground">:</span>
            <select
              aria-label="分"
              value={draftMinute}
              onChange={(e) => setDraftMinute(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            >
              {MINUTE_STEPS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between gap-2 px-1 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClear}
            >
              クリア
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
              >
                キャンセル
              </Button>
              <Button type="button" size="sm" onClick={handleConfirm}>
                確定
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}

/** 分を 15 分刻みの最も近い下限へ丸める（00/15/30/45）。 */
function nearestStep(minute: number): string {
  const step = Math.floor(minute / 15) * 15;
  return String(step).padStart(2, "0");
}
