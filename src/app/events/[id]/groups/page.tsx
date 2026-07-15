import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { findEventByIdOrSlug } from "@/lib/repositories/events";
import {
  listGroupsWithTeams,
  listUnassignedApprovedTeams,
} from "@/lib/repositories/groups";
import { listGroupMatches } from "@/lib/repositories/matches";
import { teamScore, type MemberScore } from "@/lib/services/team-score";
import { canViewEvent } from "@/lib/services/event-status";
import { hasGroupStage } from "@/lib/services/event-format";
import { GroupsBoard, type BoardGroup, type BoardTeam } from "./groups-board";

export const dynamic = "force-dynamic";

/**
 * 予選ブロック分け画面（本戦 PR-1）。
 * 認証ガードはチーム編成（/teams）と同型:
 * - A: 未ログインは /login へリダイレクト。
 * - 閲覧は「主催者 or そのイベントの応募者」。主催者は編集可、応募者は閲覧のみ（read-only）。
 *   それ以外・存在しないイベントは 404（存在を隠す）。
 *
 * 承認済み（approved）チームを未割当プールに出し、D&D でブロックへ振り分ける。
 * チーム平均スコアは出場メンバーのみで算出（DB設計 4.2）。
 */
export default async function EventGroupsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const viewerId = user?.id ?? null;

  const event = await findEventByIdOrSlug(id);
  if (!event) notFound();
  // 閲覧は「公開済みなら誰でも（観戦者含む）・下書きは主催者のみ」。編集は readOnly で制御。
  if (!canViewEvent(event.status, event.organizer_id, viewerId)) {
    notFound();
  }
  // 形式による出し分け（PR-2）。予選を持たない形式（トーナメントのみ）では
  // ブロック分けページ自体が存在しないものとして 404（URL直叩きの抑止）。
  if (!hasGroupStage(event.format)) notFound();
  const isOrganizer = viewerId !== null && event.organizer_id === viewerId;

  const [groupsRaw, unassignedRaw, matchesRaw] = await Promise.all([
    listGroupsWithTeams(event.id),
    listUnassignedApprovedTeams(event.id),
    listGroupMatches(event.id),
  ]);

  // 対戦表が1件でも生成済みなら、ブロックの組み替えは事故るのでロックする（⑬）。
  // 生成後に移動すると対戦カードと所属ブロックがズレるため。
  const matchesGenerated = (matchesRaw ?? []).length > 0;

  // DB の戻りをボード用の素直な型へ整形する。チーム平均は出場メンバーのみで算出。
  type TeamJoin = {
    id: string;
    name: string;
    status: string;
    team_members:
      | {
          position: string;
          registrations: {
            final_score: number | null;
            organizer_override_score: number | null;
          } | null;
        }[]
      | null;
  };

  function toBoardTeam(t: TeamJoin): BoardTeam {
    const members: MemberScore[] = (t.team_members ?? []).map((tm) => ({
      id: "",
      position: tm.position === "reserve" ? "reserve" : "regular",
      finalScore: tm.registrations?.final_score ?? null,
      overrideScore: tm.registrations?.organizer_override_score ?? null,
    }));
    return {
      id: t.id,
      name: t.name,
      score: teamScore(members),
    };
  }

  const groups: BoardGroup[] = (groupsRaw ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    teams: (g.group_teams ?? []).map((gt) =>
      toBoardTeam(gt.teams as unknown as TeamJoin),
    ),
  }));

  // 未割当プールは振り分け作業の領域。観戦者（read-only）には見せず、確定したブロックだけ表示する。
  const unassigned: BoardTeam[] = isOrganizer
    ? (unassignedRaw ?? []).map((t) => toBoardTeam(t as unknown as TeamJoin))
    : [];

  // シード番号（表示用の派生値）: 全チームを平均スコア降順で並べた順位を各チームに付ける。
  // スコアの高い順に #1, #2, ...。スコアが null のチームは末尾（seed なし）。
  // 純粋な表示用（DB には保存しない）。Claude Design 案のシードチップ表示に使う。
  {
    const all = [...groups.flatMap((g) => g.teams), ...unassigned];
    const scored = all
      .filter((t) => t.score !== null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    scored.forEach((t, i) => {
      t.seed = i + 1;
    });
  }

  // 立場ラベル（観戦者には Organizer を出さない）。
  const roleLabel = isOrganizer ? "Organizer" : "Viewer";
  // ゲーム名（ヒーローのゲームチップ用）。
  const gameName = (event.games as { name: string } | null)?.name ?? "-";
  const totalTeams =
    groups.reduce((n, g) => n + g.teams.length, 0) + unassigned.length;

  return (
    <div className="theme-matchpoint min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1600px] px-6 py-8">
        {/* パンくず（イベント一覧 → イベント名 → ブロック分け）。 */}
        <nav className="text-sm text-muted-foreground">
          <Link
            href="/events"
            className="underline-offset-2 transition-colors hover:text-[color:var(--mp-brand)] hover:underline"
          >
            イベント一覧
          </Link>
          <span className="mx-2 text-[color:var(--mp-fg-subtle)]">/</span>
          <Link
            href={`/events/${event.slug ?? event.id}`}
            className="underline-offset-2 transition-colors hover:text-[color:var(--mp-brand)] hover:underline"
          >
            {event.title}
          </Link>
          <span className="mx-2 text-[color:var(--mp-fg-subtle)]">/</span>
          <span className="text-foreground">ブロック分け</span>
        </nav>

        {/* ヒーロー：モードラベル＋タイトル・イベント名、ゲームチップ、承認チーム数。 */}
        <header className="mt-5 rounded-2xl border border-border bg-card p-6 shadow-[var(--mp-e2)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-xs font-semibold tracking-widest text-[color:var(--mp-brand)]">
                <span className="h-px w-6 bg-[color:var(--mp-brand)]" />
                GROUP STAGE
                <span className="text-[color:var(--mp-fg-subtle)]">·</span>
                <span className="text-[color:var(--mp-fg-subtle)]">
                  {roleLabel}
                </span>
              </p>
              <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
                ブロック分け
              </h1>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {event.title}
              </p>
            </div>

            {/* 対戦表・観戦ビューへの導線（観戦者にも出す・フェーズB）。 */}
            <div className="flex shrink-0 flex-col items-end gap-1.5 text-sm">
              <Link
                href={`/events/${event.id}/matches`}
                className="text-[color:var(--mp-brand)] underline-offset-2 hover:underline"
              >
                対戦表・順位表へ →
              </Link>
              <Link
                href={`/events/${event.id}/watch`}
                className="text-muted-foreground hover:text-foreground"
              >
                観戦ビューへ →
              </Link>
            </div>
          </div>

          {/* ゲームチップ（赤ドット＋ゲーム名）＋ 承認チーム数。 */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-[color:var(--mp-surface-2)] px-3 py-1 text-xs font-medium text-muted-foreground">
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full bg-[color:var(--mp-danger)]"
              />
              {gameName}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-[color:var(--mp-surface-2)] px-3 py-1 text-xs font-medium text-muted-foreground">
              承認チーム{" "}
              <span className="font-semibold text-foreground tabular-nums">
                {totalTeams}
              </span>
            </span>
          </div>
        </header>

        {/*
          key にサーバー状態のシグネチャ（ブロック構成＋未割当）を渡す。
          GroupsBoard は initialGroups/Unassigned を useState の初期値にするため、
          自動ブロック分け等の router.refresh() で props が変わっても、key が変わらないと
          ローカル state が初期値のままで画面へ反映されない（リロードするまで出ない UX バグ）。
          割当が変わると key も変わり再マウントされ、最新状態で初期化される。ドラッグ等の
          楽観更新は Server Action 成功後も router.refresh() を呼ばず props が変わらないので、
          key も変わらず再マウントは起きない（楽観状態は保持される）。
        */}
        <GroupsBoard
          key={
            groups
              .map((g) => `${g.id}:${g.teams.map((t) => t.id).join(",")}`)
              .join("|") + `#${unassigned.map((t) => t.id).join(",")}`
          }
          eventId={event.id}
          readOnly={!isOrganizer}
          locked={matchesGenerated}
          showScore={event.require_score}
          initialGroups={groups}
          initialUnassigned={unassigned}
        />
      </div>
    </div>
  );
}
