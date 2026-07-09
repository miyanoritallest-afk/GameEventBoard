"use client";

/**
 * スコア/POTG のステッパー（±ボタン・editable=false は数値のみ）。
 * 予選（matches）と決勝トーナメント（tournament）の結果入力モーダルで共通利用する。
 */
export function ScoreStepper({
  label,
  value,
  onChange,
  editable,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  editable: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="max-w-[150px] truncate font-sans text-xs font-semibold text-muted-foreground">
        {label}
      </span>
      <div className="flex items-center gap-2">
        {editable && (
          <button
            type="button"
            aria-label={`${label} を減らす`}
            onClick={() => onChange(value - 1)}
            className="grid h-[38px] w-8 place-items-center rounded-md border border-[color:var(--mp-border-strong)] bg-[color:var(--mp-surface-3)] text-[17px] leading-none transition hover:border-[color:var(--mp-brand)] hover:bg-[color:var(--mp-surface-2)]"
          >
            −
          </button>
        )}
        <span className={`text-center font-mono text-[28px] font-bold ${editable ? "w-[38px]" : ""}`}>
          {value}
        </span>
        {editable && (
          <button
            type="button"
            aria-label={`${label} を増やす`}
            onClick={() => onChange(value + 1)}
            className="grid h-[38px] w-8 place-items-center rounded-md border border-[color:var(--mp-border-strong)] bg-[color:var(--mp-surface-3)] text-[17px] leading-none transition hover:border-[color:var(--mp-brand)] hover:bg-[color:var(--mp-surface-2)]"
          >
            ＋
          </button>
        )}
      </div>
    </div>
  );
}
