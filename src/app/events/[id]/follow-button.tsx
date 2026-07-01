"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toggleFollow } from "./follow-actions";

/**
 * フォロー/解除ボタン（クライアント）。event / user 両対象で共用。
 * - 楽観的トグル（押した瞬間に見た目を反転）。失敗したら元に戻してメッセージ。
 * - 未ログイン（isLoggedIn=false）は押下で /login へ（戻り先を持ち回る）。
 * follower_id はサーバー側で auth.uid() 固定（クライアントは対象だけ渡す）。
 */
export function FollowButton({
  targetType,
  targetId,
  initialFollowing,
  isLoggedIn,
  redirectTo,
  label,
}: {
  targetType: "event" | "user";
  targetId: string;
  initialFollowing: boolean;
  isLoggedIn: boolean;
  redirectTo: string;
  label: string;
}) {
  const router = useRouter();
  const [following, setFollowing] = useState(initialFollowing);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    if (!isLoggedIn) {
      router.push(`/login?redirect=${encodeURIComponent(redirectTo)}`);
      return;
    }
    const next = !following;
    setFollowing(next); // 楽観的更新
    setError(null);
    startTransition(async () => {
      const res = await toggleFollow({
        targetType,
        targetId,
        follow: next,
        eventPath: redirectTo,
      });
      if (res.error) {
        setFollowing(!next); // 失敗したら戻す
        setError(res.error);
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        aria-pressed={following}
        className={`inline-flex items-center rounded-md px-3 py-1 text-xs font-medium transition-colors disabled:opacity-60 ${
          following
            ? "border border-border bg-muted hover:bg-muted/70"
            : "bg-primary text-primary-foreground hover:bg-primary/90"
        }`}
      >
        {following ? `${label}フォロー中` : `${label}をフォロー`}
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
