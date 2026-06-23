"use client";

import { useEffect, useState, useTransition } from "react";
import { generateMatches, addMatch, deleteMatch } from "./actions";

/** ブロック所属チーム（プルダウン用）。 */
export type BoardTeam = { id: string; name: string };

/** 1試合（対戦カード）。チームが削除/承認取消されると id/name が null になりうる。 */
export type BoardMatch = {
  id: string;
  teamAId: string | null;
  teamBId: string | null;
  teamAName: string | null;
  teamBName: string | null;
};

export type BoardGroup = {
  id: string;
  name: string;
  teams: BoardTeam[];
  matches: BoardMatch[];
};

export function MatchesBoard({
  readOnly = false,
  initialGroups,
}: {
  readOnly?: boolean;
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
  isPending,
  onGenerate,
  onAdd,
  onDelete,
}: {
  group: BoardGroup;
  readOnly: boolean;
  isPending: boolean;
  onGenerate: () => void;
  onAdd: (teamAId: string, teamBId: string) => void;
  onDelete: (matchId: string) => void;
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
        {!readOnly && (
          <button
            type="button"
            onClick={onGenerate}
            disabled={isPending || group.teams.length < 2}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            対戦表を生成
          </button>
        )}
      </div>

      {group.teams.length < 2 && (
        <p className="mt-2 text-xs text-muted-foreground">
          振り分け済みのチームが2つ以上必要です（現在 {group.teams.length}）。
        </p>
      )}

      {/* 対戦カード一覧（生成順）。 */}
      <div className="mt-3 space-y-2">
        {group.matches.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
            対戦カードがありません。
          </p>
        ) : (
          group.matches.map((m, i) => (
            <div
              key={m.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2"
            >
              <span className="text-sm">
                <span className="mr-2 text-xs text-muted-foreground tabular-nums">
                  {i + 1}.
                </span>
                <span className={m.teamAName ? "" : "text-destructive"}>
                  {m.teamAName ?? "未定/削除済み"}
                </span>
                <span className="mx-2 text-muted-foreground">vs</span>
                <span className={m.teamBName ? "" : "text-destructive"}>
                  {m.teamBName ?? "未定/削除済み"}
                </span>
              </span>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => onDelete(m.id)}
                  disabled={isPending}
                  className="text-xs text-muted-foreground hover:text-destructive disabled:opacity-60"
                  aria-label="この対戦を削除"
                >
                  削除
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* 手動追加フォーム（同ブロックのチームから選択）。 */}
      {!readOnly && group.teams.length >= 2 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
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
      )}
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
