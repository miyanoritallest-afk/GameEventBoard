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
 *
 * デザイン: 未読は左アクセント帯＋ベルの青ドット＋強調背景。既読は通常。link ありで矢印＋hover。
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
        className={`group relative flex w-full items-start gap-[15px] overflow-hidden rounded-xl border p-4 pl-[21px] text-left shadow-[var(--mp-e1)] transition focus-visible:border-[color:var(--mp-brand)] focus-visible:shadow-[0_0_0_3px_rgba(255,106,43,0.2)] focus-visible:outline-none ${
          read
            ? "border-border bg-card"
            : "border-[color:var(--mp-brand)]/26 bg-[linear-gradient(100deg,rgba(255,106,43,0.06),var(--mp-surface)_34%)]"
        } ${
          linkUrl
            ? "cursor-pointer hover:border-[color:var(--mp-border-strong)] hover:bg-[color:var(--mp-surface-2)] active:translate-y-px"
            : "cursor-pointer"
        }`}
      >
        {/* 未読の左アクセント帯 */}
        {!read && (
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-[3px] bg-[color:var(--mp-brand)]"
          />
        )}

        {/* ベルアイコン（共通・未読は青ドット付き） */}
        <span
          aria-hidden
          className={`relative mt-px flex size-10 flex-none items-center justify-center rounded-full border ${
            read
              ? "border-border bg-[color:var(--mp-surface-3)] text-[color:var(--mp-fg-subtle)]"
              : "border-[color:var(--mp-brand)]/32 bg-[color:var(--mp-brand)]/12 text-[color:var(--mp-brand)]"
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-[18px]"
          >
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
          </svg>
          {!read && (
            <span className="absolute -right-px -top-px size-[11px] rounded-full bg-[color:var(--mp-brand)] shadow-[0_0_8px_var(--mp-brand),0_0_0_2px_var(--mp-surface)]" />
          )}
        </span>

        {/* 本文：title（＋任意で body）。React 自動エスケープ（XSS 対策）。 */}
        <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
          <span
            className={`font-heading text-[14.5px] leading-snug ${
              read
                ? "font-semibold text-muted-foreground"
                : "font-bold text-foreground"
            }`}
          >
            {title}
          </span>
          {body && (
            <span
              className={`whitespace-pre-wrap break-words text-[13px] leading-relaxed ${
                read
                  ? "text-[color:var(--mp-fg-subtle)]"
                  : "text-muted-foreground"
              }`}
            >
              {body}
            </span>
          )}
        </div>

        {/* 右：日時（＋link ありで矢印） */}
        <div className="flex flex-none flex-col items-end gap-2 pl-1.5">
          <time className="whitespace-nowrap text-right font-mono text-[11.5px] tabular-nums text-[color:var(--mp-fg-subtle)]">
            {fmtJst(createdAt)}
          </time>
          {linkUrl && (
            <span
              aria-hidden
              className="text-[color:var(--mp-fg-subtle)] transition group-hover:text-[color:var(--mp-brand)]"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-4 transition group-hover:translate-x-0.5"
              >
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </span>
          )}
        </div>
      </button>
    </li>
  );
}
