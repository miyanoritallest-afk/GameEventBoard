-- 本戦フェーズ PR-2: matches の RLS ポリシー（予選グループ内総当たりの対戦カード）
-- 背景: 0001 で RLS は ON（デフォルト拒否）だが matches のポリシーが未整備。
--       予選ブロック分け（0013）に続き、ブロック内総当たりの対戦カードを生成・管理する。
--       主催者が対戦表を生成・追加・削除でき、参加者は閲覧できるよう権限を整える。
-- 方針(壁打ち確定・groups 0013 と同じ流儀):
--   - 操作（生成・追加・削除）は対象イベントの主催者のみ。
--   - 閲覧は「主催者 or 同イベントの参加者（応募者）」に開放。判定は 0011 の
--     is_event_participant を再利用（再帰評価回避）。
--   - 本 PR は phase='group'（予選）のみ扱うが、ポリシーは phase に依らずイベント単位で許可する
--     （tournament の対戦は本戦-5 以降で同テーブルに入るが、所有権の判定は同じ events.organizer_id）。
-- 対応: docs/DB設計書.md（6章 RLS） / docs/要件定義書.md（3.4.1 進行形式）
-- 冪等性: drop policy if exists / create policy。

-- ===== matches（試合）=====

-- 閲覧: 主催者 or 同イベント参加者。
drop policy if exists "matches_select_participant" on public.matches;
create policy "matches_select_participant"
  on public.matches for select
  to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = matches.event_id
        and e.organizer_id = auth.uid()
    )
    or public.is_event_participant(matches.event_id, auth.uid())
  );

-- 作成: 対象イベントの主催者のみ。event_id を他人のイベントにできない。
drop policy if exists "matches_insert_organizer" on public.matches;
create policy "matches_insert_organizer"
  on public.matches for insert
  to authenticated
  with check (
    exists (
      select 1 from public.events e
      where e.id = matches.event_id
        and e.organizer_id = auth.uid()
    )
  );

-- 更新: 対象イベントの主催者のみ（日時・配信・結果連携は後続PRで使用）。
-- 他人のイベントへの付け替えも防ぐ（using/with check 両方で主催を要求）。
drop policy if exists "matches_update_organizer" on public.matches;
create policy "matches_update_organizer"
  on public.matches for update
  to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = matches.event_id
        and e.organizer_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.events e
      where e.id = matches.event_id
        and e.organizer_id = auth.uid()
    )
  );

-- 削除: 対象イベントの主催者のみ。match_results は FK の on delete cascade で連動。
drop policy if exists "matches_delete_organizer" on public.matches;
create policy "matches_delete_organizer"
  on public.matches for delete
  to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = matches.event_id
        and e.organizer_id = auth.uid()
    )
  );
