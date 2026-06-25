-- フェーズB（閲覧の全面公開）: 観戦者（anon・非ログイン）に公開イベントの閲覧を開放
-- 背景: 盛り上げポリシー上、応募していない観戦者（③）も対戦表・順位・トーナメント表・
--       参加チーム・配信・結果を見られるべき（壁打ち確定）。現状は全 SELECT が
--       `to authenticated`＋主催者/参加者限定で、観戦者には何も見えない。
-- 方針(壁打ち確定):
--   - 既存の `to authenticated` ポリシーはそのまま残す（ログインユーザーの挙動は不変）。
--   - anon 向けに「公開イベント（status <> 'draft'）に属する行」の SELECT ポリシーを追加する。
--     RLS の複数ポリシーは OR 結合なので、追加するだけで既存を壊さない。
--   - 下書きイベントの中身は観戦者に見せない（is_public_event で除外）。
--   - users（ログイン全ユーザーの名簿）は「公開イベントの応募者 or 主催者の行」だけ開放
--     （関係者のみ＝出場選手は見える・無関係ユーザーの名簿露出は避ける）。
--   - 操作（INSERT/UPDATE/DELETE）は一切変更しない（観戦者は閲覧のみ）。
-- 対応: docs/DB設計書.md（6章 RLS）/ docs/要件定義書.md（3.2 検索・閲覧）
-- 冪等性: create or replace / drop policy if exists。

-- イベントが公開済み（下書きでない）かを判定する security definer 関数。
-- anon ポリシーから events を参照する際の再帰評価を避ける。
create or replace function public.is_public_event(p_event_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id
      and e.status <> 'draft'
  );
$$;

-- ===== matches（試合）: 公開イベントなら anon も閲覧可 =====
drop policy if exists "matches_select_public" on public.matches;
create policy "matches_select_public"
  on public.matches for select
  to anon
  using (public.is_public_event(matches.event_id));

-- ===== match_results（試合結果）: 公開イベントの試合なら anon も閲覧可 =====
drop policy if exists "match_results_select_public" on public.match_results;
create policy "match_results_select_public"
  on public.match_results for select
  to anon
  using (
    exists (
      select 1 from public.matches m
      where m.id = match_results.match_id
        and public.is_public_event(m.event_id)
    )
  );

-- ===== groups（予選ブロック）: 公開イベントなら anon も閲覧可 =====
drop policy if exists "groups_select_public" on public.groups;
create policy "groups_select_public"
  on public.groups for select
  to anon
  using (public.is_public_event(groups.event_id));

-- ===== group_teams（ブロック↔チーム）: 公開イベントのブロックなら anon も閲覧可 =====
drop policy if exists "group_teams_select_public" on public.group_teams;
create policy "group_teams_select_public"
  on public.group_teams for select
  to anon
  using (
    exists (
      select 1 from public.groups g
      where g.id = group_teams.group_id
        and public.is_public_event(g.event_id)
    )
  );

-- ===== teams（チーム）: 公開イベントなら anon も閲覧可 =====
drop policy if exists "teams_select_public" on public.teams;
create policy "teams_select_public"
  on public.teams for select
  to anon
  using (public.is_public_event(teams.event_id));

-- ===== team_members（チーム所属）: 公開イベントのチームなら anon も閲覧可 =====
drop policy if exists "team_members_select_public" on public.team_members;
create policy "team_members_select_public"
  on public.team_members for select
  to anon
  using (
    exists (
      select 1 from public.teams t
      where t.id = team_members.team_id
        and public.is_public_event(t.event_id)
    )
  );

-- ===== registrations（応募）: 公開イベントの応募なら anon も閲覧可 =====
-- 応募者の表示名・ロール・スコアは観戦者に見せてよい（壁打ち確定）。
drop policy if exists "registrations_select_public" on public.registrations;
create policy "registrations_select_public"
  on public.registrations for select
  to anon
  using (public.is_public_event(registrations.event_id));

-- ===== users（プロフィール）: 公開イベントの関係者（応募者 or 主催者）のみ anon に開放 =====
-- 出場選手の名前は観戦者に見える。イベントと無関係なユーザーの名簿露出は避ける。
drop policy if exists "users_select_public_participant" on public.users;
create policy "users_select_public_participant"
  on public.users for select
  to anon
  using (
    -- 公開イベントに応募しているユーザー
    exists (
      select 1 from public.registrations r
      where r.user_id = users.id
        and public.is_public_event(r.event_id)
    )
    -- または公開イベントの主催者
    or exists (
      select 1 from public.events e
      where e.organizer_id = users.id
        and e.status <> 'draft'
    )
  );
