"use client";

import { useMemo, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { scoreToRankLabel } from "@/lib/services/overwatch-ranks";
import {
  teamScore,
  isOverCap,
  type MemberScore,
} from "@/lib/services/team-score";
import {
  createTeam,
  deleteTeam,
  assignMember,
  unassignMember,
} from "./actions";

/** ボード用のメンバー表現（page.tsx で DB から整形して渡す）。 */
export type BoardMember = {
  registrationId: string;
  discordName: string;
  battleTag: string | null;
  preferredRoles: (string | null)[]; // [第1, 第2, 第3]
  finalScore: number | null;
  overrideScore: number | null;
  role: string; // チーム内の担当ロール（未割当は第1希望）
  position: string; // regular / reserve（PR-1 は全員 regular）
};

export type BoardTeam = {
  id: string;
  name: string;
  members: BoardMember[];
};

const ROLE_LABEL: Record<string, string> = {
  tank: "タンク",
  dps: "DPS",
  support: "サポート",
};

const POOL_ID = "pool"; // 未割当プールの droppable id

/** 実効スコア = override ?? final（表示用）。 */
function effective(m: BoardMember): number | null {
  return m.overrideScore ?? m.finalScore;
}

/** BoardMember → Service の MemberScore へ。 */
function toMemberScore(m: BoardMember): MemberScore {
  return {
    id: m.registrationId,
    position: m.position === "reserve" ? "reserve" : "regular",
    finalScore: m.finalScore,
    overrideScore: m.overrideScore,
  };
}

export function TeamsBoard({
  eventId,
  showScore,
  teamScoreCap,
  initialTeams,
  initialUnassigned,
}: {
  eventId: string;
  showScore: boolean;
  teamScoreCap: number | null;
  initialTeams: BoardTeam[];
  initialUnassigned: BoardMember[];
}) {
  const [teams, setTeams] = useState<BoardTeam[]>(initialTeams);
  const [unassigned, setUnassigned] = useState<BoardMember[]>(initialUnassigned);
  const [activeMember, setActiveMember] = useState<BoardMember | null>(null);
  const [newTeamName, setNewTeamName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // 数px動かして初めてドラッグ開始＝その場クリック（ボタン操作）と両立する。
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  /** registrationId からメンバーを全所在から探す。 */
  function findMember(registrationId: string): BoardMember | null {
    const inPool = unassigned.find((m) => m.registrationId === registrationId);
    if (inPool) return inPool;
    for (const t of teams) {
      const m = t.members.find((x) => x.registrationId === registrationId);
      if (m) return m;
    }
    return null;
  }

  function handleDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    setActiveMember(findMember(id));
  }

  /**
   * ドラッグ完了。楽観的にローカル状態を更新してから Server Action を呼ぶ。
   * Action が失敗したら元状態へロールバックしてエラー表示する。
   */
  function handleDragEnd(e: DragEndEvent) {
    setActiveMember(null);
    const { active, over } = e;
    if (!over) return;

    const registrationId = String(active.id);
    const overId = String(over.id);
    const member = findMember(registrationId);
    if (!member) return;

    // 現在の所在（プール or どのチームか）。
    const fromTeam = teams.find((t) =>
      t.members.some((m) => m.registrationId === registrationId),
    );
    const fromTeamId = fromTeam?.id ?? null;
    const toTeamId = overId === POOL_ID ? null : overId;

    if (fromTeamId === toTeamId) return; // 同じ場所なら何もしない。

    const prevTeams = teams;
    const prevUnassigned = unassigned;

    // 楽観更新: いったん全所在から外し、移動先へ入れる。
    const detachedTeams = teams.map((t) => ({
      ...t,
      members: t.members.filter((m) => m.registrationId !== registrationId),
    }));
    const detachedPool = unassigned.filter(
      (m) => m.registrationId !== registrationId,
    );

    setError(null);

    if (toTeamId === null) {
      // プールへ戻す。
      setTeams(detachedTeams);
      setUnassigned([...detachedPool, { ...member, position: "regular" }]);
      startTransition(async () => {
        const r = await unassignMember(registrationId);
        if (r.error) {
          setTeams(prevTeams);
          setUnassigned(prevUnassigned);
          setError(r.error);
        }
      });
      return;
    }

    // チームへ割当（移動）。割当ロールは本人の第1希望をデフォルトに。
    const role = member.preferredRoles[0] ?? member.role ?? "tank";
    setUnassigned(detachedPool);
    setTeams(
      detachedTeams.map((t) =>
        t.id === toTeamId
          ? { ...t, members: [...t.members, { ...member, role }] }
          : t,
      ),
    );
    startTransition(async () => {
      const r = await assignMember({ registrationId, teamId: toTeamId, role });
      if (r.error) {
        setTeams(prevTeams);
        setUnassigned(prevUnassigned);
        setError(r.error);
      }
    });
  }

  function handleCreateTeam() {
    const name = newTeamName.trim();
    if (!name) return;
    setError(null);
    startTransition(async () => {
      const r = await createTeam(eventId, name);
      if (r.error) {
        setError(r.error);
        return;
      }
      setNewTeamName("");
      // 作成結果は revalidate で反映される（簡潔さ優先で楽観追加はしない）。
    });
  }

  function handleDeleteTeam(teamId: string) {
    const target = teams.find((t) => t.id === teamId);
    if (!target) return;
    setError(null);
    const prevTeams = teams;
    const prevUnassigned = unassigned;
    // 楽観: チームを消し、所属メンバーをプールへ戻す。
    setTeams(teams.filter((t) => t.id !== teamId));
    setUnassigned([
      ...unassigned,
      ...target.members.map((m) => ({ ...m, position: "regular" })),
    ]);
    startTransition(async () => {
      const r = await deleteTeam(teamId);
      if (r.error) {
        setTeams(prevTeams);
        setUnassigned(prevUnassigned);
        setError(r.error);
      }
    });
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {error && (
        <p className="mt-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[20rem_1fr]">
        {/* 左: 未割当プール */}
        <Pool members={unassigned} showScore={showScore} />

        {/* 右: チーム群 */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newTeamName}
              maxLength={50}
              onChange={(e) => setNewTeamName(e.target.value)}
              placeholder="チーム名"
              className="w-48 rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={handleCreateTeam}
              disabled={isPending || newTeamName.trim() === ""}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              + チームを追加
            </button>
          </div>

          {teams.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              チームがまだありません。「+ チームを追加」で作成してください。
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {teams.map((team) => (
                <TeamCard
                  key={team.id}
                  team={team}
                  showScore={showScore}
                  teamScoreCap={teamScoreCap}
                  onDelete={() => handleDeleteTeam(team.id)}
                  onUnassign={(rid) => {
                    // ✕ ボタン: 即解除（楽観）。
                    const prevTeams = teams;
                    const prevUnassigned = unassigned;
                    const m = team.members.find(
                      (x) => x.registrationId === rid,
                    );
                    if (!m) return;
                    setError(null);
                    setTeams(
                      teams.map((t) =>
                        t.id === team.id
                          ? {
                              ...t,
                              members: t.members.filter(
                                (x) => x.registrationId !== rid,
                              ),
                            }
                          : t,
                      ),
                    );
                    setUnassigned([
                      ...unassigned,
                      { ...m, position: "regular" },
                    ]);
                    startTransition(async () => {
                      const r = await unassignMember(rid);
                      if (r.error) {
                        setTeams(prevTeams);
                        setUnassigned(prevUnassigned);
                        setError(r.error);
                      }
                    });
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ドラッグ中のプレビュー。 */}
      <DragOverlay>
        {activeMember ? (
          <MemberCard member={activeMember} showScore={showScore} overlay />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/** 未割当プール（droppable）。 */
function Pool({
  members,
  showScore,
}: {
  members: BoardMember[];
  showScore: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: POOL_ID });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border p-4 ${
        isOver ? "border-primary bg-primary/5" : "border-border bg-card"
      }`}
    >
      <h2 className="text-sm font-semibold text-muted-foreground">
        未割当の応募者 ({members.length})
      </h2>
      <div className="mt-3 space-y-2">
        {members.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            未割当の参加確定者はいません。
          </p>
        ) : (
          members.map((m) => (
            <MemberCard
              key={m.registrationId}
              member={m}
              showScore={showScore}
            />
          ))
        )}
      </div>
    </div>
  );
}

/** チームカード（droppable）。カード内はロール行ではなくメンバーリスト＋ロールラベル。 */
function TeamCard({
  team,
  showScore,
  teamScoreCap,
  onDelete,
  onUnassign,
}: {
  team: BoardTeam;
  showScore: boolean;
  teamScoreCap: number | null;
  onDelete: () => void;
  onUnassign: (registrationId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: team.id });

  const score = useMemo(
    () => teamScore(team.members.map(toMemberScore)),
    [team.members],
  );
  const overCap = isOverCap(score, teamScoreCap);

  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border p-4 ${
        isOver ? "border-primary bg-primary/5" : "border-border bg-card"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{team.name}</h3>
          {showScore && (
            <p className="mt-0.5 text-xs">
              平均{" "}
              <span
                className={`font-semibold tabular-nums ${
                  overCap ? "text-destructive" : "text-foreground"
                }`}
              >
                {score === null ? "—" : score.toFixed(1)}
              </span>
              {teamScoreCap !== null && (
                <span className="text-muted-foreground">
                  {" "}
                  / 上限 {teamScoreCap.toFixed(1)}{" "}
                  {score !== null &&
                    (overCap ? (
                      <span className="text-destructive">⚠ 超過</span>
                    ) : (
                      <span className="text-primary">✓ 上限内</span>
                    ))}
                </span>
              )}
            </p>
          )}
        </div>
        <button
          type="button"
          // ドラッグ開始（active 化）を抑止してからクリック処理する。
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onDelete}
          className="text-xs text-muted-foreground hover:text-destructive"
        >
          チーム削除
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {team.members.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
            ＋ ここにドラッグで追加
          </p>
        ) : (
          team.members.map((m) => (
            <MemberCard
              key={m.registrationId}
              member={m}
              showScore={showScore}
              onUnassign={() => onUnassign(m.registrationId)}
            />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * 応募者カード（draggable）。カード全体がドラッグ対象（ハンドルなし）。
 * ✕（解除）ボタンは pointer-down 伝播を止めて誤ドラッグを防ぐ。
 */
function MemberCard({
  member,
  showScore,
  onUnassign,
  overlay = false,
}: {
  member: BoardMember;
  showScore: boolean;
  onUnassign?: () => void;
  overlay?: boolean;
}) {
  // overlay（DragOverlay 内の表示）は draggable にしない。
  const draggable = useDraggable({ id: member.registrationId });
  const { attributes, listeners, setNodeRef, isDragging } = overlay
    ? ({} as ReturnType<typeof useDraggable>)
    : draggable;

  const roles = member.preferredRoles.filter((r): r is string => !!r);
  const score = effective(member);

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      {...(overlay ? {} : listeners)}
      {...(overlay ? {} : attributes)}
      className={`cursor-grab rounded-lg border border-border bg-muted/40 px-3 py-2 ${
        isDragging ? "opacity-40" : ""
      } ${overlay ? "shadow-lg" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{member.discordName}</span>
        <div className="flex items-center gap-2">
          {showScore && (
            <span className="text-sm font-semibold tabular-nums">
              {score === null ? "—" : Math.round(score * 10) / 10}
            </span>
          )}
          {onUnassign && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onUnassign}
              className="text-xs text-muted-foreground hover:text-destructive"
              aria-label="チームから外す"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">
        {roles.length > 0 && (
          <span>希望 {roles.map((r) => ROLE_LABEL[r] ?? r).join("→")}</span>
        )}
        {showScore && (
          <span>
            {roles.length > 0 ? " ／ " : ""}
            {scoreToRankLabel(score)}
          </span>
        )}
      </div>
    </div>
  );
}
