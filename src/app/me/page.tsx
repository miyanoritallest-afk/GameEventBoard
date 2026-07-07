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
    <div className="theme-matchpoint min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-lg px-6 py-10">
        <p className="flex items-center gap-2 text-xs font-semibold tracking-widest text-[color:var(--mp-fg-subtle)]">
          <span className="h-px w-6 bg-[color:var(--mp-brand)]" />
          PROFILE
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">マイページ</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          プロフィールの確認とバトルタグの登録ができます。
        </p>

        {/* プロフィール表示（Discord 由来は編集不可） */}
        <section className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-[var(--mp-e1)]">
          <div className="flex items-center gap-4">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt=""
                className="size-14 rounded-full border-2 border-[color:var(--mp-brand)]/40"
              />
            ) : (
              <div className="flex size-14 items-center justify-center rounded-full bg-[color:var(--mp-surface-3)] text-lg font-bold text-[color:var(--mp-brand)]">
                {discordName.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-lg font-semibold text-foreground">
                {discordName}
              </p>
              <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full bg-[color:var(--mp-discord)]"
                />
                Discord アカウント（変更不可）
              </p>
            </div>
          </div>
        </section>

        {/* バトルタグ編集 */}
        <section className="mt-4 rounded-2xl border border-border bg-card p-6 shadow-[var(--mp-e1)]">
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
