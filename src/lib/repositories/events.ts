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
