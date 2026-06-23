-- 本戦フェーズ PR-3a: match_results の RLS ポリシー（試合結果の入力）
-- 背景: 0001 で RLS は ON（デフォルト拒否）だが match_results のポリシーが未整備。
--       予選対戦表（0014）に続き、各試合にスコア（取マップ数）を入力して勝者を記録する。
-- 方針(壁打ち確定):
--   - 閲覧: 主催者 or 同イベント参加者（順位表・結果は参加者に公開）。
--   - 書き込み（INSERT/UPDATE/DELETE）: 主催者 or「対戦両チームの代表（自チームが絡む試合）」。
--     代表＝その試合の team_a / team_b の captain_registration_id を持つユーザー。
--     判定は match_results → matches → teams → registrations と多段に辿るため、
--     security definer 関数 can_report_match に切り出す（再帰評価回避・複雑さの集約）。
--   - winner_team_id / reported_by はサーバー（Server Action）がスコアと auth.uid() から固定する。
--     RLS は「誰が書けるか」を担保し、「何を書くか」の整合はアプリ層が担保する。
-- 対応: docs/DB設計書.md（6章 RLS） / docs/要件定義書.md（3.4.1）
-- 冪等性: create or replace / drop policy if exists。

-- 「指定ユーザーが、その試合の結果を入力できる主体か」を判定する。
-- = その試合の所属イベント主催者である、または team_a / team_b いずれかの代表（captain）である。
-- security definer で RLS をバイパスして判定（自己参照・多段 JOIN の再帰評価を避ける）。
create or replace function public.can_report_match(p_match_id uuid, p_uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.matches m
    join public.events e on e.id = m.event_id
    where m.id = p_match_id
      and (
        -- 主催者
        e.organizer_id = p_uid
        -- または team_a / team_b の代表（captain の registration の user_id が一致）
        or exists (
          select 1
          from public.teams t
          join public.registrations r on r.id = t.captain_registration_id
          where t.id in (m.team_a_id, m.team_b_id)
            and r.user_id = p_uid
        )
      )
  );
$$;

-- ===== match_results（試合結果）=====

-- 閲覧: 主催者 or 同イベント参加者（matches を経由して event を判定）。
drop policy if exists "match_results_select_participant" on public.match_results;
create policy "match_results_select_participant"
  on public.match_results for select
  to authenticated
  using (
    exists (
      select 1 from public.matches m
      where m.id = match_results.match_id
        and (
          exists (
            select 1 from public.events e
            where e.id = m.event_id
              and e.organizer_id = auth.uid()
          )
          or public.is_event_participant(m.event_id, auth.uid())
        )
    )
  );

-- 作成: 主催者 or 対戦両チームの代表。
drop policy if exists "match_results_insert_reporter" on public.match_results;
create policy "match_results_insert_reporter"
  on public.match_results for insert
  to authenticated
  with check (public.can_report_match(match_results.match_id, auth.uid()));

-- 更新: 主催者 or 対戦両チームの代表（スコア修正）。
drop policy if exists "match_results_update_reporter" on public.match_results;
create policy "match_results_update_reporter"
  on public.match_results for update
  to authenticated
  using (public.can_report_match(match_results.match_id, auth.uid()))
  with check (public.can_report_match(match_results.match_id, auth.uid()));

-- 削除: 主催者 or 対戦両チームの代表（結果の取り消し）。
drop policy if exists "match_results_delete_reporter" on public.match_results;
create policy "match_results_delete_reporter"
  on public.match_results for delete
  to authenticated
  using (public.can_report_match(match_results.match_id, auth.uid()));
