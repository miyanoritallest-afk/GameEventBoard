-- registrations の RLS ポリシー（応募フロー）
-- 背景: 0001 で RLS は ON（デフォルト拒否）だが registrations のポリシーが未整備。
--       応募の導入で「本人＋イベント主催者だけが見え、本人だけが応募でき、
--       主催者だけが承認/却下できる」可視性・操作権限を DB 層でも担保する必要がある。
-- 方針: 実装ガイドライン（IDOR はアプリ層＋DB層 RLS で最終防衛）。
--       本コードベース初の EXISTS サブクエリ RLS（主催者は events への参照で判定）。
-- 対応: docs/DB設計書.md / docs/実装ガイドライン.md
-- 冪等性: 既存ポリシーを drop してから作成する。

alter table public.registrations enable row level security;

-- 閲覧: 応募者本人、またはそのイベントの主催者。
-- 第三者には見えない（誰が誰に応募したかは秘密）。
drop policy if exists "registrations_select_own_or_organizer" on public.registrations;
create policy "registrations_select_own_or_organizer"
  on public.registrations for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.events e
      where e.id = registrations.event_id
        and e.organizer_id = auth.uid()
    )
  );

-- 作成: 本人の応募のみ（user_id を他人にできない＝なりすまし防止）。
drop policy if exists "registrations_insert_own" on public.registrations;
create policy "registrations_insert_own"
  on public.registrations for insert
  to authenticated
  with check (user_id = auth.uid());

-- 更新: そのイベントの主催者のみ（承認/却下）。
drop policy if exists "registrations_update_organizer" on public.registrations;
create policy "registrations_update_organizer"
  on public.registrations for update
  to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = registrations.event_id
        and e.organizer_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.events e
      where e.id = registrations.event_id
        and e.organizer_id = auth.uid()
    )
  );

-- DELETE は今回未定義（取り下げ＝withdrawn は後続PRで対応）。
