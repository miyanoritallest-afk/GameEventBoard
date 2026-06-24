"use client";

import { useEffect, useState, useTransition } from "react";
import {
  generateMatches,
  addMatch,
  deleteMatch,
  reportResult,
  clearResult,
} from "./actions";
import {
  validateBoScore,
  validatePotg,
  describeBestOf,
} from "@/lib/services/match-result";

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

export function MatchesBoard({
  readOnly = false,
  rankingEnabled = false,
  usePotg = false,
  initialGroups,
}: {
  readOnly?: boolean;
  /** 順位機能 ON か（順位表セクションの表示）。 */
  rankingEnabled?: boolean;
  /** タイブレークに potg があるか（結果入力の POTG 欄の出し分け）。 */
  usePotg?: boolean;
  initialGroups: BoardGroup[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [savedTick, setSavedTick] = useState(0);
  const [isPending, startTransition] = useTransition();

  function flashSaved() {
    setSaved(true);
    setSavedTick((n) => n + 1);
  }

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(t);
  }, [saved, savedTick]);

  function run(action: () => Promise<{ error?: string }>) {
    setError(null);
    startTransition(async () => {
      const r = await action();
      if (r.error) setError(r.error);
      else flashSaved();
    });
  }

  function handleGenerate(groupId: string, teamCount: number, hasMatches: boolean) {
    if (teamCount < 2) {
      setError("総当たりには2チーム以上が必要です。");
      return;
    }
    if (
      hasMatches &&
      !window.confirm(
        "このブロックの既存の対戦カードをすべて削除して作り直します。よろしいですか？",
      )
    ) {
      return;
    }
    run(() => generateMatches({ groupId }));
  }

  return (
    <div>
      {error && (
        <p className="mt-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {saved && (
        <div className="fixed bottom-6 right-6 z-50 rounded-md border border-primary/50 bg-primary/10 px-4 py-2 text-sm text-primary shadow-lg">
          ✓ 保存しました
        </div>
      )}

      {readOnly && (
        <p className="mt-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          参加者として閲覧しています。対戦表の編集は主催者のみ可能です。
        </p>
      )}

      {initialGroups.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          まだブロックがありません。先に
          {!readOnly && "「ブロック分け」画面で"}
          ブロックを作成してチームを振り分けてください。
        </p>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {initialGroups.map((group) => (
            <GroupMatches
              key={group.id}
              group={group}
              readOnly={readOnly}
              rankingEnabled={rankingEnabled}
              usePotg={usePotg}
              isPending={isPending}
              onGenerate={() =>
                handleGenerate(
                  group.id,
                  group.teams.length,
                  group.matches.length > 0,
                )
              }
              onAdd={(teamAId, teamBId) =>
                run(() => addMatch({ groupId: group.id, teamAId, teamBId }))
              }
              onDelete={(matchId) => run(() => deleteMatch(matchId))}
              onReport={(matchId, teamAScore, teamBScore, potgA, potgB) =>
                run(() =>
                  reportResult({ matchId, teamAScore, teamBScore, potgA, potgB }),
                )
              }
              onClear={(matchId) => run(() => clearResult(matchId))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** 1ブロックの対戦カード一覧＋生成/追加/削除。 */
function GroupMatches({
  group,
  readOnly,
  rankingEnabled,
  usePotg,
  isPending,
  onGenerate,
  onAdd,
  onDelete,
  onReport,
  onClear,
}: {
  group: BoardGroup;
  readOnly: boolean;
  rankingEnabled: boolean;
  usePotg: boolean;
  isPending: boolean;
  onGenerate: () => void;
  onAdd: (teamAId: string, teamBId: string) => void;
  onDelete: (matchId: string) => void;
  onReport: (
    matchId: string,
    teamAScore: number,
    teamBScore: number,
    potgA: number,
    potgB: number,
  ) => void;
  onClear: (matchId: string) => void;
}) {
  const [teamAId, setTeamAId] = useState("");
  const [teamBId, setTeamBId] = useState("");

  function handleAdd() {
    if (!teamAId || !teamBId || teamAId === teamBId) return;
    onAdd(teamAId, teamBId);
    setTeamAId("");
    setTeamBId("");
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-semibold">
          {group.name}{" "}
          <span className="text-xs font-normal text-muted-foreground">
            （{group.teams.length}チーム / {group.matches.length}試合）
          </span>
        </h2>
      </div>

      {group.teams.length < 2 && (
        <p className="mt-2 text-xs text-muted-foreground">
          振り分け済みのチームが2つ以上必要です（現在 {group.teams.length}）。
        </p>
      )}

      {/* 操作エリア（生成＋手動追加）。両操作を近くにまとめる（⑩）。
          まず総当たりを生成し、足りなければ手動で1試合ずつ追加する流れ。 */}
      {!readOnly && group.teams.length >= 2 && (
        <div className="mt-3 space-y-2 rounded-md border border-border bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              総当たりを一括生成
            </span>
            <button
              type="button"
              onClick={onGenerate}
              disabled={isPending}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              対戦表を生成
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
            <span className="text-xs font-medium text-muted-foreground">
              個別に追加
            </span>
            <TeamSelect
              value={teamAId}
              onChange={setTeamAId}
              teams={group.teams}
              exclude={teamBId}
              placeholder="チームA"
            />
            <span className="text-xs text-muted-foreground">vs</span>
            <TeamSelect
              value={teamBId}
              onChange={setTeamBId}
              teams={group.teams}
              exclude={teamAId}
              placeholder="チームB"
            />
            <button
              type="button"
              onClick={handleAdd}
              disabled={
                isPending || !teamAId || !teamBId || teamAId === teamBId
              }
              className="rounded-md border border-primary/50 px-3 py-1.5 text-xs text-primary hover:bg-primary/10 disabled:opacity-60"
            >
              + 対戦を追加
            </button>
          </div>
        </div>
      )}

      {/* 順位表（順位機能 ON のとき）。 */}
      {rankingEnabled && group.standings.length > 0 && (
        <StandingsTable standings={group.standings} usePotg={usePotg} />
      )}

      {/* 対戦カード一覧（生成順）。 */}
      <div className="mt-3 space-y-2">
        {group.matches.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
            対戦カードがありません。
          </p>
        ) : (
          group.matches.map((m, i) => (
            <MatchCard
              key={m.id}
              match={m}
              index={i}
              readOnly={readOnly}
              usePotg={usePotg}
              isPending={isPending}
              onDelete={() => onDelete(m.id)}
              onReport={(a, b, pa, pb) => onReport(m.id, a, b, pa, pb)}
              onClear={() => onClear(m.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * 1試合の対戦カード。対戦名＋結果（スコア）表示と、権限があれば結果入力フォーム・削除。
 * 結果入力は「主催者 or 対戦両チーム代表（canReport）」かつ両チーム確定時のみ。
 */
function MatchCard({
  match,
  index,
  readOnly,
  usePotg,
  isPending,
  onDelete,
  onReport,
  onClear,
}: {
  match: BoardMatch;
  index: number;
  readOnly: boolean;
  usePotg: boolean;
  isPending: boolean;
  onDelete: () => void;
  onReport: (
    teamAScore: number,
    teamBScore: number,
    potgA: number,
    potgB: number,
  ) => void;
  onClear: () => void;
}) {
  const [editing, setEditing] = useState(false);
  // 未入力時の初期値は 0（空欄だと先頭にカーソルを置いて消す手間がある・⑪）。
  const [scoreA, setScoreA] = useState(
    match.teamAScore !== null ? String(match.teamAScore) : "0",
  );
  const [scoreB, setScoreB] = useState(
    match.teamBScore !== null ? String(match.teamBScore) : "0",
  );
  const [potgA, setPotgA] = useState(String(match.potgA));
  const [potgB, setPotgB] = useState(String(match.potgB));
  // 入力が BO/POTG ルールに反するときの説明（保存前にその場で示す）。
  const [validationError, setValidationError] = useState<string | null>(null);

  const bothTeams = match.teamAId != null && match.teamBId != null;
  // 結果入力できる: 編集権あり・両チーム確定・主催者/代表。
  const canInput = !readOnly && match.canReport && bothTeams;

  function handleSave() {
    const a = Number(scoreA);
    const b = Number(scoreB);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) {
      setValidationError("マップ数は0以上の整数で入力してください。");
      return;
    }
    // スコアが BO の組み合わせとして妥当か（サーバーと同じ純粋関数で先に弾く）。
    const boCheck = validateBoScore({
      bestOf: match.bestOf,
      teamAScore: a,
      teamBScore: b,
    });
    if (!boCheck.ok) {
      setValidationError(boCheck.message);
      return;
    }
    // POTG は使うイベントのみ。未使用は 0 を送る。
    const pa = usePotg ? Number(potgA) || 0 : 0;
    const pb = usePotg ? Number(potgB) || 0 : 0;
    if (usePotg) {
      const potgCheck = validatePotg({
        teamAScore: a,
        teamBScore: b,
        potgA: pa,
        potgB: pb,
      });
      if (!potgCheck.ok) {
        setValidationError(potgCheck.message);
        return;
      }
    }
    setValidationError(null);
    onReport(a, b, pa, pb);
    setEditing(false);
  }

  const winA = match.winnerTeamId !== null && match.winnerTeamId === match.teamAId;
  const winB = match.winnerTeamId !== null && match.winnerTeamId === match.teamBId;
  const isDraw = match.hasResult && match.winnerTeamId === null;

  return (
    <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm">
          <span className="mr-2 text-xs text-muted-foreground tabular-nums">
            {index + 1}.
          </span>
          <span
            title={`BO${match.bestOf}（${describeBestOf(match.bestOf)}）`}
            className="mr-2 cursor-help rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
          >
            BO{match.bestOf}
          </span>
          <span
            className={
              match.teamAName
                ? winA
                  ? "rounded bg-primary/15 px-1.5 py-0.5 font-bold text-primary"
                  : match.hasResult
                  ? "text-muted-foreground"
                  : ""
                : "text-destructive"
            }
          >
            {winA && "🏆 "}
            {match.teamAName ?? "未定/削除済み"}
          </span>
          {match.hasResult ? (
            <span className="mx-2 tabular-nums">
              <span className={winA ? "font-bold text-primary" : "font-semibold"}>
                {match.teamAScore}
              </span>
              {" - "}
              <span className={winB ? "font-bold text-primary" : "font-semibold"}>
                {match.teamBScore}
              </span>
            </span>
          ) : (
            <span className="mx-2 text-muted-foreground">vs</span>
          )}
          <span
            className={
              match.teamBName
                ? winB
                  ? "rounded bg-primary/15 px-1.5 py-0.5 font-bold text-primary"
                  : match.hasResult
                  ? "text-muted-foreground"
                  : ""
                : "text-destructive"
            }
          >
            {winB && "🏆 "}
            {match.teamBName ?? "未定/削除済み"}
          </span>
          {isDraw && (
            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              引分
            </span>
          )}
        </span>

        <div className="flex shrink-0 items-center gap-2">
          {canInput && !editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={isPending}
              className="text-xs text-primary hover:underline disabled:opacity-60"
            >
              {match.hasResult ? "結果を修正" : "結果を入力"}
            </button>
          )}
          {!readOnly && (
            <button
              type="button"
              onClick={onDelete}
              disabled={isPending}
              className="text-xs text-muted-foreground hover:text-destructive disabled:opacity-60"
              aria-label="この対戦を削除"
            >
              削除
            </button>
          )}
        </div>
      </div>

      {/* 結果入力フォーム（取マップ数）。 */}
      {canInput && editing && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2">
          <span className="text-xs text-muted-foreground">
            {match.teamAName}
          </span>
          <input
            type="number"
            min={0}
            max={match.bestOf}
            value={scoreA}
            onChange={(e) => setScoreA(e.target.value)}
            className="w-14 rounded-md border border-border bg-background px-2 py-1 text-sm tabular-nums"
          />
          <span className="text-xs text-muted-foreground">-</span>
          <input
            type="number"
            min={0}
            max={match.bestOf}
            value={scoreB}
            onChange={(e) => setScoreB(e.target.value)}
            className="w-14 rounded-md border border-border bg-background px-2 py-1 text-sm tabular-nums"
          />
          <span className="text-xs text-muted-foreground">
            {match.teamBName}
          </span>

          {/* POTG 欄（tiebreakers に potg があるイベントのみ）。 */}
          {usePotg && (
            <span className="flex items-center gap-2">
              <span className="ml-2 text-xs text-muted-foreground">POTG</span>
              <input
                type="number"
                min={0}
                max={99}
                value={potgA}
                onChange={(e) => setPotgA(e.target.value)}
                aria-label={`${match.teamAName} のPOTG数`}
                className="w-12 rounded-md border border-border bg-background px-2 py-1 text-sm tabular-nums"
              />
              <span className="text-xs text-muted-foreground">-</span>
              <input
                type="number"
                min={0}
                max={99}
                value={potgB}
                onChange={(e) => setPotgB(e.target.value)}
                aria-label={`${match.teamBName} のPOTG数`}
                className="w-12 rounded-md border border-border bg-background px-2 py-1 text-sm tabular-nums"
              />
            </span>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={isPending || scoreA === "" || scoreB === ""}
            className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            保存
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            キャンセル
          </button>
          {match.hasResult && (
            <button
              type="button"
              onClick={() => {
                onClear();
                setEditing(false);
              }}
              disabled={isPending}
              className="ml-auto text-xs text-muted-foreground hover:text-destructive disabled:opacity-60"
            >
              結果を取り消し
            </button>
          )}
          {validationError && (
            <p className="w-full text-xs text-destructive">{validationError}</p>
          )}
        </div>
      )}
    </div>
  );
}

/** ブロックの順位表（Service standings.ts の結果を表示）。 */
function StandingsTable({
  standings,
  usePotg,
}: {
  standings: BoardStanding[];
  usePotg: boolean;
}) {
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
            <th className="px-2 py-1.5 text-left font-medium">順位</th>
            <th className="px-2 py-1.5 text-left font-medium">チーム</th>
            <th className="px-2 py-1.5 text-right font-medium">勝</th>
            <th className="px-2 py-1.5 text-right font-medium">分</th>
            <th className="px-2 py-1.5 text-right font-medium">敗</th>
            <th className="px-2 py-1.5 text-right font-medium">勝点</th>
            <th className="px-2 py-1.5 text-right font-medium">得失</th>
            {usePotg && (
              <th className="px-2 py-1.5 text-right font-medium">POTG</th>
            )}
          </tr>
        </thead>
        <tbody>
          {standings.map((s) => (
            <tr key={s.teamId} className="border-b border-border last:border-0">
              <td className="px-2 py-1.5 tabular-nums">{s.rank}</td>
              <td className="px-2 py-1.5 font-medium">{s.teamName}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{s.wins}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{s.draws}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{s.losses}</td>
              <td className="px-2 py-1.5 text-right font-semibold tabular-nums">
                {s.points}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">
                {s.mapDiff > 0 ? `+${s.mapDiff}` : s.mapDiff}
              </td>
              {usePotg && (
                <td className="px-2 py-1.5 text-right tabular-nums">{s.potg}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** チーム選択プルダウン。exclude（相手側で選択中）は選べないようにする。 */
function TeamSelect({
  value,
  onChange,
  teams,
  exclude,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  teams: BoardTeam[];
  exclude: string;
  placeholder: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
    >
      <option value="">{placeholder}</option>
      {teams
        .filter((t) => t.id !== exclude)
        .map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
    </select>
  );
}
