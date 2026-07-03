"use client";

import { useActionState, useState, useTransition } from "react";
import {
  searchInviteCandidates,
  inviteMember,
  removeMember,
  type SearchInviteState,
  type InviteMemberState,
} from "../actions";

/**
 * シリーズ運営管理パネル（クライアント）。owner のみに表示する（呼び出し側で分岐）。
 * - 運営一覧（owner/admin・invited は「招待中」表示）＋削除ボタン。
 * - ユーザー検索 → 招待（検索は owner のみ・既member除外は DB関数）。
 * 認可・不変条件（最後のowner保護・二重招待防止）は Server Action＋DB関数が最終防衛。
 * ここは UI のみで、権限判定を信頼のソースにはしない。
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
  return (
    <section className="mt-8 rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold">運営メンバー</h2>
      <ul className="mt-3 space-y-2">
        {members.map((m) => (
          <MemberRow
            key={m.userId}
            seriesId={seriesId}
            member={m}
            isSelf={m.userId === currentUserId}
          />
        ))}
      </ul>
      <InviteForm seriesId={seriesId} />
    </section>
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

  function handleRemove() {
    setError(null);
    const label = member.status === "invited" ? "招待を取り消す" : "運営から外す";
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

  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium">
          {member.user?.discord_name ?? "（不明なユーザー）"}
        </span>
        {member.user?.battle_tag && (
          <span className="truncate text-xs text-muted-foreground">
            {member.user.battle_tag}
          </span>
        )}
        <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {ROLE_LABEL[member.role]}
        </span>
        {member.status === "invited" && (
          <span className="shrink-0 rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400">
            招待中
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {error && <span className="text-xs text-destructive">{error}</span>}
        <button
          type="button"
          onClick={handleRemove}
          disabled={pending}
          className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-60"
        >
          {member.status === "invited"
            ? "取消"
            : isSelf
              ? "退会"
              : "削除"}
        </button>
      </div>
    </li>
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
    <div className="mt-5 border-t border-border/60 pt-4">
      <h3 className="text-xs font-semibold text-muted-foreground">
        運営を招待する
      </h3>
      <form action={searchAction} className="mt-2 flex gap-2">
        <input type="hidden" name="seriesId" value={seriesId} />
        <input
          name="query"
          type="text"
          placeholder="Discord名 / BattleTag で検索"
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          maxLength={100}
        />
        <button
          type="submit"
          disabled={searching}
          className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
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
        <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
          招待を送りました。
        </p>
      )}
      {searchState.results && (
        <ul className="mt-3 space-y-2">
          {searchState.results.length === 0 ? (
            <li className="text-xs text-muted-foreground">
              該当するユーザーがいません（既に運営の人は表示されません）。
            </li>
          ) : (
            searchState.results.map((u) => (
              <li
                key={u.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm">{u.discord_name}</span>
                  {u.battle_tag && (
                    <span className="truncate text-xs text-muted-foreground">
                      {u.battle_tag}
                    </span>
                  )}
                </div>
                {invitedIds.has(u.id) ? (
                  <span className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground">
                    招待済み
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={invitePending}
                    onClick={() => handleInvite(u.id)}
                    className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-60"
                  >
                    招待
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
