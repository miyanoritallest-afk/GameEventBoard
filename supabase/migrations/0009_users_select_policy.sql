-- users の SELECT RLS ポリシー（応募者一覧で名前が出ない問題の修正）
-- 背景: 0001 で users は RLS 有効・デフォルト拒否のまま SELECT ポリシーが未整備だった。
--       このため registrations → users の JOIN で discord_name 等が返らず、
--       応募者一覧で名前が「-」になっていた（実機確認で発覚）。
-- 方針: 表示用の公開プロフィール（discord_name/avatar/battle_tag）は
--       ログインユーザーが参照できるようにする（DB設計書6章「参照は公開情報のみ」）。
--       更新は別途（本人のみ）。本マイグレーションは SELECT のみ整備する。
-- 対応: docs/DB設計書.md
-- 冪等性: drop policy if exists 付き。

alter table public.users enable row level security;

-- 参照: ログインユーザーは users 行を参照できる（表示名・アバター・Battle Tag の表示用）。
drop policy if exists "users_select_authenticated" on public.users;
create policy "users_select_authenticated"
  on public.users for select
  to authenticated
  using (true);
