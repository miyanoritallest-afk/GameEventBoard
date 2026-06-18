"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  INITIAL_ROSTER,
  ROLE_LABEL,
  TEAM_SCORE_CAP,
  swapCandidates,
  teamScore,
  type Player,
  type Role,
} from "../data";

const ROLE_ORDER: Role[] = ["tank", "dps", "support"];

export default function TeamBuildingPrototype() {
  const [roster, setRoster] = useState<Player[]>(INITIAL_ROSTER);
  const [selectedReserveId, setSelectedReserveId] = useState<string | null>(null);

  const regulars = roster.filter((p) => p.position === "regular");
  const reserves = roster.filter((p) => p.position === "reserve");
  const score = useMemo(() => teamScore(roster), [roster]);
  const overCap = score > TEAM_SCORE_CAP;

  const selectedReserve = reserves.find((p) => p.id === selectedReserveId) ?? null;
  const candidates = useMemo(
    () => (selectedReserve ? swapCandidates(roster, selectedReserve, TEAM_SCORE_CAP) : []),
    [roster, selectedReserve],
  );

  function doSwap(outId: string, inId: string) {
    setRoster((prev) =>
      prev.map((p) => {
        if (p.id === outId) return { ...p, position: "reserve" };
        if (p.id === inId) return { ...p, position: "regular" };
        return p;
      }),
    );
    setSelectedReserveId(null);
  }

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <Link href="/prototype" className="text-sm text-muted-foreground hover:underline">
          ← プロトタイプ一覧
        </Link>

        <div className="mt-4 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">チーム編成 — 誇り高きOTP</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              OSL Season3 / 5v5（タンク1・DPS2・サポート2）
            </p>
          </div>
          {/* チームスコア表示 */}
          <div
            className={`rounded-xl border px-5 py-3 text-right ${
              overCap
                ? "border-destructive/60 bg-destructive/10"
                : "border-primary/50 bg-primary/10"
            }`}
          >
            <div className="text-xs text-muted-foreground">チーム平均スコア</div>
            <div className="text-2xl font-bold tabular-nums">
              {score.toFixed(1)}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                / 上限 {TEAM_SCORE_CAP.toFixed(1)}
              </span>
            </div>
            <div className={`text-xs ${overCap ? "text-destructive" : "text-primary"}`}>
              {overCap ? "⚠ 上限オーバー" : "✓ 上限内"}
            </div>
          </div>
        </div>

        {/* レギュラー（ロール別） */}
        <h2 className="mt-8 text-sm font-semibold text-muted-foreground">
          出場メンバー（レギュラー）
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {ROLE_ORDER.map((role) => {
            const inRole = regulars.filter((p) => p.role === role);
            return (
              <div key={role} className="rounded-xl border border-border bg-card p-4">
                <div className="text-xs font-medium text-primary/80">
                  {ROLE_LABEL[role]}
                </div>
                <ul className="mt-2 space-y-2">
                  {inRole.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2"
                    >
                      <span className="text-sm">{p.name}</span>
                      <span className="text-sm font-semibold tabular-nums">
                        {p.finalScore}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        {/* リザーブと交代シミュレーション */}
        <h2 className="mt-8 text-sm font-semibold text-muted-foreground">
          リザーブ（クリックで「誰と交代できるか」を確認）
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {reserves.length === 0 && (
            <p className="text-sm text-muted-foreground">リザーブはいません。</p>
          )}
          {reserves.map((p) => {
            const selected = p.id === selectedReserveId;
            return (
              <button
                key={p.id}
                onClick={() => setSelectedReserveId(selected ? null : p.id)}
                className={`rounded-lg border px-3 py-2 text-sm transition ${
                  selected
                    ? "border-primary bg-primary/20"
                    : "border-border bg-card hover:border-primary/60"
                }`}
              >
                {p.name}
                <span className="ml-2 text-xs text-muted-foreground">
                  {ROLE_LABEL[p.role]} / {p.finalScore}
                </span>
              </button>
            );
          })}
        </div>

        {/* 交代候補の提示 */}
        {selectedReserve && (
          <div className="mt-4 rounded-xl border border-border bg-card p-4">
            <p className="text-sm">
              <span className="font-semibold">{selectedReserve.name}</span>（
              {ROLE_LABEL[selectedReserve.role]} / {selectedReserve.finalScore}）を出す場合の交代候補:
            </p>
            <ul className="mt-3 space-y-2">
              {candidates.map((c) => (
                <li
                  key={c.outPlayer.id}
                  className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2"
                >
                  <span className="text-sm">
                    {c.outPlayer.name} と交代 → 平均{" "}
                    <span className="font-semibold tabular-nums">
                      {c.newTeamScore.toFixed(1)}
                    </span>{" "}
                    <span className={c.withinCap ? "text-primary" : "text-destructive"}>
                      {c.withinCap ? "✓ 上限内" : "⚠ 超過"}
                    </span>
                  </span>
                  <button
                    disabled={!c.withinCap}
                    onClick={() => doSwap(c.outPlayer.id, selectedReserve.id)}
                    className="rounded-md border border-primary/50 px-3 py-1 text-xs text-primary transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    交代する
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              ※ OSL運営が手作業で「誰と入れ替えれば上限内か」を総当たりしていた計算を自動化するイメージ。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
