import { createClient } from "@/lib/supabase/server";

/**
 * 試合結果（match_results）Repository。DB アクセスを集約する（実装ガイドライン: 層構造）。
 * Supabase クエリビルダのみ（生SQL禁止＝SQLi対策）。
 * 入力可否（主催者 or 対戦両チーム代表）はアクション側で確認し、RLS（0015）が最終防衛。
 *
 * 本戦フェーズ PR-3a: スコア（取マップ数）入力 → 勝者保存・修正・取り消し。
 * winner_team_id / reported_by はサーバー（アクション）が固定して渡す（マスアサインメント対策）。
 */

/** イベントの全試合結果を取得する（順位/表示用に最小列）。 */
export async function listMatchResultsByEvent(eventId: string) {
  const supabase = await createClient();
  // matches を経由してイベントを絞る（match_results に event_id は無い）。
  const { data, error } = await supabase
    .from("match_results")
    .select(
      "match_id, team_a_score, team_b_score, winner_team_id, potg_a, potg_b, replay_codes, updated_at, matches!inner(event_id)",
    )
    .eq("matches.event_id", eventId);

  if (error) throw error;
  return data;
}

/**
 * 結果を保存（upsert）。match_id が PK なので、未入力なら INSERT、入力済みなら UPDATE。
 * winner_team_id / reported_by はアクションが算出・固定して渡す。
 */
export async function upsertMatchResult(params: {
  matchId: string;
  teamAScore: number;
  teamBScore: number;
  winnerTeamId: string | null;
  reportedBy: string;
  potgA: number;
  potgB: number;
  /** マップ別リプレイコード（任意・空配列可。フェーズA）。 */
  replayCodes: string[];
}): Promise<{ ok: true } | { ok: false }> {
  const supabase = await createClient();
  const { error } = await supabase.from("match_results").upsert(
    {
      match_id: params.matchId,
      team_a_score: params.teamAScore,
      team_b_score: params.teamBScore,
      winner_team_id: params.winnerTeamId,
      reported_by: params.reportedBy,
      potg_a: params.potgA,
      potg_b: params.potgB,
      replay_codes: params.replayCodes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "match_id" },
  );

  if (error) return { ok: false };
  return { ok: true };
}

/** 結果を取り消す（未入力に戻す）。対象なしは null。 */
export async function deleteMatchResult(matchId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("match_results")
    .delete()
    .eq("match_id", matchId)
    .select("match_id")
    .maybeSingle();

  if (error) throw error;
  return data;
}
