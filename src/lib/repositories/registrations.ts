import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type RegStatus = Database["public"]["Enums"]["reg_status"];
type Role = Database["public"]["Enums"]["role"];
type Json = Database["public"]["Tables"]["registrations"]["Insert"]["score_breakdown"];

/**
 * 応募（registration）Repository。DB アクセスを集約する（実装ガイドライン: 層構造）。
 * Supabase クエリビルダのみ（生SQL禁止＝SQLi対策）。
 */

/**
 * 応募を1件作成する（status='pending' 固定）。スコアなし／ありで共有。
 * 1ユーザー1応募は UNIQUE(event_id, user_id) が最終防衛。
 * 同時連打などで UNIQUE 違反（Postgres 23505）になったら、呼び出し側が
 * 「応募済み」として扱えるよう { duplicate: true } を返す（throw しない）。
 *
 * scored 系（preferred_role / individual_score / final_score / score_breakdown）は
 * スコアあり応募のスナップショット。未指定なら null（スコアなし応募）。
 * user_id / status はサーバー固定（なりすまし・マスアサインメント対策）。
 */
export async function insertRegistration(params: {
  eventId: string;
  userId: string;
  preferredRole?: Role | null;
  individualScore?: number | null;
  finalScore?: number | null;
  scoreBreakdown?: Json;
}): Promise<{ ok: true; id: string } | { ok: false; duplicate: true }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("registrations")
    .insert({
      event_id: params.eventId,
      user_id: params.userId,
      status: "pending",
      preferred_role: params.preferredRole ?? null,
      individual_score: params.individualScore ?? null,
      final_score: params.finalScore ?? null,
      score_breakdown: params.scoreBreakdown ?? null,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { ok: false, duplicate: true };
    throw error; // 想定外は上位（error.tsx）へ
  }
  return { ok: true, id: data.id };
}

/** 本人の応募1件を取得する（重複判定・応募済み表示用）。無ければ null。 */
export async function findRegistration(eventId: string, userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("registrations")
    .select("id, status")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * イベントの応募者一覧（主催者用）。表示に必要な応募者情報を JOIN する。
 * 新しい順。RLS（0006）で主催者本人のイベントのみ返る。
 */
export async function listRegistrationsByEvent(eventId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("registrations")
    .select(
      "id, status, created_at, preferred_role, individual_score, final_score, organizer_override_score, score_breakdown, users(discord_name, discord_avatar_url, battle_tag)",
    )
    .eq("event_id", eventId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}

/**
 * 運営によるスコア上書き（organizer_override_score を設定/解除）。
 * score=null でクリア（算出値に戻る）。主催者確認はアクション側＋ RLS（0006 UPDATE）。
 * 算出元の individual/final_score・score_breakdown は触らない（根拠を保持）。
 * 行が無ければ null。
 */
export async function setOverrideScore(params: {
  registrationId: string;
  score: number | null;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("registrations")
    .update({ organizer_override_score: params.score })
    .eq("id", params.registrationId)
    .select("id, organizer_override_score")
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * 承認/却下の所有権確認用に、応募とそのイベント（organizer_id・status）を取得する。
 * 2テーブル跨ぎの所有権チェックをアプリ層で行うため events を JOIN する。
 */
export async function findRegistrationWithEvent(registrationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("registrations")
    .select("id, status, event_id, events(id, organizer_id)")
    .eq("id", registrationId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * 応募の承認/却下（status を approved/rejected に更新）。
 * expectedStatus（通常 'pending'）に一致する行のみ更新＝二重処理防止。
 * 主催者確認はアクション側＋ RLS（0006）で担保。
 * 条件に合致する行が無ければ null（既に処理済み等）。
 */
export async function decideRegistration(params: {
  registrationId: string;
  expectedStatus: RegStatus;
  nextStatus: RegStatus;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("registrations")
    .update({ status: params.nextStatus })
    .eq("id", params.registrationId)
    .eq("status", params.expectedStatus)
    .select("id, status")
    .maybeSingle();

  if (error) throw error;
  return data;
}
