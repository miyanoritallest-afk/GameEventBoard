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

/**
 * ユーザーが実在するか（id の有無だけ）を判定する。フォロー等の対象実在確認用。
 * discord_name の有無では判定しない（null 名でも実在ユーザーは弾かない）。
 */
export async function existsUserById(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("id", userId);

  if (error) throw error;
  return (count ?? 0) > 0;
}

/**
 * ユーザーの battle_tag を取得する。応募フォームの既定値に使う。
 * 未登録は null。本人の行は RLS（0009）で取得できる。
 */
export async function findBattleTag(userId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("users")
    .select("battle_tag")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data?.battle_tag ?? null;
}

/**
 * マイページ用の本人プロフィールを取得する。無ければ null。
 * 表示・編集に使う最小項目（discord_name は編集不可・battle_tag は編集可）。
 */
export async function findMyProfile(userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("users")
    .select("id, discord_name, discord_avatar_url, battle_tag")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * 本人の battle_tag を更新する（マイページ・応募フォームから）。
 * **更新するのは battle_tag のみに固定**＝マスアサインメント対策の二層目
 * （discord_id / is_admin 等は触らせない）。行レベルは RLS（0025・本人のみ）が担保。
 * tag に null/空文字を渡せば未登録に戻せる（呼び出し側で正規化）。
 */
export async function updateBattleTag(params: {
  userId: string;
  battleTag: string | null;
}): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("users")
    .update({ battle_tag: params.battleTag })
    .eq("id", params.userId);

  if (error) throw error;
}
