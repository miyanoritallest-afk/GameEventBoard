-- シリーズ PR-⑥-1: event_series / series_members の RLS ポリシー
-- 背景: 0001 で両テーブルとも RLS ON だがポリシー未整備。シリーズ機能（作成・一覧・詳細・
--       フォロー・イベント紐付け）の前提としてポリシーを整備する。
-- 方針(実装ガイドライン: 閲覧系は公開・操作系は保護／IDOR は アプリ層＋DB層 RLS):
--   - event_series: SELECT=公開（一覧・詳細は誰でも）。INSERT=本人（created_by=auth.uid()）。
--     UPDATE=owner のみ（series_members に owner・active で属する人）。DELETE は⑥-2（owner）。
--   - series_members: SELECT=公開（運営一覧の表示）。INSERT=作成時の owner 自己登録のみ
--     （series の created_by 本人が自分を owner・active で入れる）。招待による追加は⑥-2。
--   - owner/staff 判定は series_members 経由の多段のため security definer 関数に切り出す
--     （0015 can_report_match / 0030 と同型・RLS 自己参照の再帰評価を避ける）。
-- 対応: docs/DB設計書.md（6章 RLS）/ docs/要件定義書.md（3.5.1）
-- 冪等性: create or replace / drop policy if exists。

-- 指定ユーザーがシリーズの owner（active）か。
create or replace function public.is_series_owner(p_series_id uuid, p_uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.series_members m
    where m.series_id = p_series_id
      and m.user_id = p_uid
      and m.role = 'owner'
      and m.status = 'active'
  );
$$;

-- 指定ユーザーがシリーズの運営（owner/admin・active）か。イベント紐付けの可否判定に使う。
create or replace function public.is_series_staff(p_series_id uuid, p_uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.series_members m
    where m.series_id = p_series_id
      and m.user_id = p_uid
      and m.status = 'active'
  );
$$;

-- ===== event_series =====
alter table public.event_series enable row level security;

-- 閲覧: 公開（シリーズ一覧・詳細は誰でも）。
drop policy if exists "event_series_select_all" on public.event_series;
create policy "event_series_select_all"
  on public.event_series for select
  using (true);

-- 作成: ログインユーザーが自分を created_by として作る。
drop policy if exists "event_series_insert_own" on public.event_series;
create policy "event_series_insert_own"
  on public.event_series for insert
  to authenticated
  with check (created_by = auth.uid());

-- 更新: owner のみ。
drop policy if exists "event_series_update_owner" on public.event_series;
create policy "event_series_update_owner"
  on public.event_series for update
  to authenticated
  using (public.is_series_owner(id, auth.uid()))
  with check (public.is_series_owner(id, auth.uid()));

-- ===== series_members =====
alter table public.series_members enable row level security;

-- 閲覧: 公開（運営一覧の表示用）。
drop policy if exists "series_members_select_all" on public.series_members;
create policy "series_members_select_all"
  on public.series_members for select
  using (true);

-- 作成: シリーズ作成者本人が、自分を owner・active として登録するときのみ（本 PR）。
-- 招待による追加（invited_by・admin・invited→active）は⑥-2 で別ポリシーを足す。
drop policy if exists "series_members_insert_creator_owner" on public.series_members;
create policy "series_members_insert_creator_owner"
  on public.series_members for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and role = 'owner'
    and status = 'active'
    and exists (
      select 1 from public.event_series s
      where s.id = series_id and s.created_by = auth.uid()
    )
  );

-- シリーズ作成＋作成者を owner・active で登録を1トランザクションで行う security definer 関数。
-- 背景: アプリ層で event_series → series_members の2回 INSERT に分けると、後者が失敗したとき
--       owner 不在の孤立シリーズが残り、以後 RLS（update=owner のみ）で誰も編集できなくなる。
-- 対策: 単一関数内で両方を実行（どちらか失敗すれば関数全体がロールバック）。作成者を
--       p_created_by に固定し、その本人が owner・active で入る。返り値は作成した series id。
-- サーバー（Server Action）の作成処理からのみ呼ぶ。
create or replace function public.create_series_with_owner(
  p_name text,
  p_description text,
  p_created_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.event_series (name, description, created_by)
  values (p_name, p_description, p_created_by)
  returning id into v_id;

  insert into public.series_members (series_id, user_id, role, status, joined_at)
  values (v_id, p_created_by, 'owner', 'active', now());

  return v_id;
end;
$$;
