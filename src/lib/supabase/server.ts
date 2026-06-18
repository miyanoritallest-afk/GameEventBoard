import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * サーバー（Server Component / Route Handler / Server Action）用の Supabase クライアント。
 * Next.js 16 では cookies() が async のため await して使う。
 * anon キーを使い、ユーザーのセッション cookie を引き継いで RLS 配下でアクセスする。
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component から呼ばれた場合、cookie の書き込みは不可。
            // middleware でセッションを更新する想定のため、ここでは握りつぶしてよい。
          }
        },
      },
    },
  );
}
