-- self 応募（PR-3a）: 応募者間の閲覧開放
-- 背景: self/mixed 編成では、応募者が他の応募者のスコア・ロールを見てチームを組む。
--       現状の RLS は registrations/teams/team_members とも「本人＋主催者のみ」閲覧で、
--       応募者同士は見えない。self 応募の前提として「同じイベントの応募者は相互に閲覧可」へ緩和する。
-- 方針(壁打ち確定): OSL は Google フォーム提出物を全共有していた運用に忠実に、
--       同イベントの参加者（応募者）には算出根拠含め全公開する。全イベント対象。
--       書き込み（確定・承認・編集）は引き続き主催者のみ（self の確定は PR-3b で追加）。
-- 対応: docs/DB設計書.md / docs/要件定義書.md
-- 冪等性: drop policy if exists / create or replace 付き。

-- 「ユーザーが対象イベントに応募しているか」を判定する関数。
-- RLS 内で registrations を直接 EXISTS 参照すると自己参照ポリシーで再帰評価になりうるため、
-- security definer 関数（RLS をバイパスして判定）に切り出す。
create or replace function public.is_event_participant(p_event_id uuid, p_uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.registrations r
    where r.event_id = p_event_id
      and r.user_id = p_uid
  );
$$;

-- ===== registrations: SELECT を「本人 or 主催者 or 同イベント参加者」に緩和 =====
drop policy if exists "registrations_select_own_or_organizer" on public.registrations;
drop policy if exists "registrations_select_participant" on public.registrations;
create policy "registrations_select_participant"
  on public.registrations for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.events e
      where e.id = registrations.event_id
        and e.organizer_id = auth.uid()
    )
    or public.is_event_participant(registrations.event_id, auth.uid())
  );

-- ===== teams: SELECT を「主催者 or 同イベント参加者」に緩和 =====
-- （INSERT/UPDATE/DELETE は 0010 の主催者限定のまま。self の作成は PR-3b で追加）
drop policy if exists "teams_select_organizer" on public.teams;
drop policy if exists "teams_select_participant" on public.teams;
create policy "teams_select_participant"
  on public.teams for select
  to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = teams.event_id
        and e.organizer_id = auth.uid()
    )
    or public.is_event_participant(teams.event_id, auth.uid())
  );

-- ===== team_members: SELECT を「主催者 or 同イベント参加者」に緩和 =====
drop policy if exists "team_members_select_organizer" on public.team_members;
drop policy if exists "team_members_select_participant" on public.team_members;
create policy "team_members_select_participant"
  on public.team_members for select
  to authenticated
  using (
    exists (
      select 1
      from public.teams t
      where t.id = team_members.team_id
        and (
          exists (
            select 1 from public.events e
            where e.id = t.event_id
              and e.organizer_id = auth.uid()
          )
          or public.is_event_participant(t.event_id, auth.uid())
        )
    )
  );
