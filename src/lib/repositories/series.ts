import { createClient } from "@/lib/supabase/server";

/**
 * シリーズ（event_series）Repository。DB アクセスを集約する（実装ガイドライン: 層構造）。
 * Supabase クエリビルダのみ（生SQL禁止＝SQLi対策）。
 *
 * シリーズ＝継続する企画（例: OSL）。開催回（events）の上位概念（要件定義書 3.5.1）。
 * created_by はサーバー固定。作成者は series_members に owner・active で登録する（本 PR）。
 */

/**
 * シリーズを1件作成し、作成者を owner・active として series_members に登録する。
 * id はアプリ側で事前生成（members への紐付けに使う）。作成者確認は RLS（0032）が最終防衛。
 */
export async function insertSeries(params: {
  name: string;
  description: string | null;
  createdBy: string;
}): Promise<{ id: string }> {
  const supabase = await createClient();
  // シリーズ作成＋作成者の owner 登録を1トランザクション（0032 の security definer 関数）で。
  // 分割 INSERT だと後者失敗で owner 不在の孤立シリーズが残るため（誰も編集できない）。
  const { data, error } = await supabase.rpc("create_series_with_owner", {
    p_name: params.name,
    p_description: params.description,
    p_created_by: params.createdBy,
  });
  if (error) throw error;
  if (data === null) {
    throw new Error("create_series_with_owner が id を返しませんでした。");
  }
  return { id: data };
}

/** シリーズ一覧（新しい順）。RLS（0032）で SELECT は公開。 */
export async function listSeries() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("event_series")
    .select("id, name, description, created_at")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}

/**
 * シリーズが実在するか（id の有無だけ）を判定する。フォロー等の対象実在確認用。
 */
export async function existsSeriesById(id: string): Promise<boolean> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("event_series")
    .select("id", { count: "exact", head: true })
    .eq("id", id);

  if (error) throw error;
  return (count ?? 0) > 0;
}

/** id でシリーズを1件取得。存在しなければ null。 */
export async function findSeriesById(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("event_series")
    .select("id, name, description, logo_url, created_by, created_at")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * 自分が運営（series_members active）のシリーズ一覧。イベント紐付けの候補に使う。
 * series_members → event_series を辿る。RLS（0032）で members/series とも SELECT 公開。
 */
export async function listMySeries(userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("series_members")
    .select("event_series(id, name)")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("invited_at", { ascending: false });

  if (error) throw error;
  // 埋め込みは series_members→event_series の多対一なので単一オブジェクト
  // （[[supabase-embed-cardinality]]）。null を除いて series だけの配列に整える。
  return (data ?? [])
    .map((row) => row.event_series as { id: string; name: string } | null)
    .filter((s): s is { id: string; name: string } => s !== null);
}

/**
 * シリーズに属する開催回（events）を新しい順に取得。詳細ページの一覧用。
 * 公開済みのみ（下書きは出さない）。events の SELECT は 0005（公開は誰でも）。
 */
export async function listSeriesEvents(seriesId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .select("id, slug, title, status, starts_at")
    .eq("series_id", seriesId)
    .neq("status", "draft")
    .order("starts_at", { ascending: false, nullsFirst: false });

  if (error) throw error;
  return data;
}

/**
 * シリーズの最新イベント（開催回）の大会設定を取得する。イベント作成フォームの
 * プリフィル用（Season2 は Season1 と同じルール、という実運用）。下書き含む最新1件。
 * 無ければ null（初回シリーズ）。
 */
export async function findLatestEventSettingsForSeries(seriesId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .select(
      "game_id, require_score, role_swap_allowed, declared_seasons, uncertified_handling, bonus_master, bonus_gm, bonus_champion, team_score_cap, format, group_best_of, tournament_third_place, ranking_enabled",
    )
    .eq("series_id", seriesId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}
