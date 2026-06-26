import { createClient } from "@/lib/supabase/server";

/**
 * ユーザー（users）Repository。DB アクセスを集約する（実装ガイドライン: 層構造）。
 * Supabase クエリビルダのみ（生SQL禁止＝SQLi対策）。
 */

/**
 * ユーザーの discord_name を取得する。
 * 登録名フォーム（応募・イベント作成）のデフォルト値に使う。無ければ null。
 * 本人の行は RLS（0009）で取得できる。
 */
export async function findDiscordName(userId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("users")
    .select("discord_name")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data?.discord_name ?? null;
}
