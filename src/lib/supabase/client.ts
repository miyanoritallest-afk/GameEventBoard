import { createBrowserClient } from "@supabase/ssr";

/**
 * ブラウザ（クライアントコンポーネント）用の Supabase クライアント。
 * NEXT_PUBLIC_ 環境変数を使うため、ブラウザに露出してよい anon キーのみ参照する。
 * 認証・データアクセスは RLS で保護する前提。
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
