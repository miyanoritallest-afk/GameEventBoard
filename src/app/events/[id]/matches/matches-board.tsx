"use client";

import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import {
  generateMatches,
  addMatch,
  deleteMatch,
  reportResult,
  clearResult,
  updateSchedule,
  updateStream,
} from "./actions";
import {
  validateBoScore,
  validatePotg,
  describeBestOf,
  mapsPlayed,
} from "@/lib/services/match-result";
import { formatLocalInputForDisplay } from "@/lib/datetime-local";
import { ScoreStepper } from "../_components/score-stepper";

/** ブロック所属チーム（プルダウン用）。 */
export type BoardTeam = { id: string; name: string };

/** 1試合（対戦カード）。チームが削除/承認取消されると id/name が null になりうる。 */
export type BoardMatch = {
  id: string;
  teamAId: string | null;
  teamBId: string | null;
  teamAName: string | null;
  teamBName: string | null;
  /** 結果（取マップ数）。未入力は null。 */
  teamAScore: number | null;
  teamBScore: number | null;
  winnerTeamId: string | null;
  /** POTG 取得数（potg 不使用イベントは 0）。 */
  potgA: number;
  potgB: number;
  /** この試合の BO（最大マップ数）。スコア入力上限に使う。 */
  bestOf: number;
  hasResult: boolean;
  /** この閲覧者がこの試合の結果を入力できるか（主催者 or 対戦両チーム代表）。 */
  canReport: boolean;
  /** マップ別リプレイコード（フェーズA）。未入力は空配列。 */
  replayCodes: string[];
  /** 試合日時（JST の datetime-local 文字列）。未設定は ""。 */
  scheduledAtLocal: string;
  /** 配信URL・配信者名（主催者が設定）。未設定は null。 */
  streamUrl: string | null;
  streamerName: string | null;
  /** 閲覧者が主催者か（配信編集の出し分け）。 */
  isOrganizer: boolean;
};

/** 順位表の1行（Service standings.ts の結果＋チーム名）。 */
export type BoardStanding = {
  teamId: string;
  teamName: string;
  wins: number;
  losses: number;
  draws: number;
  points: number;
  mapDiff: number;
  potg: number;
  rank: number;
};

export type BoardGroup = {
  id: string;
  name: string;
  teams: BoardTeam[];
  matches: BoardMatch[];
  standings: BoardStanding[];
};

/**
 * チームの識別色（Claude Design 案準拠）。ブロック内の並び順（index）で循環割当。
 * マトリクスのバッジ・行ヘッダー・順位表のスウォッチ・モーダルで共通利用する。
 */
const TEAM_COLORS = [
  "#FF6A2B",
  "#22D3EE",
  "#45C08A",
  "#F5B93D",
  "#5B93F0",
  "#A78BFA",
  "#F2685A",
  "#E8637F",
] as const;

function teamColor(index: number): string {
  return TEAM_COLORS[index % TEAM_COLORS.length];
}

/** ブロック内チームに表示用の番号(1始まり)と色を割り当てた表現。 */
type TeamMeta = { id: string; name: string; no: number; color: string };

/** 2チーム間の試合を探す（順序不問）。 */
function matchBetween(
  matches: BoardMatch[],
  id1: string,
  id2: string,
): BoardMatch | null {
  return (
    matches.find(
      (m) =>
        (m.teamAId === id1 && m.teamBId === id2) ||
        (m.teamAId === id2 && m.teamBId === id1),
    ) ?? null
  );
}

export function MatchesBoard({
  readOnly = false,
  rankingEnabled = false,
  usePotg = false,
  advanceCount = 0,
  initialGroups,
}: {
  readOnly?: boolean;
  /** 順位機能 ON か（順位表セクションの表示）。 */
  rankingEnabled?: boolean;
  /** タイブレークに potg があるか（結果入力の POTG 欄の出し分け）。 */
  usePotg?: boolean;
  /** 決勝トーナメント進出数（各ブロック上位N）。0 は決勝Tなし＝通過ライン非表示。 */
  advanceCount?: number;
  initialGroups: BoardGroup[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [savedTick, setSavedTick] = useState(0);
  const [isPending, startTransition] = useTransition();
  // 表示中のブロック（タブ）。
  const [activeBlock, setActiveBlock] = useState(0);
  // 開いている試合モーダル（セルクリックで開く）。null は閉。
  // match 本体ではなく id で保持し、描画時に最新の initialGroups から引き直す
  // （保存後や他者の更新で内容が変わっても、開いたままのモーダルが最新を反映するため）。
  const [modal, setModal] = useState<{
    groupId: string;
    matchId: string;
  } | null>(null);

  function flashSaved() {
    setSaved(true);
    setSavedTick((n) => n + 1);
  }

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(t);
  }, [saved, savedTick]);

  function run(
    action: () => Promise<{ error?: string }>,
    onSuccess?: () => void,
  ) {
    setError(null);
    startTransition(async () => {
      const r = await action();
      if (r.error) setError(r.error);
      else {
        flashSaved();
        onSuccess?.();
      }
    });
  }

  // activeBlock が範囲外になったら先頭へ戻す（ブロック削除時などの保険）。
  const safeBlock = Math.min(activeBlock, Math.max(0, initialGroups.length - 1));
  const group = initialGroups[safeBlock] ?? null;

  // 開いているモーダルの試合を最新データから引き直す（スナップショットではなく id で保持しているため）。
  // 対戦カードが削除されるなどで消えて見つからない場合は modalMatch が null になり、
  // 下の描画ガード（modal && modalMatch）でモーダルは表示されなくなる。残った modal state は
  // 何も描画しないため無害で、次にセルを開いた時点で上書きされる。
  const modalMatch = modal
    ? (initialGroups
        .find((g) => g.id === modal.groupId)
        ?.matches.find((m) => m.id === modal.matchId) ?? null)
    : null;

  if (initialGroups.length === 0) {
    return (
      <>
        {readOnly && <RoleBanner readOnly />}
        <p className="mt-6 rounded-2xl border border-dashed border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          まだブロックがありません。先に
          {!readOnly && "「ブロック分け」画面で"}
          ブロックを作成してチームを振り分けてください。
        </p>
      </>
    );
  }

  return (
    <div>
      {error && (
        <p className="mt-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* 保存トースト（下部中央）。 */}
      {saved && (
        <div className="fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-xl border border-[color:var(--mp-success)]/50 bg-[color:var(--mp-surface-2)] px-4 py-2.5 text-sm shadow-[var(--mp-e3)]">
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-[color:var(--mp-success)]" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20 6L9 17l-5-5" />
          </svg>
          保存しました
        </div>
      )}

      <RoleBanner readOnly={readOnly} />

      {/* ブロックタブ（2つ以上のときだけ）。 */}
      {initialGroups.length > 1 && (
        <div className="mt-6 flex flex-wrap items-center gap-1.5 border-b border-border">
          {initialGroups.map((g, i) => {
            const done = g.matches.filter((m) => m.hasResult).length;
            const on = i === safeBlock;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setActiveBlock(i)}
                className={`relative inline-flex items-center gap-2 rounded-t-md px-4 pb-3 pt-2.5 text-sm font-bold transition ${
                  on
                    ? "text-foreground after:absolute after:inset-x-1.5 after:-bottom-px after:h-[2.5px] after:rounded after:bg-[color:var(--mp-brand)]"
                    : "text-muted-foreground hover:bg-[color:var(--mp-surface)] hover:text-foreground"
                }`}
              >
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-sm"
                  style={{ backgroundColor: teamColor(i) }}
                />
                {g.name}
                <span className="font-mono text-[10.5px] font-medium text-[color:var(--mp-fg-subtle)] tabular-nums">
                  {g.teams.length}チーム · {done}/{g.matches.length}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {group && (
        <GroupView
          key={group.id}
          group={group}
          readOnly={readOnly}
          rankingEnabled={rankingEnabled}
          usePotg={usePotg}
          advanceCount={advanceCount}
          isPending={isPending}
          onOpenMatch={(match) => setModal({ groupId: group.id, matchId: match.id })}
          onGenerate={() => {
            if (
              group.matches.length > 0 &&
              !window.confirm(
                "このブロックの既存の対戦カードをすべて削除して作り直します。よろしいですか？",
              )
            ) {
              return;
            }
            if (group.teams.length < 2) {
              setError("総当たりには2チーム以上が必要です。");
              return;
            }
            run(() => generateMatches({ groupId: group.id }));
          }}
          onAdd={(teamAId, teamBId) =>
            run(() => addMatch({ groupId: group.id, teamAId, teamBId }))
          }
          onDelete={(matchId) => run(() => deleteMatch(matchId))}
        />
      )}

      {/* 試合モーダル（セルクリックで開く）。match は最新データ（modalMatch）を渡す。 */}
      {modal && modalMatch && (
        <MatchModal
          match={modalMatch}
          readOnly={readOnly}
          usePotg={usePotg}
          isPending={isPending}
          onClose={() => setModal(null)}
          onReport={(a, b, pa, pb, rc) => {
            // 成功時のみ閉じる。サーバー検証で弾かれたら開いたままにして入力を保持する。
            run(
              () =>
                reportResult({
                  matchId: modalMatch.id,
                  teamAScore: a,
                  teamBScore: b,
                  potgA: pa,
                  potgB: pb,
                  replayCodes: rc,
                }),
              () => setModal(null),
            );
          }}
          onClear={() => {
            run(() => clearResult(modalMatch.id), () => setModal(null));
          }}
          onSchedule={(local) => {
            run(() => updateSchedule({ matchId: modalMatch.id, scheduledAtLocal: local }));
          }}
          onStream={(url, name) => {
            run(() => updateStream({ matchId: modalMatch.id, streamUrl: url, streamerName: name }));
          }}
        />
      )}
    </div>
  );
}

/** 立場バナー（参加者／観戦者）。主催者には出さない。 */
function RoleBanner({ readOnly }: { readOnly: boolean }) {
  if (!readOnly) return null;
  return (
    <div className="mt-6 flex items-center gap-3 rounded-xl border border-[color:var(--mp-accent)]/30 bg-gradient-to-r from-[color:var(--mp-accent)]/10 to-transparent px-4 py-3 text-sm text-muted-foreground">
      <span
        aria-hidden
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--mp-live)] shadow-[0_0_10px_var(--mp-live)]"
      />
      <span>
        <span className="font-semibold text-foreground">閲覧モード</span>{" "}
        予選の順位表と全対戦の結果を閲覧しています。セルをクリックすると試合の詳細を確認できます（結果の入力は主催者・対戦チームの代表のみ）。
      </span>
    </div>
  );
}

/** 1ブロックの順位表＋マトリクス＋主催者ツールバー。 */
function GroupView({
  group,
  readOnly,
  rankingEnabled,
  usePotg,
  advanceCount,
  isPending,
  onOpenMatch,
  onGenerate,
  onAdd,
  onDelete,
}: {
  group: BoardGroup;
  readOnly: boolean;
  rankingEnabled: boolean;
  usePotg: boolean;
  advanceCount: number;
  isPending: boolean;
  onOpenMatch: (match: BoardMatch) => void;
  onGenerate: () => void;
  onAdd: (teamAId: string, teamBId: string) => void;
  onDelete: (matchId: string) => void;
}) {
  // ブロック内チームに番号(1..)と色を割り当てる（表示順＝group.teams の順）。
  const teamMetas: TeamMeta[] = useMemo(
    () =>
      group.teams.map((t, i) => ({
        id: t.id,
        name: t.name,
        no: i + 1,
        color: teamColor(i),
      })),
    [group.teams],
  );
  const metaById = useMemo(
    () => new Map(teamMetas.map((t) => [t.id, t])),
    [teamMetas],
  );

  return (
    <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(360px,460px)_minmax(0,1fr)] xl:items-start">
      {/* 左: 順位表 */}
      {rankingEnabled ? (
        <StandingsPanel
          group={group}
          metaById={metaById}
          usePotg={usePotg}
          advanceCount={advanceCount}
        />
      ) : (
        <div />
      )}

      {/* 右: マトリクス */}
      <MatrixPanel
        group={group}
        teamMetas={teamMetas}
        readOnly={readOnly}
        onOpenMatch={onOpenMatch}
      />

      {/* 主催者ツールバー（全幅・主催者のみ）。 */}
      {!readOnly && (
        <div className="xl:col-span-2">
          <OrganizerToolbar
            teams={group.teams}
            matches={group.matches}
            metaById={metaById}
            isPending={isPending}
            onGenerate={onGenerate}
            onAdd={onAdd}
            onDelete={onDelete}
          />
        </div>
      )}
    </div>
  );
}

/** 順位表パネル（1位ゴールド・予選通過ライン強調）。 */
function StandingsPanel({
  group,
  metaById,
  usePotg,
  advanceCount,
}: {
  group: BoardGroup;
  metaById: Map<string, TeamMeta>;
  usePotg: boolean;
  advanceCount: number;
}) {
  const rows = group.standings;
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--mp-e1)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3.5">
        <h2 className="flex items-center gap-2.5 text-base font-extrabold">
          <span aria-hidden className="h-4 w-0.5 rounded-full bg-[color:var(--mp-brand)]" />
          順位表
          <span className="text-[13px] font-semibold text-[color:var(--mp-fg-subtle)]">
            {group.name}
          </span>
        </h2>
        <span className="text-xs text-[color:var(--mp-fg-subtle)]">
          勝点 → 得失 → 直接対決
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          まだ結果がありません。
        </p>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="bg-[color:var(--mp-surface-2)] text-[10px] font-medium uppercase tracking-wider text-[color:var(--mp-fg-subtle)]">
              <th className="w-[52px] px-2 py-2.5 text-center">順位</th>
              <th className="px-2 py-2.5 pl-4 text-left">チーム</th>
              <th className="px-2 py-2.5 text-center">勝-分-敗</th>
              <th className="px-2 py-2.5 text-center">勝点</th>
              <th className="px-2 py-2.5 text-center">得失</th>
              {usePotg && <th className="px-2 py-2.5 text-center">POTG</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const meta = metaById.get(s.teamId);
              const isFirst = s.rank === 1;
              const isQual = advanceCount > 0 && s.rank <= advanceCount;
              const gdCls =
                s.mapDiff > 0
                  ? "text-[color:var(--mp-success)]"
                  : s.mapDiff < 0
                    ? "text-[color:var(--mp-danger)]"
                    : "text-[color:var(--mp-fg-subtle)]";
              const showQualLine =
                advanceCount > 0 &&
                s.rank === advanceCount &&
                rows.length > advanceCount;
              return (
                <Fragment key={s.teamId}>
                  <tr
                    className={`border-b border-border last:border-0 ${
                      isFirst
                        ? "bg-gradient-to-r from-[color:var(--mp-gold)]/[0.07] to-transparent"
                        : isQual
                          ? "bg-gradient-to-r from-[color:var(--mp-success)]/[0.05] to-transparent"
                          : ""
                    }`}
                  >
                    <td className="px-2 py-3 text-center">
                      <span
                        className={`inline-grid h-[26px] w-[26px] place-items-center rounded font-mono text-[13px] font-bold tabular-nums ${
                          isFirst
                            ? "border-transparent text-[#1a1206] shadow-[0_0_14px_rgba(245,196,81,.35)]"
                            : isQual
                              ? "border border-[color:var(--mp-success)]/35 bg-[color:var(--mp-success)]/10 text-[color:var(--mp-success)]"
                              : "border border-border bg-[color:var(--mp-surface-3)] text-[color:var(--mp-fg-muted)]"
                        }`}
                        style={
                          isFirst
                            ? { background: "linear-gradient(135deg,var(--mp-gold),#E0A93A)" }
                            : undefined
                        }
                      >
                        {s.rank}
                      </span>
                    </td>
                    <td className="py-2.5 pl-4 pr-2">
                      <div className="flex items-center gap-2.5">
                        <span
                          aria-hidden
                          className="h-[22px] w-2.5 shrink-0 rounded-sm"
                          style={{ backgroundColor: meta?.color ?? "var(--mp-border-strong)" }}
                        />
                        {meta && (
                          <span className="grid h-[19px] w-[19px] shrink-0 place-items-center rounded-full border border-border bg-[color:var(--mp-surface-3)] font-mono text-[10.5px] text-[color:var(--mp-fg-subtle)]">
                            {meta.no}
                          </span>
                        )}
                        <span className="truncate font-bold" style={isFirst ? { color: "var(--mp-gold)" } : undefined}>
                          {s.teamName}
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-3 text-center">
                      <span className="font-mono text-[13.5px] font-semibold tabular-nums">
                        <span className="text-[color:var(--mp-success)]">{s.wins}</span>
                        <span className="text-[color:var(--mp-fg-subtle)]">-</span>
                        <span className="text-[color:var(--mp-fg-muted)]">{s.draws}</span>
                        <span className="text-[color:var(--mp-fg-subtle)]">-</span>
                        <span className="text-[color:var(--mp-danger)]">{s.losses}</span>
                      </span>
                    </td>
                    <td className="px-2 py-3 text-center">
                      <span
                        className="font-mono text-[17px] font-bold tabular-nums"
                        style={isFirst ? { color: "var(--mp-gold)" } : undefined}
                      >
                        {s.points}
                      </span>
                    </td>
                    <td className="px-2 py-3 text-center">
                      <span className={`font-mono text-[13px] font-semibold tabular-nums ${gdCls}`}>
                        {s.mapDiff > 0 ? `+${s.mapDiff}` : s.mapDiff}
                      </span>
                    </td>
                    {usePotg && (
                      <td className="px-2 py-3 text-center">
                        <span className={`font-mono text-[13px] font-semibold tabular-nums ${s.potg ? "text-[color:var(--mp-fg-muted)]" : "text-[color:var(--mp-fg-subtle)]"}`}>
                          {s.potg}
                        </span>
                      </td>
                    )}
                  </tr>
                  {showQualLine && (
                    <tr>
                      <td colSpan={usePotg ? 6 : 5} className="p-0">
                        <div className="flex items-center gap-2.5 px-4 py-1 font-mono text-[10px] tracking-wider text-[color:var(--mp-success)]">
                          <span className="rounded-full border border-[color:var(--mp-success)]/35 bg-card px-2 text-[color:var(--mp-success)]">
                            ▲ 予選通過ライン
                          </span>
                          <span>上位 {advanceCount} チームが決勝トーナメントへ</span>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
      {advanceCount > 0 && (
        <div className="border-t border-border px-4 py-3 text-[11px] text-[color:var(--mp-fg-subtle)]">
          <span className="text-[color:var(--mp-success)]">
            上位 {advanceCount} チームが決勝トーナメント進出
          </span>
        </div>
      )}
    </div>
  );
}

/** 総当たりマトリクス（セルクリックで試合モーダル）。 */
function MatrixPanel({
  group,
  teamMetas,
  readOnly,
  onOpenMatch,
}: {
  group: BoardGroup;
  teamMetas: TeamMeta[];
  readOnly: boolean;
  onOpenMatch: (match: BoardMatch) => void;
}) {
  const noteText = readOnly
    ? "セルをクリックすると試合の詳細（日時・配信・スコア）が開きます。"
    : "セルをクリックすると試合の詳細・結果入力が開きます。";

  return (
    <div className="min-w-0">
      {/* 注意書き（クリックできることの導線）。 */}
      <div className="mb-3.5 flex items-center gap-2.5 rounded-lg border border-border bg-[color:var(--mp-surface-2)] px-3.5 py-2.5 text-xs text-muted-foreground">
        <svg viewBox="0 0 24 24" className="h-[15px] w-[15px] shrink-0 stroke-[color:var(--mp-accent)]" fill="none" strokeWidth={2} aria-hidden>
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
        <span>
          <span className="font-semibold text-foreground">セルをクリック</span>
          {noteText.replace("セルをクリック", "")}
        </span>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 shadow-[var(--mp-e1)]">
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2 px-0.5">
          <h2 className="flex items-center gap-2.5 text-base font-extrabold">
            <span aria-hidden className="h-4 w-0.5 rounded-full bg-[color:var(--mp-accent)]" />
            総当たりマトリクス
          </h2>
          <span className="text-xs text-[color:var(--mp-fg-subtle)]">
            行＝ホーム ／ 列＝アウェイ ・ 番号＝チーム
          </span>
        </div>

        {teamMetas.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            このブロックにチームがいません。
          </p>
        ) : (
          <div className="overflow-x-auto pb-1">
            <table className="border-separate border-spacing-[5px] font-mono">
              <thead>
                <tr>
                  <th className="pb-1.5 pl-1 pr-2 text-left align-bottom">
                    <div className="font-mono text-[9.5px] leading-relaxed text-[color:var(--mp-fg-subtle)]">
                      <b className="font-semibold text-[color:var(--mp-fg-muted)]">H＼A</b>
                      <br />
                      行=ホーム
                    </div>
                  </th>
                  {teamMetas.map((t) => (
                    <th key={t.id} className="h-10 w-[54px] text-center align-bottom">
                      <span
                        title={t.name}
                        data-tip={t.name}
                        className="inline-grid h-[30px] w-[30px] cursor-default place-items-center rounded font-mono text-[13px] font-bold text-[#0B0E14]"
                        style={{ backgroundColor: t.color }}
                      >
                        {t.no}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {teamMetas.map((rowT) => (
                  <tr key={rowT.id}>
                    <th className="whitespace-nowrap pr-2.5 text-right">
                      <span className="inline-flex items-center justify-end gap-2.5">
                        <span className="font-sans text-[13px] font-semibold text-foreground">
                          {rowT.name}
                        </span>
                        <span
                          className="inline-grid h-[22px] w-[22px] place-items-center rounded font-mono text-[11px] font-bold text-[#0B0E14]"
                          style={{ backgroundColor: rowT.color }}
                        >
                          {rowT.no}
                        </span>
                      </span>
                    </th>
                    {teamMetas.map((colT) => (
                      <MatrixCell
                        key={colT.id}
                        rowTeam={rowT}
                        colTeam={colT}
                        match={
                          rowT.id === colT.id
                            ? null
                            : matchBetween(group.matches, rowT.id, colT.id)
                        }
                        diagonal={rowT.id === colT.id}
                        readOnly={readOnly}
                        onOpenMatch={onOpenMatch}
                      />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/** マトリクスの1セル（行チーム視点のスコア・勝敗色・クリック）。 */
function MatrixCell({
  rowTeam,
  match,
  diagonal,
  readOnly,
  onOpenMatch,
}: {
  rowTeam: TeamMeta;
  colTeam: TeamMeta;
  match: BoardMatch | null;
  diagonal: boolean;
  readOnly: boolean;
  onOpenMatch: (match: BoardMatch) => void;
}) {
  // 対角線（自分 vs 自分）は斜線パターン・クリック不可。
  if (diagonal) {
    return (
      <td>
        <div
          aria-hidden
          className="grid h-11 w-[54px] place-items-center rounded-[6px] border border-transparent"
          style={{
            background:
              "repeating-linear-gradient(-45deg,transparent,transparent 5px,var(--mp-border) 5px,var(--mp-border) 6px)",
          }}
        />
      </td>
    );
  }

  // 対戦カードが未生成（総当たり未生成・削除済み）。
  if (!match) {
    return (
      <td>
        <div className="grid h-11 w-[54px] place-items-center rounded-[6px] border border-dashed border-border bg-[color:var(--mp-surface-2)]/50 text-[color:var(--mp-fg-subtle)]">
          <span className="text-[13px]">·</span>
        </div>
      </td>
    );
  }

  // 結果を入力できるか（主催者・代表かつ閲覧モードでない）。＋の出し分けに使う。
  const canReport = !readOnly && match.canReport;
  // 日時・配信の付随情報があるか。閲覧者でもモーダルで確認できるようにする（閲覧公開・フェーズB）。
  const hasInfo = match.scheduledAtLocal !== "" || match.streamUrl !== null;
  const clickable = match.hasResult || canReport || hasInfo;

  // 結果未入力。
  if (!match.hasResult) {
    return (
      <td>
        <button
          type="button"
          disabled={!clickable}
          onClick={() => clickable && onOpenMatch(match)}
          className={`group grid h-11 w-[54px] place-items-center rounded-[6px] border border-dashed border-border bg-[color:var(--mp-surface-2)]/50 text-[color:var(--mp-fg-subtle)] transition ${
            clickable
              ? "cursor-pointer hover:-translate-y-px hover:border-[color:var(--mp-border-strong)] hover:bg-[color:var(--mp-surface-3)] hover:shadow-[var(--mp-e1)]"
              : "cursor-default"
          }`}
        >
          {canReport ? (
            <>
              <span className="text-[13px] group-hover:hidden">–</span>
              <span className="hidden text-[18px] font-bold text-[color:var(--mp-brand)] group-hover:inline">
                ＋
              </span>
            </>
          ) : (
            <span className="text-[13px]">–</span>
          )}
        </button>
      </td>
    );
  }

  // 結果あり。行チーム視点でスコアを出す。
  const home = match.teamAId === rowTeam.id;
  const rs = home ? match.teamAScore : match.teamBScore;
  const cs = home ? match.teamBScore : match.teamAScore;
  // 勝敗色はサーバー算出済みの winnerTeamId を正とする（勝者判定ロジックを UI で再実装しない）。
  const outcome =
    match.winnerTeamId === null
      ? "draw"
      : match.winnerTeamId === rowTeam.id
        ? "win"
        : "loss";
  const cls =
    outcome === "win"
      ? "border-[color:var(--mp-success)]/40 bg-[color:var(--mp-success)]/15 text-[color:var(--mp-success)]"
      : outcome === "loss"
        ? "border-[color:var(--mp-danger)]/35 bg-[color:var(--mp-danger)]/[0.13] text-[color:var(--mp-danger)]"
        : "border-[color:var(--mp-border-strong)] bg-[color:var(--mp-surface-3)] text-foreground";

  return (
    <td>
      <button
        type="button"
        disabled={!clickable}
        onClick={() => clickable && onOpenMatch(match)}
        className={`grid h-11 w-[54px] place-items-center rounded-[6px] border font-mono text-[14px] font-semibold tabular-nums transition ${cls} ${
          clickable
            ? "cursor-pointer hover:-translate-y-px hover:shadow-[var(--mp-e1)]"
            : "cursor-default"
        }`}
      >
        {rs}-{cs}
      </button>
    </td>
  );
}

/** 主催者ツールバー（一括生成・個別追加・削除）。 */
function OrganizerToolbar({
  teams,
  matches,
  metaById,
  isPending,
  onGenerate,
  onAdd,
  onDelete,
}: {
  teams: BoardTeam[];
  matches: BoardMatch[];
  metaById: Map<string, TeamMeta>;
  isPending: boolean;
  onGenerate: () => void;
  onAdd: (teamAId: string, teamBId: string) => void;
  onDelete: (matchId: string) => void;
}) {
  const [addA, setAddA] = useState("");
  const [addB, setAddB] = useState("");
  const [delId, setDelId] = useState("");

  function handleAdd() {
    if (!addA || !addB || addA === addB) return;
    onAdd(addA, addB);
    setAddA("");
    setAddB("");
  }

  return (
    <div className="mt-5 rounded-2xl border border-border bg-card p-4 shadow-[var(--mp-e1)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 text-[14.5px] font-extrabold">
            <span className="grid h-[26px] w-[26px] place-items-center rounded bg-[color:var(--mp-brand)]/[0.14] text-[color:var(--mp-brand)]">
              <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M4 6h16M4 12h16M4 18h10" />
                <circle cx="18" cy="18" r="2.5" />
              </svg>
            </span>
            対戦表の生成・管理
          </div>
          <p className="mt-1.5 max-w-[560px] text-[11.5px] leading-relaxed text-muted-foreground">
            総当たり戦の全カードを一括生成できます。個別に対戦を追加・削除して、変則的なブロック構成にも対応します。
          </p>
        </div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={isPending || teams.length < 2}
          className="inline-flex items-center gap-2 rounded-md bg-[color:var(--mp-brand)] px-4 py-2.5 text-[13px] font-semibold text-[color:var(--mp-on-brand)] shadow-[0_0_0_1px_rgba(255,106,43,.35),0_6px_18px_rgba(255,106,43,.2)] transition hover:bg-[color:var(--mp-brand-hover)] disabled:opacity-45"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 2v6h-6" />
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
            <path d="M3 22v-6h6" />
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
          </svg>
          総当たりを一括生成
        </button>
      </div>

      {teams.length >= 2 && (
        <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-border pt-3.5">
          {/* 個別追加 */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11.5px] text-[color:var(--mp-fg-subtle)]">個別に追加</span>
            <ToolSelect value={addA} onChange={setAddA} placeholder="チームA" metaById={metaById} teams={teams} exclude={addB} />
            <span className="font-mono text-[11px] text-[color:var(--mp-fg-subtle)]">VS</span>
            <ToolSelect value={addB} onChange={setAddB} placeholder="チームB" metaById={metaById} teams={teams} exclude={addA} />
            <button
              type="button"
              onClick={handleAdd}
              disabled={isPending || !addA || !addB || addA === addB}
              className="rounded-md border border-[color:var(--mp-border-strong)] bg-[color:var(--mp-surface-3)] px-3 py-2 text-[12px] font-semibold transition hover:border-[color:var(--mp-fg-subtle)] hover:bg-[color:var(--mp-surface-2)] disabled:opacity-45"
            >
              ＋ 対戦を追加
            </button>
          </div>

          <div className="hidden h-8 w-px self-stretch bg-border sm:block" />

          {/* 削除 */}
          {matches.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11.5px] text-[color:var(--mp-fg-subtle)]">削除</span>
              <select
                value={delId}
                onChange={(e) => setDelId(e.target.value)}
                className="rounded-md border border-border bg-[color:var(--mp-surface-3)] px-3 py-2 text-[12.5px]"
              >
                <option value="">対戦を選択…</option>
                {matches.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.teamAName ?? "?"} vs {m.teamBName ?? "?"}
                    {m.hasResult ? "（済）" : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  const m = matches.find((x) => x.id === delId);
                  if (!m) return;
                  if (
                    m.hasResult &&
                    !window.confirm("結果が入力済みの対戦です。削除しますか？")
                  )
                    return;
                  onDelete(delId);
                  setDelId("");
                }}
                disabled={isPending || !delId}
                className="rounded-md border border-[color:var(--mp-border-strong)] px-3 py-2 text-[12px] font-semibold text-[color:var(--mp-fg-muted)] transition hover:border-[color:var(--mp-danger)]/40 hover:bg-[color:var(--mp-danger)]/10 hover:text-[color:var(--mp-danger)] disabled:opacity-45"
              >
                対戦を削除
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** ツールバーのチーム選択（番号＋名前・相手側を除外）。 */
function ToolSelect({
  value,
  onChange,
  placeholder,
  teams,
  metaById,
  exclude,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  teams: BoardTeam[];
  metaById: Map<string, TeamMeta>;
  exclude: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-border bg-[color:var(--mp-surface-3)] px-3 py-2 text-[12.5px]"
    >
      <option value="">{placeholder}</option>
      {teams
        .filter((t) => t.id !== exclude)
        .map((t) => {
          const no = metaById.get(t.id)?.no;
          return (
            <option key={t.id} value={t.id}>
              {no ? `${no}. ` : ""}
              {t.name}
            </option>
          );
        })}
    </select>
  );
}

/**
 * 試合モーダル（セルクリックで開く）。スコア（ステッパー）・POTG取得数・
 * マップ別リプレイコード・日時・配信を編集。観戦者・非権限者は閲覧のみ（readonly）。
 * 既存の結果入力ロジック（BO/POTG 検証）を踏襲する。
 */
function MatchModal({
  match,
  readOnly,
  usePotg,
  isPending,
  onClose,
  onReport,
  onClear,
  onSchedule,
  onStream,
}: {
  match: BoardMatch;
  readOnly: boolean;
  usePotg: boolean;
  isPending: boolean;
  onClose: () => void;
  onReport: (
    teamAScore: number,
    teamBScore: number,
    potgA: number,
    potgB: number,
    replayCodes: string[],
  ) => void;
  onClear: () => void;
  onSchedule: (scheduledAtLocal: string) => void;
  onStream: (streamUrl: string, streamerName: string) => void;
}) {
  const bothTeams = match.teamAId != null && match.teamBId != null;
  // 結果・日時を編集できるか（主催者 or 代表・両チーム確定時）。配信は主催者のみ。
  const canInput = !readOnly && match.canReport && bothTeams;
  const canEditSchedule = !readOnly && match.canReport;
  const canEditStream = !readOnly && match.isOrganizer;

  const [scoreA, setScoreA] = useState(match.teamAScore ?? 0);
  const [scoreB, setScoreB] = useState(match.teamBScore ?? 0);
  const [potgA, setPotgA] = useState(match.potgA);
  const [potgB, setPotgB] = useState(match.potgB);
  const [replayCodes, setReplayCodes] = useState<string[]>(match.replayCodes);
  const [scheduledAt, setScheduledAt] = useState(match.scheduledAtLocal);
  const [streamUrl, setStreamUrl] = useState(match.streamUrl ?? "");
  const [streamerName, setStreamerName] = useState(match.streamerName ?? "");
  const [validationError, setValidationError] = useState<string | null>(null);

  // ESC で閉じる。
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const replayCount = mapsPlayed(scoreA, scoreB);

  function clampScore(v: number) {
    return Math.max(0, Math.min(match.bestOf, v));
  }
  function setReplayAt(i: number, value: string) {
    setReplayCodes((prev) => {
      const next = [...prev];
      while (next.length <= i) next.push("");
      next[i] = value;
      return next;
    });
  }

  function handleSave() {
    const boCheck = validateBoScore({
      bestOf: match.bestOf,
      teamAScore: scoreA,
      teamBScore: scoreB,
    });
    if (!boCheck.ok) {
      setValidationError(boCheck.message);
      return;
    }
    const pa = usePotg ? potgA : 0;
    const pb = usePotg ? potgB : 0;
    if (usePotg) {
      const potgCheck = validatePotg({
        teamAScore: scoreA,
        teamBScore: scoreB,
        potgA: pa,
        potgB: pb,
      });
      if (!potgCheck.ok) {
        setValidationError(potgCheck.message);
        return;
      }
    }
    setValidationError(null);
    onReport(scoreA, scoreB, pa, pb, replayCodes.slice(0, mapsPlayed(scoreA, scoreB)));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(6,9,14,.72)] px-5 py-14 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[520px] overflow-hidden rounded-2xl border border-[color:var(--mp-border-strong)] bg-card shadow-[var(--mp-e3)]">
        {/* ヘッダー */}
        <div className="relative border-b border-border bg-gradient-to-b from-[color:var(--mp-surface-2)] to-transparent px-5 pb-4 pt-[18px]">
          <div className="mb-2.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-[color:var(--mp-accent)]">
            Match · 予選
            {!canInput && (
              <span className="rounded-full border border-[color:var(--mp-live)]/30 bg-[color:var(--mp-live)]/[0.12] px-2 py-0.5 text-[9.5px] tracking-wider text-[color:var(--mp-live)]">
                閲覧のみ
              </span>
            )}
          </div>
          <span
            title={`BO${match.bestOf}（${describeBestOf(match.bestOf)}）`}
            className="absolute right-5 top-[18px] rounded-full border border-[color:var(--mp-brand)]/30 bg-[color:var(--mp-brand)]/10 px-2.5 py-0.5 font-mono text-[10.5px] font-semibold text-[color:var(--mp-brand)]"
          >
            BO{match.bestOf}
          </span>
          <div className="flex items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-base font-bold" style={{ color: match.teamAName ? undefined : "var(--mp-danger)" }}>
              {match.teamAName ?? "未定/削除済み"}
            </span>
            <span className="shrink-0 font-sans text-xs font-extrabold text-[color:var(--mp-fg-subtle)]">
              VS
            </span>
            <span className="min-w-0 flex-1 truncate text-right text-base font-bold" style={{ color: match.teamBName ? undefined : "var(--mp-danger)" }}>
              {match.teamBName ?? "未定/削除済み"}
            </span>
          </div>
        </div>

        {/* 本体 */}
        <div className="px-5 pb-1.5 pt-[18px]">
          {/* スコア */}
          <div className="mb-4">
            <div className="mb-2 flex items-center gap-1.5 font-sans text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
              スコア
              <span className="font-jp text-[11px] font-normal normal-case tracking-normal text-[color:var(--mp-fg-subtle)]">
                マップ取得数（BO{match.bestOf}：0〜{match.bestOf}）
              </span>
            </div>
            <div className="flex items-center justify-center gap-4 pb-0.5 pt-1.5">
              <ScoreStepper
                label={match.teamAName ?? "A"}
                value={scoreA}
                onChange={(v) => setScoreA(clampScore(v))}
                editable={canInput}
              />
              <span className="mt-5 self-center font-mono text-2xl font-normal text-[color:var(--mp-fg-subtle)]">
                –
              </span>
              <ScoreStepper
                label={match.teamBName ?? "B"}
                value={scoreB}
                onChange={(v) => setScoreB(clampScore(v))}
                editable={canInput}
              />
            </div>
          </div>

          {/* POTG（取得数）。使うイベントのみ。 */}
          {usePotg && (
            <div className="mb-4">
              <div className="mb-2 flex items-center gap-1.5 font-sans text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                POTG
                <span className="font-jp text-[11px] font-normal normal-case tracking-normal text-[color:var(--mp-fg-subtle)]">
                  各チームの POTG 取得数
                </span>
              </div>
              <div className="flex items-center justify-center gap-4 pt-1">
                <ScoreStepper
                  label={match.teamAName ?? "A"}
                  value={potgA}
                  onChange={(v) => setPotgA(Math.max(0, Math.min(99, v)))}
                  editable={canInput}
                />
                <span className="mt-5 self-center font-mono text-2xl font-normal text-[color:var(--mp-fg-subtle)]">
                  –
                </span>
                <ScoreStepper
                  label={match.teamBName ?? "B"}
                  value={potgB}
                  onChange={(v) => setPotgB(Math.max(0, Math.min(99, v)))}
                  editable={canInput}
                />
              </div>
            </div>
          )}

          {/* マップ別リプレイコード（行われたマップ数分）。 */}
          {replayCount > 0 && (
            <div className="mb-4">
              <div className="mb-2 flex items-center gap-1.5 font-sans text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                マップ別リプレイコード
                <span className="font-jp text-[11px] font-normal normal-case tracking-normal text-[color:var(--mp-fg-subtle)]">
                  行われたマップ分・任意
                </span>
              </div>
              <div className="space-y-2">
                {Array.from({ length: replayCount }, (_, i) => (
                  <div key={i} className="grid grid-cols-[80px_1fr] items-center gap-2.5">
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="rounded border border-border bg-[color:var(--mp-surface-3)] px-1.5 py-0.5 font-mono text-[10px] text-[color:var(--mp-fg-subtle)]">
                        MAP {i + 1}
                      </span>
                    </span>
                    <input
                      type="text"
                      maxLength={16}
                      value={replayCodes[i] ?? ""}
                      onChange={(e) => setReplayAt(i, e.target.value)}
                      disabled={!canInput}
                      placeholder="リプレイコード"
                      aria-label={`マップ${i + 1}のリプレイコード`}
                      className="w-full rounded-md border border-border bg-[color:var(--mp-surface-3)] px-3 py-2 font-mono text-[13px] tracking-wide disabled:border-dashed disabled:bg-[color:var(--mp-surface-2)] disabled:text-muted-foreground"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 日時 */}
          {(canEditSchedule || match.scheduledAtLocal) && (
            <div className="mb-4">
              <div className="mb-2 font-sans text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                試合日時
              </div>
              {canEditSchedule ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    className="rounded-md border border-border bg-[color:var(--mp-surface-3)] px-3 py-2 text-[13px]"
                  />
                  <button
                    type="button"
                    onClick={() => onSchedule(scheduledAt)}
                    disabled={isPending}
                    className="rounded-md bg-[color:var(--mp-brand)] px-3 py-2 text-xs font-semibold text-[color:var(--mp-on-brand)] hover:bg-[color:var(--mp-brand-hover)] disabled:opacity-45"
                  >
                    日時を保存
                  </button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  🕒 {formatLocalInputForDisplay(match.scheduledAtLocal)}
                </p>
              )}
            </div>
          )}

          {/* 配信 */}
          {(canEditStream || match.streamUrl) && (
            <div className="mb-4">
              <div className="mb-2 font-sans text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                配信
              </div>
              {canEditStream ? (
                <div className="grid grid-cols-2 gap-2.5">
                  <input
                    type="url"
                    value={streamUrl}
                    onChange={(e) => setStreamUrl(e.target.value)}
                    placeholder="https://twitch.tv/..."
                    className="rounded-md border border-border bg-[color:var(--mp-surface-3)] px-3 py-2 text-[13px]"
                  />
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={streamerName}
                      onChange={(e) => setStreamerName(e.target.value)}
                      placeholder="配信者名"
                      maxLength={100}
                      className="min-w-0 flex-1 rounded-md border border-border bg-[color:var(--mp-surface-3)] px-3 py-2 text-[13px]"
                    />
                    <button
                      type="button"
                      onClick={() => onStream(streamUrl, streamerName)}
                      disabled={isPending}
                      className="shrink-0 rounded-md bg-[color:var(--mp-brand)] px-3 py-2 text-xs font-semibold text-[color:var(--mp-on-brand)] hover:bg-[color:var(--mp-brand-hover)] disabled:opacity-45"
                    >
                      保存
                    </button>
                  </div>
                </div>
              ) : (
                <a
                  href={match.streamUrl ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-[color:var(--mp-brand)] hover:underline"
                >
                  📺 {match.streamerName || "配信"}
                </a>
              )}
            </div>
          )}

          {validationError && (
            <p className="mb-3 text-xs text-[color:var(--mp-danger)]">{validationError}</p>
          )}
        </div>

        {/* フッター */}
        <div className="flex items-center justify-between gap-3 border-t border-border bg-[color:var(--mp-surface-2)] px-5 py-3.5">
          {canInput && match.hasResult ? (
            <button
              type="button"
              onClick={onClear}
              disabled={isPending}
              className="text-xs text-[color:var(--mp-fg-muted)] hover:text-[color:var(--mp-danger)] disabled:opacity-45"
            >
              結果を取り消し
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-[13px] font-semibold text-muted-foreground transition hover:bg-[color:var(--mp-surface-3)] hover:text-foreground"
            >
              {canInput ? "キャンセル" : "閉じる"}
            </button>
            {canInput && (
              <button
                type="button"
                onClick={handleSave}
                disabled={isPending}
                className="rounded-md bg-[color:var(--mp-brand)] px-4 py-2 text-[13px] font-semibold text-[color:var(--mp-on-brand)] shadow-[0_0_0_1px_rgba(255,106,43,.35),0_6px_18px_rgba(255,106,43,.2)] transition hover:bg-[color:var(--mp-brand-hover)] disabled:opacity-45"
              >
                結果を保存
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

