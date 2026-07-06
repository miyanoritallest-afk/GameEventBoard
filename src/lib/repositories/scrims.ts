import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

/**
 * スクリム/練習（scrims）Repository。チーム日程管理（要件定義書 3.4.3）の DB アクセスを集約。
 * Supabase クエリビルダのみ（生SQL禁止＝SQLi対策）。閲覧範囲・書き込み可否は RLS（0035）が
 * 最終防衛（SELECT=メンバー/主催者・書き込み=メンバー）。ここは「取得・書き込み」だけを担う。
 */

type ScrimKind = Database["public"]["Enums"]["scrim_kind"];

/** スクリム/練習を1件作成する。created_by/team_id はサーバー固定で渡す（Action の責務）。 */
export async function insertScrim(params: {
  teamId: string;
  createdBy: string;
  kind: ScrimKind;
  scheduledAt: string; // UTC ISO
  opponentName: string | null;
  memo: string | null;
}): Promise<{ id: string }> {
  const supabase = await createClient();
  const id = crypto.randomUUID();
  const { error } = await supabase.from("scrims").insert({
    id,
    team_id: params.teamId,
    created_by: params.createdBy,
    kind: params.kind,
    scheduled_at: params.scheduledAt,
    opponent_name: params.opponentName,
    memo: params.memo,
  });
  if (error) throw error;
  return { id };
}

/** スクリム/練習を1件更新する（team_id/created_by は変えない）。返り値は更新行数。 */
export async function updateScrim(params: {
  id: string;
  kind: ScrimKind;
  scheduledAt: string;
  opponentName: string | null;
  memo: string | null;
}): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scrims")
    .update({
      kind: params.kind,
      scheduled_at: params.scheduledAt,
      opponent_name: params.opponentName,
      memo: params.memo,
    })
    .eq("id", params.id)
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

/** スクリム/練習を1件削除する。返り値は削除行数。RLS（0035）で自チームのみ削除可。 */
export async function deleteScrim(id: string): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scrims")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

/** id で1件取得（編集フォームのプリフィル用）。RLS で見えない行は null。 */
export async function findScrimById(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scrims")
    .select("id, team_id, kind, scheduled_at, opponent_name, memo")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * イベントのスクリム/練習を取得する。scrims→teams で event_id を辿る。
 * **RLS（0035）が閲覧範囲を自動で絞る**（呼び出し元がメンバーなら自チーム分、主催者なら全チーム分
 * だけが返る）。チーム名も埋め込む（カード表示用）。
 */
export async function listEventScrims(eventId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scrims")
    // teams は team_id / opponent_team_id の2FKで参照されるため FK を明示（曖昧回避）。
    .select(
      "id, team_id, kind, scheduled_at, opponent_name, memo, teams:teams!scrims_team_id_fkey!inner(name, event_id)",
    )
    .eq("teams.event_id", eventId)
    .order("scheduled_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((s) => ({
    id: s.id,
    teamId: s.team_id,
    kind: s.kind,
    scheduledAt: s.scheduled_at,
    opponentName: s.opponent_name,
    memo: s.memo,
    teamName: (s.teams as { name: string } | null)?.name ?? "チーム",
  }));
}

/**
 * イベントの公式戦（matches）を日程表示用に取得する（scheduled_at がある試合のみ）。
 * 対戦カード（team_a/team_b の名前）・配信URLを引く。matches の SELECT は公開系（既存）。
 * 濃淡（自チームが絡むか）は Service 側で判定するため、team_a_id/team_b_id も返す。
 */
export async function listEventMatchesForSchedule(eventId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("matches")
    .select(
      `id, scheduled_at, stream_url, team_a_id, team_b_id,
       team_a:teams!matches_team_a_id_fkey(name),
       team_b:teams!matches_team_b_id_fkey(name)`,
    )
    .eq("event_id", eventId)
    .not("scheduled_at", "is", null)
    .order("scheduled_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((m) => ({
    id: m.id,
    scheduledAt: m.scheduled_at as string,
    streamUrl: m.stream_url,
    teamAId: m.team_a_id,
    teamBId: m.team_b_id,
    teamAName: (m.team_a as { name: string } | null)?.name ?? "未定",
    teamBName: (m.team_b as { name: string } | null)?.name ?? "未定",
  }));
}

/**
 * 閲覧者がこのイベントで所属するチームの id を返す（無ければ null）。日程カードの濃淡
 * （自チームが絡む公式戦は濃い／他チームは控えめ）と、スクリム登録先チームの決定に使う。
 * teams→team_members→registrations で辿る。1イベント1チーム（registrations の unique）想定。
 */
export async function findViewerTeamId(params: {
  eventId: string;
  userId: string;
}): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("team_members")
    .select("team_id, teams!inner(event_id), registrations!inner(user_id)")
    .eq("teams.event_id", params.eventId)
    .eq("registrations.user_id", params.userId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.team_id ?? null;
}
