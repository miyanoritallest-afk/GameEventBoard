"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { markRead } from "./actions";

/** UTC(ISO) を JST 表示に整形する。 */
function fmtJst(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 通知1件（クライアント）。クリックで既読化してから link_url へ遷移する。
 * 既読は楽観的に見た目へ反映（is_read）。文面は React 自動エスケープに任せる（XSS 対策）。
 */
export function NotificationItem({
  id,
  title,
  body,
  linkUrl,
  isRead,
  createdAt,
}: {
  id: string;
  title: string;
  body: string | null;
  linkUrl: string | null;
  isRead: boolean;
  createdAt: string;
}) {
  const router = useRouter();
  const [read, setRead] = useState(isRead);
  const [, startTransition] = useTransition();

  function handleClick() {
    if (!read) {
      setRead(true); // 楽観的に既読表示
      startTransition(() => {
        void markRead(id);
      });
    }
    if (linkUrl) router.push(linkUrl);
  }

  return (
    <li>
      <button
        type="button"
        onClick={handleClick}
        className={`flex w-full flex-col items-start gap-1 rounded-xl border p-4 text-left transition-colors ${
          read
            ? "border-border bg-card"
            : "border-primary/40 bg-primary/5"
        } ${linkUrl ? "hover:bg-accent" : "cursor-default"}`}
      >
        <div className="flex w-full items-center justify-between gap-2">
          <span className="flex items-center gap-2 font-medium">
            {!read && (
              <span
                aria-hidden
                className="inline-block h-2 w-2 shrink-0 rounded-full bg-primary"
              />
            )}
            {title}
          </span>
          <time className="shrink-0 text-xs text-muted-foreground">
            {fmtJst(createdAt)}
          </time>
        </div>
        {body && (
          <p className="text-sm text-muted-foreground">{body}</p>
        )}
      </button>
    </li>
  );
}
