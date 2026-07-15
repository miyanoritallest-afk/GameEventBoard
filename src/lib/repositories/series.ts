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
 * 作成者（created_by / owner）は DB 関数が auth.uid() から取る（0037）。呼び出し側から
 * ユーザーIDを渡さない＝他人名義での作成を原理的に不可能にする（RLS もバイパスできない）。
 */
export async function insertSeries(params: {
  name: string;
  description: string | null;
}): Promise<{ id: string }> {
  const supabase = await createClient();
  // シリーズ作成＋作成者の owner 登録を1トランザクション（security definer 関数）で。
  // 分割 INSERT だと後者失敗で owner 不在の孤立シリーズが残るため（誰も編集できない）。
  const { data, error } = await supabase.rpc("create_series_with_owner", {
    p_name: params.name,
    p_description: params.description,
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
 * シリーズの運営メンバー一覧（owner→admin の順、状態問わず）。詳細ページの運営一覧用。
 * users を埋め込み（series_members→users は多対一なので単一オブジェクト
 * ・[[supabase-embed-cardinality]]）。members/users とも SELECT は公開（0032 / users）。
 */
export async function listSeriesMembers(seriesId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("series_members")
    // users は user_id / invited_by の2FKで参照されるため、埋め込むFKを明示する
    // （曖昧だと "more than one relationship" で埋め込み不可）。運営者＝user_id 側。
    .select(
      "user_id, role, status, invited_at, users:users!series_members_user_id_fkey(discord_name, battle_tag, discord_avatar_url)",
    )
    .eq("series_id", seriesId)
    // 辞書順で 'admin' < 'owner'。owner を先頭にしたいので降順。
    .order("role", { ascending: false })
    .order("invited_at", { ascending: true });

  if (error) throw error;
  return (data ?? []).map((row) => ({
    userId: row.user_id,
    role: row.role,
    status: row.status,
    invitedAt: row.invited_at,
    // series_members→users は多対一なので単一オブジェクト（[[supabase-embed-cardinality]]）。
    user: row.users,
  }));
}

/**
 * 指定ユーザーのシリーズにおける運営レコード（無ければ null）。
 * 権限判定（staff か・invited 招待中か）とUI分岐に使う。RLS で members は SELECT 公開。
 */
export async function findSeriesMembership(params: {
  seriesId: string;
  userId: string;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("series_members")
    .select("role, status")
    .eq("series_id", params.seriesId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * 招待候補のユーザー検索（discord_name / battle_tag 部分一致・既member除外・上限20）。
 * users の他人行は RLS で見えないため security definer 関数（0033）で跨ぐ。
 */
export async function searchUsersForInvite(params: {
  seriesId: string;
  query: string;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_users_for_invite", {
    p_series_id: params.seriesId,
    p_query: params.query,
  });
  if (error) throw error;
  return data ?? [];
}

/**
 * owner が運営メンバーを招待する（admin・invited）。原子性・二重招待防止・owner 資格確認は
 * DB関数（0034 invite_series_member）内。実行者は関数内で auth.uid() を使う
 * （actor をクライアントから渡さない＝他人 UUID を借りる権限昇格を封じる）。
 * 返り値は作成した series_members.id。既に member 等は関数が例外を投げる（Server Action で握る）。
 */
export async function inviteSeriesMember(params: {
  seriesId: string;
  userId: string;
}): Promise<{ id: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("invite_series_member", {
    p_series_id: params.seriesId,
    p_user_id: params.userId,
  });
  if (error) throw error;
  if (data === null) {
    throw new Error("invite_series_member が id を返しませんでした。");
  }
  return { id: data };
}

/**
 * 招待への応答（承認/拒否）。自分（auth.uid()）宛ての invited 行にのみ作用
 * （0034 respond_to_series_invite・実行者は関数内で auth.uid()）。
 * 返り値は作用した行数（0 なら該当なし＝既に処理済み）。
 */
export async function respondToSeriesInvite(params: {
  seriesId: string;
  accept: boolean;
}): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("respond_to_series_invite", {
    p_series_id: params.seriesId,
    p_accept: params.accept,
  });
  if (error) throw error;
  return data ?? 0;
}

/**
 * 運営メンバーを削除する（owner による削除・招待取消、または本人の退会）。最後の owner 保護・
 * 認可（auth.uid() が owner か本人か）は DB関数（0034 remove_series_member）内。
 * 実行者は関数内で auth.uid() を使う。返り値は削除した行数（0 なら該当なし）。
 */
export async function removeSeriesMember(params: {
  seriesId: string;
  userId: string;
}): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("remove_series_member", {
    p_series_id: params.seriesId,
    p_user_id: params.userId,
  });
  if (error) throw error;
  return data ?? 0;
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
