/**
 * チーム日程（スクリム/練習/公式戦）の並び替え・正規化（Service 層・純粋関数）。副作用なし。
 *
 * スクリム/練習（scrims）と公式戦（matches）を、表示用の統一アイテム ScheduleItem に正規化し、
 * 日程順に並べる。要件（壁打ち確定）:
 *  - 種別: match（公式戦・🔴）/ scrim（🔵）/ practice（🟢）。
 *  - 濃淡: 公式戦は「閲覧者の自チームが絡む」なら own（濃い）、絡まないなら other（控えめ）。
 *    主催者・観戦者は自チームが無い → viewerTeamId=null。この場合は全公式戦を own 扱い（濃い）
 *    にする（控えめにする意味は「自チーム以外を弱める」ことなので、自チームが無いなら弱めない）。
 *  - 消化済み: 開始時刻 + 2時間 を過ぎたら consumed（下部に薄く表示）。スクリムは終了時刻を
 *    持たない運用のため、開始+2h を消化ラインにする（30分程度の後ろ倒しを許容する猶予）。
 *  - 並び: 未消化を日程昇順で上に、消化済みを日程降順で下に（直近の過去が消化済みの先頭）。
 */

/** 消化済みと見なす、開始からの猶予（ミリ秒）。開始+2h。 */
export const CONSUMED_GRACE_MS = 2 * 60 * 60 * 1000;

export type ScheduleKind = "match" | "scrim" | "practice";
export type ScheduleEmphasis = "own" | "other";

export type ScheduleItem = {
  id: string;
  kind: ScheduleKind;
  scheduledAt: string; // UTC ISO
  /** 見出し（公式戦=対戦カード / スクリム=vs相手 or「スクリム」/ 練習=「練習」）。 */
  title: string;
  /** チーム名（自チーム/どのチームの予定か）。公式戦は対戦カードに含むので任意。 */
  teamName?: string;
  memo?: string | null;
  streamUrl?: string | null;
  /** 公式戦の濃淡。scrim/practice は常に own（自チームの予定）。 */
  emphasis: ScheduleEmphasis;
  /** スクリム/練習のみ編集可（公式戦は表示のみ）。 */
  editable: boolean;
  /** 開始+2h を過ぎた消化済みか。 */
  consumed: boolean;
};

type ScrimRow = {
  id: string;
  teamId: string;
  kind: "scrim" | "practice";
  scheduledAt: string;
  opponentName: string | null;
  memo: string | null;
  teamName: string;
};

type MatchRow = {
  id: string;
  scheduledAt: string;
  streamUrl: string | null;
  teamAId: string | null;
  teamBId: string | null;
  teamAName: string;
  teamBName: string;
};

/** スクリム/練習の見出し（vs相手 or 種別名）。 */
function scrimTitle(s: ScrimRow): string {
  if (s.kind === "practice") return "練習";
  return s.opponentName ? `vs ${s.opponentName}` : "スクリム";
}

/**
 * scrims と matches を ScheduleItem[] に正規化して並べる。
 * viewerTeamId: 閲覧者がこのイベントで所属するチーム id（無ければ null＝主催者/観戦者）。
 */
export function buildScheduleItems(params: {
  scrims: ScrimRow[];
  matches: MatchRow[];
  viewerTeamId: string | null;
  now: Date;
}): ScheduleItem[] {
  const nowMs = params.now.getTime();
  const isConsumed = (iso: string) =>
    new Date(iso).getTime() + CONSUMED_GRACE_MS <= nowMs;

  const scrimItems: ScheduleItem[] = params.scrims.map((s) => ({
    id: s.id,
    kind: s.kind,
    scheduledAt: s.scheduledAt,
    title: scrimTitle(s),
    teamName: s.teamName,
    memo: s.memo,
    streamUrl: null,
    emphasis: "own",
    editable: true,
    consumed: isConsumed(s.scheduledAt),
  }));

  const matchItems: ScheduleItem[] = params.matches.map((m) => {
    // 自チームが絡むか。viewerTeamId が無い（主催者/観戦者）なら own 扱い（濃い）。
    const involvesViewer =
      params.viewerTeamId == null ||
      m.teamAId === params.viewerTeamId ||
      m.teamBId === params.viewerTeamId;
    return {
      id: m.id,
      kind: "match" as const,
      scheduledAt: m.scheduledAt,
      title: `${m.teamAName} vs ${m.teamBName}`,
      streamUrl: m.streamUrl,
      emphasis: involvesViewer ? "own" : "other",
      editable: false,
      consumed: isConsumed(m.scheduledAt),
    };
  });

  const all = [...scrimItems, ...matchItems];
  const upcoming = all
    .filter((i) => !i.consumed)
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const consumed = all
    .filter((i) => i.consumed)
    .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
  return [...upcoming, ...consumed];
}
