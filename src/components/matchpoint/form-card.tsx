// フォーム系画面（event-form / apply-form / series-form 等）で共有する
// 番号付きカードと入力フィールドのプリミティブ。.theme-matchpoint 前提。
// 縦の間隔は親（FormCard body / grid の gap）が持ち、FormField 自身は余白を持たない
// （以前 [&+&]:mt-* で隣接余白を持たせて grid 列2以降に段ズレした経緯があるため）。

/** 設定群を1つのカードに（番号付き見出し）。sub は右寄せの補足文言。 */
export function FormCard({
  n,
  title,
  sub,
  children,
}: {
  n: string;
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-[var(--mp-e1)]">
      <div className="mb-5 flex items-baseline gap-3">
        <span className="font-mono text-xs font-semibold tracking-[0.14em] text-[color:var(--mp-brand)]">
          {n}
        </span>
        <h2 className="text-base font-extrabold tracking-tight text-foreground">
          {title}
        </h2>
        {sub && (
          <span className="ml-auto text-xs text-[color:var(--mp-fg-muted)]">
            {sub}
          </span>
        )}
      </div>
      {/* 直下の各ブロック（FormField / grid / Nest）を一定間隔で縦積みする。 */}
      <div className="flex flex-col gap-[18px]">{children}</div>
    </section>
  );
}

/** 1入力欄（ラベル＋必須/任意マーク＋子＋エラー/ヒント）。 */
export function FormField({
  label,
  required,
  opt,
  error,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  /** 任意・補足のラベル（"任意" / "JST" / "到達ボーナス・任意" 等）。 */
  opt?: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-[7px] block text-[13px] font-semibold text-foreground">
        {label}
        {required && (
          <span className="ml-[3px] text-[color:var(--mp-brand)]">*</span>
        )}
        {opt && (
          <span className="ml-1.5 text-[11.5px] font-normal text-[color:var(--mp-fg-subtle)]">
            {opt}
          </span>
        )}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      {hint && (
        <p className="mt-[7px] text-[11.5px] leading-relaxed text-[color:var(--mp-fg-muted)]">
          {hint}
        </p>
      )}
    </div>
  );
}
