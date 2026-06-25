"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  pointerWithin,
  closestCenter,
  type CollisionDetection,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  createGroup,
  renameGroup,
  deleteGroup,
  assignTeam,
  unassignTeam,
  autoAssignGroups,
} from "./actions";

/** ボード用のチーム表現（page.tsx で DB から整形して渡す）。 */
export type BoardTeam = {
  id: string;
  name: string;
  /** 出場メンバーのチーム平均（require_score=false や未算出は null）。 */
  score: number | null;
};

export type BoardGroup = {
  id: string;
  name: string;
  teams: BoardTeam[];
};

const POOL_ID = "pool"; // 未割当プールの droppable id

/** droppable id を groupId に解決する。pool は null。 */
function parseZone(id: string): string | null {
  return id === POOL_ID ? null : id;
}

/**
 * ドロップ判定。ポインタ位置が領域内かで判定する pointerWithin を第一にし、
 * どこにも重ならないときだけ closestCenter にフォールバックする。
 * 横長のチームカードでも浅い位置でドロップを受け付けられる（teams-board と同方針）。
 */
const dropCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : closestCenter(args);
};

export function GroupsBoard({
  eventId,
  readOnly = false,
  locked = false,
  showScore,
  initialGroups,
  initialUnassigned,
}: {
  eventId: string;
  /** 応募者の閲覧（read-only）。D&D・操作ボタンを無効化する。 */
  readOnly?: boolean;
  /**
   * 対戦表が生成済みのためロックするか（⑬）。主催者でも D&D・ブロック削除を無効化する。
   * 生成後にブロックを動かすと対戦カードと所属ブロックがズレて事故るため。
   */
  locked?: boolean;
  showScore: boolean;
  initialGroups: BoardGroup[];
  initialUnassigned: BoardTeam[];
}) {
  // 編集可否: 応募者の閲覧（readOnly）か、対戦表生成済み（locked）なら不可。
  const editable = !readOnly && !locked;
  const router = useRouter();
  const [groups, setGroups] = useState<BoardGroup[]>(initialGroups);
  const [unassigned, setUnassigned] = useState<BoardTeam[]>(initialUnassigned);
  const [activeTeam, setActiveTeam] = useState<BoardTeam | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [savedTick, setSavedTick] = useState(0);
  const [isPending, startTransition] = useTransition();

  // 自動ブロック分け（PR-4）の入力と確認ダイアログの開閉。
  const totalTeams = groups.reduce((n, g) => n + g.teams.length, 0) + unassigned.length;
  const [draftBlockCount, setDraftBlockCount] = useState(2);
  const [draftDialogOpen, setDraftDialogOpen] = useState(false);

  function flashSaved() {
    setSaved(true);
    setSavedTick((n) => n + 1);
  }

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(t);
  }, [saved, savedTick]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  /** teamId からチームを全所在から探す。 */
  function findTeam(teamId: string): BoardTeam | null {
    const inPool = unassigned.find((t) => t.id === teamId);
    if (inPool) return inPool;
    for (const g of groups) {
      const t = g.teams.find((x) => x.id === teamId);
      if (t) return t;
    }
    return null;
  }

  /** teamId が今どのブロックに属すか（プールなら null）。 */
  function findOwningGroupId(teamId: string): string | null {
    return groups.find((g) => g.teams.some((t) => t.id === teamId))?.id ?? null;
  }

  /** 楽観更新の共通ロールバック。 */
  function rollback(
    prevGroups: BoardGroup[],
    prevUnassigned: BoardTeam[],
    msg: string,
  ) {
    setGroups(prevGroups);
    setUnassigned(prevUnassigned);
    setError(msg);
  }

  function handleDragStart(e: DragStartEvent) {
    setActiveTeam(findTeam(String(e.active.id)));
  }

  /**
   * ドラッグ完了。ドロップ先（プール / ブロック）に応じて楽観更新し Server Action を呼ぶ。
   * 移動モデル: 別ブロックへ移すと元から消える（1チーム1ブロック）。失敗時はロールバック。
   */
  function handleDragEnd(e: DragEndEvent) {
    setActiveTeam(null);
    if (!editable) return;
    const { active, over } = e;
    if (!over) return;

    const teamId = String(active.id);
    const team = findTeam(teamId);
    if (!team) return;

    const fromGroupId = findOwningGroupId(teamId);
    const toGroupId = parseZone(String(over.id)); // null=プール

    // 変化なし（同じブロック、またはプール→プール）なら何もしない。
    if (fromGroupId === toGroupId) return;

    const prevGroups = groups;
    const prevUnassigned = unassigned;
    setError(null);

    // 全所在から外す（楽観）。
    const detachedGroups = groups.map((g) => ({
      ...g,
      teams: g.teams.filter((t) => t.id !== teamId),
    }));
    const detachedPool = unassigned.filter((t) => t.id !== teamId);

    // --- プールへ戻す ---
    if (toGroupId === null) {
      setGroups(detachedGroups);
      setUnassigned([...detachedPool, team]);
      startTransition(async () => {
        const r = await unassignTeam(teamId);
        if (r.error) rollback(prevGroups, prevUnassigned, r.error);
        else flashSaved();
      });
      return;
    }

    // --- ブロックへ割当（プール/別ブロック → ブロック）---
    setUnassigned(detachedPool);
    setGroups(
      detachedGroups.map((g) =>
        g.id === toGroupId ? { ...g, teams: [...g.teams, team] } : g,
      ),
    );
    startTransition(async () => {
      const r = await assignTeam({ groupId: toGroupId, teamId });
      if (r.error) rollback(prevGroups, prevUnassigned, r.error);
      else flashSaved();
    });
  }

  function handleCreateGroup() {
    const name = newGroupName.trim();
    if (!name) return;
    setError(null);
    startTransition(async () => {
      const r = await createGroup(eventId, name);
      if (r.error || !r.groupId) {
        setError(r.error ?? "ブロックの作成に失敗しました。");
        return;
      }
      setGroups((prev) => [...prev, { id: r.groupId as string, name, teams: [] }]);
      setNewGroupName("");
      flashSaved();
    });
  }

  function handleRenameGroup(groupId: string, current: string) {
    const next = window.prompt("ブロック名を入力してください", current);
    if (next === null) return;
    const name = next.trim();
    if (!name || name === current) return;
    setError(null);
    const prevGroups = groups;
    setGroups(groups.map((g) => (g.id === groupId ? { ...g, name } : g)));
    startTransition(async () => {
      const r = await renameGroup(groupId, name);
      if (r.error) {
        setGroups(prevGroups);
        setError(r.error);
      } else flashSaved();
    });
  }

  function handleDeleteGroup(groupId: string) {
    const target = groups.find((g) => g.id === groupId);
    if (!target) return;
    setError(null);
    const prevGroups = groups;
    const prevUnassigned = unassigned;
    // 中のチームはプールへ戻す（cascade と同じ結果を楽観反映）。
    setGroups(groups.filter((g) => g.id !== groupId));
    setUnassigned([...unassigned, ...target.teams]);
    startTransition(async () => {
      const r = await deleteGroup(groupId);
      if (r.error) rollback(prevGroups, prevUnassigned, r.error);
      else flashSaved();
    });
  }

  /**
   * 自動ブロック分けを実行する（確認ダイアログで承諾後）。
   * 既存ブロック・割当を全削除して N ブロックへ配り直すため、楽観更新ではなく
   * サーバーが正の状態を返す router.refresh() で画面全体を再取得する。
   */
  function handleAutoDraft() {
    setDraftDialogOpen(false);
    setError(null);
    startTransition(async () => {
      const r = await autoAssignGroups(eventId, draftBlockCount);
      if (r.error) {
        setError(r.error);
        return;
      }
      flashSaved();
      router.refresh();
    });
  }

  return (
    <DndContext
      id="groups-board-dnd"
      sensors={sensors}
      collisionDetection={dropCollision}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
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
          参加者として閲覧しています。ブロックの編集は主催者のみ可能です。
        </p>
      )}

      {/* 対戦表生成済みのロック告知（主催者向け・⑬）。 */}
      {!readOnly && locked && (
        <p className="mt-4 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
          対戦表が生成済みのため、ブロックの組み替え・削除はできません。組み替えると対戦表とブロックがずれて事故ります。変更したい場合は対戦表側で対象の試合を削除してから戻ってください。
        </p>
      )}

      {/* 観戦者（readOnly）には未割当プールを見せず、確定したブロックだけ全幅で表示する。 */}
      <div
        className={`mt-6 grid gap-6 ${
          readOnly ? "" : "lg:grid-cols-[20rem_1fr]"
        }`}
      >
        {/* 左: 未割当プール（承認済みチーム）。観戦者には出さない。 */}
        {!readOnly && (
          <Pool teams={unassigned} showScore={showScore} draggable={editable} />
        )}

        {/* 右: ブロック群 */}
        <div className="space-y-4">
          {/* 自動でブロック分け（PR-4）。承認チームをスコア降順スネークドラフトで配り直す。 */}
          {editable && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h2 className="text-sm font-semibold">自動でブロック分け</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                承認済みの全チーム（{totalTeams}）を強さが偏らないように指定数のブロックへ自動で振り分けます。
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="text-sm text-muted-foreground" htmlFor="draft-block-count">
                  ブロック数
                </label>
                <input
                  id="draft-block-count"
                  type="number"
                  min={1}
                  max={Math.max(1, totalTeams)}
                  value={draftBlockCount}
                  onChange={(e) =>
                    setDraftBlockCount(
                      Math.max(1, Math.floor(Number(e.target.value) || 1)),
                    )
                  }
                  className="w-20 rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setDraftDialogOpen(true)}
                  disabled={
                    isPending ||
                    totalTeams === 0 ||
                    draftBlockCount < 1 ||
                    draftBlockCount > totalTeams
                  }
                  className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                >
                  自動で振り分ける
                </button>
              </div>
              {totalTeams === 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  承認済みのチームがありません。
                </p>
              )}
            </div>
          )}

          {editable && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newGroupName}
                maxLength={50}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="ブロック名（例: Aブロック）"
                className="w-56 rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={handleCreateGroup}
                disabled={isPending || newGroupName.trim() === ""}
                className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                + ブロックを追加
              </button>
            </div>
          )}

          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {readOnly
                ? "まだブロックがありません。"
                : "ブロックがまだありません。「+ ブロックを追加」で作成してください。"}
            </p>
          ) : (
            <div className="grid gap-4 2xl:grid-cols-2">
              {groups.map((group) => (
                <GroupCard
                  key={group.id}
                  group={group}
                  readOnly={readOnly}
                  editable={editable}
                  showScore={showScore}
                  onRename={() => handleRenameGroup(group.id, group.name)}
                  onDelete={() => handleDeleteGroup(group.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <DragOverlay>
        {activeTeam ? (
          <TeamCard team={activeTeam} showScore={showScore} overlay />
        ) : null}
      </DragOverlay>

      {/* 自動ブロック分けの確認（破壊的操作の警告）。 */}
      <AlertDialog open={draftDialogOpen} onOpenChange={setDraftDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>自動でブロック分けしますか？</AlertDialogTitle>
            <AlertDialogDescription>
              現在のブロックと割り当てがすべて削除され、承認済みの全チーム（{totalTeams}）が
              {draftBlockCount}個のブロックへ自動で振り分けられます。この操作は元に戻せません。
              振り分け後はドラッグ＆ドロップで手動調整できます。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={handleAutoDraft}>
              振り分ける
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DndContext>
  );
}

/** 未割当プール（droppable）。承認済みで未割当のチーム。 */
function Pool({
  teams,
  showScore,
  draggable,
}: {
  teams: BoardTeam[];
  showScore: boolean;
  /** チームカードをドラッグできるか（閲覧者・ロック時は false）。 */
  draggable: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: POOL_ID });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border p-4 ${
        isOver && draggable ? "border-primary bg-primary/5" : "border-border bg-card"
      }`}
    >
      <h2 className="text-sm font-semibold text-muted-foreground">
        未割当のチーム ({teams.length})
      </h2>
      <div className="mt-3 space-y-2">
        {teams.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            未割当の承認済みチームはありません。
          </p>
        ) : (
          teams.map((t) => (
            <TeamCard
              key={t.id}
              team={t}
              showScore={showScore}
              draggable={draggable}
            />
          ))
        )}
      </div>
    </div>
  );
}

/** 1ブロック（droppable）。所属チームを並べる。 */
function GroupCard({
  group,
  readOnly,
  editable,
  showScore,
  onRename,
  onDelete,
}: {
  group: BoardGroup;
  readOnly: boolean;
  /** D&D・ブロック削除が可能か（閲覧者・ロック時は false）。 */
  editable: boolean;
  showScore: boolean;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: group.id });
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold">
          {group.name}{" "}
          <span className="text-xs font-normal text-muted-foreground">
            ({group.teams.length})
          </span>
        </h3>
        {!readOnly && (
          <div className="flex items-center gap-2">
            {/* 改名はロック中も可（対戦表と整合性に影響しない）。 */}
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onRename}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              改名
            </button>
            {/* 削除はロック中は不可（中のチームがプールへ戻り対戦表とずれる）。 */}
            {editable && (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={onDelete}
                className="text-xs text-muted-foreground hover:text-destructive"
              >
                ブロック削除
              </button>
            )}
          </div>
        )}
      </div>

      <div
        ref={setNodeRef}
        className={`mt-3 space-y-2 rounded-md border p-2 ${
          isOver && editable
            ? "border-primary bg-primary/5"
            : "border-dashed border-border"
        }`}
      >
        {group.teams.length === 0 ? (
          <p className="px-1 py-3 text-center text-xs text-muted-foreground">
            {editable ? "＋ チームをここにドラッグ" : "チームなし"}
          </p>
        ) : (
          group.teams.map((t) => (
            <TeamCard
              key={t.id}
              team={t}
              showScore={showScore}
              draggable={editable}
            />
          ))
        )}
      </div>
    </div>
  );
}

/** チームカード（draggable）。カード全体がドラッグ対象。 */
function TeamCard({
  team,
  showScore,
  overlay = false,
  draggable = true,
}: {
  team: BoardTeam;
  showScore: boolean;
  overlay?: boolean;
  draggable?: boolean;
}) {
  const drag = useDraggable({ id: team.id, disabled: !draggable || overlay });
  const { attributes, listeners, setNodeRef, isDragging } = drag;

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      {...(overlay || !draggable ? {} : listeners)}
      {...(overlay || !draggable ? {} : attributes)}
      className={`rounded-lg border px-3 py-2 ${
        draggable ? "cursor-grab" : ""
      } border-border bg-muted/40 ${isDragging ? "opacity-40" : ""} ${
        overlay ? "shadow-lg" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{team.name}</span>
        {showScore && (
          <span className="text-sm font-semibold tabular-nums">
            {team.score === null ? "—" : Math.round(team.score * 10) / 10}
          </span>
        )}
      </div>
    </div>
  );
}
