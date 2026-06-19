import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Discord 認証後のコールバック。
 * Discord → Supabase → ここ、の順で戻ってくる。URLの `code` をセッションに交換する。
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // 認証後の遷移先（指定なければトップ）
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    // 失敗時はエラー内容をクエリに付けてログインページへ
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  // code が無い場合もログインへ
  return NextResponse.redirect(`${origin}/login?error=missing_code`);
}
