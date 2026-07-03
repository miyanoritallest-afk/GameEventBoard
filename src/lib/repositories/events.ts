import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type EventInsert = Database["public"]["Tables"]["events"]["Insert"];
type EventUpdate = Database["public"]["Tables"]["events"]["Update"];

/** 編集で更新を許可するカラム（マスアサインメント対策＝ホワイトリスト）。 */
type EventEditableColumns = Pick<
  EventUpdate,
  | "title"
  | "game_id"
  | "organizer_display_name"
  | "description"
  | "starts_at"
  | "ends_at"
  | "recruit_deadline"
  | "capacity"
  | "format"
  | "require_score"
  | "uncertified_handling"
  | "role_swap_allowed"
  | "declared_seasons"
  | "bonus_master"
  | "bonus_gm"
  | "bonus_champion"
  | "team_score_cap"
  | "discord_webhook_url"
  | "ranking_enabled"
  | "points_win"
  | "points_draw"
  | "points_loss"
  | "tiebreakers"
  | "group_best_of"
  | "tournament_third_place"
>;

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
    // 主催者表示名のフォールバック用に organizer の discord_name も引く（1:1）。
    .select(
      "*, games(name, team_size), organizer:users!events_organizer_id_fkey(discord_name)",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * イベントが実在するか（id の有無だけ）を判定する。フォロー等の対象実在確認用。
 * 全カラム＋join を引く findEventById より軽い（存在確認だけが目的のとき使う）。
 */
export async function existsEventById(id: string): Promise<boolean> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("id", id);

  if (error) throw error;
  return (count ?? 0) > 0;
}

/**
 * イベントをシリーズに紐付ける（events.series_id をセット）。
 * 主催者本人＝organizerId、かつ **まだ series 未所属（series_id is null）** の行のみ更新
 * ＝二重シリーズ化を防ぐ。更新できたら true。条件に合わなければ false（他人・既に所属等）。
 * 主催者確認はアプリ層＋RLS（events_update_own / 0004）で最終防衛。
 */
export async function linkEventToSeries(params: {
  eventId: string;
  organizerId: string;
  seriesId: string;
}): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .update({ series_id: params.seriesId })
    .eq("id", params.eventId)
    .eq("organizer_id", params.organizerId)
    .is("series_id", null)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return data !== null;
}

/**
 * 決勝トーナメントの進出数 N（events.tournament_advance_count）を更新する（本戦-5a）。
 * 所有権確認は呼び出し側＋RLS が担保。生成時にだけ呼ぶ専用更新（編集フォームの whitelist とは分離）。
 */
export async function updateTournamentAdvanceCount(params: {
  eventId: string;
  advanceCount: number;
}): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("events")
    .update({ tournament_advance_count: params.advanceCount })
    .eq("id", params.eventId);
  if (error) throw error;
}

/** slug でイベントを1件取得する。存在しなければ null。 */
export async function findEventBySlug(slug: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    // 主催者表示名のフォールバック用に organizer の discord_name も引く（1:1）。
    .select(
      "*, games(name), organizer:users!events_organizer_id_fkey(discord_name)",
    )
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * 公開済みイベントの一覧を取得する（新しい順）。
 * アプリ層で status='draft' を除外（RLS 0005 と二重で下書き漏れを防ぐ）。
 * 一覧は概要表示なので必要な列だけ取る。
 */
export async function listPublishedEvents() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .select("id, slug, title, status, starts_at, recruit_deadline, games(name)")
    .neq("status", "draft")
    .order("created_at", { ascending: false });

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

/**
 * イベントを編集する（内容の更新）。
 *
 * 防御:
 * - 更新カラムは EventEditableColumns のみ（マスアサインメント対策）。
 *   organizer_id / status / slug / version は呼び出し側からは渡せない。
 * - organizer_id で絞る（アプリ層 IDOR 対策。RLS と二重）。
 * - version で楽観ロック。一致時のみ更新し version をインクリメント。
 * - slug は触らない（公開後にタイトルを変えても URL を固定。共有URLを壊さない）。
 *
 * 条件に合致する行が無ければ null（所有者違い / version 競合）。
 */
export async function updateEvent(params: {
  id: string;
  organizerId: string;
  expectedVersion: number;
  values: EventEditableColumns;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .update({ ...params.values, version: params.expectedVersion + 1 })
    .eq("id", params.id)
    .eq("organizer_id", params.organizerId)
    .eq("version", params.expectedVersion)
    .select()
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * 主催者本人のイベント一覧（下書き＋公開）を新しい順で取得する。
 * 「自分のイベント管理」用。RLS（0005）は本人の下書きも返すため整合する。
 */
export async function listEventsByOrganizer(organizerId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .select("id, slug, title, status, starts_at, recruit_deadline, games(name)")
    .eq("organizer_id", organizerId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}

/**
 * 下書きイベントを削除する。
 * - organizer_id ＋ status='draft' を条件にし、本人の下書きのみ削除可（公開済みは消せない）。
 * - 削除できた行数を返す（0 なら対象なし＝権限なし/公開済み）。
 */
export async function deleteDraftEvent(params: {
  id: string;
  organizerId: string;
}): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .delete()
    .eq("id", params.id)
    .eq("organizer_id", params.organizerId)
    .eq("status", "draft")
    .select("id");

  if (error) throw error;
  return data?.length ?? 0;
}
