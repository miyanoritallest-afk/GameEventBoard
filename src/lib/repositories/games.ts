import { createClient } from "@/lib/supabase/server";

/**
 * ゲーム Repository。Supabase クエリビルダのみを使う（生SQL禁止＝SQLi対策）。
 */

/** ゲーム一覧（選択ドロップダウン用）。名前順。 */
export async function listGames() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("games")
    .select("id, name")
    .order("name");

  if (error) throw error;
  return data;
}
