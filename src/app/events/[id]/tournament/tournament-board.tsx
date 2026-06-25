"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { generateTournament } from "./actions";

/** ブラケット1試合（page.tsx で DB から整形して渡す）。 */
export type BoardBracketMatch = {
  id: string;
  round: number;
  position: number;
  teamAId: string | null;
  teamBId: string | null;
  teamAName: string | null;
  teamBName: string | null;
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
  initialAdvanceCount,
  previewSeeded,
  initialMatches,
}: {
  eventId: string;
  /** 応募者の閲覧（read-only）。生成操作を無効化する。 */
  readOnly: boolean;
  /** 順位機能が有効か。無効だと進出抽出ができないので生成不可。 */
  rankingEnabled: boolean;
  initialAdvanceCount: number;
  /** 現在の進出数で抽出されるシード順チーム（生成前プレビュー）。 */
  previewSeeded: PreviewSeed[];
  initialMatches: BoardBracketMatch[];
}) {
  const router = useRouter();
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

      {/* ブラケット表示 */}
      {!hasBracket ? (
        <p className="text-sm text-muted-foreground">
          まだトーナメントが生成されていません。
          {!readOnly && rankingEnabled && "上の「トーナメントを生成」で作成してください。"}
        </p>
      ) : (
        <div className="flex gap-6 overflow-x-auto pb-4">
          {rounds.map((roundMatches, i) => (
            <div key={i} className="flex min-w-[14rem] flex-col gap-4">
              <h3 className="text-sm font-semibold text-muted-foreground">
                {roundLabel(i + 1, totalRounds)}
              </h3>
              <div className="flex flex-1 flex-col justify-around gap-4">
                {roundMatches.map((m) => (
                  <BracketCard key={m.id} match={m} />
                ))}
              </div>
            </div>
          ))}
        </div>
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

/** ブラケットの1試合カード。未確定スロットは「未定」と表示。 */
function BracketCard({ match }: { match: BoardBracketMatch }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 text-sm">
      <Slot name={match.teamAName} />
      <div className="my-1 border-t border-dashed border-border" />
      <Slot name={match.teamBName} />
    </div>
  );
}

function Slot({ name }: { name: string | null }) {
  return (
    <div className={name ? "font-medium" : "text-muted-foreground"}>
      {name ?? "未定"}
    </div>
  );
}
