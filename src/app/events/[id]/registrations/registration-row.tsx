"use client";

import { useState, useTransition } from "react";
import {
  decideRegistration,
  overrideRegistrationScore,
} from "../../actions";
import { scoreToRankLabel } from "@/lib/services/overwatch-ranks";

const REG_STATUS_LABEL: Record<string, string> = {
  pending: "承認待ち",
  approved: "参加確定",
  rejected: "不参加",
  withdrawn: "取り下げ",
};

const ROLE_LABEL: Record<string, string> = {
  tank: "タンク",
  dps: "DPS",
  support: "サポート",
};

/** ロール識別色トークン（globals.css の --mp-tank/dps/support）。 */
const ROLE_COLOR: Record<string, string> = {
  tank: "var(--mp-tank)",
  dps: "var(--mp-dps)",
  support: "var(--mp-support)",
};

const HANDLING_LABEL: Record<string, string> = {
  fill_by_role: "同シーズンの他ロール平均で補完",
  fill_by_season: "同ロールの他シーズン平均で補完",
  exclude: "未認定は除外",
};

/** score_breakdown(jsonb) の想定形（PR-D で保存した形）。 */
type Breakdown = {
  method?: string;
  handling?: string;
  base?: number | null;
  bonusApplied?: number;
  peak?: string;
  grid?: Record<string, string[]>;
};

export type RegistrationRowData = {
  id: string;
  status: string;
  createdAtLabel: string;
  /** 公開表示名（登録名 ?? Discord名）。全立場で主表示。 */
  displayName: string;
  /** 素のDiscord名（内部識別）。運営のみに渡す（観戦者・応募者には null）。 */
  discordName: string | null;
  battleTag: string | null;
  preferredRole: string | null;
  preferredRoles: (string | null)[]; // [第1, 第2, 第3]
  individualScore: number | null;
  finalScore: number | null;
  overrideScore: number | null;
  breakdown: Breakdown | null;
};

/** 数値スコアの表示（null は "—"）。 */
function fmtScore(n: number | null): string {
  return n === null ? "—" : String(Math.round(n * 10) / 10);
}

/** ステータス別のバッジ配色（色トークン）。 */
const STATUS_COLOR: Record<string, string> = {
  pending: "var(--mp-warning)",
  approved: "var(--mp-success)",
  rejected: "var(--mp-danger)",
  withdrawn: "var(--mp-fg-subtle)",
};

/** ステータスバッジ（ドット＋ラベル）。 */
function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? "var(--mp-fg-subtle)";
  const label = REG_STATUS_LABEL[status] ?? status;
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold"
      style={{
        color,
        backgroundColor: `color-mix(in oklab, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in oklab, ${color} 30%, transparent)`,
      }}
    >
      <span
        aria-hidden
        className="size-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

/** 希望ロールの優先チップ（第1→第2→第3・ロール色ドット）。 */
function PrefChips({ roles }: { roles: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-[color:var(--mp-fg-subtle)]">希望</span>
      {roles.map((r, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-[color:var(--mp-surface-2)] py-0.5 pl-2 pr-2.5 text-[11.5px] font-semibold text-foreground"
          style={{ opacity: i === 0 ? 1 : i === 1 ? 0.82 : 0.62 }}
        >
          <span className="font-mono text-[9px] text-[color:var(--mp-fg-subtle)]">
            {i + 1}
          </span>
          <span
            aria-hidden
            className="size-2 flex-none rounded-full"
            style={{
              background: ROLE_COLOR[r] ?? "var(--mp-fg-subtle)",
              boxShadow: `0 0 7px color-mix(in oklab, ${
                ROLE_COLOR[r] ?? "var(--mp-fg-subtle)"
              } 60%, transparent)`,
            }}
          />
          {ROLE_LABEL[r] ?? r}
        </span>
      ))}
    </div>
  );
}

export function RegistrationRow({
  reg,
  showScore,
  canManage,
}: {
  reg: RegistrationRowData;
  showScore: boolean;
  /** 操作系（承認/却下・スコア上書き）を出すか。主催者のみ true。 */
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [overrideInput, setOverrideInput] = useState(
    reg.overrideScore !== null ? String(reg.overrideScore) : "",
  );

  function decide(decision: "approve" | "reject") {
    setError(null);
    startTransition(async () => {
      const r = await decideRegistration(reg.id, decision);
      if (r.error) setError(r.error);
    });
  }

  function saveOverride() {
    setError(null);
    startTransition(async () => {
      const r = await overrideRegistrationScore(reg.id, overrideInput);
      if (r.error) setError(r.error);
      else setOpen(false);
    });
  }

  // 振り分けに使われる実効スコア（override 優先）。
  const effectiveScore =
    reg.overrideScore !== null ? reg.overrideScore : reg.finalScore;
  const overridden = reg.overrideScore !== null;

  // 希望ロール（第1〜第3・空は除外）。後方互換で preferred_role 単体もフォロー。
  const prefRoles = reg.preferredRoles.filter((r): r is string => !!r);

  // ステータス別の左アクセント帯・不参加/取り下げの減光。
  const accent =
    reg.status === "pending"
      ? "var(--mp-warning)"
      : reg.status === "approved"
        ? "var(--mp-success)"
        : "transparent";
  const dimmed = reg.status === "rejected" || reg.status === "withdrawn";

  return (
    <li
      className={`relative overflow-hidden rounded-xl border border-border bg-card shadow-[var(--mp-e1)] transition hover:border-[color:var(--mp-border-strong)] ${
        dimmed ? "opacity-70" : ""
      }`}
    >
      {/* ステータス別の左アクセント帯 */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: accent }}
      />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 py-4 pl-[22px] pr-5">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {/* 名前＋ステータス＋希望ロールチップ */}
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-heading text-base font-bold text-foreground">
              {reg.displayName}
            </span>
            <StatusBadge status={reg.status} />
            {prefRoles.length > 0 ? (
              <PrefChips roles={prefRoles} />
            ) : reg.preferredRole ? (
              <PrefChips roles={[reg.preferredRole]} />
            ) : null}
          </div>

          {/* メタ行（Discord名〔主催者のみ〕・バトルタグ・応募日時） */}
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[12.5px] text-muted-foreground">
            {reg.discordName && (
              <span className="inline-flex items-center gap-1.5 text-[color:var(--mp-accent)]">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M8.5 8.5a6 6 0 0 1 7 0M5 16c1.5 1.5 3.5 2.5 7 2.5s5.5-1 7-2.5" />
                  <circle cx="9" cy="12" r="1.3" />
                  <circle cx="15" cy="12" r="1.3" />
                </svg>
                {reg.discordName}
              </span>
            )}
            {reg.battleTag && (
              <span className="inline-flex items-center gap-1.5">
                バトルタグ{" "}
                <span className="font-mono text-foreground">
                  {reg.battleTag}
                </span>
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
              <span className="font-mono">応募 {reg.createdAtLabel}</span>
            </span>
          </div>
        </div>

        {/* 右カラム：スコア＋操作 */}
        <div className="flex items-center gap-5">
          {showScore && (
            <div className="flex min-w-[64px] flex-col items-end gap-1">
              <span className="font-mono text-[22px] font-semibold leading-none tabular-nums text-foreground">
                {fmtScore(effectiveScore)}
              </span>
              {overridden ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--mp-brand)]/34 bg-[color:var(--mp-brand)]/12 px-2 py-px text-[9.5px] font-semibold text-[color:var(--mp-brand)]">
                  上書き
                </span>
              ) : (
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[color:var(--mp-fg-subtle)]">
                  Score
                </span>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            {canManage && reg.status === "pending" && (
              <>
                <button
                  type="button"
                  onClick={() => decide("approve")}
                  disabled={isPending}
                  className="rounded-md border border-[color:var(--mp-success)]/34 bg-[color:var(--mp-success)]/12 px-3 py-1.5 text-[12.5px] font-semibold text-[color:var(--mp-success)] transition hover:bg-[color:var(--mp-success)]/20 disabled:opacity-60"
                >
                  ✓ 承認
                </button>
                <button
                  type="button"
                  onClick={() => decide("reject")}
                  disabled={isPending}
                  className="rounded-md border border-[color:var(--mp-border-strong)] px-3 py-1.5 text-[12.5px] font-semibold text-muted-foreground transition hover:border-[color:var(--mp-danger)]/40 hover:bg-[color:var(--mp-danger)]/12 hover:text-[color:var(--mp-danger)] disabled:opacity-60"
                >
                  却下
                </button>
              </>
            )}
            {showScore && (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="rounded-md border border-[color:var(--mp-border-strong)] bg-[color:var(--mp-surface-3)] px-3 py-1.5 text-[12.5px] font-semibold text-foreground transition hover:bg-[color:var(--mp-surface-2)]"
              >
                詳細
              </button>
            )}
          </div>
        </div>
      </div>

      {error && !open && (
        <p className="px-[22px] pb-3 text-xs text-destructive">{error}</p>
      )}

      {/* 詳細モーダル（算出根拠＋スコア上書き） */}
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/[0.66] p-6 backdrop-blur-[6px] sm:p-12"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-[560px] overflow-hidden rounded-2xl border border-[color:var(--mp-border-strong)] bg-card shadow-[var(--mp-e3)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* ヘッダー */}
            <div className="flex items-start gap-3.5 border-b border-border bg-gradient-to-b from-[color:var(--mp-surface-2)] to-transparent px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="font-heading text-[17px] font-extrabold text-foreground">
                  {reg.displayName}
                </p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {reg.discordName && (
                    <span>
                      Discord{" "}
                      <span className="text-foreground">{reg.discordName}</span>
                    </span>
                  )}
                  {reg.battleTag && (
                    <span>
                      バトルタグ{" "}
                      <span className="font-mono text-foreground">
                        {reg.battleTag}
                      </span>
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
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

            <div className="px-5 py-5">
              {/* 適用スコア */}
              <div
                className={`mb-5 flex items-center justify-between gap-4 rounded-lg border border-border bg-[color:var(--mp-surface-2)] px-4 py-3.5`}
              >
                <span className="text-[12.5px] text-muted-foreground">
                  適用スコア
                  <span className="mt-0.5 block text-[10.5px] text-[color:var(--mp-fg-subtle)]">
                    {overridden
                      ? "主催者による上書き値"
                      : "算出値をそのまま適用"}
                  </span>
                </span>
                <span
                  className="flex items-center gap-2 font-mono text-[28px] font-semibold tabular-nums"
                  style={{
                    color: overridden ? "var(--mp-brand)" : "var(--mp-fg)",
                  }}
                >
                  {fmtScore(effectiveScore)}
                  {overridden && (
                    <span className="inline-flex items-center rounded-full border border-[color:var(--mp-brand)]/34 bg-[color:var(--mp-brand)]/12 px-2 py-px text-[9.5px] font-semibold text-[color:var(--mp-brand)]">
                      上書き
                    </span>
                  )}
                </span>
              </div>

              {/* 申告ランク（グリッド） */}
              <div className="mb-5">
                <div className="mb-3 flex items-center gap-2">
                  <span
                    aria-hidden
                    className="h-3.5 w-[3px] rounded-sm bg-[color:var(--mp-accent)]"
                  />
                  <span className="font-heading text-[13px] font-bold text-foreground">
                    申告ランク
                  </span>
                </div>
                <RankGrid grid={reg.breakdown?.grid ?? null} />
                <p className="mt-2.5 flex gap-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="mt-0.5 flex-none text-[color:var(--mp-fg-subtle)]"
                    aria-hidden
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 16v-4M12 8h.01" />
                  </svg>
                  {reg.breakdown?.handling ? (
                    <span>
                      未認定の扱い:{" "}
                      {HANDLING_LABEL[reg.breakdown.handling] ??
                        reg.breakdown.handling}
                    </span>
                  ) : (
                    <span>未認定シーズンは平均計算から除外されます。</span>
                  )}
                </p>
              </div>

              {/* スコア算出（内訳） */}
              <div className="mb-1">
                <div className="mb-3 flex items-center gap-2">
                  <span
                    aria-hidden
                    className="h-3.5 w-[3px] rounded-sm bg-[color:var(--mp-accent)]"
                  />
                  <span className="font-heading text-[13px] font-bold text-foreground">
                    スコア算出
                  </span>
                </div>
                <div className="overflow-hidden rounded-lg border border-border">
                  <div className="flex items-center justify-between gap-4 px-4 py-2.5 text-[13px]">
                    <span className="text-muted-foreground">
                      算出スコア（個人）
                    </span>
                    <span className="font-mono font-semibold tabular-nums text-foreground">
                      {fmtScore(reg.individualScore)}
                    </span>
                  </div>
                  {reg.breakdown?.bonusApplied ? (
                    <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-2.5 text-[13px]">
                      <span className="text-muted-foreground">到達ボーナス</span>
                      <span className="font-mono font-semibold tabular-nums text-[color:var(--mp-success)]">
                        +{reg.breakdown.bonusApplied}
                      </span>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between gap-4 border-t border-border bg-[color:var(--mp-surface-2)] px-4 py-2.5">
                    <span className="font-heading text-sm font-bold text-foreground">
                      ファイナルスコア（算出値）
                    </span>
                    <span className="font-mono text-base font-semibold tabular-nums text-foreground">
                      {fmtScore(reg.finalScore)}
                    </span>
                  </div>
                </div>
              </div>

              {/* スコア上書き（主催者のみ） */}
              {canManage && (
                <div className="mt-5 border-t border-dashed border-[color:var(--mp-border-strong)] pt-5">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span
                      aria-hidden
                      className="h-3.5 w-[3px] rounded-sm bg-[color:var(--mp-brand)]"
                    />
                    <span className="font-heading text-[13px] font-bold text-foreground">
                      スコアを上書き
                    </span>
                  </div>
                  <p className="mb-3 text-[11.5px] leading-relaxed text-muted-foreground">
                    算出値に代えて適用する値を手動で設定できます。空にすると上書きを解除し、算出値（
                    <span className="font-mono text-[color:var(--mp-fg-muted)]">
                      {fmtScore(reg.finalScore)}
                    </span>
                    ）に戻ります。
                  </p>
                  <div className="flex items-center gap-2.5">
                    <input
                      type="number"
                      min={0}
                      step="0.5"
                      value={overrideInput}
                      onChange={(e) => setOverrideInput(e.target.value)}
                      placeholder={`${fmtScore(reg.finalScore)}（算出値）`}
                      className="flex-1 rounded-md border border-[color:var(--mp-border-strong)] bg-[color:var(--mp-surface-3)] px-3 py-2.5 font-mono text-[15px] tabular-nums text-foreground transition placeholder:font-mono placeholder:text-[color:var(--mp-fg-subtle)] focus:border-[color:var(--mp-brand)] focus:shadow-[0_0_0_3px_rgba(255,106,43,0.16)] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={saveOverride}
                      disabled={isPending}
                      className="rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-[0_0_0_1px_rgba(255,106,43,0.35),0_6px_18px_rgba(255,106,43,0.2)] transition hover:bg-[color:var(--mp-brand-hover)] disabled:opacity-60"
                    >
                      保存
                    </button>
                  </div>
                  {error && (
                    <p className="mt-2 text-xs text-destructive">{error}</p>
                  )}
                </div>
              )}
            </div>

            {/* フッター */}
            <div className="flex items-center justify-end gap-2.5 border-t border-border bg-[color:var(--mp-surface-2)] px-5 py-4">
              <span className="mr-auto text-[11.5px] text-[color:var(--mp-fg-subtle)]">
                {canManage
                  ? "保存すると上書き値が反映されます。"
                  : "閲覧のみ表示です。"}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-muted-foreground transition hover:bg-[color:var(--mp-surface-3)] hover:text-foreground"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * 算出根拠のランクグリッド（ロール×シーズン）。
 * breakdown.grid は Record<role, cells[]>（各セルは score 文字列 or "uncertified"/""）。
 * 表示は現行の scoreToRankLabel を使う（再計算・pt 列なし）。
 */
function RankGrid({ grid }: { grid: Record<string, string[]> | null }) {
  if (!grid || Object.keys(grid).length === 0) {
    return (
      <div className="rounded-lg border border-border bg-background px-4 py-3 text-xs text-muted-foreground">
        根拠データがありません。
      </div>
    );
  }
  const entries = Object.entries(grid);
  // 列数（シーズン数）は各ロールのセル数の最大に合わせる。
  const cols = Math.max(1, ...entries.map(([, cells]) => cells.length));
  const seasonLabels = ["最新", "1つ前", "2つ前", "3つ前", "4つ前", "5つ前"];

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {/* ヘッダー行 */}
      <div
        className="grid items-stretch bg-[color:var(--mp-surface-2)]"
        style={{ gridTemplateColumns: `96px repeat(${cols}, 1fr)` }}
      >
        <div className="px-2.5 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-[color:var(--mp-fg-subtle)]">
          ロール
        </div>
        {Array.from({ length: cols }, (_, s) => (
          <div
            key={s}
            className="border-l border-border px-2.5 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-[color:var(--mp-fg-subtle)]"
          >
            {seasonLabels[s] ?? `S${s}`}
          </div>
        ))}
      </div>
      {/* ロール行 */}
      {entries.map(([role, cells]) => (
        <div
          key={role}
          className="grid items-stretch border-t border-border"
          style={{ gridTemplateColumns: `96px repeat(${cols}, 1fr)` }}
        >
          <div className="flex items-center gap-1.5 bg-[color:var(--mp-surface-2)] px-2.5 py-2.5 text-xs font-semibold text-foreground">
            <span
              aria-hidden
              className="size-[9px] flex-none rounded-full"
              style={{
                background: ROLE_COLOR[role] ?? "var(--mp-fg-subtle)",
                boxShadow: `0 0 7px color-mix(in oklab, ${
                  ROLE_COLOR[role] ?? "var(--mp-fg-subtle)"
                } 55%, transparent)`,
              }}
            />
            {ROLE_LABEL[role] ?? role}
          </div>
          {Array.from({ length: cols }, (_, s) => {
            const c = cells[s];
            const isUncertified =
              c === undefined || c === "uncertified" || c === "";
            return (
              <div
                key={s}
                className={`flex items-center border-l border-border px-2.5 py-2.5 text-xs ${
                  isUncertified
                    ? "bg-[repeating-linear-gradient(135deg,transparent,transparent_5px,rgba(255,255,255,0.014)_5px,rgba(255,255,255,0.014)_10px)] text-[color:var(--mp-fg-subtle)]"
                    : "text-foreground"
                }`}
              >
                {isUncertified ? "未認定" : scoreToRankLabel(Number(c))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
