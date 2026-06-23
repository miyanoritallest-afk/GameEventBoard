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
    .select("id, group_id, team_a_id, team_b_id, created_at")
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
  organizerId: string;
  captainUserIds: string[];
} | null> {
  const supabase = await createClient();
  const { data: m, error } = await supabase
    .from("matches")
    .select("id, event_id, team_a_id, team_b_id, events(organizer_id)")
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

/** 試合カードをまとめて作成する（総当たり生成）。phase は 'group' 固定。 */
export async function insertGroupMatches(params: {
  eventId: string;
  groupId: string;
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
  }));
  const { error } = await supabase.from("matches").insert(rows);
  if (error) throw error;
}

/** 試合カードを1件作成する（手動追加）。phase は 'group' 固定。 */
export async function insertGroupMatch(params: {
  eventId: string;
  groupId: string;
  teamAId: string;
  teamBId: string;
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
