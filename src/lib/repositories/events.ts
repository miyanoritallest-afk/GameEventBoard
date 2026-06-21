import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type EventInsert = Database["public"]["Tables"]["events"]["Insert"];

/**
 * イベント Repository。DB アクセスを集約する（実装ガイドライン: 層構造）。
 * Supabase クエリビルダのみを使う（生SQL禁止＝SQLi対策）。
 */

/** イベントを1件作成し、作成行を返す。 */
export async function insertEvent(values: EventInsert) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .insert(values)
    .select()
    .single();

  if (error) throw error; // 想定外のDBエラーは上位（error.tsx）へ
  return data;
}

/** id でイベントを1件取得する。存在しなければ null。 */
export async function findEventById(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .select("*, games(name)")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * イベントを公開する（status を published に上げる）。
 *
 * 防御の多層化:
 * - organizer_id でも絞る（アプリ層 IDOR 対策。RLS と二重で他人の行を弾く）。
 * - status='draft' を条件に含める（下書きのときだけ公開。二重公開を構造的に防ぐ）。
 * - version で楽観ロック（編集と公開の競合を検出）。一致時のみ更新し version をインクリメント。
 *
 * 条件に合致する行が無ければ更新 0 件 → maybeSingle が null を返す。
 * 呼び出し側は「所有者違い / 既に公開済み / version 競合」のいずれかとして扱う。
 */
export async function publishEvent(params: {
  id: string;
  organizerId: string;
  expectedVersion: number;
  slug: string;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .update({
      status: "published",
      version: params.expectedVersion + 1,
      slug: params.slug,
    })
    .eq("id", params.id)
    .eq("organizer_id", params.organizerId)
    .eq("status", "draft")
    .eq("version", params.expectedVersion)
    .select()
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** 指定 slug がすでに使われているかを返す（採番時の重複チェック用）。 */
export async function slugExists(slug: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw error;
  return data !== null;
}
