-- シリーズ PR-⑥-2: シリーズ共同運営（検索招待・承認・削除）
-- 背景: ⑥-1（0032）で series_members は「作成者が自分を owner・active で登録」だけを許可。
--       本 PR で owner による admin の招待（invited）・招待相手の承認（invited→active）・
--       owner による運営削除を可能にする（要件定義書 3.5.1）。
-- 方針(実装ガイドライン: 操作系は保護／IDOR は アプリ層＋DB層 RLS／他人データ集約は definer):
--   - 招待/承認/削除は series_members への INSERT/UPDATE/DELETE。RLS で最終防衛しつつ、
--     多段判定（owner か・最後の owner か・被招待者本人か）が必要なため security definer 関数に
--     ロジックを寄せる（0032 is_series_owner / 0030 list_follower_ids と同型）。RLS は
--     「関数経由の正しい書き込みだけが通る」形にはできないため、ポリシーは緩め（owner/本人）に
--     しつつ、原子性と不変条件（owner 最低1人・二重招待防止）は関数側で担保する。
--   - ユーザー検索は users の他人行が RLS で見えないため definer 関数で跨ぐ（既 member 除外・上限20）。
-- owner 保護（devlog 1942 / 壁打ち確定）:
--   - admin は owner を削除/降格できない（owner のみ）。
--   - 最後の owner（active）は削除できない（シリーズの孤立防止）。owner 降格は本 PR では扱わない
--     （役割変更 UI は将来。まずは招待=admin 固定・削除で足りる）。
-- 対応: docs/DB設計書.md（6章 RLS）/ docs/要件定義書.md（3.5.1 / 3.7 #11）
-- 冪等性: create or replace / drop policy if exists。

-- ========================================================================
-- security definer 関数
-- ========================================================================

-- 招待候補のユーザー検索。discord_name / battle_tag の部分一致（大小無視）。
-- users は RLS で他人行が見えないため definer で跨ぐ。既に series_members に居る人は除外。
-- 列挙抑制のため上限20件。空クエリは空集合（誤爆で全件返さない）。
-- 返すのは招待に必要な最小限（id / discord_name / battle_tag / avatar）。
create or replace function public.search_users_for_invite(
  p_series_id uuid,
  p_query text
)
returns table (
  id uuid,
  discord_name text,
  battle_tag text,
  discord_avatar_url text
)
language sql
security definer
set search_path = public
stable
as $$
  select u.id, u.discord_name, u.battle_tag, u.discord_avatar_url
  from public.users u
  where length(trim(coalesce(p_query, ''))) > 0
    and (
      u.discord_name ilike '%' || p_query || '%'
      or u.battle_tag ilike '%' || p_query || '%'
    )
    and not exists (
      select 1 from public.series_members m
      where m.series_id = p_series_id and m.user_id = u.id
    )
  order by u.discord_name
  limit 20;
$$;

-- owner による運営メンバー招待。相手を role=admin・status=invited で登録する。
-- 冪等性/安全: 呼び出し元（p_inviter）が owner・active であること、対象がまだ member でないことを
--   関数内で検証（RLS だけだと「二重招待」「非 owner の招待」を完全に防ぎきれないため）。
-- 返り値: 作成した series_members.id。既に member なら例外（アプリ層で握る）。
create or replace function public.invite_series_member(
  p_series_id uuid,
  p_user_id uuid,
  p_inviter uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_series_owner(p_series_id, p_inviter) then
    raise exception 'inviter is not an active owner of the series';
  end if;
  if exists (
    select 1 from public.series_members
    where series_id = p_series_id and user_id = p_user_id
  ) then
    raise exception 'user is already a member of the series';
  end if;

  insert into public.series_members (series_id, user_id, role, status, invited_by, invited_at)
  values (p_series_id, p_user_id, 'admin', 'invited', p_inviter, now())
  returning id into v_id;

  return v_id;
end;
$$;

-- 招待への応答（承認/拒否）。本人（p_user）宛ての invited 行にのみ作用する。
-- 承認: status=active・joined_at=now()。拒否: 行を削除。
-- 返り値: 実際に作用した行数（0 なら該当なし＝アプリ層で「既に処理済み」応答に使う）。
create or replace function public.respond_to_series_invite(
  p_series_id uuid,
  p_user uuid,
  p_accept boolean
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_accept then
    update public.series_members
    set status = 'active', joined_at = now()
    where series_id = p_series_id
      and user_id = p_user
      and status = 'invited';
    get diagnostics v_count = row_count;
  else
    delete from public.series_members
    where series_id = p_series_id
      and user_id = p_user
      and status = 'invited';
    get diagnostics v_count = row_count;
  end if;
  return v_count;
end;
$$;

-- owner による運営メンバー削除（招待取消・退会含む）。
-- 保護: 実行者（p_remover）は owner・active であること。最後の owner（active）は削除不可。
--   自分自身の削除（退会）も owner なら可だが、最後の owner なら弾く（孤立防止）。
-- 返り値: 削除した行数（0 なら該当なし）。
create or replace function public.remove_series_member(
  p_series_id uuid,
  p_user_id uuid,
  p_remover uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_role series_role;
  v_target_status member_state;
  v_owner_count integer;
  v_count integer;
begin
  if not public.is_series_owner(p_series_id, p_remover) then
    raise exception 'remover is not an active owner of the series';
  end if;

  select role, status into v_target_role, v_target_status
  from public.series_members
  where series_id = p_series_id and user_id = p_user_id;
  if not found then
    return 0;
  end if;

  -- 最後の active owner は削除できない（シリーズ孤立防止）。
  if v_target_role = 'owner' and v_target_status = 'active' then
    select count(*) into v_owner_count
    from public.series_members
    where series_id = p_series_id and role = 'owner' and status = 'active';
    if v_owner_count <= 1 then
      raise exception 'cannot remove the last active owner of the series';
    end if;
  end if;

  delete from public.series_members
  where series_id = p_series_id and user_id = p_user_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ========================================================================
-- series_members RLS ポリシー拡張
-- ========================================================================
-- 0032 で INSERT=作成者の owner 自己登録のみだった。本 PR で招待/承認/削除を足す。
-- ロジックの主役は上の definer 関数（原子性・不変条件を担保）。RLS は多層防御の外側として、
-- 「owner 以外は書けない／本人は自分の invited 行だけ触れる」を最低限保証する。

-- INSERT: 0032 の「作成者の owner 自己登録」に加えて「owner による招待（admin・invited）」を許可。
drop policy if exists "series_members_insert_owner_invite" on public.series_members;
create policy "series_members_insert_owner_invite"
  on public.series_members for insert
  to authenticated
  with check (
    role = 'admin'
    and status = 'invited'
    and public.is_series_owner(series_id, auth.uid())
  );

-- UPDATE: 被招待者本人が自分の invited 行を承認（active 化）できる。
-- USING で「自分の invited 行」に限定。WITH CHECK で更新後の姿を admin・active に固定する
--   （権限昇格防止＝マスアサインメント対策。RLS 直叩きで role='owner' に自己昇格させない。
--    招待は必ず admin で入るので承認後も admin のまま。role 変更 UI は将来別ポリシーで）。
drop policy if exists "series_members_update_self_accept" on public.series_members;
create policy "series_members_update_self_accept"
  on public.series_members for update
  to authenticated
  using (user_id = auth.uid() and status = 'invited')
  with check (user_id = auth.uid() and role = 'admin' and status = 'active');

-- DELETE: owner による削除（招待取消・運営削除）、または本人による拒否/退会。
-- 不変条件（最後の owner 保護）は remove_series_member 関数で担保。RLS は書き手の資格だけ見る。
drop policy if exists "series_members_delete_owner_or_self" on public.series_members;
create policy "series_members_delete_owner_or_self"
  on public.series_members for delete
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_series_owner(series_id, auth.uid())
  );
