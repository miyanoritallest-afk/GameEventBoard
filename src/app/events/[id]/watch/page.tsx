import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { findEventById, findEventBySlug } from "@/lib/repositories/events";
import { listTeamsWithMembers } from "@/lib/repositories/teams";
import { listGroupsWithTeams } from "@/lib/repositories/groups";
import {
  listGroupMatches,
  listTournamentMatches,
} from "@/lib/repositories/matches";
import { listMatchResultsByEvent } from "@/lib/repositories/match-results";
import { computeStandings } from "@/lib/services/standings";
import { canViewEvent } from "@/lib/services/event-status";
import {
  hasGroupStage,
  hasTournamentStage,
} from "@/lib/services/event-format";
import { isValidEventSlug } from "@/lib/services/event-slug";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  draft: "下書き",
  published: "公開中",
  recruiting: "募集中",
  closed: "募集締切",
  ongoing: "開催中",
  finished: "終了",
};

/**
 * ラウンド番号からラベルを作る（最終ラウンド=決勝, その前=準決勝…）。
 * 決勝トーナメント詳細（tournament-board.tsx の roundLabel）と同じ規則。
 */
function tournamentRoundLabel(round: number, totalRounds: number): string {
  const fromLast = totalRounds - round; // 0=決勝, 1=準決勝, 2=準々決勝
  if (fromLast === 0) return "決勝";
  if (fromLast === 1) return "準決勝";
  if (fromLast === 2) return "準々決勝";
  return `${round}回戦`;
}

/** UTC(ISO) を JST 表示に整形する。null は "未定"。 */
function fmtJst(iso: string | null): string {
  if (!iso) return "未定";
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 観戦集約ページ（/events/[id]/watch）。
 * 参加チーム・ブロック・予選順位・試合結果・決勝トーナメントを1ページに通覧する
 * 観戦者向けビュー。各セクションは「サマリー＋詳細ページへの導線」。編集UIは持たない。
 *
 * 表示ルール: 観戦者区分のためメンバーは登録名のみ（Discord名・バトルタグは出さない）。
 * 空セクション（未実施）は丸ごと非表示にし、進行に応じてセクションが増えていく。
 * 閲覧は「公開済みなら誰でも・下書きは主催者のみ」（canViewEvent）。
 */
export default async function EventWatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const event = isValidEventSlug(id)
    ? await findEventBySlug(id)
    : await findEventById(id);
  if (!event) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const viewerId = user?.id ?? null;
  if (!canViewEvent(event.status, event.organizer_id, viewerId)) notFound();

  const detailHref = `/events/${event.slug ?? event.id}`;
  const gameName = (event.games as { name: string } | null)?.name ?? "-";
  const organizerName =
    event.organizer_display_name ??
    (event.organizer as { discord_name: string } | null)?.discord_name ??
    "-";

  const [teamsRaw, groupsRaw, groupMatchesRaw, resultsRaw, tournamentRaw] =
    await Promise.all([
      listTeamsWithMembers(event.id),
      listGroupsWithTeams(event.id),
      listGroupMatches(event.id),
      listMatchResultsByEvent(event.id),
      listTournamentMatches(event.id),
    ]);

  // ── 参加チーム（登録名のみ・regular/reserve 区分） ──────────────
  type MemberJoin = {
    position: string;
    is_representative: boolean;
    registrations: {
      display_name: string | null;
      users: { discord_name: string } | null;
    } | null;
  };
  type TeamJoin = {
    id: string;
    name: string;
    status: string;
    team_members: MemberJoin[] | null;
  };
  const teams = ((teamsRaw ?? []) as unknown as TeamJoin[]).map((t) => {
    const members = (t.team_members ?? []).map((tm) => {
      const reg = tm.registrations;
      // 観戦者区分: 登録名 ?? Discord名（Discord名は内部識別だが、表示名が無い場合の
      // フォールバックとしてのみ使う。素のDiscord名を単独で見せる用途ではない）。
      const name = reg?.display_name ?? reg?.users?.discord_name ?? "-";
      return { name, position: tm.position };
    });
    return {
      id: t.id,
      name: t.name,
      regular: members.filter((m) => m.position !== "reserve").map((m) => m.name),
      reserve: members.filter((m) => m.position === "reserve").map((m) => m.name),
    };
  });

  // ── チーム名解決（ブロック・試合・トーナメントで使う） ──────────
  const teamNameById = new Map<string, string>();
  for (const t of teams) teamNameById.set(t.id, t.name);

  // ── ブロック分け ──────────────────────────────────────────────
  type GroupTeamJoin = {
    teams: { id: string; name: string } | null;
  };
  type GroupJoin = {
    id: string;
    name: string;
    group_teams: GroupTeamJoin[] | null;
  };
  const groups = ((groupsRaw ?? []) as unknown as GroupJoin[]).map((g) => ({
    id: g.id,
    name: g.name,
    teamNames: (g.group_teams ?? [])
      .map((gt) => gt.teams?.name)
      .filter((n): n is string => !!n),
  }));

  // ── 試合結果（予選） ──────────────────────────────────────────
  type ResultRow = {
    match_id: string;
    team_a_score: number;
    team_b_score: number;
    winner_team_id: string | null;
    potg_a: number;
    potg_b: number;
    updated_at: string | null;
  };
  const resultRows = (resultsRaw ?? []) as unknown as ResultRow[];
  const resultByMatch = new Map<string, ResultRow>();
  for (const r of resultRows) resultByMatch.set(r.match_id, r);

  type MatchRow = {
    id: string;
    group_id: string | null;
    team_a_id: string | null;
    team_b_id: string | null;
  };
  const groupMatches = (groupMatchesRaw ?? []) as MatchRow[];
  const matchById = new Map<string, MatchRow>();
  for (const m of groupMatches) matchById.set(m.id, m);

  // 消化済み試合（予選のうち結果あり）。
  const finishedMatches = groupMatches
    .filter((m) => resultByMatch.has(m.id))
    .map((m) => {
      const r = resultByMatch.get(m.id)!;
      return {
        id: m.id,
        teamAName: m.team_a_id ? teamNameById.get(m.team_a_id) ?? "-" : "-",
        teamBName: m.team_b_id ? teamNameById.get(m.team_b_id) ?? "-" : "-",
        teamAScore: r.team_a_score,
        teamBScore: r.team_b_score,
        finishedAt: r.updated_at,
      };
    });
  // サマリーは「直近に結果が確定した試合」を最新5件。確定時刻（updated_at）降順で取り、
  // ブロック単位の生成順ではなく実際の消化順に並べる（ブロック偏りを避ける）。
  const recentResults = [...finishedMatches]
    .sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""))
    .slice(0, 5);

  // ── 予選順位（ランキング ON のときだけ。ブロックごとに集計） ────
  const rankingConfig = {
    pointsWin: event.points_win,
    pointsDraw: event.points_draw,
    pointsLoss: event.points_loss,
    tiebreakers: (event.tiebreakers ?? []) as (
      | "head_to_head"
      | "map_diff"
      | "potg"
    )[],
  };

  type GroupTeamWithId = {
    id: string;
    name: string;
    group_teams: { teams: { id: string; name: string } | null }[] | null;
  };
  const standingsByGroup = event.ranking_enabled
    ? ((groupsRaw ?? []) as unknown as GroupTeamWithId[]).map((g) => {
        const teamIds = (g.group_teams ?? [])
          .map((gt) => gt.teams?.id)
          .filter((x): x is string => !!x);
        const teamIdSet = new Set(teamIds);
        const groupResults = resultRows
          .map((res) => {
            const m = matchById.get(res.match_id);
            return m ? { m, res } : null;
          })
          .filter(
            (x): x is { m: MatchRow; res: ResultRow } =>
              x !== null &&
              x.m.team_a_id != null &&
              x.m.team_b_id != null &&
              teamIdSet.has(x.m.team_a_id) &&
              teamIdSet.has(x.m.team_b_id),
          )
          .map(({ m, res }) => ({
            teamAId: m.team_a_id as string,
            teamBId: m.team_b_id as string,
            teamAScore: res.team_a_score,
            teamBScore: res.team_b_score,
            potgA: res.potg_a,
            potgB: res.potg_b,
          }));
        const rows = computeStandings({
          teamIds,
          results: groupResults,
          config: rankingConfig,
        }).map((row) => ({
          teamName: teamNameById.get(row.teamId) ?? "-",
          points: row.points,
          rank: row.rank,
        }));
        return { id: g.id, name: g.name, rows };
      })
    : [];
  // 結果が1件もないブロックの順位は出さない（全0点の羅列を避ける）。
  const standingsToShow = standingsByGroup.filter(() => finishedMatches.length > 0);

  // ── 決勝トーナメント（簡易ブラケット: round ごとの対戦カード） ──
  type TMatchRow = {
    id: string;
    team_a_id: string | null;
    team_b_id: string | null;
    round: number | null;
    bracket_position: number | null;
  };
  const tournamentMatches = (tournamentRaw ?? []) as TMatchRow[];
  // ラウンド名（決勝/準決勝/…）は最終ラウンドからの距離で決まるので、まず総ラウンド数を求める。
  const totalTournamentRounds =
    tournamentMatches.length > 0
      ? Math.max(...tournamentMatches.map((m) => m.round ?? 1))
      : 0;
  const roundsMap = new Map<
    number,
    {
      position: number;
      teamAName: string | null;
      teamBName: string | null;
      teamAScore: number | null;
      teamBScore: number | null;
    }[]
  >();
  for (const m of tournamentMatches) {
    const round = m.round ?? 1;
    const r = resultByMatch.get(m.id) ?? null;
    const arr = roundsMap.get(round) ?? [];
    arr.push({
      position: m.bracket_position ?? 0,
      teamAName: m.team_a_id ? teamNameById.get(m.team_a_id) ?? "未定" : "未定",
      teamBName: m.team_b_id ? teamNameById.get(m.team_b_id) ?? "未定" : "未定",
      teamAScore: r?.team_a_score ?? null,
      teamBScore: r?.team_b_score ?? null,
    });
    roundsMap.set(round, arr);
  }
  const rounds = [...roundsMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([round, matches]) => ({
      round,
      label: tournamentRoundLabel(round, totalTournamentRounds),
      // 最終ラウンドは [3位決定戦(position 1), 決勝(position 2)] の2枠。position 昇順で並べる。
      matches: [...matches]
        .sort((a, b) => a.position - b.position)
        .map((m) => ({
          ...m,
          isThirdPlace: round === totalTournamentRounds && m.position === 1,
        })),
    }));

  // セクションの表示判定。
  // 形式（format）でまず出せるステージを絞り、その中で空（未実施）なら丸ごと非表示にする（PR-2）。
  // 予選を持たない形式（トーナメントのみ）ではブロック/予選順位/予選結果を一切出さず、
  // 決勝Tを持たない形式（総当たりのみ）では決勝Tセクションを出さない。
  const groupStage = hasGroupStage(event.format);
  const tournamentStage = hasTournamentStage(event.format);
  const showTeams = teams.length > 0;
  const showGroups = groupStage && groups.length > 0;
  const showStandings = groupStage && standingsToShow.length > 0;
  const showResults = groupStage && finishedMatches.length > 0;
  const showTournament = tournamentStage && rounds.length > 0;

  const matchesHref = `/events/${event.id}/matches`;

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <Link
          href={detailHref}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← イベント詳細に戻る
        </Link>

        {/* イベント概要 */}
        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{event.title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="rounded bg-muted px-2 py-0.5">{gameName}</span>
              <span className="rounded bg-muted px-2 py-0.5">
                状態: {STATUS_LABEL[event.status] ?? event.status}
              </span>
              <span className="rounded bg-muted px-2 py-0.5">
                主催: {organizerName}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              開催 {fmtJst(event.starts_at)}
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
            観戦ビュー
          </span>
        </div>

        {/* 参加チーム */}
        {showTeams && (
          <Section
            title={`参加チーム (${teams.length})`}
            action={{ href: `/events/${event.id}/teams`, label: "詳しく見る →" }}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {teams.map((t) => (
                <div
                  key={t.id}
                  className="rounded-xl border border-border bg-card p-4"
                >
                  <p className="font-semibold">{t.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    <span className="text-xs font-medium text-foreground/70">
                      regular:{" "}
                    </span>
                    {t.regular.length > 0 ? t.regular.join(" / ") : "—"}
                  </p>
                  {t.reserve.length > 0 && (
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      <span className="text-xs font-medium text-foreground/70">
                        reserve:{" "}
                      </span>
                      {t.reserve.join(" / ")}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ブロック分け */}
        {showGroups && (
          <Section
            title="ブロック分け"
            action={{ href: `/events/${event.id}/groups`, label: "詳しく見る →" }}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {groups.map((g) => (
                <div
                  key={g.id}
                  className="rounded-xl border border-border bg-card p-4"
                >
                  <p className="font-semibold">{g.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {g.teamNames.length > 0 ? g.teamNames.join(" / ") : "—"}
                  </p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* 予選順位 */}
        {showStandings && (
          <Section
            title="予選 順位"
            action={{ href: matchesHref, label: "詳しく見る →" }}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {standingsToShow.map((g) => (
                <div
                  key={g.id}
                  className="rounded-xl border border-border bg-card p-4"
                >
                  <p className="font-semibold">{g.name}</p>
                  <ol className="mt-2 space-y-1 text-sm">
                    {g.rows.map((row, i) => (
                      <li
                        key={i}
                        className="flex items-center justify-between gap-2"
                      >
                        <span>
                          <span className="text-muted-foreground">
                            {row.rank}.{" "}
                          </span>
                          {row.teamName}
                        </span>
                        <span className="tabular-nums text-muted-foreground">
                          {row.points}pt
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* 予選 試合結果 */}
        {showResults && (
          <Section
            title={`予選 試合結果 (${finishedMatches.length}/${groupMatches.length} 試合消化)`}
            action={{ href: matchesHref, label: "詳しく見る →" }}
          >
            <ul className="space-y-2">
              {recentResults.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-2 text-sm"
                >
                  <span>{m.teamAName}</span>
                  <span className="font-semibold tabular-nums">
                    {m.teamAScore} - {m.teamBScore}
                  </span>
                  <span className="text-right">{m.teamBName}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* 決勝トーナメント（簡易ブラケット） */}
        {showTournament && (
          <Section
            title="決勝トーナメント"
            action={{
              href: `/events/${event.id}/tournament`,
              label: "詳しく見る →",
            }}
          >
            <div className="flex flex-wrap gap-4">
              {rounds.map((r) => (
                <div key={r.round} className="min-w-[200px] flex-1">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    {r.label}
                  </p>
                  <div className="space-y-2">
                    {r.matches.map((m, i) => (
                      <div
                        key={i}
                        className="rounded-lg border border-border bg-card p-3 text-sm"
                      >
                        {m.isThirdPlace && (
                          <p className="mb-1 text-xs font-semibold text-muted-foreground">
                            3位決定戦
                          </p>
                        )}
                        <div className="flex items-center justify-between gap-2">
                          <span>{m.teamAName}</span>
                          <span className="tabular-nums text-muted-foreground">
                            {m.teamAScore ?? "-"}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <span>{m.teamBName}</span>
                          <span className="tabular-nums text-muted-foreground">
                            {m.teamBScore ?? "-"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* どのセクションも出ない初期段階の案内 */}
        {!showTeams && (
          <p className="mt-10 text-sm text-muted-foreground">
            まだ参加チームが確定していません。募集・編成が進むと、ここに参加チームやブロック・対戦表が表示されます。
          </p>
        )}
      </div>
    </div>
  );
}

/** セクション枠（見出し＋右上の詳細リンク＋本体）。 */
function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8 border-t border-border pt-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{title}</h2>
        {action && (
          <Link
            href={action.href}
            className="text-sm text-primary hover:underline"
          >
            {action.label}
          </Link>
        )}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}
