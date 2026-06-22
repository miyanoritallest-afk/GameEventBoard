-- teams / team_members の RLS ポリシー（チーム編成 PR-1）
-- 背景: 0001 で RLS は ON（デフォルト拒否）だが teams / team_members のポリシーが未整備。
--       チーム編成の導入で「イベント主催者だけがチームを作成・編集・削除でき、
--       メンバーを割当/解除できる」操作権限を DB 層でも担保する必要がある。
-- 方針: 実装ガイドライン（IDOR はアプリ層＋DB層 RLS で最終防衛）。0006 と同じ
--       EXISTS サブクエリで「対象イベントの主催者か」を判定する。
--       team_members は teams を経由して events に到達する2段の EXISTS。
-- スコープ: PR-1 は organizer 振り分けのみ。self 応募（応募者がチームを作る）の
--       ポリシーは PR-3 で追加する。本 PR は「主催者のみ操作可」で十分。
-- 対応: docs/DB設計書.md / docs/実装ガイドライン.md
-- 冪等性: 既存ポリシーを drop してから作成する。

alter table public.teams        enable row level security;
alter table public.team_members enable row level security;

-- ===== teams =====

-- 閲覧: そのイベントの主催者のみ（編成画面は主催者専用）。
-- 一般公開（参加チーム一覧の表示）は本戦機能の実装時に別途緩和する。
drop policy if exists "teams_select_organizer" on public.teams;
create policy "teams_select_organizer"
  on public.teams for select
  to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = teams.event_id
        and e.organizer_id = auth.uid()
    )
  );

-- 作成: そのイベントの主催者のみ。event_id を他人のイベントにできない。
drop policy if exists "teams_insert_organizer" on public.teams;
create policy "teams_insert_organizer"
  on public.teams for insert
  to authenticated
  with check (
    exists (
      select 1 from public.events e
      where e.id = teams.event_id
        and e.organizer_id = auth.uid()
    )
  );

-- 更新: そのイベントの主催者のみ（改名・version 更新）。
-- using/with check 両方で主催を要求し、他人のイベントへの付け替えも防ぐ。
drop policy if exists "teams_update_organizer" on public.teams;
create policy "teams_update_organizer"
  on public.teams for update
  to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = teams.event_id
        and e.organizer_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.events e
      where e.id = teams.event_id
        and e.organizer_id = auth.uid()
    )
  );

-- 削除: そのイベントの主催者のみ。team_members は FK の on delete cascade で連動。
drop policy if exists "teams_delete_organizer" on public.teams;
create policy "teams_delete_organizer"
  on public.teams for delete
  to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = teams.event_id
        and e.organizer_id = auth.uid()
    )
  );

-- ===== team_members =====
-- teams を経由して events.organizer_id を確認する（2段の所有権チェック）。

-- 閲覧: 所属チームのイベント主催者のみ。
drop policy if exists "team_members_select_organizer" on public.team_members;
create policy "team_members_select_organizer"
  on public.team_members for select
  to authenticated
  using (
    exists (
      select 1
      from public.teams t
      join public.events e on e.id = t.event_id
      where t.id = team_members.team_id
        and e.organizer_id = auth.uid()
    )
  );

-- 作成: 所属チームのイベント主催者のみ（メンバー割当）。
drop policy if exists "team_members_insert_organizer" on public.team_members;
create policy "team_members_insert_organizer"
  on public.team_members for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.teams t
      join public.events e on e.id = t.event_id
      where t.id = team_members.team_id
        and e.organizer_id = auth.uid()
    )
  );

-- 更新: 所属チームのイベント主催者のみ（ロール・position 変更）。
drop policy if exists "team_members_update_organizer" on public.team_members;
create policy "team_members_update_organizer"
  on public.team_members for update
  to authenticated
  using (
    exists (
      select 1
      from public.teams t
      join public.events e on e.id = t.event_id
      where t.id = team_members.team_id
        and e.organizer_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.teams t
      join public.events e on e.id = t.event_id
      where t.id = team_members.team_id
        and e.organizer_id = auth.uid()
    )
  );

-- 削除: 所属チームのイベント主催者のみ（メンバー解除）。
drop policy if exists "team_members_delete_organizer" on public.team_members;
create policy "team_members_delete_organizer"
  on public.team_members for delete
  to authenticated
  using (
    exists (
      select 1
      from public.teams t
      join public.events e on e.id = t.event_id
      where t.id = team_members.team_id
        and e.organizer_id = auth.uid()
    )
  );
