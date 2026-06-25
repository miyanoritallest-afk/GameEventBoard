import { createClient } from "@/lib/supabase/server";

/**
 * 試合（matches）Repository。DB アクセスを集約する（実装ガイドライン: 層構造）。
 * Supabase クエリビルダのみ（生SQL禁止＝SQLi対策）。
 * 所有権（イベント主催者か）の確認はアクション側で行い、RLS（0014）が最終防衛。
 *
 * 本戦フェーズ PR-2: 予選（phase='group'）の対戦カード生成・追加・削除・一覧。
 * tournament（決勝）は本戦-5 以降。本 Repository のクエリは phase='group' に絞る。
 */

/** 1ブロックの予選試合（結果は含めない）を取得する。生成順（created_at）で返す。 */
export async function listGroupMatches(eventId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("matches")
    .select("id, group_id, team_a_id, team_b_id, best_of, created_at")
    .eq("event_id", eventId)
    .eq("phase", "group")
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data;
}

/** id で試合を1件取得する（所有権確認用に event_id を返す）。無ければ null。 */
export async function findMatchById(matchId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("matches")
    .select("id, event_id, group_id, phase")
    .eq("id", matchId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * 結果入力の認可確認用に、試合＋イベント主催者＋両チームの代表（captain）の user_id を取得する。
 * 「主催者 or 対戦両チームの代表」をアプリ層で判定するために使う（RLS 0015 が最終防衛）。
 *
 * 2つの FK（team_a / team_b）がともに teams を指すため埋め込みが曖昧になるのを避け、
 * matches は素直に取り、両チームの captain の user_id は別クエリで引いて返す。
 * 無ければ null。
 */
export async function findMatchForReport(matchId: string): Promise<{
  id: string;
  eventId: string;
  teamAId: string | null;
  teamBId: string | null;
  bestOf: number;
  organizerId: string;
  captainUserIds: string[];
} | null> {
  const supabase = await createClient();
  const { data: m, error } = await supabase
    .from("matches")
    .select("id, event_id, team_a_id, team_b_id, best_of, events(organizer_id)")
    .eq("id", matchId)
    .maybeSingle();
  if (error) throw error;
  if (!m) return null;

  const organizerId = (m.events as { organizer_id: string } | null)
    ?.organizer_id;
  if (!organizerId) return null;

  // 両チームの代表（captain）の user_id を引く。
  const teamIds = [m.team_a_id, m.team_b_id].filter(
    (id): id is string => !!id,
  );
  let captainUserIds: string[] = [];
  if (teamIds.length > 0) {
    const { data: teams, error: tErr } = await supabase
      .from("teams")
      .select("captain_registration_id, registrations(user_id)")
      .in("id", teamIds);
    if (tErr) throw tErr;
    captainUserIds = (teams ?? [])
      .map(
        (t) =>
          (t.registrations as { user_id: string } | null)?.user_id ?? null,
      )
      .filter((uid): uid is string => !!uid);
  }

  return {
    id: m.id,
    eventId: m.event_id,
    teamAId: m.team_a_id,
    teamBId: m.team_b_id,
    bestOf: m.best_of,
    organizerId,
    captainUserIds,
  };
}

/**
 * 指定ブロックの予選試合を、結果の有無付きで取得する（再生成の保護判定用）。
 * match_results を left join し、結果が入っているかを hasResult で返す。
 */
export async function listGroupMatchesWithResult(params: {
  eventId: string;
  groupId: string;
}): Promise<
  {
    id: string;
    teamAId: string | null;
    teamBId: string | null;
    hasResult: boolean;
  }[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("matches")
    .select("id, team_a_id, team_b_id, match_results(match_id)")
    .eq("event_id", params.eventId)
    .eq("phase", "group")
    .eq("group_id", params.groupId);
  if (error) throw error;
  return (data ?? []).map((m) => {
    const results = m.match_results as { match_id: string }[] | null;
    return {
      id: m.id,
      teamAId: m.team_a_id,
      teamBId: m.team_b_id,
      hasResult: Array.isArray(results) && results.length > 0,
    };
  });
}

/** 指定 id の試合をまとめて削除する（再生成で結果なし試合だけ消すのに使う）。 */
export async function deleteMatchesByIds(matchIds: string[]): Promise<void> {
  if (matchIds.length === 0) return;
  const supabase = await createClient();
  const { error } = await supabase.from("matches").delete().in("id", matchIds);
  if (error) throw error;
}

/**
 * 試合カードをまとめて作成する（総当たり生成）。phase は 'group' 固定。
 * best_of は予選デフォルト BO（events.group_best_of）を全試合へ一括セットする（本戦-3d）。
 */
export async function insertGroupMatches(params: {
  eventId: string;
  groupId: string;
  bestOf: number;
  pairs: { teamAId: string; teamBId: string }[];
}): Promise<void> {
  if (params.pairs.length === 0) return;
  const supabase = await createClient();
  const rows = params.pairs.map((p) => ({
    event_id: params.eventId,
    group_id: params.groupId,
    phase: "group" as const,
    team_a_id: p.teamAId,
    team_b_id: p.teamBId,
    best_of: params.bestOf,
  }));
  const { error } = await supabase.from("matches").insert(rows);
  if (error) throw error;
}

/** 試合カードを1件作成する（手動追加）。phase は 'group' 固定。best_of は予選デフォルト。 */
export async function insertGroupMatch(params: {
  eventId: string;
  groupId: string;
  teamAId: string;
  teamBId: string;
  bestOf: number;
}): Promise<{ ok: true; id: string } | { ok: false }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("matches")
    .insert({
      event_id: params.eventId,
      group_id: params.groupId,
      phase: "group",
      team_a_id: params.teamAId,
      team_b_id: params.teamBId,
      best_of: params.bestOf,
    })
    .select("id")
    .single();

  if (error) return { ok: false };
  return { ok: true, id: data.id };
}

/** 試合を削除する。match_results は FK の on delete cascade で連動。 */
export async function deleteMatch(matchId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("matches")
    .delete()
    .eq("id", matchId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return data; // null なら対象なし（RLS で弾かれた・既に削除済み）
}

// --- 決勝トーナメント（phase='tournament'・本戦-5a〜） ---

/** 1試合のトーナメント生成入力（bracket.ts の出力を DB 行に対応させる）。 */
export type TournamentMatchInput = {
  round: number;
  bracketPosition: number;
  teamAId: string | null;
  teamBId: string | null;
};

/** 決勝トーナメントの試合（phase='tournament'）を取得する。round→bracket_position 順。 */
export async function listTournamentMatches(eventId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("matches")
    .select(
      "id, team_a_id, team_b_id, best_of, round, bracket_position, created_at",
    )
    .eq("event_id", eventId)
    .eq("phase", "tournament")
    .order("round", { ascending: true })
    .order("bracket_position", { ascending: true });

  if (error) throw error;
  return data;
}

/** 決勝トーナメントの試合をすべて削除する（再生成時の作り直し）。 */
export async function deleteTournamentMatches(eventId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("matches")
    .delete()
    .eq("event_id", eventId)
    .eq("phase", "tournament");
  if (error) throw error;
}

/**
 * 決勝トーナメントを一括生成する（既存T試合を全削除してから insert）。
 * phase='tournament' 固定。best_of はイベント既定 BO（group_best_of）を流用（試合ごと個別BOは後続）。
 */
export async function replaceTournamentMatches(params: {
  eventId: string;
  bestOf: number;
  matches: TournamentMatchInput[];
}): Promise<void> {
  const supabase = await createClient();

  // 1) 既存のトーナメント試合を全削除（match_results は cascade で連動）。
  await deleteTournamentMatches(params.eventId);

  if (params.matches.length === 0) return;

  // 2) ブラケットの全カードを insert。
  const rows = params.matches.map((m) => ({
    event_id: params.eventId,
    phase: "tournament" as const,
    round: m.round,
    bracket_position: m.bracketPosition,
    team_a_id: m.teamAId,
    team_b_id: m.teamBId,
    best_of: params.bestOf,
  }));
  const { error } = await supabase.from("matches").insert(rows);
  if (error) throw error;
}

/**
 * 再計算結果（本戦-5b）を DB へ反映する。
 * - shouldClearResult の試合の結果を削除する。
 * - 各試合の team_a_id/team_b_id を「あるべきスロット」へ更新する。
 * matches と match_results の更新をまとめて行う（呼び出し側＝Server Action が再計算済みを渡す）。
 */
export async function applyBracketRecompute(params: {
  updates: {
    matchId: string;
    teamAId: string | null;
    teamBId: string | null;
  }[];
  clearResultMatchIds: string[];
}): Promise<void> {
  const supabase = await createClient();

  // 1) 無効化される結果を先に削除する。
  if (params.clearResultMatchIds.length > 0) {
    const { error } = await supabase
      .from("match_results")
      .delete()
      .in("match_id", params.clearResultMatchIds);
    if (error) throw error;
  }

  // 2) 各試合のスロットを更新する。teamA/teamB の組が試合ごとに異なるため1行ずつ。
  for (const u of params.updates) {
    const { error } = await supabase
      .from("matches")
      .update({ team_a_id: u.teamAId, team_b_id: u.teamBId })
      .eq("id", u.matchId);
    if (error) throw error;
  }
}
