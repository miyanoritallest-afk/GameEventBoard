"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
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
  teamScore,
  isOverCap,
  swapCandidates,
  type MemberScore,
} from "@/lib/services/team-score";
import {
  createTeam,
  deleteTeam,
  assignMember,
  unassignMember,
  updateMember,
  swapMembers,
  submitSelfTeam,
  cancelSelfTeam,
  approveTeam,
  rejectTeam,
  setTeamCaptain,
} from "./actions";

/** OW2 のロール順（ロール行の並び）。 */
const ROLE_ORDER = ["tank", "dps", "support"] as const;
type RoleKey = (typeof ROLE_ORDER)[number];

/** ボード用のメンバー表現（page.tsx で DB から整形して渡す）。 */
export type BoardMember = {
  registrationId: string;
  /** 公開表示名（登録名 ?? Discord名）。全立場で主表示。 */
  displayName: string;
  /** 素のDiscord名（内部識別）。運営のみに渡す（観戦者・応募者には null）。 */
  discordName: string | null;
  battleTag: string | null;
  preferredRoles: (string | null)[]; // [第1, 第2, 第3]
  finalScore: number | null;
  overrideScore: number | null;
  role: string; // チーム内の担当ロール（未割当は第1希望）
  position: string; // regular / reserve
};

/** チーム応募の承認状態。organizer 振り分けは 'approved'、self 確定は 'pending' で生まれる。 */
export type TeamStatus = "pending" | "approved" | "rejected";

export type BoardTeam = {
  id: string;
  name: string;
  status: TeamStatus;
  /** self 確定時の代表（応募 id）。organizer 振り分けは null。 */
  captainRegistrationId: string | null;
  /** 確定（作成）日時の ISO 文字列。承認待ちの応募順（先着）表示に使う。 */
  createdAt: string | null;
  members: BoardMember[];
};

const ROLE_LABEL: Record<string, string> = {
  tank: "タンク",
  dps: "DPS",
  support: "サポート",
};

/**
 * OW2 の3ロールのアイコンと識別色（CSS 変数）。希望ロール・担当ロール・フィルタで共通利用。
 * 色は globals.css の .theme-matchpoint（--mp-tank/dps/support）。
 * アイコンは OW2 公式ロールマーク準拠のシンプルなラインSVG（タンク=盾・DPS=照準・サポート=十字）。
 * Claude Design の生成物に合わせ、ゲーム内アイコンから一目でロールを連想できるようにする。
 */
const ROLE_COLOR: Record<string, string> = {
  tank: "var(--mp-tank)",
  dps: "var(--mp-dps)",
  support: "var(--mp-support)",
};

/** OW2 ロールマーク準拠のパス（stroke で描く。fill は none）。 */
function RoleGlyph({ role, px }: { role: string; px: number }) {
  const common = {
    viewBox: "0 0 24 24",
    width: px,
    height: px,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (role === "tank") {
    // 盾のシルエット。
    return (
      <svg {...common} aria-hidden>
        <path d="M12 3l7 2.6v5.2c0 4.3-3 7.2-7 8.7-4-1.5-7-4.4-7-8.7V5.6z" />
      </svg>
    );
  }
  if (role === "dps") {
    // 照準（円＋十字）。
    return (
      <svg {...common} aria-hidden>
        <circle cx="12" cy="12" r="6.5" />
        <line x1="12" y1="1.5" x2="12" y2="5" />
        <line x1="12" y1="19" x2="12" y2="22.5" />
        <line x1="1.5" y1="12" x2="5" y2="12" />
        <line x1="19" y1="12" x2="22.5" y2="12" />
      </svg>
    );
  }
  if (role === "support") {
    // 十字（プラス）。
    return (
      <svg {...common} aria-hidden>
        <path d="M12 5.5v13M5.5 12h13" />
      </svg>
    );
  }
  return null;
}

/**
 * ロールのアイコンチップ（色付き丸背景＋アイコン）。未知ロールは何も出さない。
 * rank を渡すと右上に希望順の数字バッジ（①②③相当）を出す（Claude Design の .pref .rank）。
 * 第1希望は背景を濃く（.18）、第2/3希望は小さく薄く（opacity）して優先度を一目で示す。
 */
function RoleIcon({
  role,
  size = 20,
  dim = false,
  title,
  rank,
}: {
  role: string;
  /** チップの一辺(px)。 */
  size?: number;
  /** 第2・3希望など控えめ表示（半透明）。 */
  dim?: boolean;
  title?: string;
  /** 希望順（1始まり）。渡すと右上に数字バッジを出す。 */
  rank?: number;
}) {
  const color = ROLE_COLOR[role];
  if (!color) return null;
  return (
    <span
      title={title ?? ROLE_LABEL[role] ?? role}
      aria-label={ROLE_LABEL[role] ?? role}
      className="relative inline-flex shrink-0 items-center justify-center rounded-md"
      style={{
        width: size,
        height: size,
        color,
        // 第1希望（dim=false）は背景を濃く（.18）、第2/3（dim）は薄く（.12）。
        backgroundColor: `color-mix(in oklab, ${color} ${dim ? 12 : 18}%, transparent)`,
        opacity: dim ? 0.7 : 1,
      }}
    >
      <RoleGlyph role={role} px={Math.round(size * 0.62)} />
      {rank !== undefined && (
        <span
          aria-hidden
          className="absolute -right-1.5 -top-1.5 grid h-3.5 w-3.5 place-items-center rounded-full border border-[color:var(--mp-border-strong)] bg-[color:var(--mp-surface)] text-[8px] font-semibold leading-none text-[color:var(--mp-fg-muted)] tabular-nums"
        >
          {rank}
        </span>
      )}
    </span>
  );
}

/**
 * 希望ロールの表示（第1〜第3希望）。矢印区切りをやめ、アイコンで並べて優先度を視覚化する
 * （第1希望を大きく濃く・第2/3希望を小さく薄く）＋右上に希望順の数字バッジ。null/空は落とす。
 */
function PreferredRoles({ roles }: { roles: (string | null)[] }) {
  const list = roles.filter((r): r is string => !!r);
  if (list.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      {list.map((r, i) => (
        <RoleIcon
          key={`${r}-${i}`}
          role={r}
          size={i === 0 ? 26 : i === 1 ? 22 : 19}
          dim={i > 0}
          rank={i + 1}
          title={`第${i + 1}希望: ${ROLE_LABEL[r] ?? r}`}
        />
      ))}
    </span>
  );
}

const POOL_ID = "pool"; // 未割当プールの droppable id

/**
 * droppable id を「チームID:position[:role]」で構成する（ゾーン識別）。
 * role_swap 不可の出場ゾーンはロール行ごとに droppable を作るため role を含める。
 */
function zoneId(
  teamId: string,
  position: "regular" | "reserve",
  role?: RoleKey,
): string {
  return role ? `${teamId}:${position}:${role}` : `${teamId}:${position}`;
}

/** droppable id を {teamId, position, role?} に分解する。pool は null。 */
function parseZone(
  id: string,
): { teamId: string; position: "regular" | "reserve"; role?: RoleKey } | null {
  if (id === POOL_ID) return null;
  const [teamId, position, role] = id.split(":");
  return {
    teamId,
    position: position === "reserve" ? "reserve" : "regular",
    role: (role as RoleKey) || undefined,
  };
}

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

/** ローカル試算チームの id プレフィックス（DB 保存しない）。 */
const SIM_TEAM_ID = "sim-1";

/**
 * ドロップ判定（⑫の付随改善）。
 * 既定の rectIntersection は「ドラッグ中カードの矩形がドロップ先と交差する面積」で
 * 判定するため、横長の応募者カードだと領域へ深く押し込まないとヒットしない。
 * ポインタ位置が領域内かで判定する pointerWithin を第一にし、どのゾーンにも
 * 重なっていないとき（プールの隙間など）だけ closestCenter にフォールバックする。
 * これで「カーソルが乗れば浅い位置でも受け付ける」直感的な挙動になる。
 */
const dropCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : closestCenter(args);
};

/** 未割当プールの並び替えキー（⑫）。応募者が多いとき探しやすくする。 */
type PoolSort =
  | "applied" // 全体（応募順＝初期配列の順）
  | "score" // 全体（スコア順・降順）
  | "role_tank" // 第1希望タンクのみ（スコア順）
  | "role_dps" // 第1希望DPSのみ（スコア順）
  | "role_support"; // 第1希望サポートのみ（スコア順）

const POOL_SORT_OPTIONS: { value: PoolSort; label: string }[] = [
  { value: "applied", label: "全体（応募順）" },
  { value: "score", label: "全体（スコア順）" },
  { value: "role_tank", label: "第1希望: タンク（スコア順）" },
  { value: "role_dps", label: "第1希望: DPS（スコア順）" },
  { value: "role_support", label: "第1希望: サポート（スコア順）" },
];

/** PoolSort のロール系キー → 第1希望ロール値。 */
const POOL_SORT_ROLE: Partial<Record<PoolSort, RoleKey>> = {
  role_tank: "tank",
  role_dps: "dps",
  role_support: "support",
};

/**
 * 未割当プールを並び替え/絞り込みする（表示用の派生・純粋）。
 * - applied: 元の順序を保つ（応募順）。
 * - score: 実効スコア降順（null は末尾）。
 * - role_*: 第1希望が該当ロールの人だけに絞り、スコア降順。
 * 元配列は破壊しない（応募順を失わないため）。
 */
function sortPool(members: BoardMember[], sort: PoolSort): BoardMember[] {
  const byScoreDesc = (a: BoardMember, b: BoardMember) => {
    const sa = effective(a);
    const sb = effective(b);
    if (sa === null && sb === null) return 0;
    if (sa === null) return 1; // null は末尾
    if (sb === null) return -1;
    return sb - sa;
  };
  if (sort === "applied") return members;
  if (sort === "score") return [...members].sort(byScoreDesc);
  const role = POOL_SORT_ROLE[sort];
  return members
    .filter((m) => (m.preferredRoles[0] ?? null) === role)
    .sort(byScoreDesc);
}

/** 確定日時を JST の「MM/DD HH:mm」で表示する（承認待ちの応募順表示用）。 */
function formatSubmittedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(d);
}

export function TeamsBoard({
  eventId,
  readOnly = false,
  isOrganizer = false,
  spectator = false,
  selfFormation = false,
  myRegistrationId = null,
  showScore,
  roleSwapAllowed,
  teamSize,
  teamScoreCap,
  initialTeams,
  initialUnassigned,
}: {
  eventId: string;
  /** 試算モード（応募者の閲覧）。D&D で組み替えできるが保存しない・操作ボタンを隠す。 */
  readOnly?: boolean;
  /**
   * 観戦者（非ログイン/非参加者）か。試算（シミュレーション枠）も未割当プールも出さず、
   * 確定したチーム一覧だけを純粋閲覧する（フェーズB）。readOnly かつ非応募者のとき true。
   */
  spectator?: boolean;
  /** 主催者か（承認/却下ボタンの出し分け）。 */
  isOrganizer?: boolean;
  /** team_formation='self' のイベントか（応募者の確定ボタンの出し分け）。 */
  selfFormation?: boolean;
  /** 閲覧者（応募者）の応募 id。自分が代表のチームの取り下げ判定に使う。 */
  myRegistrationId?: string | null;
  showScore: boolean;
  roleSwapAllowed: boolean;
  teamSize: number;
  teamScoreCap: number | null;
  initialTeams: BoardTeam[];
  initialUnassigned: BoardMember[];
}) {
  // 試算モード（応募者の閲覧）では、実チームの有無に関わらず「シミュレーション」枠を
  // 常に先頭に1枚用意する（自分の試算用。DB 保存しない。id はローカル専用プレフィックス）。
  // 実チームがあれば、その後ろに参考として表示する（試算で組み替えても保存されない）。
  // 観戦者（spectator）には試算枠を出さず、確定チームだけを純粋閲覧させる。
  const [teams, setTeams] = useState<BoardTeam[]>(() =>
    readOnly && !spectator
      ? [
          {
            id: SIM_TEAM_ID,
            name: "シミュレーション",
            status: "pending",
            captainRegistrationId: null,
            createdAt: null,
            members: [],
          },
          ...initialTeams,
        ]
      : initialTeams,
  );
  const [unassigned, setUnassigned] = useState<BoardMember[]>(initialUnassigned);
  // 未割当プールの並び替え（⑫・表示のみ。元の応募順は state 側で保持）。
  const [poolSort, setPoolSort] = useState<PoolSort>("applied");
  const [activeMember, setActiveMember] = useState<BoardMember | null>(null);
  const [newTeamName, setNewTeamName] = useState("");
  // self 確定（試算モード）のチーム名入力。
  const [selfTeamName, setSelfTeamName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // 保存フィードバック。表示中フラグ＋更新カウンタ（連続保存でタイマーを延長する）。
  const [saved, setSaved] = useState(false);
  const [savedTick, setSavedTick] = useState(0);
  const [isPending, startTransition] = useTransition();

  /** 保存成功を一定時間「✓ 保存しました」と示す。 */
  function flashSaved() {
    setSaved(true);
    setSavedTick((n) => n + 1);
  }

  // 保存表示は最後の保存から 2 秒で自動的に消す（savedTick で延長）。
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(t);
  }, [saved, savedTick]);

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

  /** registrationId が今どのチームに属すか（プールなら null）。 */
  function findOwningTeamId(registrationId: string): string | null {
    return (
      teams.find((t) =>
        t.members.some((m) => m.registrationId === registrationId),
      )?.id ?? null
    );
  }

  /** 楽観更新の共通ロールバック。 */
  function rollback(prevTeams: BoardTeam[], prevUnassigned: BoardMember[], msg: string) {
    setTeams(prevTeams);
    setUnassigned(prevUnassigned);
    setError(msg);
  }

  function handleDragStart(e: DragStartEvent) {
    setActiveMember(findMember(String(e.active.id)));
  }

  /**
   * ドラッグ完了。ドロップ先（プール / チームの出場ゾーン / リザーブゾーン）に応じて
   * 楽観更新し、対応する Server Action を呼ぶ。失敗時はロールバック。
   */
  function handleDragEnd(e: DragEndEvent) {
    setActiveMember(null);
    const { active, over } = e;
    if (!over) return;

    const registrationId = String(active.id);
    const member = findMember(registrationId);
    if (!member) return;

    const fromTeamId = findOwningTeamId(registrationId);
    const dest = parseZone(String(over.id)); // null=プール
    const toTeamId = dest?.teamId ?? null;

    // 試算モードでは自分のシミュレーション枠以外の実チームへは入れない（②の保険）。
    // ドラッグ元を固定しているので通常ここには来ないが、念のため弾く。
    if (readOnly && toTeamId !== null && toTeamId !== SIM_TEAM_ID) return;
    const toPosition = dest?.position ?? "regular";
    // 出場ロール行へのドロップなら role 確定。無ければ既存/第1希望を維持。
    const toRole = dest?.role ?? member.preferredRoles[0] ?? member.role ?? "tank";

    // 変化なし（同じチーム・同じゾーン・同じロール、またはプール→プール）なら何もしない。
    if (
      fromTeamId === toTeamId &&
      (toTeamId === null ||
        (member.position === toPosition &&
          (dest?.role === undefined || member.role === toRole)))
    ) {
      return;
    }

    const prevTeams = teams;
    const prevUnassigned = unassigned;
    setError(null);

    // 全所在から外す（楽観）。
    const detachedTeams = teams.map((t) => ({
      ...t,
      members: t.members.filter((m) => m.registrationId !== registrationId),
    }));
    const detachedPool = unassigned.filter(
      (m) => m.registrationId !== registrationId,
    );

    // --- プールへ戻す ---
    if (toTeamId === null) {
      setTeams(detachedTeams);
      setUnassigned([...detachedPool, { ...member, position: "regular" }]);
      if (readOnly) return; // 試算モードは保存しない。
      startTransition(async () => {
        const r = await unassignMember(registrationId);
        if (r.error) rollback(prevTeams, prevUnassigned, r.error);
        else flashSaved();
      });
      return;
    }

    // --- 同一チーム内の移動（ゾーン or ロール行）= position/role 更新のみ ---
    if (fromTeamId === toTeamId) {
      setUnassigned(detachedPool);
      setTeams(
        detachedTeams.map((t) =>
          t.id === toTeamId
            ? {
                ...t,
                members: [
                  ...t.members,
                  { ...member, position: toPosition, role: toRole },
                ],
              }
            : t,
        ),
      );
      if (readOnly) return; // 試算モードは保存しない。
      startTransition(async () => {
        const r = await updateMember({
          registrationId,
          position: toPosition,
          role: toRole,
        });
        if (r.error) rollback(prevTeams, prevUnassigned, r.error);
        else flashSaved();
      });
      return;
    }

    // --- 別所からチームへ割当（プール/別チーム → チームの指定ゾーン）---
    setUnassigned(detachedPool);
    setTeams(
      detachedTeams.map((t) =>
        t.id === toTeamId
          ? {
              ...t,
              members: [
                ...t.members,
                { ...member, role: toRole, position: toPosition },
              ],
            }
          : t,
      ),
    );
    if (readOnly) return; // 試算モードは保存しない。
    startTransition(async () => {
      // assign は position=regular で割当（role 指定）。リザーブゾーンなら続けて
      // position を reserve へ更新する。
      const r = await assignMember({
        registrationId,
        teamId: toTeamId,
        role: toRole,
      });
      if (r.error) {
        rollback(prevTeams, prevUnassigned, r.error);
        return;
      }
      if (toPosition === "reserve") {
        const r2 = await updateMember({ registrationId, position: "reserve" });
        if (r2.error) {
          rollback(prevTeams, prevUnassigned, r2.error);
          return;
        }
      }
      flashSaved();
    });
  }

  function handleCreateTeam() {
    const name = newTeamName.trim();
    if (!name) return;
    setError(null);
    startTransition(async () => {
      const r = await createTeam(eventId, name);
      if (r.error || !r.teamId) {
        setError(r.error ?? "チームの作成に失敗しました。");
        return;
      }
      setTeams((prev) => [
        ...prev,
        {
          id: r.teamId as string,
          name,
          status: "approved",
          captainRegistrationId: null,
          createdAt: new Date().toISOString(),
          members: [],
        },
      ]);
      setNewTeamName("");
      flashSaved();
    });
  }

  function handleDeleteTeam(teamId: string) {
    const target = teams.find((t) => t.id === teamId);
    if (!target) return;
    setError(null);
    const prevTeams = teams;
    const prevUnassigned = unassigned;
    setTeams(teams.filter((t) => t.id !== teamId));
    setUnassigned([
      ...unassigned,
      ...target.members.map((m) => ({ ...m, position: "regular" })),
    ]);
    startTransition(async () => {
      const r = await deleteTeam(teamId);
      if (r.error) rollback(prevTeams, prevUnassigned, r.error);
      else flashSaved();
    });
  }

  /** ✕（チームから外す）。registration 単位で解除しプールへ戻す。 */
  function handleUnassign(registrationId: string) {
    const member = findMember(registrationId);
    if (!member) return;
    setError(null);
    const prevTeams = teams;
    const prevUnassigned = unassigned;
    setTeams(
      teams.map((t) => ({
        ...t,
        members: t.members.filter((m) => m.registrationId !== registrationId),
      })),
    );
    setUnassigned([...unassigned, { ...member, position: "regular" }]);
    startTransition(async () => {
      const r = await unassignMember(registrationId);
      if (r.error) rollback(prevTeams, prevUnassigned, r.error);
      else flashSaved();
    });
  }

  /** 交代実行: out（レギュラー）と in（リザーブ）の position を入れ替える。 */
  function handleSwap(teamId: string, outId: string, inId: string) {
    setError(null);
    const prevTeams = teams;
    const prevUnassigned = unassigned;
    setTeams(
      teams.map((t) =>
        t.id === teamId
          ? {
              ...t,
              members: t.members.map((m) => {
                if (m.registrationId === outId) return { ...m, position: "reserve" };
                if (m.registrationId === inId) return { ...m, position: "regular" };
                return m;
              }),
            }
          : t,
      ),
    );
    startTransition(async () => {
      const r = await swapMembers({
        outRegistrationId: outId,
        inRegistrationId: inId,
      });
      if (r.error) rollback(prevTeams, prevUnassigned, r.error);
      else flashSaved();
    });
  }

  /**
   * 代表（captain）を指名する（主催者のみ・実機FB）。
   * 指名すると、そのメンバーは自チームの試合結果を入力できるようになる。
   * 楽観更新でチームの captainRegistrationId を差し替え、失敗時はロールバック。
   */
  function handleSetCaptain(teamId: string, registrationId: string) {
    setError(null);
    const prevTeams = teams;
    const prevUnassigned = unassigned;
    setTeams(
      teams.map((t) =>
        t.id === teamId
          ? { ...t, captainRegistrationId: registrationId }
          : t,
      ),
    );
    startTransition(async () => {
      const r = await setTeamCaptain(teamId, registrationId);
      if (r.error) rollback(prevTeams, prevUnassigned, r.error);
      else flashSaved();
    });
  }

  /**
   * self 確定（試算モード）。シミュレーション枠 sim-1 の中身をサーバーへ送って確定する。
   * 成功したらページが revalidate され、確定チームが pending として表示される。
   */
  function handleSubmitSelfTeam() {
    if (!myRegistrationId) return;
    const sim = teams.find((t) => t.id === SIM_TEAM_ID);
    if (!sim || sim.members.length === 0) return;
    // 代表（自分）がメンバーに含まれることを確認（含まれなければサーバーでも弾く）。
    if (!sim.members.some((m) => m.registrationId === myRegistrationId)) {
      setError("自分をメンバーに含めてください。");
      return;
    }
    const name = selfTeamName.trim();
    if (!name) {
      setError("チーム名を入力してください。");
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await submitSelfTeam(eventId, {
        name,
        captainRegistrationId: myRegistrationId,
        members: sim.members.map((m) => ({
          registrationId: m.registrationId,
          role: (m.role as "tank" | "dps" | "support") ?? "tank",
          position: m.position === "reserve" ? "reserve" : "regular",
        })),
      });
      if (r.error) {
        setError(r.error);
        return;
      }
      setSelfTeamName("");
      flashSaved();
    });
  }

  /** self 確定チームの取り下げ（代表本人・pending のみ）。楽観的にリストから外す。 */
  function handleCancelSelfTeam(teamId: string) {
    setError(null);
    const prevTeams = teams;
    setTeams((cur) => cur.filter((t) => t.id !== teamId));
    startTransition(async () => {
      const r = await cancelSelfTeam(teamId);
      if (r.error) {
        setTeams(prevTeams);
        setError(r.error);
      } else flashSaved();
    });
  }

  /**
   * 主催者: self チームの承認。楽観的に status を approved へ更新する
   * （承認待ちセクションから消え、成立チームとして表示される）。失敗時はロールバック。
   */
  function handleApproveTeam(teamId: string) {
    setError(null);
    const prevTeams = teams;
    setTeams((cur) =>
      cur.map((t) => (t.id === teamId ? { ...t, status: "approved" } : t)),
    );
    startTransition(async () => {
      const r = await approveTeam(teamId);
      if (r.error) {
        setTeams(prevTeams);
        setError(r.error);
      } else flashSaved();
    });
  }

  /** 主催者: self チームの却下。楽観的に status を rejected へ更新する。失敗時はロールバック。 */
  function handleRejectTeam(teamId: string) {
    setError(null);
    const prevTeams = teams;
    setTeams((cur) =>
      cur.map((t) => (t.id === teamId ? { ...t, status: "rejected" } : t)),
    );
    startTransition(async () => {
      const r = await rejectTeam(teamId);
      if (r.error) {
        setTeams(prevTeams);
        setError(r.error);
      } else flashSaved();
    });
  }

  // 主催者の承認待ち（pending）チーム。確定が早い順（先着）に並べる。
  // 先に申請したチームを承認・後を却下する判断のため、応募順を可視化する。
  const pendingTeams = useMemo(
    () =>
      isOrganizer
        ? teams
            .filter((t) => t.status === "pending")
            .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))
        : [],
    [isOrganizer, teams],
  );

  return (
    <DndContext
      id="teams-board-dnd"
      sensors={sensors}
      // 横長カードでも浅い位置でドロップを受け付ける（ポインタ位置基準）。
      collisionDetection={dropCollision}
      // 応募者が多いと未割当プールが縦に長くなるため、ドラッグ中の端で
      // 自動スクロールを効かせる（⑫。チームへ運ぶ移動距離を緩和）。
      autoScroll={{ threshold: { x: 0, y: 0.2 } }}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {error && (
        <p className="mt-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* 保存フィードバック（右下に数秒表示）。即時保存されたことを伝える。 */}
      {saved && (
        <div className="fixed bottom-6 right-6 z-50 rounded-md border border-primary/50 bg-primary/10 px-4 py-2 text-sm text-primary shadow-lg">
          ✓ 保存しました
        </div>
      )}

      {/* 観戦者: 純粋閲覧のバナー（試算なし）。 */}
      {spectator && (
        <p className="mt-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          参加チームを閲覧しています。
        </p>
      )}

      {/* 試算モードのバナー（応募者の閲覧）。保存されないことを明示する。 */}
      {readOnly && !spectator && (
        <p className="mt-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          試算モードで閲覧しています。自由に組み替えてチーム平均を試算できますが、
          <span className="font-medium">変更は保存されません</span>。
          {selfFormation && myRegistrationId
            ? "組みたいメンバーを「シミュレーション」枠に入れ、下の「このチームで確定」で主催者の承認に申請できます。"
            : "（チームの確定は主催者が行います。）"}
        </p>
      )}

      {/* 主催者: self 応募の承認待ちセクション（編成画面上部）。 */}
      {isOrganizer && pendingTeams.length > 0 && (
        <div className="mt-4 rounded-2xl border border-[color:var(--mp-warning)]/40 bg-[color:var(--mp-warning)]/5 p-4">
          <h2 className="text-sm font-semibold text-[color:var(--mp-warning)]">
            承認待ちのチーム応募（{pendingTeams.length}）
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            応募者が確定したチームです。承認すると参加チームとして成立し、定員にカウントされます。
            定員が埋まる場合は<span className="font-medium">申請が早い順（#1から）</span>に承認してください。
          </p>
          <div className="mt-3 space-y-2">
            {pendingTeams.map((team, pIndex) => {
              const score = teamScore(
                team.members
                  .filter((m) => m.position !== "reserve")
                  .map(toMemberScore),
              );
              const overCap = isOverCap(score, teamScoreCap);
              return (
                <div
                  key={team.id}
                  className="rounded-lg border border-border bg-card p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">
                        <span className="mr-1.5 rounded bg-[color:var(--mp-warning)]/20 px-1.5 py-0.5 text-xs font-medium text-[color:var(--mp-warning)] tabular-nums">
                          #{pIndex + 1}
                        </span>
                        {team.name}
                        {team.createdAt && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">
                            {formatSubmittedAt(team.createdAt)} 確定
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {team.members.map((m) => m.displayName).join("、")}
                      </p>
                      {showScore && (
                        <p className="mt-0.5 text-xs">
                          出場平均{" "}
                          <span
                            className={`font-semibold tabular-nums ${
                              overCap ? "text-destructive" : "text-foreground"
                            }`}
                          >
                            {score === null ? "—" : score.toFixed(1)}
                          </span>
                          {teamScoreCap !== null && overCap && (
                            <span className="text-destructive"> ⚠ 上限超過</span>
                          )}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => handleApproveTeam(team.id)}
                        className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                      >
                        承認
                      </button>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => handleRejectTeam(team.id)}
                        className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-destructive disabled:opacity-60"
                      >
                        却下
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 観戦者には未割当プールを見せず、確定チームだけ全幅で表示する（フェーズB）。 */}
      <div
        className={`mt-6 grid gap-6 ${
          spectator ? "" : "lg:grid-cols-[20rem_1fr]"
        }`}
      >
        {/* 左: 未割当プール。観戦者には出さない。 */}
        {!spectator && (
          <Pool
            members={sortPool(unassigned, poolSort)}
            totalCount={unassigned.length}
            showScore={showScore}
            sort={poolSort}
            onSortChange={setPoolSort}
          />
        )}

        {/* 右: チーム群 */}
        <div className="space-y-4">
          {!readOnly && (
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
          )}

          {teams.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {readOnly
                ? "まだチームがありません。"
                : "チームがまだありません。「+ チームを追加」で作成してください。"}
            </p>
          ) : (
            <div className="grid gap-4 2xl:grid-cols-2">
              {teams.map((team) => {
                const isSim = team.id === SIM_TEAM_ID;
                // 応募者の試算モードで、自分が代表の確定済みチームは取り下げ可能。
                const canCancelSelf =
                  readOnly &&
                  !isSim &&
                  team.status === "pending" &&
                  myRegistrationId !== null &&
                  team.captainRegistrationId === myRegistrationId;
                return (
                  <div key={team.id} className="space-y-2">
                    <TeamCard
                      team={team}
                      readOnly={readOnly}
                      // 試算モードでは自分のシミュレーション枠だけ操作可。
                      // 他人の実チームはカードを固定して動かせなくする（②）。
                      membersDraggable={!readOnly || isSim}
                      showStatus={!isSim}
                      showScore={showScore}
                      roleSwapAllowed={roleSwapAllowed}
                      teamSize={teamSize}
                      teamScoreCap={teamScoreCap}
                      // 代表指名は主催者・実チームのみ（SIM/試算では出さない）。
                      onSetCaptain={
                        isOrganizer && !isSim
                          ? (rid) => handleSetCaptain(team.id, rid)
                          : undefined
                      }
                      onDelete={() => handleDeleteTeam(team.id)}
                      onUnassign={handleUnassign}
                      onSwap={handleSwap}
                    />

                    {/* 応募者の確定バー（シミュレーション枠のみ・self イベント）。 */}
                    {isSim && selfFormation && myRegistrationId && (
                      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
                        <input
                          type="text"
                          value={selfTeamName}
                          maxLength={50}
                          onChange={(e) => setSelfTeamName(e.target.value)}
                          placeholder="チーム名"
                          className="w-40 rounded-md border border-border bg-background px-3 py-2 text-sm"
                        />
                        <button
                          type="button"
                          onClick={handleSubmitSelfTeam}
                          disabled={
                            isPending ||
                            team.members.length === 0 ||
                            selfTeamName.trim() === ""
                          }
                          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                        >
                          このチームで確定
                        </button>
                        <span className="text-xs text-muted-foreground">
                          確定すると主催者の承認に申請されます（承認まで定員枠は確保されません）。
                        </span>
                      </div>
                    )}

                    {/* 応募者: 自分が代表の確定チームの取り下げ。 */}
                    {canCancelSelf && (
                      <button
                        type="button"
                        onClick={() => handleCancelSelfTeam(team.id)}
                        disabled={isPending}
                        className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-destructive disabled:opacity-60"
                      >
                        このチームの確定を取り下げる
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ドラッグ中のプレビュー（持ち上げゴースト）。Claude Design の .drag-ghost に合わせ、
          幅を固定して横長化を防ぎ、-2deg 傾け・オレンジ淵・大きい影で「持ち上げている」感を出す。 */}
      <DragOverlay dropAnimation={null} className="!cursor-grabbing">
        {activeMember ? (
          <DragGhost member={activeMember} showScore={showScore} />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/** チーム応募の承認状態バッジ（approved は控えめ、pending/rejected を強調）。 */
function StatusBadge({ status }: { status: TeamStatus }) {
  if (status === "approved") {
    return (
      <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-[color:var(--mp-success)]/15 px-2 py-0.5 text-xs font-medium text-[color:var(--mp-success)] align-middle">
        ✓ 承認済み
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="ml-2 rounded-full bg-[color:var(--mp-warning)]/15 px-2 py-0.5 text-xs font-medium text-[color:var(--mp-warning)] align-middle">
        承認待ち
      </span>
    );
  }
  return (
    <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground align-middle">
      却下
    </span>
  );
}

/**
 * 未割当プール（droppable）。
 * 応募者が多いと縦に長くなるため、並び替え（⑫）で探す負担を下げ、リストは欄内スクロール
 * にする（見出し・並び替えは固定、カード群だけスクロール）。割当は D&D に統一する。
 * members は表示用に整形済み（応募順 or 絞込/ソート後）。
 */
function Pool({
  members,
  totalCount,
  showScore,
  sort,
  onSortChange,
}: {
  members: BoardMember[];
  /** 絞り込み前の未割当総数（見出し表示用）。 */
  totalCount: number;
  showScore: boolean;
  sort: PoolSort;
  onSortChange: (s: PoolSort) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: POOL_ID });
  const filtered = members.length !== totalCount;
  return (
    <div
      ref={setNodeRef}
      className={`flex max-h-[calc(100vh-9rem)] flex-col rounded-2xl border p-4 transition-[box-shadow,background-color,border-color] duration-150 lg:sticky lg:top-6 lg:self-start ${
        isOver
          ? "border-[color:var(--mp-brand)] bg-[color:var(--mp-brand)]/[0.06] shadow-[0_0_0_2px_var(--mp-brand),0_0_22px_-2px_color-mix(in_oklab,var(--mp-brand)_50%,transparent)]"
          : "border-border bg-card"
      }`}
    >
      <h2 className="text-sm font-semibold text-muted-foreground">
        未割当の応募者 ({filtered ? `${members.length} / ${totalCount}` : totalCount})
      </h2>

      {/* 並び替え/絞り込み（応募順・スコア順・第1希望ロール別）。 */}
      <label className="mt-2 block">
        <span className="sr-only">並び替え</span>
        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value as PoolSort)}
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
        >
          {POOL_SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      {/* 応募者が増えても欄内スクロールで対応（Claude Design 案）。スクロール→チームへ D&D。 */}
      <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {members.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {filtered
              ? "この条件に合う未割当の応募者はいません。"
              : "未割当の参加確定者はいません。"}
          </p>
        ) : (
          members.map((m) => (
            <MemberCard key={m.registrationId} member={m} showScore={showScore} />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * チームカード。出場（レギュラー）とリザーブの2ゾーンに分け、ゾーン間も D&D で移動。
 * チーム平均は出場メンバーのみで算出（DB設計 4.2）。交代シミュレーションを内蔵。
 */
function TeamCard({
  team,
  readOnly = false,
  membersDraggable = true,
  showStatus = false,
  showScore,
  roleSwapAllowed,
  teamSize,
  teamScoreCap,
  onSetCaptain,
  onDelete,
  onUnassign,
  onSwap,
}: {
  team: BoardTeam;
  readOnly?: boolean;
  /** メンバーをドラッグできるか（試算モードの他人の実チームは false＝カード固定）。 */
  membersDraggable?: boolean;
  /** 承認状態バッジを出すか（シミュレーション枠は出さない）。 */
  showStatus?: boolean;
  showScore: boolean;
  roleSwapAllowed: boolean;
  teamSize: number;
  teamScoreCap: number | null;
  /** 代表を指名する（主催者・実チームのみ。未指定なら代表操作を出さない）。 */
  onSetCaptain?: (registrationId: string) => void;
  onDelete: () => void;
  onUnassign: (registrationId: string) => void;
  onSwap: (teamId: string, outId: string, inId: string) => void;
}) {
  const regulars = team.members.filter((m) => m.position !== "reserve");
  const reserves = team.members.filter((m) => m.position === "reserve");

  const score = useMemo(
    () => teamScore(team.members.map(toMemberScore)),
    [team.members],
  );
  const overCap = isOverCap(score, teamScoreCap);
  const overSize = regulars.length > teamSize;

  // 交代シミュレーション: 選択中のリザーブと全レギュラーの交代候補。
  const [selectedReserveId, setSelectedReserveId] = useState<string | null>(null);
  const selectedReserve = reserves.find(
    (m) => m.registrationId === selectedReserveId,
  );
  const candidates = useMemo(() => {
    if (!selectedReserve) return [];
    return swapCandidates(
      team.members.map(toMemberScore),
      selectedReserve.registrationId,
      teamScoreCap,
    );
  }, [team.members, selectedReserve, teamScoreCap]);

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-[var(--mp-e1)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">
            {team.name}
            {showStatus && <StatusBadge status={team.status} />}
          </h3>
          {showScore && (
            <div className="mt-1.5">
              <div className="flex items-baseline gap-1.5 text-xs">
                <span className="text-[color:var(--mp-fg-subtle)]">平均</span>
                <span
                  className={`text-sm font-semibold tabular-nums ${
                    overCap
                      ? "text-[color:var(--mp-danger)]"
                      : "text-foreground"
                  }`}
                >
                  {score === null ? "—" : score.toFixed(1)}
                </span>
                {teamScoreCap !== null && (
                  <span className="text-[color:var(--mp-fg-subtle)] tabular-nums">
                    / 上限 {teamScoreCap.toFixed(1)}
                  </span>
                )}
                {teamScoreCap !== null &&
                  score !== null &&
                  (overCap ? (
                    <span className="text-[color:var(--mp-danger)]">
                      ⚠ 超過
                    </span>
                  ) : (
                    <span className="text-[color:var(--mp-success)]">
                      ✓ 上限内
                    </span>
                  ))}
              </div>
              {/* スコアバー: 上限に対する充填率を可視化（上限ありのときのみ）。 */}
              {teamScoreCap !== null && teamScoreCap > 0 && (
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--mp-surface-3)]">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, ((score ?? 0) / teamScoreCap) * 100)}%`,
                      backgroundColor: overCap
                        ? "var(--mp-danger)"
                        : "var(--mp-success)",
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
        {!readOnly && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onDelete}
            className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground transition hover:bg-[color:var(--mp-danger)]/10 hover:text-[color:var(--mp-danger)]"
          >
            チーム削除
          </button>
        )}
      </div>

      {/* 出場ゾーン（レギュラー）。平均はここのメンバーで算出。 */}
      <div className="mt-3">
        <p className="text-xs font-medium">
          regular{" "}
          <span className={overSize ? "text-destructive" : "text-muted-foreground"}>
            {regulars.length}/{teamSize}
            {overSize && " ⚠"}
          </span>
        </p>
        {roleSwapAllowed ? (
          // ロールスワップ可: 担当ロールを固定せずフラットに並べる。
          <Zone
            teamId={team.id}
            position="regular"
            members={regulars}
            readOnly={readOnly}
            membersDraggable={membersDraggable}
            showScore={showScore}
            onUnassign={onUnassign}
            captainRegistrationId={team.captainRegistrationId}
            onSetCaptain={onSetCaptain}
          />
        ) : (
          // ロールスワップ不可: タンク/DPS/サポートのロール行に分け、担当を明示。
          // ロール行へドロップすると担当ロールが確定する（人数は自由・上限は警告のみ）。
          <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
            {ROLE_ORDER.map((role) => (
              <Zone
                key={role}
                teamId={team.id}
                position="regular"
                role={role}
                title={
                  <span
                    className="inline-flex items-center gap-1.5 font-semibold"
                    style={{ color: ROLE_COLOR[role] }}
                  >
                    <RoleIcon role={role} size={18} />
                    {ROLE_LABEL[role]}
                  </span>
                }
                members={regulars.filter((m) => m.role === role)}
                readOnly={readOnly}
                membersDraggable={membersDraggable}
                showScore={showScore}
                onUnassign={onUnassign}
                captainRegistrationId={team.captainRegistrationId}
                onSetCaptain={onSetCaptain}
                compact
              />
            ))}
          </div>
        )}
      </div>

      {/* リザーブゾーン。クリックで交代シミュレーションを開く。 */}
      <Zone
        teamId={team.id}
        position="reserve"
        title={<span className="text-muted-foreground">reserve</span>}
        members={reserves}
        readOnly={readOnly}
        membersDraggable={membersDraggable}
        showScore={showScore}
        onUnassign={onUnassign}
        captainRegistrationId={team.captainRegistrationId}
        onSetCaptain={onSetCaptain}
        selectableReserve={showScore}
        selectedReserveId={selectedReserveId}
        onSelectReserve={(rid) =>
          setSelectedReserveId((cur) => (cur === rid ? null : rid))
        }
      />

      {/* 交代シミュレーション結果（リザーブ選択時のみ）。 */}
      {showScore && selectedReserve && (
        <div className="mt-3 rounded-lg border border-border bg-background p-3">
          <p className="text-xs">
            <span className="font-semibold">{selectedReserve.displayName}</span>{" "}
            を出す場合の交代候補:
          </p>
          {candidates.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              出場メンバーがいません。
            </p>
          ) : (
            <ul className="mt-2 space-y-1">
              {candidates.map((c) => {
                const out = team.members.find(
                  (m) => m.registrationId === c.outId,
                );
                return (
                  <li
                    key={c.outId}
                    className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1.5"
                  >
                    <span className="text-xs">
                      {out?.displayName ?? "?"} と交代 → 平均{" "}
                      <span className="font-semibold tabular-nums">
                        {c.newTeamScore === null
                          ? "—"
                          : c.newTeamScore.toFixed(1)}
                      </span>{" "}
                      <span
                        className={
                          c.withinCap ? "text-primary" : "text-destructive"
                        }
                      >
                        {teamScoreCap === null
                          ? ""
                          : c.withinCap
                          ? "✓ 上限内"
                          : "⚠ 超過"}
                      </span>
                    </span>
                    {!readOnly && (
                      <button
                        type="button"
                        disabled={teamScoreCap !== null && !c.withinCap}
                        onClick={() => {
                          onSwap(
                            team.id,
                            c.outId,
                            selectedReserve.registrationId,
                          );
                          setSelectedReserveId(null);
                        }}
                        className="rounded border border-primary/50 px-2 py-0.5 text-xs text-primary hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        交代する
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {teamScoreCap === null && (
            <p className="mt-2 text-xs text-muted-foreground">
              ※ このイベントはチームスコア上限が未設定です。
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * チーム内の1ゾーン（出場 / 出場のロール行 / リザーブ）。droppable。
 * role を渡すと「出場の特定ロール行」になり、ドロップで担当ロールが確定する。
 */
function Zone({
  teamId,
  position,
  role,
  title,
  members,
  readOnly = false,
  membersDraggable = true,
  showScore,
  onUnassign,
  captainRegistrationId = null,
  onSetCaptain,
  compact = false,
  selectableReserve = false,
  selectedReserveId = null,
  onSelectReserve,
}: {
  teamId: string;
  position: "regular" | "reserve";
  role?: RoleKey;
  title?: React.ReactNode;
  members: BoardMember[];
  readOnly?: boolean;
  /** ゾーン内メンバーをドラッグできるか（試算モードの他人の実チームは false）。 */
  membersDraggable?: boolean;
  showScore: boolean;
  onUnassign: (registrationId: string) => void;
  /** このチームの代表の応募 id（代表バッジ表示用）。 */
  captainRegistrationId?: string | null;
  /** 代表を指名する（主催者・実チームのみ。未指定なら代表操作を出さない）。 */
  onSetCaptain?: (registrationId: string) => void;
  compact?: boolean;
  selectableReserve?: boolean;
  selectedReserveId?: string | null;
  onSelectReserve?: (registrationId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: zoneId(teamId, position, role),
  });
  return (
    <div className={compact ? "" : "mt-3"}>
      {title && <p className="text-xs font-medium">{title}</p>}
      <div
        ref={setNodeRef}
        className={`mt-1.5 space-y-2 rounded-lg border p-2 transition-[box-shadow,background-color,border-color] duration-150 ${
          compact ? "min-h-[3rem]" : ""
        } ${
          isOver
            ? "border-[color:var(--mp-brand)] bg-[color:var(--mp-brand)]/[0.12] shadow-[0_0_0_2.5px_var(--mp-brand),0_0_30px_-2px_color-mix(in_oklab,var(--mp-brand)_70%,transparent)]"
            : "border-dashed border-border"
        }`}
      >
        {members.length === 0 ? (
          <p className="px-1 py-2 text-center text-xs text-muted-foreground">
            {/* 閲覧者にはドラッグ案内を出さない（ノイズ防止）。 */}
            {readOnly ? "なし" : "＋ ここにドラッグ"}
          </p>
        ) : (
          members.map((m) => (
            <MemberCard
              key={m.registrationId}
              member={m}
              showScore={showScore}
              draggable={membersDraggable}
              isCaptain={captainRegistrationId === m.registrationId}
              onSetCaptain={
                onSetCaptain ? () => onSetCaptain(m.registrationId) : undefined
              }
              onUnassign={
                readOnly ? undefined : () => onUnassign(m.registrationId)
              }
              selected={
                selectableReserve && selectedReserveId === m.registrationId
              }
              onSelect={
                selectableReserve && onSelectReserve
                  ? () => onSelectReserve(m.registrationId)
                  : undefined
              }
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
 * onSelect 指定時（リザーブ）はクリックで交代シミュレーションを開く。
 */
function MemberCard({
  member,
  showScore,
  onUnassign,
  overlay = false,
  selected = false,
  onSelect,
  draggable: canDrag = true,
  isCaptain = false,
  onSetCaptain,
}: {
  member: BoardMember;
  showScore: boolean;
  onUnassign?: () => void;
  overlay?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  /** ドラッグ可能か。試算モードの他人の実チームは false（カード固定）。 */
  draggable?: boolean;
  /** このメンバーが代表（captain）か。代表バッジ表示用。 */
  isCaptain?: boolean;
  /** 代表に指名する（主催者・実チームのみ。未指定なら代表操作を出さない）。 */
  onSetCaptain?: () => void;
}) {
  // overlay（DragOverlay 内の表示）と固定カードは draggable にしない。
  const draggable = useDraggable({
    id: member.registrationId,
    disabled: overlay || !canDrag,
  });
  const { attributes, listeners, setNodeRef, isDragging } =
    overlay || !canDrag
      ? ({} as ReturnType<typeof useDraggable>)
      : draggable;

  const roles = member.preferredRoles.filter((r): r is string => !!r);
  const score = effective(member);

  return (
    <div
      ref={overlay || !canDrag ? undefined : setNodeRef}
      {...(overlay || !canDrag ? {} : listeners)}
      {...(overlay || !canDrag ? {} : attributes)}
      onClick={onSelect}
      className={`rounded-lg border px-3 py-2 transition-[border-color,background-color,box-shadow,transform] duration-150 ${
        canDrag && !overlay
          ? "cursor-grab hover:-translate-y-px hover:border-[color:var(--mp-border-strong)] hover:bg-[color:var(--mp-surface-3)] hover:shadow-[var(--mp-e1)]"
          : ""
      } ${
        selected
          ? "border-primary bg-primary/15"
          : "border-border bg-muted/40"
      } ${isDragging ? "opacity-35" : ""} ${overlay ? "shadow-lg" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {member.displayName}
          {isCaptain && (
            <span
              title="代表（試合結果を入力できます）"
              className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary align-middle"
            >
              ★代表
            </span>
          )}
          {/* 補助: バトルタグ（全立場）＋ Discord名（運営のみ・内部識別）。 */}
          {(member.battleTag || member.discordName) && (
            <span className="ml-1.5 text-[10px] font-normal text-muted-foreground align-middle">
              {[member.battleTag, member.discordName]
                .filter(Boolean)
                .join(" ／ ")}
            </span>
          )}
        </span>
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
              onClick={(e) => {
                e.stopPropagation();
                onUnassign();
              }}
              className="text-xs text-muted-foreground hover:text-destructive"
              aria-label="チームから外す"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      {roles.length > 0 && (
        <div className="mt-1 flex items-center gap-1.5">
          <span className="text-[10px] text-[color:var(--mp-fg-subtle)]">
            希望
          </span>
          <PreferredRoles roles={member.preferredRoles} />
        </div>
      )}

      {/* 代表指名（主催者・実チームのみ）。既に代表の人には出さない。
          代表は自チームの試合結果を入力できる（実機FB）。 */}
      {!overlay && onSetCaptain && !isCaptain && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onSetCaptain();
          }}
          className="mt-1.5 text-xs text-primary hover:underline"
        >
          代表にする
        </button>
      )}
    </div>
  );
}

/**
 * 持ち上げゴースト（DragOverlay 内の表示）。Claude Design の .drag-ghost 準拠。
 * カード全体を運ぶのではなく専用の小さなプレビューにすることで、
 * ・幅を固定して横長化を防ぐ
 * ・-2deg 傾け・オレンジ淵・大きい影で「掴んで浮かせている」触感を出す
 * 名前・スコア・希望ロール（数字バッジ付き）だけを最小構成で見せる。
 */
function DragGhost({
  member,
  showScore,
}: {
  member: BoardMember;
  showScore: boolean;
}) {
  const score = effective(member);
  const roles = member.preferredRoles.filter((r): r is string => !!r);
  return (
    <div
      className="w-[230px] rounded-lg border border-[color:var(--mp-brand)] bg-[color:var(--mp-surface-2)] px-3 py-2.5"
      style={{
        transform: "rotate(-2deg)",
        boxShadow:
          "0 18px 40px rgba(0,0,0,.6), 0 0 0 1px color-mix(in oklab, var(--mp-brand) 40%, transparent)",
        opacity: 0.96,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold">
          {member.displayName}
        </span>
        {showScore && (
          <span className="shrink-0 text-sm font-semibold tabular-nums">
            {score === null ? "—" : Math.round(score * 10) / 10}
          </span>
        )}
      </div>
      {roles.length > 0 && (
        <div className="mt-2 flex items-center gap-1.5">
          <span className="text-[10px] text-[color:var(--mp-fg-subtle)]">
            希望
          </span>
          <PreferredRoles roles={member.preferredRoles} />
        </div>
      )}
    </div>
  );
}
