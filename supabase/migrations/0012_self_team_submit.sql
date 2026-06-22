-- self 応募（PR-3b）: 応募者本人によるチーム「確定」の書き込み許可
-- 背景: 0010 で teams/team_members の INSERT/UPDATE/DELETE は「主催者のみ」。0011 で SELECT を
--       同イベント参加者へ開放し、応募者は編成を「試算」できる（保存しない）状態まで来た（PR-3a）。
--       PR-3b は self 応募の最後のピース＝応募者本人が試算を「確定」して主催者の承認に乗せる書き込み。
-- 方針(壁打ち確定):
--   - 確定できるのは team_formation='self' のイベント（self/team/mixed）の approved な応募者。
--     entry_type / wants_matching では絞らない（あっせん希望者も誘われて self で組めるため）。
--   - 確定者本人が代表（captain_registration_id＝本人の registration）で、status='pending' で作る。
--   - メンバー集め・合意はアプリ外（Discord）。代表1人が代理で確定。通知/異議申立ては後続PR。
--   - capacity（=チーム数）のカウントは「主催者の承認時」。pending は枠を食わない。
--     排他制御は events の version 条件付き UPDATE（Server Action 側・events の UPDATE は 0004 の
--     主催者ポリシーで担保）。本マイグレーションは teams/team_members の self 書き込み許可が主目的。
-- 巻き込み防止: team_members の UNIQUE(registration_id) で二重所属を構造的に防ぐ
--               （既に他チームにいる人は self チームに入れられない）。
-- 対応: docs/DB設計書.md（6章 RLS / 7章 capacity カウント） / docs/要件定義書.md
-- 冪等性: drop policy if exists / create or replace 付き。

-- ===== self 確定の認可を判定する security definer 関数 =====
-- RLS 内で registrations / teams を直接参照すると自己参照ポリシーで再帰評価になりうるため、
-- security definer 関数（RLS をバイパスして判定）に切り出す。

-- 「対象 registration が、指定ユーザー本人の approved 応募で、かつ
--   その所属イベントが team_formation='self'（自分で組む）か」を判定する。
-- self チームの代表（captain）として確定する資格があるかの中核チェック。
create or replace function public.can_self_captain(p_registration_id uuid, p_uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.registrations r
    join public.events e on e.id = r.event_id
    where r.id = p_registration_id
      and r.user_id = p_uid
      and r.status = 'approved'
      and e.team_formation = 'self'
  );
$$;

-- 「対象 registration が、指定イベントの approved 応募か」を判定する。
-- self チームへ追加するメンバーが、確かにそのイベントの参加確定者であることの確認に使う。
create or replace function public.is_approved_registration(p_registration_id uuid, p_event_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.registrations r
    where r.id = p_registration_id
      and r.event_id = p_event_id
      and r.status = 'approved'
  );
$$;

-- 「対象 team が、指定ユーザーが代表の self 申請（pending）か」を判定する。
-- team_members の INSERT/DELETE で「自分が代表の確定中チームにだけ手を入れられる」ことの確認に使う。
create or replace function public.is_own_pending_self_team(p_team_id uuid, p_uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.teams t
    join public.registrations r on r.id = t.captain_registration_id
    where t.id = p_team_id
      and t.status = 'pending'
      and r.user_id = p_uid
  );
$$;

-- ===== teams: self 応募者の INSERT/DELETE を追加（主催者の 0010 はそのまま並存）=====

-- 作成: team_formation='self' のイベントで、代表が「自分の approved 応募」かつ status='pending'。
-- current_count 等の改竄を防ぐため events 列は触らない（承認時に主催者が排他 UPDATE）。
drop policy if exists "teams_insert_self_captain" on public.teams;
create policy "teams_insert_self_captain"
  on public.teams for insert
  to authenticated
  with check (
    status = 'pending'
    and captain_registration_id is not null
    and public.can_self_captain(captain_registration_id, auth.uid())
    and public.is_approved_registration(captain_registration_id, teams.event_id)
  );

-- 削除（取り下げ）: 代表本人が、まだ承認されていない（pending）自分の self チームのみ。
-- approved 後は主催者の承認を覆すことになるため不可（主催者の 0010 delete に委ねる）。
drop policy if exists "teams_delete_self_captain" on public.teams;
create policy "teams_delete_self_captain"
  on public.teams for delete
  to authenticated
  using (
    status = 'pending'
    and captain_registration_id is not null
    and public.can_self_captain(captain_registration_id, auth.uid())
  );

-- ===== team_members: self 応募者の INSERT/DELETE を追加（主催者の 0010 はそのまま並存）=====

-- 作成: 自分が代表の pending な self チームへ、同イベントの approved 応募を追加できる。
-- UNIQUE(registration_id) により、既に他チームに属する応募は弾かれる（巻き込み防止）。
drop policy if exists "team_members_insert_self_captain" on public.team_members;
create policy "team_members_insert_self_captain"
  on public.team_members for insert
  to authenticated
  with check (
    public.is_own_pending_self_team(team_members.team_id, auth.uid())
    and exists (
      select 1 from public.teams t
      where t.id = team_members.team_id
        and public.is_approved_registration(team_members.registration_id, t.event_id)
    )
  );

-- 削除: 自分が代表の pending な self チームのメンバーを外せる（確定前の組み替え・取り下げ）。
drop policy if exists "team_members_delete_self_captain" on public.team_members;
create policy "team_members_delete_self_captain"
  on public.team_members for delete
  to authenticated
  using (
    public.is_own_pending_self_team(team_members.team_id, auth.uid())
  );
