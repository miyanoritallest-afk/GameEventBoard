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
  /**
   * シード番号（全チームを平均スコア降順で並べた順位・表示用）。page.tsx で付与する。
   * スコアが null のチームは付かない（undefined）。DB には保存しない純粋な表示用。
   */
  seed?: number;
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
 * ブロックの識別色（Claude Design 案準拠）。作成順（index）で循環割当。
 * バッジ・バランスバー・平均ゲージで共通利用し、ブロックを色で識別できるようにする。
 */
const BLOCK_COLORS = [
  "var(--mp-brand)", // A: オレンジ
  "var(--mp-accent)", // B: シアン
  "var(--mp-support)", // C: 緑
  "var(--mp-warning)", // D: 黄
  "var(--mp-tank)", // E: 青
  "#a78bfa", // F: 紫（トークン外・案準拠）
] as const;
const BLOCK_LETTERS = ["A", "B", "C", "D", "E", "F"] as const;

function blockColor(index: number): string {
  return BLOCK_COLORS[index % BLOCK_COLORS.length];
}
function blockLetter(index: number): string {
  return BLOCK_LETTERS[index] ?? "?";
}

/** ブロックの平均スコア（所属チームの score 平均・null は除外）。空・全 null は null。 */
function groupAvg(teams: BoardTeam[]): number | null {
  const scores = teams
    .map((t) => t.score)
    .filter((s): s is number => s !== null);
  if (scores.length === 0) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/**
 * バランスバーの充填率(%)。観測レンジ [min, max] を 4〜100% に写す。
 * 全ブロックの平均を同一スケールで比較できるよう、表示中の平均群から動的にレンジを決める。
 */
function barPct(value: number, min: number, max: number): number {
  if (max <= min) return 60; // レンジが潰れているとき（全ブロック同値）は中央寄り
  return Math.max(4, Math.min(100, ((value - min) / (max - min)) * 100));
}

/** 全体平均からの差分バッジ（up=強い/down=弱い/flat=均衡）。案の deltaTag 準拠。 */
function deltaTag(diff: number): { txt: string; cls: "up" | "down" | "flat" } {
  const rounded = Math.round(diff * 10) / 10;
  if (Math.abs(rounded) < 3) return { txt: "±0", cls: "flat" };
  return { txt: (rounded > 0 ? "+" : "") + rounded.toFixed(1), cls: rounded > 0 ? "up" : "down" };
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

  // ── バランス表示用の派生値（表示のみ・純粋）──────────────────────────────
  // 各ブロックの平均スコア（null は「まだ算出できない」）。
  const groupAvgs = groups.map((g) => groupAvg(g.teams));
  // 全体平均＝チームが入っているブロックの平均の平均（delta・平均線の基準）。
  const activeAvgs = groupAvgs.filter((a): a is number => a !== null);
  const mean =
    activeAvgs.length > 0
      ? activeAvgs.reduce((a, b) => a + b, 0) / activeAvgs.length
      : null;
  // バランスバーの共通スケール。全平均を同一軸で比較できるよう min/max を動的に取り、
  // 端が潰れないよう少し余白を持たせる。
  const barMin = activeAvgs.length > 0 ? Math.min(...activeAvgs) - 3 : 0;
  const barMax = activeAvgs.length > 0 ? Math.max(...activeAvgs) + 3 : 1;
  // スコア偏差（最大平均 - 最小平均の半分）。均衡度の指標。案準拠。
  const spread =
    activeAvgs.length >= 2
      ? (Math.max(...activeAvgs) - Math.min(...activeAvgs)) / 2
      : null;

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

      {/* 保存トースト（下部中央・案準拠の #toast）。即時保存を伝える。 */}
      {saved && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-[color:var(--mp-success)]/50 bg-[color:var(--mp-surface-2)] px-4 py-2.5 text-sm shadow-[var(--mp-e3)]">
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-[color:var(--mp-success)]" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20 6L9 17l-5-5" />
          </svg>
          保存しました
        </div>
      )}

      {/* 観戦者バナー（純粋閲覧・案の .spec-banner）。 */}
      {readOnly && (
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-[color:var(--mp-accent)]/30 bg-gradient-to-r from-[color:var(--mp-accent)]/10 to-transparent px-4 py-3 text-sm text-muted-foreground">
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full bg-[color:var(--mp-live)] shadow-[0_0_10px_var(--mp-live)]"
          />
          <span>
            <span className="font-semibold text-foreground">観戦モード</span>{" "}
            予選ブロックの組み合わせを閲覧しています。編集は主催者のみ可能です。
          </span>
        </div>
      )}

      {/* 対戦表生成済みのロック告知（主催者向け・⑬・案の .lock-banner）。 */}
      {!readOnly && locked && (
        <div className="mt-6 flex items-center gap-3.5 rounded-xl border border-[color:var(--mp-brand)]/40 bg-gradient-to-r from-[color:var(--mp-brand)]/[0.14] to-[color:var(--mp-brand)]/[0.04] px-5 py-3.5 shadow-[var(--mp-e1)]">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[color:var(--mp-brand)]/[0.16] text-[color:var(--mp-brand)]">
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
              <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold">
              対戦表を生成済み — ブロックはロックされています
            </div>
            <div className="mt-0.5 text-[12.5px] text-muted-foreground">
              予選の対戦表が確定したため、ブロックの編集はできません。組み替えると対戦表とブロックがずれて事故ります。変更するには対戦表側で対象の試合を削除してから戻ってください。
            </div>
          </div>
        </div>
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

        {/* 右: 自動パネル＋ブロック群 */}
        <div className="min-w-0 space-y-4">
          {/* 自動でブロック分け（PR-4）＋ ブロック間バランス表示。 */}
          {editable && (
            <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--mp-e1)]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-2.5 text-[15px] font-extrabold">
                    <span className="grid h-6 w-6 place-items-center rounded bg-[color:var(--mp-brand)]/[0.14] text-[color:var(--mp-brand)]">
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M4 7h16M4 12h10M4 17h13" />
                        <circle cx="19" cy="14.5" r="2.5" />
                      </svg>
                    </span>
                    自動ブロック分け
                  </h2>
                  <p className="mt-1.5 max-w-[520px] text-xs leading-relaxed text-muted-foreground">
                    平均スコアが均等になるよう、承認済みの全チーム（{totalTeams}）を指定数のブロックへスネークドラフトで自動配分します。手動での微調整も可能です。
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  {/* ブロック数ステッパー（案の .num-field）。 */}
                  <div className="flex items-center gap-2 rounded-md border border-border bg-[color:var(--mp-surface-3)] py-1 pl-3 pr-1.5">
                    <label className="text-xs text-muted-foreground" htmlFor="draft-block-count">
                      ブロック数
                    </label>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label="ブロック数を減らす"
                        onClick={() =>
                          setDraftBlockCount((n) => Math.max(1, n - 1))
                        }
                        disabled={draftBlockCount <= 1}
                        className="grid h-[26px] w-[26px] place-items-center rounded border border-[color:var(--mp-border-strong)] bg-[color:var(--mp-surface)] text-[15px] leading-none hover:border-[color:var(--mp-fg-subtle)] disabled:opacity-40"
                      >
                        −
                      </button>
                      <span
                        id="draft-block-count"
                        className="w-6 text-center text-[15px] font-semibold tabular-nums"
                      >
                        {draftBlockCount}
                      </span>
                      <button
                        type="button"
                        aria-label="ブロック数を増やす"
                        onClick={() =>
                          setDraftBlockCount((n) =>
                            Math.min(Math.max(1, totalTeams), n + 1),
                          )
                        }
                        disabled={draftBlockCount >= Math.max(1, totalTeams)}
                        className="grid h-[26px] w-[26px] place-items-center rounded border border-[color:var(--mp-border-strong)] bg-[color:var(--mp-surface)] text-[15px] leading-none hover:border-[color:var(--mp-fg-subtle)] disabled:opacity-40"
                      >
                        ＋
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDraftDialogOpen(true)}
                    disabled={
                      isPending ||
                      totalTeams === 0 ||
                      draftBlockCount < 1 ||
                      draftBlockCount > totalTeams
                    }
                    className="rounded-md bg-[color:var(--mp-brand)] px-4 py-2 text-[13px] font-semibold text-[color:var(--mp-on-brand)] shadow-[0_0_0_1px_rgba(255,106,43,.35),0_6px_18px_rgba(255,106,43,.2)] transition hover:bg-[color:var(--mp-brand-hover)] disabled:opacity-45"
                  >
                    自動で振り分け
                  </button>
                </div>
              </div>

              {totalTeams === 0 ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  承認済みのチームがありません。
                </p>
              ) : (
                showScore &&
                groups.length > 0 && (
                  <BalanceOverview
                    groups={groups}
                    groupAvgs={groupAvgs}
                    mean={mean}
                    barMin={barMin}
                    barMax={barMax}
                    spread={spread}
                  />
                )
              )}
            </div>
          )}

          {/* ブロック追加ツールバー（案の .blocks-bar）。 */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="flex items-center gap-2.5 text-base font-extrabold">
              <span
                aria-hidden
                className="h-4 w-0.5 rounded-full bg-[color:var(--mp-brand)]"
              />
              ブロック
              <span className="text-[13px] font-semibold text-[color:var(--mp-fg-subtle)] tabular-nums">
                {groups.length}組
              </span>
            </h2>
            {editable && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newGroupName}
                  maxLength={50}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateGroup();
                  }}
                  placeholder="新しいブロック名…"
                  className="w-44 rounded-md border border-border bg-[color:var(--mp-surface-3)] px-3 py-2 text-sm focus:border-[color:var(--mp-brand)] focus:outline-none focus:ring-2 focus:ring-[color:var(--mp-brand)]/15"
                />
                <button
                  type="button"
                  onClick={handleCreateGroup}
                  disabled={isPending || newGroupName.trim() === ""}
                  className="rounded-md border border-[color:var(--mp-border-strong)] bg-[color:var(--mp-surface-3)] px-4 py-2 text-[13px] font-semibold transition hover:border-[color:var(--mp-fg-subtle)] hover:bg-[color:var(--mp-surface-2)] disabled:opacity-45"
                >
                  ＋ ブロックを追加
                </button>
              </div>
            )}
          </div>

          {groups.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
              {readOnly
                ? "まだブロックがありません。"
                : "ブロックがまだありません。「＋ ブロックを追加」または「自動で振り分け」で作成してください。"}
            </p>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {groups.map((group, i) => (
                <GroupCard
                  key={group.id}
                  group={group}
                  index={i}
                  mean={mean}
                  barMin={barMin}
                  barMax={barMax}
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

      {/* ドラッグ中のプレビュー（持ち上げゴースト）。幅固定・-2deg 回転・オレンジ淵。 */}
      <DragOverlay dropAnimation={null} className="!cursor-grabbing">
        {activeTeam ? (
          <DragGhost team={activeTeam} showScore={showScore} />
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

/**
 * ブロック間バランスオーバービュー（案の .balance）。
 * 各ブロックの平均スコアを共通スケールのバーで横並びにし、全体平均線・delta で
 * 「どのブロックが強い/弱い」を一目で比較できるようにする。スコア偏差で均衡度を示す。
 * showScore=true かつブロックが1つ以上あるときだけ呼ばれる（表示専用・純粋）。
 */
function BalanceOverview({
  groups,
  groupAvgs,
  mean,
  barMin,
  barMax,
  spread,
}: {
  groups: BoardGroup[];
  groupAvgs: (number | null)[];
  mean: number | null;
  barMin: number;
  barMax: number;
  spread: number | null;
}) {
  const meanPct = mean !== null ? barPct(mean, barMin, barMax) : null;
  // 偏差が小さいほど均衡（good）、大きいと偏り（warn）。しきい値は案準拠（半値で ~5 点）。
  const spreadGood = spread !== null && spread <= 5;
  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          ブロック間バランス
        </span>
        <span className="flex items-center gap-1.5 text-[11.5px]">
          <span className="text-[color:var(--mp-fg-subtle)]">スコア偏差</span>
          {spread === null ? (
            <span className="rounded-full px-2 py-0.5 font-semibold text-[color:var(--mp-fg-subtle)]">
              —
            </span>
          ) : (
            <span
              className={`rounded-full px-2 py-0.5 font-semibold ${
                spreadGood
                  ? "border border-[color:var(--mp-success)]/30 bg-[color:var(--mp-success)]/10 text-[color:var(--mp-success)]"
                  : "border border-[color:var(--mp-warning)]/30 bg-[color:var(--mp-warning)]/10 text-[color:var(--mp-warning)]"
              }`}
            >
              ±{Math.round(spread * 10) / 10}
            </span>
          )}
        </span>
      </div>
      <div className="relative flex flex-col gap-2.5">
        {groups.map((g, i) => {
          const avg = groupAvgs[i];
          const color = blockColor(i);
          const delta =
            avg !== null && mean !== null ? deltaTag(avg - mean) : null;
          return (
            <div
              key={g.id}
              className="grid grid-cols-[4.5rem_1fr_8rem] items-center gap-3"
            >
              <span className="flex items-center gap-1.5 truncate text-[12.5px] font-semibold">
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-sm"
                  style={{ backgroundColor: color }}
                />
                <span className="truncate">{g.name}</span>
              </span>
              <div className="relative h-2 rounded-full bg-[color:var(--mp-surface-3)]">
                {avg !== null && (
                  <div
                    className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300"
                    style={{
                      width: `${barPct(avg, barMin, barMax)}%`,
                      background: `linear-gradient(90deg, color-mix(in oklab, ${color} 60%, transparent), ${color})`,
                    }}
                  />
                )}
                {meanPct !== null && (
                  <div
                    aria-hidden
                    className="absolute -top-1 -bottom-1 z-[2] w-0.5 bg-[color:var(--mp-fg-muted)] opacity-75"
                    style={{ left: `${meanPct}%` }}
                  />
                )}
              </div>
              <div className="flex items-baseline justify-end gap-2">
                <span className="text-[13px] font-semibold tabular-nums">
                  {avg === null ? "—" : Math.round(avg * 10) / 10}
                </span>
                <span
                  className={`min-w-[2.75rem] rounded-full px-1.5 py-0.5 text-center text-[10.5px] font-semibold tabular-nums ${
                    delta === null
                      ? "text-[color:var(--mp-fg-subtle)]"
                      : delta.cls === "up"
                        ? "bg-[color:var(--mp-danger)]/10 text-[color:var(--mp-danger)]"
                        : delta.cls === "down"
                          ? "bg-[color:var(--mp-tank)]/10 text-[color:var(--mp-tank)]"
                          : "bg-[color:var(--mp-surface-3)] text-[color:var(--mp-fg-subtle)]"
                  }`}
                >
                  {delta === null ? "—" : delta.txt}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
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
      className={`rounded-2xl border p-4 shadow-[var(--mp-e1)] transition-[box-shadow,background-color,border-color] duration-150 lg:sticky lg:top-6 lg:self-start ${
        isOver && draggable
          ? "border-[color:var(--mp-brand)] bg-[color:var(--mp-brand)]/[0.06] shadow-[0_0_0_2px_var(--mp-brand),0_0_22px_-2px_color-mix(in_oklab,var(--mp-brand)_50%,transparent)]"
          : "border-border bg-card"
      }`}
    >
      <h2 className="flex items-center gap-2.5 text-sm font-bold">
        <span
          aria-hidden
          className="h-4 w-0.5 rounded-full bg-[color:var(--mp-accent)]"
        />
        未割当チーム
        <span className="text-xs font-semibold text-[color:var(--mp-fg-subtle)] tabular-nums">
          ({teams.length})
        </span>
      </h2>
      <p className="mt-2 text-[11px] leading-relaxed text-[color:var(--mp-fg-subtle)]">
        承認済みでまだブロックに入っていないチーム。ブロックへドラッグして振り分けます。
      </p>
      <div className="mt-3 space-y-2">
        {teams.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-[color:var(--mp-fg-subtle)]">
            全チーム振り分け済み 🎉
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

/**
 * 1ブロック（droppable）。Claude Design 案準拠。
 * ヘッダー: カラーバッジ（A/B/C）＋ブロック名＋チーム数＋改名/削除アイコン、
 * その下に平均スコアゲージ（全体平均線＋delta バッジで強さの偏りを可視化）。
 * ボディがドロップゾーン（オレンジ発光）。
 */
function GroupCard({
  group,
  index,
  mean,
  barMin,
  barMax,
  readOnly,
  editable,
  showScore,
  onRename,
  onDelete,
}: {
  group: BoardGroup;
  /** 作成順（カラー・レター割当用）。 */
  index: number;
  /** 全ブロックの平均スコアの平均（delta・平均線の基準）。null なら出さない。 */
  mean: number | null;
  /** バランスバーの共通スケール（表示中の平均群の min/max）。 */
  barMin: number;
  barMax: number;
  readOnly: boolean;
  /** D&D・ブロック削除が可能か（閲覧者・ロック時は false）。 */
  editable: boolean;
  showScore: boolean;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: group.id });
  const color = blockColor(index);
  const avg = groupAvg(group.teams);
  const delta =
    showScore && avg !== null && mean !== null ? deltaTag(avg - mean) : null;

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--mp-e1)]">
      {/* ヘッダー（バッジ＋名前＋操作＋平均ゲージ）。 */}
      <div className="border-b border-border bg-gradient-to-b from-[color:var(--mp-surface-2)] to-transparent px-4 pb-3.5 pt-3.5">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-sm font-extrabold text-[#0B0E14]"
            style={{ backgroundColor: color }}
          >
            {blockLetter(index)}
          </span>
          <span className="min-w-0 flex-1 truncate text-base font-extrabold">
            {group.name}
          </span>
          <span className="shrink-0 text-[11px] text-[color:var(--mp-fg-subtle)] tabular-nums">
            {group.teams.length} チーム
          </span>
          {!readOnly && (
            <div className="flex shrink-0 items-center gap-1">
              {/* 改名はロック中も可（対戦表と整合性に影響しない）。 */}
              <button
                type="button"
                title="改名"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={onRename}
                className="grid h-7 w-7 place-items-center rounded border border-border text-[color:var(--mp-fg-subtle)] transition hover:border-[color:var(--mp-border-strong)] hover:bg-[color:var(--mp-surface-3)] hover:text-foreground"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                </svg>
              </button>
              {/* 削除はロック中は不可（中のチームがプールへ戻り対戦表とずれる）。 */}
              {editable && (
                <button
                  type="button"
                  title="ブロック削除"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={onDelete}
                  className="grid h-7 w-7 place-items-center rounded border border-border text-[color:var(--mp-fg-subtle)] transition hover:border-[color:var(--mp-danger)]/40 hover:bg-[color:var(--mp-danger)]/10 hover:text-[color:var(--mp-danger)]"
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M4 7h16" />
                    <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                    <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>

        {/* 平均スコアゲージ（全体平均線＋delta）。スコア非表示イベントでは出さない。 */}
        {showScore && (
          <div className="mt-3">
            <div className="mb-1.5 flex items-baseline justify-between gap-2.5">
              <span className="text-[11px] text-muted-foreground">平均スコア</span>
              <span className="text-[13px] tabular-nums">
                <span className="font-semibold">
                  {avg === null ? "—" : Math.round(avg * 10) / 10}
                </span>
                {delta && (
                  <span
                    className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold ${
                      delta.cls === "up"
                        ? "bg-[color:var(--mp-danger)]/10 text-[color:var(--mp-danger)]"
                        : delta.cls === "down"
                          ? "bg-[color:var(--mp-tank)]/10 text-[color:var(--mp-tank)]"
                          : "bg-[color:var(--mp-surface-3)] text-[color:var(--mp-fg-subtle)]"
                    }`}
                  >
                    {delta.txt}
                  </span>
                )}
              </span>
            </div>
            <div className="relative h-1.5 overflow-hidden rounded-full bg-[color:var(--mp-surface-3)]">
              {avg !== null && (
                <div
                  className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300"
                  style={{
                    width: `${barPct(avg, barMin, barMax)}%`,
                    background: `linear-gradient(90deg, color-mix(in oklab, ${color} 55%, transparent), ${color})`,
                  }}
                />
              )}
              {mean !== null && (
                <div
                  aria-hidden
                  className="absolute -top-0.5 bottom-[-2px] z-[2] w-0.5 bg-[color:var(--mp-fg-muted)] opacity-70"
                  style={{ left: `${barPct(mean, barMin, barMax)}%` }}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* ボディ（ドロップゾーン）。 */}
      <div
        ref={setNodeRef}
        className={`min-h-[4.5rem] flex-1 space-y-2 p-3 transition-[box-shadow,background-color] duration-150 ${
          isOver && editable
            ? "bg-[color:var(--mp-brand)]/[0.08] shadow-[inset_0_0_0_2px_var(--mp-brand),inset_0_0_30px_-6px_color-mix(in_oklab,var(--mp-brand)_70%,transparent)]"
            : ""
        }`}
      >
        {group.teams.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-2 py-5 text-center text-[11.5px] text-[color:var(--mp-fg-subtle)]">
            {editable ? "チームをここにドロップ" : "チームなし"}
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

/**
 * チームカード（draggable）。カード全体がドラッグ対象。Claude Design 案準拠。
 * 上段: シードチップ（#順位）＋チーム名。下段: AVG（平均スコア）。
 * ホバーで枠・背景を強調＋1px 浮き上げ（案の .team-card:hover）。
 */
function TeamCard({
  team,
  showScore,
  draggable = true,
}: {
  team: BoardTeam;
  showScore: boolean;
  draggable?: boolean;
}) {
  const drag = useDraggable({ id: team.id, disabled: !draggable });
  const { attributes, listeners, setNodeRef, isDragging } = drag;

  return (
    <div
      ref={setNodeRef}
      {...(draggable ? listeners : {})}
      {...(draggable ? attributes : {})}
      className={`rounded-lg border border-border bg-[color:var(--mp-surface-2)] px-3 py-2.5 transition-[border-color,background-color,box-shadow,transform] duration-150 ${
        draggable
          ? "cursor-grab hover:-translate-y-px hover:border-[color:var(--mp-border-strong)] hover:bg-[color:var(--mp-surface-3)] hover:shadow-[var(--mp-e1)]"
          : ""
      } ${isDragging ? "opacity-35" : ""}`}
    >
      <div className="flex items-center gap-2">
        {team.seed !== undefined && (
          <span className="shrink-0 rounded border border-border bg-[color:var(--mp-surface)] px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--mp-fg-subtle)] tabular-nums">
            #{team.seed}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-bold">
          {team.name}
        </span>
      </div>
      {showScore && (
        <div className="mt-1.5 flex items-baseline gap-1.5">
          <span className="text-[9px] font-medium tracking-wider text-[color:var(--mp-fg-subtle)]">
            AVG
          </span>
          <span className="text-sm font-semibold tabular-nums">
            {team.score === null ? "—" : Math.round(team.score * 10) / 10}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * 持ち上げゴースト（DragOverlay 内の表示）。Claude Design の .drag-ghost 準拠。
 * 幅を固定して横長化を防ぎ、-2deg 傾け・オレンジ淵・影＋グローで「掴んで浮かせている」触感を出す。
 */
function DragGhost({
  team,
  showScore,
}: {
  team: BoardTeam;
  showScore: boolean;
}) {
  return (
    <div
      className="w-[236px] rounded-lg border border-[color:var(--mp-brand)] bg-[color:var(--mp-surface-2)] px-3 py-2.5"
      style={{
        transform: "rotate(-2deg)",
        boxShadow:
          "0 18px 40px rgba(0,0,0,.6), 0 0 0 1px color-mix(in oklab, var(--mp-brand) 40%, transparent)",
        opacity: 0.97,
      }}
    >
      <div className="flex items-center gap-2">
        {team.seed !== undefined && (
          <span className="shrink-0 rounded border border-border bg-[color:var(--mp-surface)] px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--mp-fg-subtle)] tabular-nums">
            #{team.seed}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-bold">
          {team.name}
        </span>
      </div>
      {showScore && (
        <div className="mt-1.5 flex items-baseline gap-1.5">
          <span className="text-[9px] font-medium tracking-wider text-[color:var(--mp-fg-subtle)]">
            AVG
          </span>
          <span className="text-sm font-semibold tabular-nums">
            {team.score === null ? "—" : Math.round(team.score * 10) / 10}
          </span>
        </div>
      )}
    </div>
  );
}
