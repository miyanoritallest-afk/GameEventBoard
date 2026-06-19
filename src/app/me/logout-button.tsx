"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LogoutButton() {
  const router = useRouter();

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.refresh(); // サーバー側の状態を再取得して表示を更新
  }

  return (
    <button
      onClick={logout}
      className="rounded-lg border border-border px-4 py-2 text-sm transition hover:border-destructive/60 hover:text-destructive"
    >
      ログアウト
    </button>
  );
}
