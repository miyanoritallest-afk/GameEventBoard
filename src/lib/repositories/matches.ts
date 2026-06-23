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
 * 指定ブロックの予選試合を全削除する（再生成の前処理）。
 * 結果保護は本戦-3 で追加（本 PR では phase='group' の当該ブロックを全消去）。
 */
export async function deleteGroupMatches(params: {
  eventId: string;
  groupId: string;
}): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("matches")
    .delete()
    .eq("event_id", params.eventId)
    .eq("phase", "group")
    .eq("group_id", params.groupId);
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
