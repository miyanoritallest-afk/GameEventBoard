-- シリーズ PR-⑥-2（修正）: 共同運営の認可バイパスを塞ぐ
-- 背景（code-review で発見・実地再現）: 0033 の security definer 関数は actor を
--   パラメータ（p_inviter / p_user / p_remover）で受け取っていた。Postgres は definer 関数に
--   EXECUTE を PUBLIC へデフォルト付与するため、認証済みユーザーが REST の /rpc/<fn> を直接
--   叩き、他人の owner UUID を actor として渡すだけで RLS をバイパスして権限昇格できた
--   （非 owner が「のりの UUID を p_inviter に」→ 自分を admin 招待、を実地で再現）。
--   さらに DELETE の RLS が user_id=auth.uid() で自己削除を無条件許可していたため、唯一の
--   owner が直 REST DELETE で自分を消してシリーズを孤立（以後 update=owner で永久ロック）できた。
-- 方針（壁打ち確定）:
--   1. actor は関数内で auth.uid() を使う。p_inviter/p_remover/p_user 引数は廃止
--      （他人 UUID を渡す攻撃を原理的に不可能にする＝本丸）。
--   2. search_users_for_invite に「呼び出し元が owner か」の内部チェックを追加
--      （Server Action だけの owner gate は直 RPC で回避されるため）。
--   3. 削除/退会/招待拒否は全て definer 関数経由に強制。DELETE の RLS ポリシーを撤去し、
--      最後の active owner 保護・TOCTOU 対策（FOR UPDATE）を関数が一元管理する。
--   4. これらの definer 関数の EXECUTE を anon から REVOKE（authenticated のみ・actor は
--      auth.uid() なので未ログインの anon から呼ばせる理由がない）。
--   5. ついでに ilike の LIKE メタ文字（% _）を未エスケープだった検索をエスケープする。
-- 対応: docs/DB設計書.md（6章 RLS）/ docs/要件定義書.md（3.5.1）
-- 冪等性: create or replace / drop policy if exists / drop function（引数変更のため旧版を落とす）。

-- ========================================================================
-- 1. search_users_for_invite: owner 内部チェック＋LIKE メタ文字エスケープ
-- ========================================================================
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
  -- 呼び出し元（auth.uid()）が owner・active のときだけ結果を返す。非 owner の直 RPC は空集合。
  -- LIKE メタ文字（% _ \）をエスケープし ESCAPE '\' で明示（誤マッチ・列挙増幅を防ぐ）。
  select u.id, u.discord_name, u.battle_tag, u.discord_avatar_url
  from public.users u
  where public.is_series_owner(p_series_id, auth.uid())
    and length(trim(coalesce(p_query, ''))) > 0
    and (
      u.discord_name ilike '%' || replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
      or u.battle_tag ilike '%' || replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
    )
    and not exists (
      select 1 from public.series_members m
      where m.series_id = p_series_id and m.user_id = u.id
    )
  order by u.discord_name
  limit 20;
$$;

-- ========================================================================
-- 2. invite_series_member: actor=auth.uid()（p_inviter 廃止）
-- ========================================================================
-- 引数が変わる（3→2）ため旧シグネチャを drop してから作り直す。
drop function if exists public.invite_series_member(uuid, uuid, uuid);

create or replace function public.invite_series_member(
  p_series_id uuid,
  p_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  -- 実行者本人が owner・active か（他人 UUID を借りられないよう auth.uid() で判定）。
  if not public.is_series_owner(p_series_id, v_uid) then
    raise exception 'inviter is not an active owner of the series';
  end if;
  if exists (
    select 1 from public.series_members
    where series_id = p_series_id and user_id = p_user_id
  ) then
    raise exception 'user is already a member of the series';
  end if;

  insert into public.series_members (series_id, user_id, role, status, invited_by, invited_at)
  values (p_series_id, p_user_id, 'admin', 'invited', v_uid, now())
  returning id into v_id;

  return v_id;
end;
$$;

-- ========================================================================
-- 3. respond_to_series_invite: actor=auth.uid()（p_user 廃止）
-- ========================================================================
drop function if exists public.respond_to_series_invite(uuid, uuid, boolean);

create or replace function public.respond_to_series_invite(
  p_series_id uuid,
  p_accept boolean
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  -- 自分（auth.uid()）宛ての invited 行にのみ作用（他人の招待を勝手に承認/拒否できない）。
  if p_accept then
    update public.series_members
    set status = 'active', joined_at = now()
    where series_id = p_series_id
      and user_id = v_uid
      and status = 'invited';
    get diagnostics v_count = row_count;
  else
    delete from public.series_members
    where series_id = p_series_id
      and user_id = v_uid
      and status = 'invited';
    get diagnostics v_count = row_count;
  end if;
  return v_count;
end;
$$;

-- ========================================================================
-- 4. remove_series_member: actor=auth.uid()（p_remover 廃止）＋ FOR UPDATE
-- ========================================================================
-- 認可: 実行者（auth.uid()）が owner・active、または対象が自分自身（＝退会）のとき削除可。
-- 保護: 最後の active owner は削除不可。owner 行のカウントを FOR UPDATE でロックし TOCTOU を防ぐ
--   （2つの並行 remove が別 owner を消して owner 0 人になる事故を防止）。
drop function if exists public.remove_series_member(uuid, uuid, uuid);

create or replace function public.remove_series_member(
  p_series_id uuid,
  p_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_owner boolean;
  v_target_role series_role;
  v_target_status member_state;
  v_owner_count integer;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  v_is_owner := public.is_series_owner(p_series_id, v_uid);
  -- owner による他者削除、または本人の退会（自分の行）のみ許可。
  if not v_is_owner and v_uid <> p_user_id then
    raise exception 'remover is not an active owner of the series';
  end if;

  select role, status into v_target_role, v_target_status
  from public.series_members
  where series_id = p_series_id and user_id = p_user_id;
  if not found then
    return 0;
  end if;

  -- 最後の active owner は削除できない（シリーズ孤立防止）。owner 行を先にロックしてから数える
  -- （並行 remove を直列化し、両方が count>1 を読む TOCTOU を防ぐ）。
  -- 注: count(*) と FOR UPDATE は同一文で併用不可（0A000）。ロック用の SELECT と件数用の
  --     SELECT を2段に分ける。perform で owner 行に行ロックを取ってから集約する。
  if v_target_role = 'owner' and v_target_status = 'active' then
    perform 1
    from public.series_members
    where series_id = p_series_id and role = 'owner' and status = 'active'
    for update;

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
-- 5. DELETE の RLS ポリシーを撤去（削除は remove_series_member 関数経由に強制）
-- ========================================================================
-- 0033 の series_members_delete_owner_or_self は user_id=auth.uid() で自己削除を無条件許可し、
-- 最後の owner 保護（関数内のみ）を直 REST DELETE でバイパスできた。ポリシー自体を落とし、
-- authenticated からの直 DELETE は一切通さない（RLS 有効＋該当ポリシー無し＝拒否）。
drop policy if exists "series_members_delete_owner_or_self" on public.series_members;

-- UPDATE も承認は respond_to_series_invite 関数経由に一本化する
-- （0033 の series_members_update_self_accept は本人の直 UPDATE を許していた。権限昇格は
--  WITH CHECK で塞いだが、承認経路を関数に一本化して直 UPDATE 経路自体を無くす）。
drop policy if exists "series_members_update_self_accept" on public.series_members;

-- INSERT（招待）も invite_series_member 関数経由に一本化する
-- （0033 の series_members_insert_owner_invite は owner の直 INSERT を許していた。関数が
--  二重招待チェック等の不変条件を持つため、直 INSERT 経路を無くして関数に寄せる）。
-- 注: 0032 の series_members_insert_creator_owner（作成者の owner 自己登録）は
--     create_series_with_owner 関数が担うため、これも将来的には不要だが本 PR では触らない
--     （create_series_with_owner は definer で INSERT するのでポリシー非依存。残置は無害）。
drop policy if exists "series_members_insert_owner_invite" on public.series_members;

-- ========================================================================
-- 6. definer 関数の EXECUTE を anon から REVOKE（authenticated のみ）
-- ========================================================================
-- actor は関数内で auth.uid() を使うため、未ログイン（anon）から呼ばせる理由がない。
-- PUBLIC への default grant を剥がし、authenticated にだけ与える。
revoke execute on function public.search_users_for_invite(uuid, text) from public;
revoke execute on function public.invite_series_member(uuid, uuid) from public;
revoke execute on function public.respond_to_series_invite(uuid, boolean) from public;
revoke execute on function public.remove_series_member(uuid, uuid) from public;

grant execute on function public.search_users_for_invite(uuid, text) to authenticated;
grant execute on function public.invite_series_member(uuid, uuid) to authenticated;
grant execute on function public.respond_to_series_invite(uuid, boolean) to authenticated;
grant execute on function public.remove_series_member(uuid, uuid) to authenticated;
