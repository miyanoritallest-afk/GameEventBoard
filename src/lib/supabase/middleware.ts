import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./types";

/**
 * リクエストごとに Supabase のセッションを更新する。
 * middleware.ts から呼ぶ。これにより、サーバー側でも常に最新のログイン状態が
 * cookie に反映され、Server Component / Server Action から認証情報を読める。
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // リクエスト・レスポンス双方の cookie を更新する（SSR の定番手順）
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // セッションを更新（トークンのリフレッシュ等）。getClaims を呼ぶことで実行される。
  await supabase.auth.getClaims();

  return response;
}
