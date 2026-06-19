import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";

/**
 * ブラウザ（クライアントコンポーネント）用の Supabase クライアント。
 * NEXT_PUBLIC_ 環境変数を使うため、ブラウザに露出してよい anon キーのみ参照する。
 * 認証・データアクセスは RLS で保護する前提。
 * Database 型を渡すことで、from()/select() の戻り値に型が効く（gen types 由来）。
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
