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
  discordName: string;
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

export function RegistrationRow({
  reg,
  showScore,
}: {
  reg: RegistrationRowData;
  showScore: boolean;
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

  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-medium">{reg.discordName}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {reg.battleTag ? `${reg.battleTag} ／ ` : ""}
            {(() => {
              // 希望ロール: 第1〜第3を「タンク→DPS→サポート」のように表示。
              const roles = reg.preferredRoles.filter(
                (r): r is string => !!r,
              );
              if (roles.length > 0) {
                return `希望 ${roles.map((r) => ROLE_LABEL[r] ?? r).join("→")} ／ `;
              }
              // 後方互換: 旧データは preferred_role 単体。
              return reg.preferredRole
                ? `${ROLE_LABEL[reg.preferredRole] ?? reg.preferredRole}希望 ／ `
                : "";
            })()}
            応募 {reg.createdAtLabel}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {showScore && (
            <span className="text-sm">
              スコア{" "}
              <span className="font-semibold">{fmtScore(effectiveScore)}</span>
              {reg.overrideScore !== null && (
                <span className="ml-1 text-xs text-primary">(上書き)</span>
              )}
            </span>
          )}
          <span className="rounded bg-muted px-2 py-0.5 text-xs">
            {REG_STATUS_LABEL[reg.status] ?? reg.status}
          </span>
          {showScore && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="text-xs text-primary hover:underline"
            >
              詳細
            </button>
          )}
          {reg.status === "pending" && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => decide("approve")}
                disabled={isPending}
                className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                承認
              </button>
              <button
                type="button"
                onClick={() => decide("reject")}
                disabled={isPending}
                className="rounded-md border border-border px-3 py-1 text-xs hover:bg-muted disabled:opacity-60"
              >
                却下
              </button>
            </div>
          )}
        </div>
      </div>

      {error && !open && (
        <p className="mt-2 text-xs text-destructive">{error}</p>
      )}

      {/* 詳細モーダル（算出根拠＋スコア上書き） */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-border bg-card p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold">{reg.discordName} の応募</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {reg.preferredRole
                ? `${ROLE_LABEL[reg.preferredRole] ?? reg.preferredRole}希望`
                : ""}
            </p>

            {/* 算出根拠 */}
            <div className="mt-4 rounded-md border border-border bg-background p-3 text-sm">
              <p className="font-medium">算出根拠</p>
              {reg.breakdown?.grid ? (
                <ul className="mt-2 space-y-1 text-xs">
                  {Object.entries(reg.breakdown.grid).map(([role, cells]) => (
                    <li key={role}>
                      <span className="text-muted-foreground">
                        {ROLE_LABEL[role] ?? role}:
                      </span>{" "}
                      {cells
                        .map((c) =>
                          c === "uncertified" || c === ""
                            ? "未認定"
                            : scoreToRankLabel(Number(c)),
                        )
                        .join(" / ")}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  根拠データがありません。
                </p>
              )}
              {reg.breakdown?.handling && (
                <p className="mt-2 text-xs text-muted-foreground">
                  未認定の扱い:{" "}
                  {HANDLING_LABEL[reg.breakdown.handling] ??
                    reg.breakdown.handling}
                </p>
              )}
              <p className="mt-2 text-xs">
                算出スコア（個人）: {fmtScore(reg.individualScore)} ／ ファイナル:{" "}
                {fmtScore(reg.finalScore)}
                {reg.breakdown?.bonusApplied
                  ? `（ボーナス +${reg.breakdown.bonusApplied}）`
                  : ""}
              </p>
            </div>

            {/* スコア上書き */}
            <div className="mt-4">
              <label className="block text-sm font-medium">
                スコア上書き（空で解除＝算出値に戻す）
              </label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  step="0.5"
                  value={overrideInput}
                  onChange={(e) => setOverrideInput(e.target.value)}
                  placeholder={fmtScore(reg.finalScore)}
                  className="w-32 rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={saveOverride}
                  disabled={isPending}
                  className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                >
                  保存
                </button>
              </div>
              {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
            </div>

            <div className="mt-4 text-right">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-sm text-muted-foreground hover:underline"
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
