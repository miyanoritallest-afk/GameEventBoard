"use client";

import { useActionState, useState, useTransition } from "react";
import {
  searchInviteCandidates,
  inviteMember,
  removeMember,
  type SearchInviteState,
  type InviteMemberState,
} from "../actions";
import { Avatar } from "./avatar";

/**
 * シリーズ運営管理パネル（クライアント）。owner のみに表示する（呼び出し側で分岐）。
 * - 運営一覧（owner/admin・invited は「招待中」表示）＋削除ボタン。
 * - ユーザー検索 → 招待（検索は owner のみ・既member除外は DB関数）。
 * 認可・不変条件（最後のowner保護・二重招待防止）は Server Action＋DB関数が最終防衛。
 * ここは UI のみで、権限判定を信頼のソースにはしない。
 *
 * デザイン: .theme-matchpoint。メンバー行（アバター＋ロールチップ＋左帯）＋検索招待（.mp-form）。
 */

type Member = {
  userId: string;
  role: "owner" | "admin";
  status: "invited" | "active";
  user: {
    discord_name: string;
    battle_tag: string | null;
    discord_avatar_url: string | null;
  } | null;
};

const ROLE_LABEL: Record<Member["role"], string> = {
  owner: "オーナー",
  admin: "運営",
};

export function SeriesMembersPanel({
  seriesId,
  members,
  currentUserId,
}: {
  seriesId: string;
  members: Member[];
  currentUserId: string;
}) {
  const active = members.filter((m) => m.status === "active");
  const invited = members.filter((m) => m.status === "invited");

  return (
    <section className="mt-5 rounded-xl border border-border bg-card p-6 shadow-[var(--mp-e1)]">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="h-4 w-[3px] rounded-sm bg-[color:var(--mp-brand)]"
        />
        <h2 className="text-[15px] font-bold tracking-tight text-foreground">
          運営管理
        </h2>
        <span className="font-mono text-[13px] font-semibold tabular-nums text-[color:var(--mp-fg-subtle)]">
          {active.length}
        </span>
      </div>
      <p className="mt-1.5 text-[12.5px] text-muted-foreground">
        シリーズの運営メンバーを管理します。運営はすべての開催回を編集できます。
      </p>

      {/* オーナー限定の注記 */}
      <div className="mt-3.5 flex items-start gap-2.5 rounded-lg border border-[color:var(--mp-accent)]/26 bg-[color:var(--mp-accent)]/[0.08] px-3.5 py-2.5 text-xs leading-relaxed text-[color:var(--mp-accent)]">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.9}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mt-0.5 flex-none"
          aria-hidden
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
        <span>
          <b className="font-semibold text-foreground">
            オーナーのみに表示されるパネルです。
          </b>
          運営メンバーには読み取り専用の一覧が表示され、削除・招待の操作はできません。
        </span>
      </div>

      {/* 運営メンバー（active） */}
      <GroupLabel label="運営メンバー" count={active.length} />
      <ul className="flex flex-col gap-2.5">
        {active.map((m) => (
          <MemberRow
            key={m.userId}
            seriesId={seriesId}
            member={m}
            isSelf={m.userId === currentUserId}
          />
        ))}
      </ul>

      {/* 招待中（invited） */}
      {invited.length > 0 && (
        <>
          <GroupLabel label="招待中" count={invited.length} />
          <ul className="flex flex-col gap-2.5">
            {invited.map((m) => (
              <MemberRow
                key={m.userId}
                seriesId={seriesId}
                member={m}
                isSelf={m.userId === currentUserId}
              />
            ))}
          </ul>
        </>
      )}

      <InviteForm seriesId={seriesId} />
    </section>
  );
}

/** メンバーグループの見出し（運営メンバー / 招待中）。 */
function GroupLabel({ label, count }: { label: string; count: number }) {
  return (
    <p className="mb-2.5 mt-[22px] flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-[color:var(--mp-fg-subtle)]">
      {label}
      <span className="font-mono text-[color:var(--mp-fg-muted)]">
        ({count})
      </span>
    </p>
  );
}

/** 運営メンバー1行（表示＋削除）。削除は owner の権限（表示側は全 owner に出す）。 */
function MemberRow({
  seriesId,
  member,
  isSelf,
}: {
  seriesId: string;
  member: Member;
  isSelf: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isOwner = member.role === "owner";
  const isInvited = member.status === "invited";
  const name = member.user?.discord_name ?? "（不明なユーザー）";

  function handleRemove() {
    setError(null);
    const label = isInvited ? "招待を取り消す" : "運営から外す";
    if (!confirm(`${member.user?.discord_name ?? "このユーザー"} を${label}？`)) {
      return;
    }
    const fd = new FormData();
    fd.set("seriesId", seriesId);
    fd.set("userId", member.userId);
    startTransition(async () => {
      const res = await removeMember({}, fd);
      if (res.error) setError(res.error);
    });
  }

  // 左アクセント帯: owner=ブランド / invited=warning。
  const accent = isOwner
    ? "var(--mp-brand)"
    : isInvited
      ? "var(--mp-warning)"
      : "transparent";

  return (
    <li
      className={`relative flex items-center gap-3.5 overflow-hidden rounded-lg border bg-[color:var(--mp-surface-2)] px-4 py-3 transition hover:border-[color:var(--mp-border-strong)] ${
        isInvited
          ? "border-dashed border-[color:var(--mp-border-strong)]"
          : "border-border"
      }`}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: accent }}
      />
      <Avatar name={name} size={38} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="truncate font-heading text-[14.5px] font-bold text-foreground">
            {name}
          </span>
          <RoleChip
            kind={isInvited ? "invited" : isOwner ? "owner" : "staff"}
            label={isInvited ? "招待中" : ROLE_LABEL[member.role]}
          />
        </div>
        {member.user?.battle_tag && (
          <span className="truncate font-mono text-[11.5px] text-muted-foreground">
            {member.user.battle_tag}
          </span>
        )}
      </div>
      <div className="flex flex-none items-center gap-2">
        {error && <span className="text-xs text-destructive">{error}</span>}
        {isOwner ? (
          <span className="text-[11px] text-[color:var(--mp-fg-subtle)]">
            削除できません
          </span>
        ) : (
          <button
            type="button"
            onClick={handleRemove}
            disabled={pending}
            className="rounded-md border border-[color:var(--mp-border-strong)] px-2.5 py-1 text-[11.5px] font-semibold text-muted-foreground transition hover:border-[color:var(--mp-danger)]/40 hover:bg-[color:var(--mp-danger)]/12 hover:text-[color:var(--mp-danger)] disabled:opacity-60"
          >
            {isInvited ? "取消" : isSelf ? "退会" : "削除"}
          </button>
        )}
      </div>
    </li>
  );
}

/** ロールチップ（オーナー/運営/招待中）。 */
function RoleChip({
  kind,
  label,
}: {
  kind: "owner" | "staff" | "invited";
  label: string;
}) {
  if (kind === "owner") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--mp-brand)]/34 bg-[color:var(--mp-brand)]/12 px-2.5 py-0.5 text-[10.5px] font-semibold text-[color:var(--mp-brand)]">
        ★ {label}
      </span>
    );
  }
  if (kind === "invited") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--mp-warning)]/30 bg-[color:var(--mp-warning)]/12 px-2.5 py-0.5 text-[10.5px] font-semibold text-[color:var(--mp-warning)]">
        ⏳ {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-[color:var(--mp-border-strong)] bg-[color:var(--mp-surface-3)] px-2.5 py-0.5 text-[10.5px] font-semibold text-foreground">
      {label}
    </span>
  );
}

const initialSearch: SearchInviteState = {};
const initialInvite: InviteMemberState = {};

/** ユーザー検索して招待するフォーム（owner のみ表示）。 */
function InviteForm({ seriesId }: { seriesId: string }) {
  const [searchState, searchAction, searching] = useActionState(
    searchInviteCandidates,
    initialSearch,
  );
  const {
    state: inviteState,
    pending: invitePending,
    invitedIds,
    handleInvite,
  } = useInvite(seriesId);

  return (
    <div className="mt-[22px] border-t border-dashed border-[color:var(--mp-border-strong)] pt-5">
      <div className="mb-1 flex items-center gap-2">
        <span
          aria-hidden
          className="h-3.5 w-[3px] rounded-sm bg-[color:var(--mp-accent)]"
        />
        <h3 className="font-heading text-[13px] font-bold text-foreground">
          ユーザーを招待
        </h3>
      </div>
      <p className="mb-3 text-[11.5px] leading-relaxed text-muted-foreground">
        Discord名 / BattleTag
        で検索して運営に招待します。招待済み・既に運営のユーザーは再招待できません。
      </p>

      <form action={searchAction} className="mp-form flex gap-2">
        <input type="hidden" name="seriesId" value={seriesId} />
        <div className="relative min-w-0 flex-1">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.9}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--mp-fg-subtle)]"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            name="query"
            type="text"
            placeholder="Discord名 / BattleTag で検索"
            maxLength={100}
            className="!pl-9"
          />
        </div>
        <button
          type="submit"
          disabled={searching}
          className="shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-[color:var(--mp-brand-hover)] disabled:opacity-60"
        >
          検索
        </button>
      </form>

      {searchState.error && (
        <p className="mt-2 text-xs text-destructive">{searchState.error}</p>
      )}
      {inviteState.error && (
        <p className="mt-2 text-xs text-destructive">{inviteState.error}</p>
      )}
      {inviteState.success && (
        <p className="mt-2 text-xs text-[color:var(--mp-success)]">
          招待を送りました。
        </p>
      )}

      {searchState.results && (
        <ul className="mt-3 flex flex-col gap-2">
          {searchState.results.length === 0 ? (
            <li className="rounded-md border border-border bg-[color:var(--mp-surface-2)] px-3 py-3 text-center text-xs text-muted-foreground">
              該当するユーザーがいません（既に運営の人は表示されません）。
            </li>
          ) : (
            searchState.results.map((u) => (
              <li
                key={u.id}
                className="flex items-center gap-3 rounded-md border border-border bg-[color:var(--mp-surface-2)] px-3 py-2"
              >
                <Avatar name={u.discord_name} size={32} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13.5px] font-semibold text-foreground">
                    {u.discord_name}
                  </span>
                  {u.battle_tag && (
                    <span className="truncate font-mono text-[11px] text-muted-foreground">
                      {u.battle_tag}
                    </span>
                  )}
                </div>
                {invitedIds.has(u.id) ? (
                  <span className="inline-flex flex-none items-center gap-1 text-[11.5px] font-semibold text-[color:var(--mp-success)]">
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                    招待済み
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={invitePending}
                    onClick={() => handleInvite(u.id)}
                    className="flex-none rounded-md border border-[color:var(--mp-border-strong)] bg-[color:var(--mp-surface-3)] px-3 py-1.5 text-[11.5px] font-semibold text-foreground transition hover:bg-[color:var(--mp-surface-2)] disabled:opacity-60"
                  >
                    ＋ 招待
                  </button>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * 招待実行のトランジション管理（検索結果の行から user_id を渡して呼ぶ）。
 * 成功した userId を invitedIds に覚え、その行のボタンを「招待済み」無効表示にする
 * （検索結果は useActionState 側の状態で revalidate では更新されないため、再クリックで
 *  「既に運営メンバーです」エラーになるのを防ぐ）。
 */
function useInvite(seriesId: string): {
  state: InviteMemberState;
  pending: boolean;
  invitedIds: Set<string>;
  handleInvite: (userId: string) => void;
} {
  const [state, setState] = useState<InviteMemberState>(initialInvite);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  function handleInvite(userId: string) {
    setState({});
    const fd = new FormData();
    fd.set("seriesId", seriesId);
    fd.set("userId", userId);
    startTransition(async () => {
      const res = await inviteMember({}, fd);
      setState(res);
      if (res.success) {
        setInvitedIds((prev) => new Set(prev).add(userId));
      }
    });
  }
  return { state, pending, invitedIds, handleInvite };
}
