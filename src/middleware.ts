import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// すべてのリクエストでセッションを更新する（静的アセット等は除外）。
export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // 画像・favicon・Next内部アセットを除く全パス
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
