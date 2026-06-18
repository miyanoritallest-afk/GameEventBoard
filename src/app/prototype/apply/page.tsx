"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { RANK_OPTIONS, ROLE_LABEL, average, type Role } from "../data";

const ROLES: Role[] = ["tank", "dps", "support"];
const SEASONS = ["最新シーズン", "1つ前", "2つ前"]; // declared_seasons = 3 のイメージ

// 高ランク到達ボーナス（イベント設定 bonus_* のイメージ）
const PEAK_OPTIONS = [
  { key: "none", label: "なし", bonus: 0 },
  { key: "master", label: "マスター到達", bonus: 1 },
  { key: "gm", label: "グランドマスター到達", bonus: 2 },
  { key: "champion", label: "チャンピオン到達", bonus: 3 },
] as const;

type PeakKey = (typeof PEAK_OPTIONS)[number]["key"];

export default function ApplyFormPrototype() {
  // ranks[seasonIndex][role] = score（未選択は null）
  const [ranks, setRanks] = useState<(number | null)[][]>(
    SEASONS.map(() => ROLES.map(() => null)),
  );
  const [peak, setPeak] = useState<PeakKey>("none");

  const filled = ranks.flat().filter((v): v is number => v !== null);
  const baseScore = useMemo(() => average(filled), [filled]);
  const bonus = PEAK_OPTIONS.find((p) => p.key === peak)?.bonus ?? 0;
  const finalScore = filled.length > 0 ? baseScore + bonus : 0;

  function setRank(si: number, ri: number, score: number | null) {
    setRanks((prev) =>
      prev.map((row, i) =>
        i === si ? row.map((v, j) => (j === ri ? score : v)) : row,
      ),
    );
  }

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <Link href="/prototype" className="text-sm text-muted-foreground hover:underline">
          ← プロトタイプ一覧
        </Link>

        <h1 className="mt-4 text-2xl font-bold">OSL Season3 に応募</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          ロールスワップ可のイベント。直近3シーズン × 3ロールのランクを申告すると個人スコアが算出されます。
        </p>

        {/* ランク申告グリッド */}
        <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">シーズン</th>
                {ROLES.map((r) => (
                  <th key={r} className="px-3 py-2 text-left font-medium">
                    {ROLE_LABEL[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SEASONS.map((s, si) => (
                <tr key={s} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 text-muted-foreground">{s}</td>
                  {ROLES.map((r, ri) => (
                    <td key={r} className="px-3 py-2">
                      <select
                        value={ranks[si][ri] ?? ""}
                        onChange={(e) =>
                          setRank(si, ri, e.target.value === "" ? null : Number(e.target.value))
                        }
                        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                      >
                        <option value="">未選択</option>
                        {RANK_OPTIONS.map((o) => (
                          <option key={o.label} value={o.score}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 高ランク到達ボーナス */}
        <h2 className="mt-6 text-sm font-semibold text-muted-foreground">
          高ランク到達経験（該当を1つ）
        </h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {PEAK_OPTIONS.map((o) => (
            <button
              key={o.key}
              onClick={() => setPeak(o.key)}
              className={`rounded-lg border px-3 py-2 text-sm transition ${
                peak === o.key
                  ? "border-primary bg-primary/20"
                  : "border-border bg-card hover:border-primary/60"
              }`}
            >
              {o.label}
              {o.bonus > 0 && (
                <span className="ml-1 text-xs text-muted-foreground">+{o.bonus}</span>
              )}
            </button>
          ))}
        </div>

        {/* 算出結果 */}
        <div className="mt-8 rounded-xl border border-primary/50 bg-primary/10 p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground">
                個人ファイナルスコア（②）
              </div>
              <div className="text-3xl font-bold tabular-nums">
                {finalScore.toFixed(1)}
              </div>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              <div>基礎（申告{filled.length}件の平均）: {baseScore.toFixed(1)}</div>
              <div>到達ボーナス: +{bonus}</div>
            </div>
          </div>
          <button
            disabled={filled.length === 0}
            className="mt-4 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            この内容で参加表明する
          </button>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            ※ 送信時にこのスコアがスナップショット保存され、チーム振り分けに使われます。
          </p>
        </div>
      </div>
    </div>
  );
}
