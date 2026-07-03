import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * service_role を使う管理用 Supabase クライアント（**RLS を全バイパスする**）。
 *
 * 用途は限定: ログインセッションが存在しないサーバー処理（Cron・⑦）で、他人の試合・
 * チームメンバーを跨いで集約し notified_at を更新する、といった RLS 越えの一括処理に使う。
 * service_role キーは**絶対にクライアントへ出さない**（この関数はサーバー専用モジュールから
 * のみ import すること）。呼び出し元（Route Handler）は必ず CRON_SECRET 等で保護する。
 *
 * セッション cookie は引き継がない（Cron に「ユーザー」はいない）。auth は無効化する。
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "createAdminClient: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です。",
    );
  }
  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
