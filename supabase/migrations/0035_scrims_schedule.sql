-- チーム日程管理（スクリム/練習）: スキーマ拡張＋RLS 整備
-- 背景: scrims は 0001 で作成・RLS 有効化のみでポリシー未整備（＝現状は誰も読み書き不可）。
--       チーム日程管理（要件定義書 3.4.3）の前提として、種別（スクリム/練習）を足し、
--       「チームメンバーが自チームの予定を共有する」RLS を整える。
-- 方針(実装ガイドライン: 操作系は保護／閲覧系は必要範囲に絞る／IDOR は アプリ層＋DB層 RLS):
--   - scrims.kind: 'scrim'（練習試合・相手あり）/ 'practice'（練習・相手なし）。既定 'scrim'。
--   - 閲覧(SELECT): そのチームのメンバー、または そのイベントの主催者。
--   - 作成/編集/削除(INSERT/UPDATE/DELETE): そのチームのメンバー（権限はゆるく＝代表限定にしない。
--     1人が入れれば全員に共有される「チーム共有カレンダー」）。
--   - メンバー判定は team_members→registrations→user の多段のため security definer 関数に
--     切り出す（0015 can_report_match と同型・RLS 自己参照の再帰評価を避ける）。
-- 対応: docs/DB設計書.md（3.4 scrims / 6章 RLS）/ docs/要件定義書.md（3.4.3）
-- 冪等性: do $$ で enum を条件付き作成 / create or replace / drop policy if exists。

-- 種別 enum（既に無ければ作る）。
do $$
begin
  if not exists (select 1 from pg_type where typname = 'scrim_kind') then
    create type scrim_kind as enum ('scrim', 'practice');
  end if;
end $$;

-- scrims に kind 列を追加（既存行は 'scrim' 既定）。
alter table public.scrims
  add column if not exists kind scrim_kind not null default 'scrim';

-- 指定ユーザーが指定チームのメンバーか（team_members→registrations→user で辿る）。
-- スケジュール（scrims）の RLS から呼ぶ。can_report_match（0015）と同型の definer。
create or replace function public.is_team_member(p_team_id uuid, p_uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.team_members tm
    join public.registrations r on r.id = tm.registration_id
    where tm.team_id = p_team_id
      and r.user_id = p_uid
  );
$$;

-- 指定ユーザーが指定チームの属するイベントの主催者か。閲覧範囲（主催者も見える）に使う。
create or replace function public.is_team_event_organizer(p_team_id uuid, p_uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.teams t
    join public.events e on e.id = t.event_id
    where t.id = p_team_id
      and e.organizer_id = p_uid
  );
$$;

-- ===== scrims RLS =====
alter table public.scrims enable row level security;

-- 閲覧: チームメンバー または イベント主催者。
drop policy if exists "scrims_select_member_or_organizer" on public.scrims;
create policy "scrims_select_member_or_organizer"
  on public.scrims for select
  to authenticated
  using (
    public.is_team_member(team_id, auth.uid())
    or public.is_team_event_organizer(team_id, auth.uid())
  );

-- 作成: そのチームのメンバーが、自分を created_by として作る（team は自チームのみ）。
drop policy if exists "scrims_insert_member" on public.scrims;
create policy "scrims_insert_member"
  on public.scrims for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and public.is_team_member(team_id, auth.uid())
  );

-- 更新: そのチームのメンバー（誰でも・チーム共有カレンダーのため）。team_id の付け替えは
-- 不可にする（更新後も同じチームのメンバーであることを WITH CHECK で要求）。
drop policy if exists "scrims_update_member" on public.scrims;
create policy "scrims_update_member"
  on public.scrims for update
  to authenticated
  using (public.is_team_member(team_id, auth.uid()))
  with check (public.is_team_member(team_id, auth.uid()));

-- 削除: そのチームのメンバー（誰でも）。
drop policy if exists "scrims_delete_member" on public.scrims;
create policy "scrims_delete_member"
  on public.scrims for delete
  to authenticated
  using (public.is_team_member(team_id, auth.uid()));
