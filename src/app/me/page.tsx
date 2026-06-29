// マイページ: 自分のプロフィール管理（表示＋バトルタグ編集）。
// 参加/主催イベント一覧はトップ（ダッシュボード）の役割なのでここには出さない。

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { findMyProfile } from "@/lib/repositories/users";
import { LogoutButton } from "./logout-button";
import { BattleTagForm } from "./battle-tag-form";

export const dynamic = "force-dynamic";

export default async function MePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // マイページは本人専用。未ログインは /login へ（戻り先を持ち回る）。
  if (!user) {
    redirect(`/login?redirect=${encodeURIComponent("/me")}`);
  }

  const profile = await findMyProfile(user.id);
  const discordName = profile?.discord_name ?? "(取得できず)";
  const avatarUrl = profile?.discord_avatar_url ?? null;
  const battleTag = profile?.battle_tag ?? "";

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-lg px-6 py-10">
        <h1 className="text-2xl font-bold">マイページ</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          プロフィールの確認とバトルタグの登録ができます。
        </p>

        {/* プロフィール表示（Discord 由来は編集不可） */}
        <section className="mt-6 rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-4">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt=""
                className="size-14 rounded-full border border-border"
              />
            ) : (
              <div className="flex size-14 items-center justify-center rounded-full border border-border bg-muted text-lg font-bold">
                {discordName.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-lg font-semibold">{discordName}</p>
              <p className="text-xs text-muted-foreground">
                Discord アカウント（変更不可）
              </p>
            </div>
          </div>
        </section>

        {/* バトルタグ編集 */}
        <section className="mt-4 rounded-xl border border-border bg-card p-6">
          <BattleTagForm defaultBattleTag={battleTag} />
        </section>

        {/* アカウント操作 */}
        <div className="mt-6">
          <LogoutButton />
        </div>
      </div>
    </div>
  );
}
