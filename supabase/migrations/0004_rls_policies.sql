-- RLS ポリシー（実装ガイドライン: IDOR は アプリ層 ＋ DB層 RLS で最終防衛）
-- 背景: games / events で RLS を有効化していたが SELECT/INSERT 等のポリシーが未整備で、
--       「行はあるのに見えない/作れない」状態だった（games の選択肢が空・events 作成が 42501）。
-- 方針: 閲覧系は公開・操作系は本人のみ。docs/DB設計書.md / docs/実装ガイドライン.md 対応。
-- 冪等性: 既存ポリシーを drop してから作成する（再適用しても壊れない）。

-- ── games（公開マスタ。全員 SELECT 可） ──
alter table public.games enable row level security;

drop policy if exists "games_select_all" on public.games;
create policy "games_select_all"
  on public.games for select
  using (true);

-- ── events ──
alter table public.events enable row level security;

-- 閲覧: 公開（下書きも当面は閲覧可。公開/下書きの出し分けは後続PRで詰める）
drop policy if exists "events_select_all" on public.events;
create policy "events_select_all"
  on public.events for select
  using (true);

-- 作成: ログインユーザーは「自分が主催者」の行だけ作れる
drop policy if exists "events_insert_own" on public.events;
create policy "events_insert_own"
  on public.events for insert
  to authenticated
  with check (organizer_id = auth.uid());

-- 更新: 主催者本人のみ
drop policy if exists "events_update_own" on public.events;
create policy "events_update_own"
  on public.events for update
  to authenticated
  using (organizer_id = auth.uid())
  with check (organizer_id = auth.uid());

-- 削除: 主催者本人のみ
drop policy if exists "events_delete_own" on public.events;
create policy "events_delete_own"
  on public.events for delete
  to authenticated
  using (organizer_id = auth.uid());
