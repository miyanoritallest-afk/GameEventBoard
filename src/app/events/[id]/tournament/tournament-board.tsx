"use client";

import { useState, useTransition } from "react";
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
} from "./actions";

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

export function TournamentBoard({
  eventId,
  readOnly,
  rankingEnabled,
  usePotg,
  swapEnabled,
  podium,
  initialAdvanceCount,
  previewSeeded,
  initialMatches,
}: {
  eventId: string;
  /** 応募者の閲覧（read-only）。生成操作を無効化する。 */
  readOnly: boolean;
  /** 順位機能が有効か。無効だと進出抽出ができないので生成不可。 */
  rankingEnabled: boolean;
  /** POTG を使うイベントか（結果入力に POTG 欄を出すか）。 */
  usePotg: boolean;
  /** 1回戦の手動入れ替え（D&D）を許可するか（主催者かつ結果が1件もないとき）。 */
  swapEnabled: boolean;
  /** 表彰台（優勝・準優勝・3位の表示名）。 */
  podium: Podium;
  initialAdvanceCount: number;
  /** 現在の進出数で抽出されるシード順チーム（生成前プレビュー）。 */
  previewSeeded: PreviewSeed[];
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

  const hasBracket = initialMatches.length > 0;
  const totalRounds = hasBracket
    ? Math.max(...initialMatches.map((m) => m.round))
    : 0;

  // ラウンドごとに束ねる（position 昇順）。
  const rounds: BoardBracketMatch[][] = [];
  for (let r = 1; r <= totalRounds; r++) {
    rounds.push(
      initialMatches
        .filter((m) => m.round === r)
        .sort((a, b) => a.position - b.position),
    );
  }

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

  return (
    <div className="mt-6 space-y-6">
      {error && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {readOnly && (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          参加者として閲覧しています。トーナメントの生成は主催者のみ可能です。
        </p>
      )}

      {!readOnly && !rankingEnabled && (
        <p className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
          決勝トーナメントには順位機能が必要です。イベント編集で順位設定を有効にしてください。
        </p>
      )}

      {/* 生成エリア（主催者・順位機能ON のときのみ）。 */}
      {!readOnly && rankingEnabled && (
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">トーナメントを生成</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            各ブロックの上位チームをシードに、シングルエリミネーションのブラケットを作ります。
            生成後はドラッグ＆ドロップなどで手動調整できます（本戦-5c）。
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
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
              className="w-20 rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <span className="text-sm text-muted-foreground">チームが進出</span>
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              disabled={isPending}
              className="ml-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {hasBracket ? "トーナメントを作り直す" : "トーナメントを生成"}
            </button>
          </div>

          {/* 進出予定チームのプレビュー（生成前の確認補助）。 */}
          {previewSeeded.length > 0 && (
            <div className="mt-3 text-xs text-muted-foreground">
              現在の設定で進出（シード順）: {previewSeeded.length}チーム
              <ol className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {previewSeeded.map((s) => (
                  <li key={s.teamId} className="tabular-nums">
                    <span className="font-semibold text-foreground">{s.seed}.</span>{" "}
                    {s.teamName}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      {/* 表彰台（決勝などが確定したら表示）。 */}
      {hasPodium && (
        <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
          <h2 className="text-sm font-semibold text-primary">表彰台</h2>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {podium.champion && (
              <span>
                🏆 優勝: <span className="font-semibold">{podium.champion}</span>
              </span>
            )}
            {podium.runnerUp && (
              <span>
                🥈 準優勝: <span className="font-medium">{podium.runnerUp}</span>
              </span>
            )}
            {podium.third.length > 0 && (
              <span>
                🥉 {podium.third.length > 1 ? "3位タイ" : "3位"}:{" "}
                <span className="font-medium">{podium.third.join(" / ")}</span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* 手動入れ替えの案内（1回戦・結果なしのときのみ）。 */}
      {swapEnabled && hasBracket && (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          1回戦のチームはドラッグ＆ドロップで入れ替えできます（結果を入力すると入れ替えはできなくなります）。
        </p>
      )}

      {/* ブラケット表示 */}
      {!hasBracket ? (
        <p className="text-sm text-muted-foreground">
          まだトーナメントが生成されていません。
          {!readOnly && rankingEnabled && "上の「トーナメントを生成」で作成してください。"}
        </p>
      ) : (
        <DndContext
          id="tournament-board-dnd"
          sensors={sensors}
          collisionDetection={dropCollision}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-6 overflow-x-auto pb-4">
            {rounds.map((roundMatches, i) => (
              <div key={i} className="flex min-w-[14rem] flex-col gap-4">
                <h3 className="text-sm font-semibold text-muted-foreground">
                  {roundLabel(i + 1, totalRounds)}
                </h3>
                <div className="flex flex-1 flex-col justify-around gap-4">
                  {roundMatches.map((m) => (
                    <BracketCard
                      key={m.id}
                      match={m}
                      readOnly={readOnly}
                      usePotg={usePotg}
                      // 1回戦かつ swap 可能なときだけスロットをドラッグ対象にする。
                      swappable={swapEnabled && m.round === 1}
                      // 最終 round の position 1 は3位決定戦（ラベル出し分け用）。
                      isThirdPlace={m.round === totalRounds && m.position === 1}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DndContext>
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
              {hasBracket
                ? "現在のトーナメント表と入力済みの試合結果がすべて削除され、各ブロック上位"
                : "各ブロック上位"}
              {advanceCount}チームをシードに新しいブラケットを作成します。
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

/**
 * ブラケットの1試合カード。未確定スロットは「未定」と表示。
 * - swappable（1回戦・結果なし）: スロットを D&D で入れ替え可能にする（結果入力は出さない）。
 * - それ以外: 両チーム確定かつ入力権限があればクリックで結果入力フォームを展開。
 */
function BracketCard({
  match,
  readOnly,
  usePotg,
  swappable,
  isThirdPlace,
}: {
  match: BoardBracketMatch;
  readOnly: boolean;
  usePotg: boolean;
  swappable: boolean;
  isThirdPlace: boolean;
}) {
  const [open, setOpen] = useState(false);
  const bothSet = match.teamAId !== null && match.teamBId !== null;
  // 入力できるのは「閲覧者でない（主催者）or 代表」かつ両チーム確定のとき。
  const canInput = (!readOnly || match.canReport) && bothSet;

  const winnerA =
    match.winnerTeamId !== null && match.winnerTeamId === match.teamAId;
  const winnerB =
    match.winnerTeamId !== null && match.winnerTeamId === match.teamBId;

  return (
    <div className="rounded-lg border border-border bg-card text-sm">
      {isThirdPlace && (
        <div className="border-b border-border px-3 pt-2 text-xs font-semibold text-muted-foreground">
          3位決定戦
        </div>
      )}

      {swappable ? (
        // 1回戦の入れ替え用: 各スロットを draggable＋droppable にする。
        <div className="p-3">
          <SwapSlot
            matchId={match.id}
            slot="a"
            name={match.teamAName}
            teamId={match.teamAId}
          />
          <div className="my-1 border-t border-dashed border-border" />
          <SwapSlot
            matchId={match.id}
            slot="b"
            name={match.teamBName}
            teamId={match.teamBId}
          />
        </div>
      ) : (
        <button
          type="button"
          disabled={!canInput}
          onClick={() => canInput && setOpen((v) => !v)}
          className={`w-full p-3 text-left ${canInput ? "hover:bg-muted/40" : ""}`}
        >
          <ScoreSlot
            name={match.teamAName}
            score={match.teamAScore}
            winner={winnerA}
          />
          <div className="my-1 border-t border-dashed border-border" />
          <ScoreSlot
            name={match.teamBName}
            score={match.teamBScore}
            winner={winnerB}
          />
        </button>
      )}

      {!swappable && open && canInput && (
        <ResultForm
          match={match}
          usePotg={usePotg}
          onDone={() => setOpen(false)}
        />
      )}
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
      className={`rounded px-1 py-1 ${isOver ? "bg-primary/10" : ""}`}
    >
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        className={`${teamId !== null ? "cursor-grab" : ""} ${
          isDragging ? "opacity-40" : ""
        } ${name ? "font-medium" : "text-muted-foreground"}`}
      >
        {name ?? "未定"}
      </div>
    </div>
  );
}

/** スコア付きスロット。勝者は強調、未確定は「未定」。 */
function ScoreSlot({
  name,
  score,
  winner,
}: {
  name: string | null;
  score: number | null;
  winner: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span
        className={
          name
            ? winner
              ? "font-semibold text-primary"
              : "font-medium"
            : "text-muted-foreground"
        }
      >
        {winner && "🏆 "}
        {name ?? "未定"}
      </span>
      {score !== null && (
        <span
          className={`tabular-nums ${winner ? "font-bold text-primary" : ""}`}
        >
          {score}
        </span>
      )}
    </div>
  );
}

/**
 * ブラケットカード内の結果入力フォーム（クリック展開）。
 * スコア（取マップ数）＋必要なら POTG。保存で reportTournamentResult を呼ぶ。
 * 下流の結果が消える修正のときだけ、サーバーが needsConfirm を返すので AlertDialog で確認する。
 */
function ResultForm({
  match,
  usePotg,
  onDone,
}: {
  match: BoardBracketMatch;
  usePotg: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const [aScore, setAScore] = useState(match.teamAScore ?? 0);
  const [bScore, setBScore] = useState(match.teamBScore ?? 0);
  const [aPotg, setAPotg] = useState(match.potgA);
  const [bPotg, setBPotg] = useState(match.potgB);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ count: number } | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(confirmed: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await reportTournamentResult(
        {
          matchId: match.id,
          teamAScore: aScore,
          teamBScore: bScore,
          potgA: usePotg ? aPotg : 0,
          potgB: usePotg ? bPotg : 0,
        },
        confirmed,
      );
      if (res.needsConfirm) {
        setConfirm({ count: res.clearCount ?? 0 });
        return;
      }
      if (res.error) {
        setError(res.error);
        return;
      }
      setConfirm(null);
      onDone();
      router.refresh();
    });
  }

  function handleClear() {
    setError(null);
    startTransition(async () => {
      const res = await clearTournamentResult(match.id);
      if (res.error) {
        setError(res.error);
        return;
      }
      onDone();
      router.refresh();
    });
  }

  return (
    <div className="border-t border-border p-3">
      <p className="mb-2 text-xs text-muted-foreground">
        取ったマップ数を入力（BO{match.bestOf}）
      </p>
      {error && (
        <p className="mb-2 rounded border border-destructive/50 bg-destructive/10 px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="space-y-2">
        <ScoreInput
          label={match.teamAName ?? "A"}
          score={aScore}
          potg={aPotg}
          usePotg={usePotg}
          onScore={setAScore}
          onPotg={setAPotg}
        />
        <ScoreInput
          label={match.teamBName ?? "B"}
          score={bScore}
          potg={bPotg}
          usePotg={usePotg}
          onScore={setBScore}
          onPotg={setBPotg}
        />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => submit(false)}
          disabled={isPending}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          保存
        </button>
        {match.hasResult && (
          <button
            type="button"
            onClick={handleClear}
            disabled={isPending}
            className="text-xs text-muted-foreground hover:text-destructive disabled:opacity-60"
          >
            取り消し
          </button>
        )}
        <button
          type="button"
          onClick={onDone}
          className="ml-auto text-xs text-muted-foreground hover:text-foreground"
        >
          閉じる
        </button>
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

/** 1チーム分のスコア（＋POTG）入力行。 */
function ScoreInput({
  label,
  score,
  potg,
  usePotg,
  onScore,
  onPotg,
}: {
  label: string;
  score: number;
  potg: number;
  usePotg: boolean;
  onScore: (n: number) => void;
  onPotg: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex-1 truncate text-xs">{label}</span>
      <input
        type="number"
        min={0}
        max={20}
        value={score}
        onChange={(e) => onScore(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        className="w-14 rounded-md border border-border bg-background px-2 py-1 text-sm tabular-nums"
        aria-label={`${label} の取マップ数`}
      />
      {usePotg && (
        <input
          type="number"
          min={0}
          max={99}
          value={potg}
          onChange={(e) => onPotg(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          className="w-14 rounded-md border border-border bg-background px-2 py-1 text-sm tabular-nums"
          aria-label={`${label} の POTG 数`}
          title="POTG"
        />
      )}
    </div>
  );
}
