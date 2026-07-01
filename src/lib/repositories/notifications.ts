import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type FollowTarget = Database["public"]["Enums"]["follow_target"];

/**
 * 通知（notification）Repository。DB アクセスを集約する（実装ガイドライン: 層構造）。
 * Supabase クエリビルダのみ（生SQL禁止＝SQLi対策）。
 *
 * 通知は「出来事（notification_events）→ 各ユーザーへの実配信（notifications）」の2段。
 * type / title / body / link_url はサーバー側で固定生成（マスアサインメント対策）。
 * 二重通知は notifications の UNIQUE(user_id, source_event_id) が最終防衛。
 */

/**
 * 出来事（notification_events）を1件作成し、その id を返す。
 * type は要件定義書 3.7 カタログの文字列（サーバー固定）。
 * source_type / source_id は「何に紐づく出来事か」（例: event の応募承認なら 'event'＋event_id）。
 *
 * id はアプリ側で事前生成して INSERT に渡す（読み返さない）。理由: notification_events は
 * SELECT ポリシーを持たない「サーバー処理専用データ」（0027）なので、INSERT 後に .select()
 * で読み返すと RLS で 42501 になる。事前生成すれば読み返し不要で id を後続に渡せる。
 */
export async function insertNotificationEvent(params: {
  type: string;
  sourceType: FollowTarget;
  sourceId: string;
  payload?: Database["public"]["Tables"]["notification_events"]["Insert"]["payload"];
}): Promise<{ id: string }> {
  const supabase = await createClient();
  const id = crypto.randomUUID();
  const { error } = await supabase.from("notification_events").insert({
    id,
    type: params.type,
    source_type: params.sourceType,
    source_id: params.sourceId,
    payload: params.payload ?? null,
  });

  if (error) throw error; // 想定外は上位（error.tsx）へ
  return { id };
}

/**
 * 出来事から、宛先ユーザーへの通知（notifications）を1件作成する。
 * title / body / link_url はサーバー固定生成の値を受け取るだけ（入力から取らない）。
 * 同一出来事から同一ユーザーへの二重生成は UNIQUE(user_id, source_event_id) が弾く。
 * 二重（Postgres 23505）は「既に通知済み」として { duplicate: true } を返す（throw しない）。
 *
 * id はアプリ側で事前生成して読み返さない。理由: notifications の SELECT は「宛先本人のみ」
 * （0027）なので、宛先≠作成者（例: 主催者が応募者宛てに作る）だと INSERT 後の .select() が
 * RLS で 42501 になる。事前生成すれば読み返し不要。
 */
export async function insertNotification(params: {
  userId: string;
  sourceEventId: string;
  title: string;
  body?: string | null;
  linkUrl?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; duplicate: true }> {
  const supabase = await createClient();
  const id = crypto.randomUUID();
  const { error } = await supabase.from("notifications").insert({
    id,
    user_id: params.userId,
    source_event_id: params.sourceEventId,
    title: params.title,
    body: params.body ?? null,
    link_url: params.linkUrl ?? null,
  });

  if (error) {
    if (error.code === "23505") return { ok: false, duplicate: true };
    throw error;
  }
  return { ok: true, id };
}

/**
 * 自分宛ての通知一覧（/notifications 用）。新しい順。
 * RLS（0027）で本人（user_id=auth.uid()）の行のみ返る。
 */
export async function listMyNotifications(userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("id, title, body, link_url, is_read, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}

/** 自分宛ての未読件数（ヘッダーのバッジ用）。RLS（0027）で本人の行のみ数える。 */
export async function countMyUnreadNotifications(userId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_read", false);

  if (error) throw error;
  return count ?? 0;
}

/**
 * 自分宛ての通知を既読にする。userId 条件はアプリ層の二重防衛
 * （RLS 0027 の UPDATE=本人のみ が最終防衛）。
 * 対象が無い／他人のものは 0 件更新で静かに終わる。
 */
export async function markNotificationRead(params: {
  notificationId: string;
  userId: string;
}): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("id", params.notificationId)
    .eq("user_id", params.userId);

  if (error) throw error;
}
