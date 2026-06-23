-- 本戦フェーズ PR-1: groups / group_teams の RLS ポリシー（予選ブロック分け）
-- 背景: 0001 で RLS は ON（デフォルト拒否）だが groups / group_teams のポリシーが未整備。
--       本戦の予選は、承認済みチームを「ブロック（=groups）」に分け、ブロック内総当たりを行う。
--       まず主催者がチームをブロックへ D&D 振り分けできるよう、操作・閲覧の権限を整える。
-- 方針(壁打ち確定・チーム編成 0010/0011 と同じ流儀):
--   - 操作（ブロック作成・改名・削除・振り分け）は対象イベントの主催者のみ。
--   - 閲覧は「主催者 or 同イベントの参加者（応募者）」に開放（参加者は自分の所属ブロックや
--     対戦相手を見られる）。判定は 0011 の is_event_participant を再利用（再帰評価回避）。
--   - ブロック数・振り分け人数に上限なし（割り切れず偏ってOK）。
-- 対応: docs/DB設計書.md（6章 RLS） / docs/要件定義書.md（3.4.1 進行形式）
-- 冪等性: drop policy if exists / create policy。

-- ===== groups（予選ブロック）=====

-- 閲覧: 主催者 or 同イベント参加者。
drop policy if exists "groups_select_participant" on public.groups;
create policy "groups_select_participant"
  on public.groups for select
  to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = groups.event_id
        and e.organizer_id = auth.uid()
    )
    or public.is_event_participant(groups.event_id, auth.uid())
  );

-- 作成: 対象イベントの主催者のみ。event_id を他人のイベントにできない。
drop policy if exists "groups_insert_organizer" on public.groups;
create policy "groups_insert_organizer"
  on public.groups for insert
  to authenticated
  with check (
    exists (
      select 1 from public.events e
      where e.id = groups.event_id
        and e.organizer_id = auth.uid()
    )
  );

-- 更新: 対象イベントの主催者のみ（改名）。他人のイベントへの付け替えも防ぐ。
drop policy if exists "groups_update_organizer" on public.groups;
create policy "groups_update_organizer"
  on public.groups for update
  to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = groups.event_id
        and e.organizer_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.events e
      where e.id = groups.event_id
        and e.organizer_id = auth.uid()
    )
  );

-- 削除: 対象イベントの主催者のみ。group_teams は FK の on delete cascade で連動（中身はプールへ戻る）。
drop policy if exists "groups_delete_organizer" on public.groups;
create policy "groups_delete_organizer"
  on public.groups for delete
  to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = groups.event_id
        and e.organizer_id = auth.uid()
    )
  );

-- ===== group_teams（ブロック↔チーム）=====
-- groups を経由して events.organizer_id を確認する（2段の所有権チェック）。

-- 閲覧: 所属ブロックのイベント主催者 or 同イベント参加者。
drop policy if exists "group_teams_select_participant" on public.group_teams;
create policy "group_teams_select_participant"
  on public.group_teams for select
  to authenticated
  using (
    exists (
      select 1
      from public.groups g
      where g.id = group_teams.group_id
        and (
          exists (
            select 1 from public.events e
            where e.id = g.event_id
              and e.organizer_id = auth.uid()
          )
          or public.is_event_participant(g.event_id, auth.uid())
        )
    )
  );

-- 作成: 所属ブロックのイベント主催者のみ（チームをブロックへ割当）。
drop policy if exists "group_teams_insert_organizer" on public.group_teams;
create policy "group_teams_insert_organizer"
  on public.group_teams for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.groups g
      join public.events e on e.id = g.event_id
      where g.id = group_teams.group_id
        and e.organizer_id = auth.uid()
    )
  );

-- 削除: 所属ブロックのイベント主催者のみ（割当解除・プールへ戻す）。
drop policy if exists "group_teams_delete_organizer" on public.group_teams;
create policy "group_teams_delete_organizer"
  on public.group_teams for delete
  to authenticated
  using (
    exists (
      select 1
      from public.groups g
      join public.events e on e.id = g.event_id
      where g.id = group_teams.group_id
        and e.organizer_id = auth.uid()
    )
  );
