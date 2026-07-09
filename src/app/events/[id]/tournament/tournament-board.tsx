"use client";

import {
  useState,
  useTransition,
  useRef,
  useLayoutEffect,
  useEffect,
  useCallback,
} from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  pointerWithin,
  closestCenter,
  type CollisionDetection,
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
  generateTournament,
  reportTournamentResult,
  clearTournamentResult,
  swapBracketTeams,
  updateRoundBestOfAction,
} from "./actions";
import type { RoundBoGroup } from "@/lib/services/bracket";
import { updateSchedule, updateStream } from "../matches/actions";
import {
  validateBoScore,
  validatePotg,
  describeBestOf,
  mapsPlayed,
} from "@/lib/services/match-result";
import { formatLocalInputForDisplay } from "@/lib/datetime-local";
import { ScoreStepper } from "../_components/score-stepper";

type Podium = {
  champion: string | null;
  runnerUp: string | null;
  third: string[];
};

/** D&D の slot id（matchId と a/b スロット）をエンコード/デコードする。 */
function slotId(matchId: string, slot: "a" | "b"): string {
  return `${matchId}::${slot}`;
}
function parseSlotId(id: string): { matchId: string; slot: "a" | "b" } | null {
  const [matchId, slot] = id.split("::");
  if (!matchId || (slot !== "a" && slot !== "b")) return null;
  return { matchId, slot };
}

/** D&D 判定。ポインタ位置優先（横長カードでも浅い位置で受け付ける・予選と同方針）。 */
const dropCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : closestCenter(args);
};

/** ブラケット1試合（page.tsx で DB から整形して渡す）。 */
export type BoardBracketMatch = {
  id: string;
  round: number;
  position: number;
  teamAId: string | null;
  teamBId: string | null;
  teamAName: string | null;
  teamBName: string | null;
  /** 結果（取マップ数・勝者・POTG）。未入力は null。 */
  teamAScore: number | null;
  teamBScore: number | null;
  winnerTeamId: string | null;
  potgA: number;
  potgB: number;
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
  /** 3位決定戦（最終ラウンド・position=1）か。ブラケット本線から分離して扱う。 */
  isThirdPlace: boolean;
};

type PreviewSeed = { seed: number; teamId: string; teamName: string };

/** ラウンド番号からラベルを作る（最終ラウンド=決勝, その前=準決勝…）。 */
function roundLabel(round: number, totalRounds: number): string {
  const fromLast = totalRounds - round; // 0=決勝, 1=準決勝, 2=準々決勝
  if (fromLast === 0) return "決勝";
  if (fromLast === 1) return "準決勝";
  if (fromLast === 2) return "準々決勝";
  return `${round}回戦`;
}

/** 試合の状態を求める（BYE / 勝者待ち / 対戦カード / 終了）。 */
type MatchState = "bye" | "locked" | "ready" | "done";
function matchState(m: BoardBracketMatch): MatchState {
  // 結果ありは常に「終了」（BYE より優先）。チーム削除で片側 null になった実試合を
  // 誤って BYE 扱いにしないため、この判定を先に行う。
  if (m.hasResult) return "done";
  // 結果なしの1回戦で片側だけ空 = BYE（不戦勝・前試合待ちの「未定」とは区別）。
  if (m.round === 1 && (m.teamAId === null) !== (m.teamBId === null)) return "bye";
  if (m.teamAId !== null && m.teamBId !== null) return "ready";
  return "locked";
}

export function TournamentBoard({
  eventId,
  readOnly,
  rankingEnabled,
  groupStage,
  usePotg,
  swapEnabled,
  podium,
  initialAdvanceCount,
  previewSeeded,
  roundBoGroups,
  initialMatches,
}: {
  eventId: string;
  /** 応募者の閲覧（read-only）。生成操作を無効化する。 */
  readOnly: boolean;
  /** 順位機能が有効か。予選を持つ形式では無効だと進出抽出できず生成不可。 */
  rankingEnabled: boolean;
  /** 予選を持つ形式か（PR-3）。false=トーナメントのみ＝順位機能なしでも全approvedで生成可。 */
  groupStage: boolean;
  /** POTG を使うイベントか（結果入力に POTG 欄を出すか）。 */
  usePotg: boolean;
  /** 1回戦の手動入れ替え（D&D）を許可するか（主催者かつ結果が1件もないとき）。 */
  swapEnabled: boolean;
  /** 表彰台（優勝・準優勝・3位の表示名）。 */
  podium: Podium;
  initialAdvanceCount: number;
  /** 現在の進出数で抽出されるシード順チーム（生成前プレビュー）。 */
  previewSeeded: PreviewSeed[];
  /** ラウンド別 BO 編集グループ（PR-4・主催者のみ編集）。 */
  roundBoGroups: RoundBoGroup[];
  initialMatches: BoardBracketMatch[];
}) {
  const router = useRouter();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const [advanceCount, setAdvanceCount] = useState(initialAdvanceCount);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // 開いている試合モーダル（id で保持し描画時に最新データから引き直す・第8画面と同方針）。
  const [openId, setOpenId] = useState<string | null>(null);

  const hasBracket = initialMatches.length > 0;
  const totalRounds = hasBracket
    ? Math.max(...initialMatches.map((m) => m.round))
    : 0;

  // 生成可否（PR-3）。予選を持つ形式は順位機能必須、トーナメントのみは順位機能不要。
  const canGenerate = groupStage ? rankingEnabled : true;

  // ラウンドごとに束ねる（position 昇順）。3位決定戦は本線から分離する（isThirdPlace で判定）。
  const rounds: BoardBracketMatch[][] = [];
  for (let r = 1; r <= totalRounds; r++) {
    rounds.push(
      initialMatches
        .filter((m) => m.round === r && !m.isThirdPlace)
        .sort((a, b) => a.position - b.position),
    );
  }
  const finalMatch = rounds[totalRounds - 1]?.[0] ?? null;
  const thirdPlaceMatch = initialMatches.find((m) => m.isThirdPlace) ?? null;

  // 開いているモーダルの試合を最新データから引き直す（保存後や他者更新を反映）。
  const openMatch =
    openId !== null
      ? initialMatches.find((m) => m.id === openId) ?? null
      : null;

  function handleGenerate() {
    setDialogOpen(false);
    setError(null);
    startTransition(async () => {
      const res = await generateTournament(eventId, advanceCount);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  /** 1回戦スロットの D&D 入れ替え。drop 先・元がともに 1 回戦スロットのときだけ swap する。 */
  function handleDragEnd(e: DragEndEvent) {
    if (!swapEnabled) return;
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const x = parseSlotId(String(active.id));
    const y = parseSlotId(String(over.id));
    if (!x || !y) return;
    setError(null);
    startTransition(async () => {
      const res = await swapBracketTeams({ x, y });
      if (res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  const hasPodium =
    podium.champion !== null ||
    podium.runnerUp !== null ||
    podium.third.length > 0;

  const noteText = readOnly
    ? "カードをクリックすると試合の詳細（日時・配信・スコア）が開きます。1回戦の BYE は上位シードの不戦勝です。"
    : "カードをクリックして結果を入力。勝者は自動で次ラウンドへ勝ち上がります。BYE は上位シードの不戦勝です。";

  return (
    <div className="mt-6">
      {error && (
        <p className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <RoleBanner readOnly={readOnly} />

      {/* 順位機能の警告は予選を持つ形式のときだけ（トーナメントのみは順位機能不要）。 */}
      {!readOnly && groupStage && !rankingEnabled && (
        <p className="mt-4 rounded-md border border-[color:var(--mp-warning)]/50 bg-[color:var(--mp-warning)]/10 px-3 py-2 text-sm text-[color:var(--mp-warning)]">
          決勝トーナメントには順位機能が必要です。イベント編集で順位設定を有効にしてください。
        </p>
      )}

      {!hasBracket ? (
        <GeneratePanel
          readOnly={readOnly}
          canGenerate={canGenerate}
          groupStage={groupStage}
          rankingEnabled={rankingEnabled}
          advanceCount={advanceCount}
          setAdvanceCount={setAdvanceCount}
          previewSeeded={previewSeeded}
          isPending={isPending}
          onOpenDialog={() => setDialogOpen(true)}
        />
      ) : (
        <>
          {/* 表彰台（決勝などが確定したら表示）。 */}
          {hasPodium && <PodiumPanel podium={podium} />}

          {/* クリック導線の注意書き。 */}
          <div className="mb-3.5 mt-6 flex items-center gap-2.5 rounded-lg border border-border bg-[color:var(--mp-surface-2)] px-3.5 py-2.5 text-xs text-muted-foreground">
            <svg viewBox="0 0 24 24" className="h-[15px] w-[15px] shrink-0 stroke-[color:var(--mp-accent)]" fill="none" strokeWidth={2} aria-hidden>
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
            <span>
              <span className="font-semibold text-foreground">カードをクリック</span>
              {noteText.replace("カードをクリック", "")}
            </span>
          </div>

          {/* 手動入れ替えの案内（1回戦・結果なしのときのみ）。 */}
          {swapEnabled && (
            <p className="mb-3 rounded-md border border-border bg-[color:var(--mp-surface-2)] px-3 py-2 text-xs text-muted-foreground">
              1回戦のチームはドラッグ＆ドロップで入れ替えできます（結果を入力すると入れ替えはできなくなります）。
            </p>
          )}

          {/* ブラケット本体（コネクタ線付き）。 */}
          <DndContext
            id="tournament-board-dnd"
            sensors={sensors}
            collisionDetection={dropCollision}
            onDragEnd={handleDragEnd}
          >
            <Bracket
              rounds={rounds}
              totalRounds={totalRounds}
              finalMatch={finalMatch}
              thirdPlaceMatch={thirdPlaceMatch}
              readOnly={readOnly}
              swapEnabled={swapEnabled}
              onOpenMatch={(id) => setOpenId(id)}
            />
          </DndContext>

          {/* 管理ツール（主催者・下部・再生成＋ラウンド別BO）。 */}
          {!readOnly && (
            <OrganizerToolbar
              eventId={eventId}
              groupStage={groupStage}
              advanceCount={advanceCount}
              setAdvanceCount={setAdvanceCount}
              isPending={isPending}
              roundBoGroups={roundBoGroups}
              onRegenerate={() => setDialogOpen(true)}
            />
          )}
        </>
      )}

      {/* 試合モーダル（カードクリックで開く）。最新データ（openMatch）を渡す。
          key にサーバー確定値を含め、保存や他者更新でデータが変わったら再マウントして
          編集フィールドのシード（useState 初期値）を最新化する。 */}
      {openId && openMatch && (
        <MatchModal
          key={`${openMatch.id}:${openMatch.teamAScore}:${openMatch.teamBScore}:${openMatch.potgA}:${openMatch.potgB}:${openMatch.scheduledAtLocal}:${openMatch.streamUrl ?? ""}:${openMatch.streamerName ?? ""}`}
          match={openMatch}
          totalRounds={totalRounds}
          readOnly={readOnly}
          usePotg={usePotg}
          onClose={() => setOpenId(null)}
        />
      )}

      {/* 生成（作り直し）の確認ダイアログ（破壊的操作の警告）。 */}
      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {hasBracket
                ? "トーナメントを作り直しますか？"
                : "トーナメントを生成しますか？"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {hasBracket &&
                "現在のトーナメント表と入力済みの試合結果がすべて削除され、"}
              {groupStage
                ? `各ブロック上位${advanceCount}チームをシードに新しいブラケットを作成します。`
                : "参加チーム全員をシードに新しいブラケットを作成します。"}
              {hasBracket && "この操作は元に戻せません。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={handleGenerate}>
              {hasBracket ? "作り直す" : "生成する"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** 立場バナー（参加者／観戦者）。主催者には出さない。 */
function RoleBanner({ readOnly }: { readOnly: boolean }) {
  if (!readOnly) return null;
  return (
    <div className="mt-4 flex items-center gap-3 rounded-xl border border-[color:var(--mp-accent)]/30 bg-gradient-to-r from-[color:var(--mp-accent)]/10 to-transparent px-4 py-3 text-sm text-muted-foreground">
      <span
        aria-hidden
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--mp-live)] shadow-[0_0_10px_var(--mp-live)]"
      />
      <span>
        <span className="font-semibold text-foreground">閲覧モード</span>{" "}
        決勝トーナメントの勝ち上がりを閲覧しています。カードをクリックすると試合の詳細（日時・配信・スコア）を確認できます（結果の入力は主催者・対戦チームの代表のみ）。
      </span>
    </div>
  );
}

/** 表彰台（優勝ゴールド演出・銀銅）。 */
function PodiumPanel({ podium }: { podium: Podium }) {
  const third = podium.third.length > 0 ? podium.third.join(" / ") : null;
  return (
    <div className="relative mt-6 overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-[var(--mp-e1)]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(520px 200px at 50% -40%, rgba(245,196,81,.12), transparent 70%)",
        }}
      />
      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-base font-extrabold">
          <span aria-hidden className="h-4 w-0.5 rounded-full bg-[color:var(--mp-gold)]" />
          最終結果
          <span className="text-[13px] font-semibold text-[color:var(--mp-fg-subtle)]">
            Final Standings
          </span>
        </h2>
        {podium.champion && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--mp-gold)]/32 bg-[color:var(--mp-gold)]/10 px-3 py-1 text-xs font-medium text-[color:var(--mp-gold)]">
            🏆 優勝 <span className="font-semibold">{podium.champion}</span>
          </span>
        )}
      </div>
      <div className="relative mt-6 flex flex-wrap items-end justify-center gap-4">
        <PodiumStep place="silver" medal="🥈" rank="準優勝" name={podium.runnerUp} />
        <PodiumStep place="gold" medal="🏆" rank="優勝" name={podium.champion} />
        <PodiumStep place="bronze" medal="🥉" rank="第3位" name={third} />
      </div>
    </div>
  );
}

function PodiumStep({
  place,
  medal,
  rank,
  name,
}: {
  place: "gold" | "silver" | "bronze";
  medal: string;
  rank: string;
  name: string | null;
}) {
  if (!name) return null;
  const baseHeight =
    place === "gold" ? "h-[86px]" : place === "silver" ? "h-[62px]" : "h-[44px]";
  const isGold = place === "gold";
  const swatch =
    place === "gold"
      ? "var(--mp-gold)"
      : place === "silver"
        ? "var(--mp-silver)"
        : "var(--mp-bronze)";
  return (
    <div className="flex w-[200px] max-w-[30vw] flex-col items-center gap-3">
      <span className="text-3xl" style={{ filter: "drop-shadow(0 3px 8px rgba(0,0,0,.5))" }}>
        {medal}
      </span>
      <div
        className={`flex w-full flex-col items-center gap-1.5 rounded-t-lg border border-b-0 border-[color:var(--mp-border-strong)] bg-[color:var(--mp-surface-2)] px-3.5 py-4 text-center ${
          isGold ? "shadow-[0_0_34px_rgba(245,196,81,.18)]" : ""
        }`}
        style={
          isGold
            ? {
                borderColor: "rgba(245,196,81,.55)",
                background:
                  "linear-gradient(180deg,rgba(245,196,81,.18),rgba(245,196,81,.04))",
              }
            : undefined
        }
      >
        <span className="font-mono text-[10px] uppercase tracking-widest text-[color:var(--mp-fg-subtle)]" style={isGold ? { color: swatch } : undefined}>
          {rank}
        </span>
        <span
          className="text-[17px] font-extrabold leading-tight"
          style={{ color: isGold ? swatch : "var(--mp-fg)" }}
        >
          {name}
        </span>
      </div>
      <div
        className={`grid w-full place-items-center rounded-b-md border border-t-0 border-[color:var(--mp-border-strong)] bg-[color:var(--mp-surface-3)] font-extrabold ${baseHeight}`}
        style={{ color: swatch }}
      >
        {medal}
      </div>
    </div>
  );
}

/** コネクタ線付きブラケット。SVG で親子カードを曲線で繋ぐ。 */
function Bracket({
  rounds,
  totalRounds,
  finalMatch,
  thirdPlaceMatch,
  readOnly,
  swapEnabled,
  onOpenMatch,
}: {
  rounds: BoardBracketMatch[][];
  totalRounds: number;
  finalMatch: BoardBracketMatch | null;
  thirdPlaceMatch: BoardBracketMatch | null;
  readOnly: boolean;
  swapEnabled: boolean;
  onOpenMatch: (id: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<{ d: string; done: boolean }[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // 親子関係（子=前ラウンド、親=次ラウンド floor(pos/2)）。3位決定戦は繋がない。
  const connectors: { childId: string; parentId: string; done: boolean }[] = [];
  for (let r = 0; r < rounds.length - 1; r++) {
    for (const child of rounds[r]) {
      const parent = rounds[r + 1].find(
        (p) => p.position === Math.floor(child.position / 2),
      );
      if (parent) {
        // 勝者確定（実結果あり）または BYE（自動進出済み）なら線を「完了」色にする。
        const advanced =
          child.winnerTeamId !== null || matchState(child) === "bye";
        connectors.push({
          childId: child.id,
          parentId: parent.id,
          done: advanced,
        });
      }
    }
  }

  const recompute = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const base = wrap.getBoundingClientRect();
    const rectOf = (id: string) => {
      const el = wrap.querySelector(`[data-card="${id}"]`);
      return el ? el.getBoundingClientRect() : null;
    };
    const out: { d: string; done: boolean }[] = [];
    for (const { childId, parentId, done } of connectors) {
      const c = rectOf(childId);
      const p = rectOf(parentId);
      if (!c || !p) continue;
      const cx = c.right - base.left;
      const cy = c.top - base.top + c.height / 2;
      const px = p.left - base.left;
      const py = p.top - base.top + p.height / 2;
      const midX = (cx + px) / 2;
      out.push({
        d: `M ${cx} ${cy} C ${midX} ${cy} ${midX} ${py} ${px} ${py}`,
        done,
      });
    }
    setPaths(out);
    setSize({ w: wrap.scrollWidth, h: wrap.scrollHeight });
    // connectors はレンダーごとに再生成されるため依存に入れない（内容は rounds に従属）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rounds]);

  useLayoutEffect(() => {
    recompute();
  }, [recompute]);
  useEffect(() => {
    const t = setTimeout(recompute, 60);
    window.addEventListener("resize", recompute);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", recompute);
    };
  }, [recompute]);

  return (
    <div className="overflow-x-auto pb-4">
      <div ref={wrapRef} className="relative flex min-w-min gap-[66px] px-0.5 py-1">
        <svg
          className="pointer-events-none absolute left-0 top-0 z-[1] overflow-visible"
          width={size.w}
          height={size.h}
        >
          {paths.map((p, i) => (
            <path
              key={i}
              d={p.d}
              fill="none"
              strokeWidth={p.done ? 2.4 : 2}
              stroke={p.done ? "rgba(255,106,43,.55)" : "var(--mp-border-strong)"}
              strokeLinecap="round"
            />
          ))}
        </svg>

        {rounds.map((roundMatches, i) => {
          const isFinalCol = i === rounds.length - 1;
          return (
            <div key={i} className="relative z-[2] flex min-w-[238px] flex-col">
              <div className="mb-4 flex items-baseline gap-2.5">
                <span className="text-[15px] font-extrabold tracking-tight">
                  {roundLabel(i + 1, totalRounds)}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-[color:var(--mp-fg-subtle)]">
                  {roundMatches.length} {roundMatches.length > 1 ? "matches" : "match"}
                </span>
                {roundMatches[0] && (
                  <span className="ml-auto rounded-full border border-[color:var(--mp-brand)]/30 bg-[color:var(--mp-brand)]/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-[color:var(--mp-brand)]">
                    BO{roundMatches[0].bestOf}
                  </span>
                )}
              </div>
              <div className="flex flex-1 flex-col justify-around gap-4">
                {roundMatches.map((m) => (
                  <BracketCard
                    key={m.id}
                    match={m}
                    readOnly={readOnly}
                    swappable={swapEnabled && m.round === 1}
                    isChampMatch={isFinalCol}
                    onOpenMatch={onOpenMatch}
                  />
                ))}
              </div>

              {/* 決勝列の下に3位決定戦を別枠で。 */}
              {isFinalCol && thirdPlaceMatch && finalMatch && (
                <div className="mt-5">
                  <div className="rounded-xl border-[1.5px] border-dashed border-[color:var(--mp-border-strong)] bg-[color:var(--mp-surface)]/40 p-3">
                    <div className="mb-2.5 flex items-center gap-2 pl-0.5 text-xs font-bold text-muted-foreground">
                      <span className="text-sm">🥉</span>3位決定戦
                      <span className="font-normal text-[color:var(--mp-fg-subtle)]">
                        · 準決勝敗者
                      </span>
                    </div>
                    <BracketCard
                      match={thirdPlaceMatch}
                      readOnly={readOnly}
                      swappable={false}
                      isChampMatch={false}
                      onOpenMatch={onOpenMatch}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** ブラケットの1試合カード。1回戦は swap 用スロット、それ以外はスコアスロット。 */
function BracketCard({
  match,
  readOnly,
  swappable,
  isChampMatch,
  onOpenMatch,
}: {
  match: BoardBracketMatch;
  readOnly: boolean;
  swappable: boolean;
  isChampMatch: boolean;
  onOpenMatch: (id: string) => void;
}) {
  const state = matchState(match);
  const bye = state === "bye";
  const done = state === "done";
  const ready = state === "ready" || done;
  // 結果あり・付随情報ありは誰でも開ける。未実施でも入力権限があれば開ける（第8画面の方針）。
  const canReport = !readOnly && match.canReport;
  const hasInfo = match.scheduledAtLocal !== "" || match.streamUrl !== null;
  const clickable = !bye && (done || hasInfo || (ready && canReport));

  const champWinnerIsA =
    isChampMatch && done && match.winnerTeamId === match.teamAId;
  const champWinnerIsB =
    isChampMatch && done && match.winnerTeamId === match.teamBId;

  const tag = bye
    ? "不戦勝"
    : done
      ? "終了"
      : ready
        ? "対戦カード"
        : "勝者待ち";

  const cls = [
    "overflow-hidden rounded-lg border bg-card shadow-[var(--mp-e1)] transition",
    clickable
      ? "cursor-pointer hover:-translate-y-px hover:border-[color:var(--mp-border-strong)] hover:shadow-[var(--mp-e2)]"
      : "cursor-default",
    isChampMatch && done
      ? "border-[color:var(--mp-gold)]/55 shadow-[0_0_26px_rgba(245,196,81,.14),var(--mp-e1)]"
      : "border-border",
  ].join(" ");

  return (
    <div
      data-card={match.id}
      className={cls}
      onClick={clickable ? () => onOpenMatch(match.id) : undefined}
    >
      <div className="flex items-center justify-between border-b border-border bg-[color:var(--mp-surface-2)] px-2.5 py-1.5">
        <span
          className={`font-mono text-[9.5px] uppercase tracking-wider ${
            done ? "text-[color:var(--mp-success)]" : "text-[color:var(--mp-fg-subtle)]"
          }`}
        >
          {done ? "✓ 終了" : tag}
        </span>
        {clickable && canReport && !done && (
          <span className="font-sans text-[9.5px] font-bold text-[color:var(--mp-brand)]">
            ＋ 結果入力
          </span>
        )}
        <span className="rounded-full border border-[color:var(--mp-brand)]/30 bg-[color:var(--mp-brand)]/10 px-1.5 py-0.5 font-mono text-[9.5px] font-semibold text-[color:var(--mp-brand)]">
          BO{match.bestOf}
        </span>
      </div>

      {swappable ? (
        <>
          <SwapSlot matchId={match.id} slot="a" name={match.teamAName} teamId={match.teamAId} />
          <SwapSlot matchId={match.id} slot="b" name={match.teamBName} teamId={match.teamBId} />
        </>
      ) : (
        <>
          <ScoreSlot
            name={match.teamAName}
            score={match.teamAScore}
            state={slotState(match, "a", state)}
            isChamp={champWinnerIsA}
          />
          <ScoreSlot
            name={match.teamBName}
            score={match.teamBScore}
            state={slotState(match, "b", state)}
            isChamp={champWinnerIsB}
          />
        </>
      )}

      {(match.scheduledAtLocal !== "" || match.streamUrl) && !bye && (
        <div className="flex items-center gap-2.5 border-t border-border bg-[color:var(--mp-surface-2)]/40 px-3 py-1.5 font-mono text-[10px] text-[color:var(--mp-fg-subtle)]">
          {match.scheduledAtLocal !== "" && (
            <span>{formatLocalInputForDisplay(match.scheduledAtLocal)}</span>
          )}
          {match.streamUrl && (
            <span className="inline-flex items-center gap-1 text-[color:var(--mp-live)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--mp-live)] shadow-[0_0_6px_var(--mp-live)]" />
              {match.streamerName || "配信"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

type SlotVisual = "win" | "lose" | "tbd" | "bye" | "neutral";
/** スロット（a/b）の表示状態を求める。 */
function slotState(
  match: BoardBracketMatch,
  slot: "a" | "b",
  state: MatchState,
): SlotVisual {
  const teamId = slot === "a" ? match.teamAId : match.teamBId;
  // 結果ありは勝敗色を優先（チーム削除で teamId が null でも winnerTeamId で判定）。
  if (state === "done") return match.winnerTeamId === teamId ? "win" : "lose";
  if (state === "bye" && teamId === null) return "bye";
  if (teamId === null) return "tbd";
  return "neutral";
}

/** スコア付きスロット。勝者は強調、未確定は「未定」、BYE は「BYE / 不戦勝」。 */
function ScoreSlot({
  name,
  score,
  state,
  isChamp,
}: {
  name: string | null;
  score: number | null;
  state: SlotVisual;
  isChamp: boolean;
}) {
  const accent =
    state === "win"
      ? isChamp
        ? "bg-[color:var(--mp-gold)]"
        : "bg-[color:var(--mp-success)]"
      : "bg-transparent";
  const nameCls =
    state === "lose"
      ? "text-[color:var(--mp-fg-muted)] font-semibold"
      : state === "tbd" || state === "bye"
        ? "text-[color:var(--mp-fg-subtle)] font-semibold font-jp"
        : "text-foreground font-bold";
  const scoreCls =
    state === "win"
      ? isChamp
        ? "text-[color:var(--mp-gold)]"
        : "text-[color:var(--mp-success)]"
      : state === "lose"
        ? "text-[color:var(--mp-fg-subtle)]"
        : "text-[color:var(--mp-fg-muted)]";
  const label = name ?? (state === "bye" ? "BYE" : "未定");
  return (
    <div className="relative flex items-center gap-2.5 border-b border-border px-3 py-2.5 last:border-b-0">
      <span className={`absolute bottom-0 left-0 top-0 w-[3px] ${accent}`} />
      <span className={`min-w-0 flex-1 truncate font-sans text-[13.5px] ${nameCls}`}>
        {label}
      </span>
      {isChamp && <span className="shrink-0 text-xs">👑</span>}
      {state === "bye" ? (
        <span className="shrink-0 font-mono text-[9px] tracking-widest text-[color:var(--mp-fg-subtle)]">
          不戦勝
        </span>
      ) : score !== null ? (
        <span className={`shrink-0 font-mono text-[15px] font-bold tabular-nums ${scoreCls}`}>
          {score}
        </span>
      ) : null}
    </div>
  );
}

/** 1回戦の入れ替え用スロット。draggable（チームあり）かつ droppable。 */
function SwapSlot({
  matchId,
  slot,
  name,
  teamId,
}: {
  matchId: string;
  slot: "a" | "b";
  name: string | null;
  teamId: string | null;
}) {
  const id = slotId(matchId, slot);
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id,
    disabled: teamId === null,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setDropRef}
      onClick={(e) => e.stopPropagation()}
      className={`relative flex items-center gap-2.5 border-b px-3 py-2.5 last:border-b-0 ${
        isOver ? "border-[color:var(--mp-brand)] bg-[color:var(--mp-brand)]/10" : "border-border"
      }`}
    >
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        className={`min-w-0 flex-1 truncate font-sans text-[13.5px] ${
          teamId !== null ? "cursor-grab" : ""
        } ${isDragging ? "opacity-40" : ""} ${
          name ? "font-bold text-foreground" : "font-semibold text-[color:var(--mp-fg-subtle)]"
        }`}
      >
        {name ?? (teamId === null ? "BYE" : "未定")}
      </div>
    </div>
  );
}

/** ブラケット未生成時の生成パネル（中央・大きく）。 */
function GeneratePanel({
  readOnly,
  canGenerate,
  groupStage,
  rankingEnabled,
  advanceCount,
  setAdvanceCount,
  previewSeeded,
  isPending,
  onOpenDialog,
}: {
  readOnly: boolean;
  canGenerate: boolean;
  groupStage: boolean;
  rankingEnabled: boolean;
  advanceCount: number;
  setAdvanceCount: (n: number) => void;
  previewSeeded: PreviewSeed[];
  isPending: boolean;
  onOpenDialog: () => void;
}) {
  if (readOnly) {
    return (
      <p className="mt-6 rounded-2xl border border-dashed border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
        まだトーナメントが生成されていません。主催者の生成をお待ちください。
      </p>
    );
  }
  if (!canGenerate) {
    return (
      <p className="mt-6 rounded-2xl border border-dashed border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
        {groupStage && !rankingEnabled
          ? "順位機能を有効にすると決勝トーナメントを生成できます。"
          : "まだトーナメントを生成できません。"}
      </p>
    );
  }

  return (
    <div className="mt-6 rounded-2xl border border-dashed border-[color:var(--mp-border-strong)] bg-card px-8 py-12 text-center shadow-[var(--mp-e1)]">
      <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-xl bg-[color:var(--mp-brand)]/[0.12] text-[color:var(--mp-brand)]">
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 3v12" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="6" r="3" />
          <path d="M18 9v3a6 6 0 0 1-6 6H9" />
        </svg>
      </div>
      <h3 className="text-xl font-extrabold">決勝トーナメントを生成</h3>
      <p className="mx-auto mt-2 max-w-[560px] text-[13.5px] leading-relaxed text-muted-foreground">
        {groupStage
          ? "各ブロックの上位チームをシードに、シングルエリミネーションのブラケットを作ります。"
          : "参加チーム全員をシード（スコア順／スコアなしは参加順）に、シングルエリミネーションのブラケットを作ります。"}
        シード数が2の累乗でない場合、上位シードには1回戦の BYE（不戦勝）が付きます。
      </p>

      {/* 進出数（予選ありのみ）。 */}
      {groupStage && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <label className="text-sm text-muted-foreground" htmlFor="advance-count">
            各ブロック上位
          </label>
          <input
            id="advance-count"
            type="number"
            min={1}
            max={99}
            value={advanceCount}
            onChange={(e) =>
              setAdvanceCount(Math.max(1, Math.floor(Number(e.target.value) || 1)))
            }
            className="w-20 rounded-md border border-border bg-[color:var(--mp-surface-3)] px-3 py-2 text-sm"
          />
          <span className="text-sm text-muted-foreground">チームが進出</span>
        </div>
      )}

      {/* 進出予定チームのプレビュー。 */}
      {previewSeeded.length > 0 && (
        <div className="mx-auto mt-5 flex max-w-[640px] flex-wrap justify-center gap-2">
          {previewSeeded.map((s) => (
            <span
              key={s.teamId}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-[color:var(--mp-surface-2)] py-1 pl-1.5 pr-3 text-[12.5px] font-semibold"
            >
              <span className="grid h-5 w-5 place-items-center rounded border border-border bg-[color:var(--mp-surface-3)] font-mono text-[10.5px] font-bold text-[color:var(--mp-fg-subtle)]">
                {s.seed}
              </span>
              {s.teamName}
            </span>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onOpenDialog}
        disabled={isPending}
        className="mt-6 inline-flex items-center gap-2 rounded-md bg-[color:var(--mp-brand)] px-5 py-3 text-[14.5px] font-semibold text-[color:var(--mp-on-brand)] shadow-[0_0_0_1px_rgba(255,106,43,.35),0_6px_18px_rgba(255,106,43,.2)] transition hover:bg-[color:var(--mp-brand-hover)] disabled:opacity-45"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 3v12" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="6" r="3" />
          <path d="M18 9v3a6 6 0 0 1-6 6H9" />
        </svg>
        トーナメントを生成する
      </button>
    </div>
  );
}

/** 主催者ツールバー（下部・再生成＋ラウンド別BO）。 */
function OrganizerToolbar({
  eventId,
  groupStage,
  advanceCount,
  setAdvanceCount,
  isPending,
  roundBoGroups,
  onRegenerate,
}: {
  eventId: string;
  groupStage: boolean;
  advanceCount: number;
  setAdvanceCount: (n: number) => void;
  isPending: boolean;
  roundBoGroups: RoundBoGroup[];
  onRegenerate: () => void;
}) {
  return (
    <div className="mt-5 rounded-2xl border border-border bg-card p-4 shadow-[var(--mp-e1)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 text-[14.5px] font-extrabold">
            <span className="grid h-[26px] w-[26px] place-items-center rounded bg-[color:var(--mp-brand)]/[0.14] text-[color:var(--mp-brand)]">
              <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M6 3v12" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="6" r="3" />
                <path d="M18 9v3a6 6 0 0 1-6 6H9" />
              </svg>
            </span>
            トーナメントの生成・管理
          </div>
          <p className="mt-1.5 max-w-[560px] text-[11.5px] leading-relaxed text-muted-foreground">
            シードをもとにシングルエリミネーションを作り直せます。各ラウンドの BO はここでまとめて設定できます（1回戦の組み替え・BO変更・再生成は主催者のみ）。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {groupStage && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11.5px] text-[color:var(--mp-fg-subtle)]">上位</span>
              <input
                type="number"
                min={1}
                max={99}
                value={advanceCount}
                onChange={(e) =>
                  setAdvanceCount(Math.max(1, Math.floor(Number(e.target.value) || 1)))
                }
                className="w-16 rounded-md border border-border bg-[color:var(--mp-surface-3)] px-2.5 py-2 text-sm"
                aria-label="各ブロック進出数"
              />
            </div>
          )}
          <button
            type="button"
            onClick={onRegenerate}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-md border border-[color:var(--mp-border-strong)] bg-[color:var(--mp-surface-3)] px-4 py-2.5 text-[13px] font-semibold transition hover:border-[color:var(--mp-fg-subtle)] hover:bg-[color:var(--mp-surface-2)] disabled:opacity-45"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 2v6h-6" />
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
              <path d="M3 22v-6h6" />
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            </svg>
            作り直す
          </button>
        </div>
      </div>

      {/* ラウンド別 BO。 */}
      {roundBoGroups.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-border pt-3.5">
          <span className="text-[11.5px] text-[color:var(--mp-fg-subtle)]">ラウンド別 BO</span>
          {roundBoGroups.map((g) => (
            <RoundBoRow
              key={`${g.round}:${g.thirdPlace ? "3rd" : "main"}`}
              eventId={eventId}
              group={g}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** トーナメントで設定できる BO（奇数のみ・引分なし・groupBestOf は最大15）。 */
const ODD_BO_OPTIONS = [1, 3, 5, 7, 9, 11, 13, 15];

/** ラウンド別 BO 編集の1行（ラベル＋BOピル＋locked注記）。 */
function RoundBoRow({
  eventId,
  group,
}: {
  eventId: string;
  group: RoundBoGroup;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function setBo(bestOf: number) {
    if (bestOf === group.bestOf || group.locked) return;
    setError(null);
    startTransition(async () => {
      const res = await updateRoundBestOfAction(eventId, {
        round: group.round,
        thirdPlace: group.thirdPlace,
        bestOf,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <span className="font-mono text-[9px] uppercase tracking-wider text-[color:var(--mp-fg-subtle)]">
        {group.label}
      </span>
      <div className="inline-flex gap-0.5 rounded-md border border-border bg-[color:var(--mp-surface-3)] p-0.5">
        {ODD_BO_OPTIONS.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setBo(v)}
            disabled={group.locked || isPending}
            className={`rounded-sm px-2.5 py-1.5 font-mono text-[11px] font-semibold transition disabled:opacity-45 ${
              group.bestOf === v
                ? "bg-[color:var(--mp-brand)] text-[color:var(--mp-on-brand)]"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            BO{v}
          </button>
        ))}
      </div>
      {group.locked && (
        <span className="text-[10px] text-[color:var(--mp-fg-subtle)]">結果入力済み</span>
      )}
      {error && <span className="text-[10px] text-[color:var(--mp-danger)]">{error}</span>}
    </div>
  );
}

/**
 * 試合モーダル（カードクリックで開く）。スコア（ステッパー）・POTG取得数・
 * マップ別リプレイコード・日時・配信を編集。観戦者・非権限者は閲覧のみ（readonly）。
 * 既存のトーナメント結果入力ロジック（reportTournamentResult の needsConfirm フロー）を踏襲。
 */
function MatchModal({
  match,
  totalRounds,
  readOnly,
  usePotg,
  onClose,
}: {
  match: BoardBracketMatch;
  totalRounds: number;
  readOnly: boolean;
  usePotg: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
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
  const [confirm, setConfirm] = useState<{ count: number } | null>(null);
  const [isPending, startTransition] = useTransition();

  // ESC で閉じる。
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const roundName = match.isThirdPlace
    ? "3位決定戦"
    : roundLabel(match.round, totalRounds);

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

  function submit(confirmed: boolean) {
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
    startTransition(async () => {
      const res = await reportTournamentResult(
        {
          matchId: match.id,
          teamAScore: scoreA,
          teamBScore: scoreB,
          potgA: pa,
          potgB: pb,
          replayCodes: replayCodes.slice(0, mapsPlayed(scoreA, scoreB)),
        },
        confirmed,
      );
      if (res.needsConfirm) {
        setConfirm({ count: res.clearCount ?? 0 });
        return;
      }
      if (res.error) {
        setValidationError(res.error);
        return;
      }
      setConfirm(null);
      onClose();
      router.refresh();
    });
  }

  function handleClear() {
    setValidationError(null);
    startTransition(async () => {
      const res = await clearTournamentResult(match.id);
      if (res.error) {
        setValidationError(res.error);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  function handleSchedule() {
    setValidationError(null);
    startTransition(async () => {
      const res = await updateSchedule({ matchId: match.id, scheduledAtLocal: scheduledAt });
      if (res.error) {
        setValidationError(res.error);
        return;
      }
      router.refresh();
    });
  }
  function handleStream() {
    setValidationError(null);
    startTransition(async () => {
      const res = await updateStream({ matchId: match.id, streamUrl, streamerName });
      if (res.error) {
        setValidationError(res.error);
        return;
      }
      router.refresh();
    });
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
            Match · {roundName}
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
                    onClick={handleSchedule}
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
                      onClick={handleStream}
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
              onClick={handleClear}
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
                onClick={() => submit(false)}
                disabled={isPending}
                className="rounded-md bg-[color:var(--mp-brand)] px-4 py-2 text-[13px] font-semibold text-[color:var(--mp-on-brand)] shadow-[0_0_0_1px_rgba(255,106,43,.35),0_6px_18px_rgba(255,106,43,.2)] transition hover:bg-[color:var(--mp-brand-hover)] disabled:opacity-45"
              >
                結果を保存
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 下流の結果が消える修正のときだけ確認する（条件付き）。 */}
      <AlertDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>この先の試合結果も削除されます</AlertDialogTitle>
            <AlertDialogDescription>
              この修正で勝者が変わるため、すでに入力済みの後続{confirm?.count ?? 0}
              試合の結果が削除されます。よろしいですか？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={() => submit(true)}>
              修正して反映する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
