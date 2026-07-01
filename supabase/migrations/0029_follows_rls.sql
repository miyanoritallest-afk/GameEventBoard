-- フォロー PR-②: follows の RLS ポリシー
-- 背景: 0001 で follows は RLS ON だがポリシー未整備（通知3テーブル 0027 と同じ状況）。
--       フォロー基盤（event / user のフォロー）を作る前提としてポリシーを整備する。
-- 方針(実装ガイドライン: IDOR は アプリ層 ＋ DB層 RLS で最終防衛):
--   - follows は「誰が(follower_id) 何を(target_type, target_id) フォローしたか」の本人データ。
--   - SELECT: 本人のフォローのみ（自分が何をフォローしているかは本人だけが見える）。
--     ※ フォロワー数の公開集計が要るなら将来 security definer 関数で別途出す（本 PR では非公開）。
--   - INSERT / DELETE: 本人のみ（follower_id = auth.uid()）。なりすましフォロー・他人の
--     フォロー解除を DB 層で防ぐ。二重フォローは UNIQUE(follower_id, target_type, target_id)。
--   - target_type / target_id の妥当性（実在する event/user か）はアプリ層 Zod ＋ Server Action。
--     follows.target_id はポリモーフィックで FK 制約が無い（0001 の設計）ため。
-- 対応: docs/DB設計書.md（6章 RLS） / docs/要件定義書.md（3.5.1）
-- 冪等性: drop policy if exists してから create。

alter table public.follows enable row level security;

-- 閲覧: 本人のフォローのみ。
drop policy if exists "follows_select_own" on public.follows;
create policy "follows_select_own"
  on public.follows for select
  to authenticated
  using (follower_id = auth.uid());

-- 作成: 本人のみ（follower_id を自分に固定）。
drop policy if exists "follows_insert_own" on public.follows;
create policy "follows_insert_own"
  on public.follows for insert
  to authenticated
  with check (follower_id = auth.uid());

-- 削除: 本人のみ（自分のフォローだけ解除できる）。
drop policy if exists "follows_delete_own" on public.follows;
create policy "follows_delete_own"
  on public.follows for delete
  to authenticated
  using (follower_id = auth.uid());
