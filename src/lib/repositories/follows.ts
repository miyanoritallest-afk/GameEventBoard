import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type FollowTarget = Database["public"]["Enums"]["follow_target"];

/**
 * フォロー（follows）Repository。DB アクセスを集約する（実装ガイドライン: 層構造）。
 * Supabase クエリビルダのみ（生SQL禁止＝SQLi対策）。
 *
 * follows は「誰が(follower_id) 何を(target_type, target_id) フォローしたか」の本人データ。
 * follower_id はサーバー固定（なりすまし対策）。二重フォローは
 * UNIQUE(follower_id, target_type, target_id) が最終防衛。RLS（0029）で本人の行のみ。
 */

/**
 * フォローを1件作成する。既にフォロー済み（23505）なら { alreadyFollowing: true }。
 * target_id の実在チェックはアプリ層（Server Action）で行う（ポリモーフィックで FK 無し）。
 */
export async function insertFollow(params: {
  followerId: string;
  targetType: FollowTarget;
  targetId: string;
}): Promise<{ ok: true } | { ok: false; alreadyFollowing: true }> {
  const supabase = await createClient();
  const { error } = await supabase.from("follows").insert({
    follower_id: params.followerId,
    target_type: params.targetType,
    target_id: params.targetId,
  });

  if (error) {
    if (error.code === "23505") return { ok: false, alreadyFollowing: true };
    throw error; // 想定外は上位（error.tsx）へ
  }
  return { ok: true };
}

/**
 * フォローを解除する（本人の対象フォローを削除）。冪等（無ければ何も起きない）。
 * follower_id 条件はアプリ層の二重防衛（RLS 0029 の DELETE=本人のみ が最終防衛）。
 */
export async function deleteFollow(params: {
  followerId: string;
  targetType: FollowTarget;
  targetId: string;
}): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("follows")
    .delete()
    .eq("follower_id", params.followerId)
    .eq("target_type", params.targetType)
    .eq("target_id", params.targetId);

  if (error) throw error;
}

/**
 * 本人が対象をフォロー済みか判定する（フォローボタンの初期状態用）。
 * RLS（0029）で本人の行のみ返るため、count>0 = 本人がフォロー中。
 */
export async function isFollowing(params: {
  followerId: string;
  targetType: FollowTarget;
  targetId: string;
}): Promise<boolean> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("follows")
    .select("id", { count: "exact", head: true })
    .eq("follower_id", params.followerId)
    .eq("target_type", params.targetType)
    .eq("target_id", params.targetId);

  if (error) throw error;
  return (count ?? 0) > 0;
}
