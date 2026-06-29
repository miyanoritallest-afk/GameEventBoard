-- users の UPDATE RLS（本人のみ）。マイページのバトルタグ登録/編集のため。
-- 背景: 0009 で SELECT は整備したが UPDATE は「別途（本人のみ）」として未整備だった。
--       battle_tag は Discord OAuth で取れず（0003）、ユーザーが後から登録する必要があるが、
--       これまで登録する手段（編集UI＋更新ポリシー）が無かった。
-- 方針:
--   - 行レベル: 本人の行のみ更新可（id = auth.uid()）。USING と WITH CHECK の両方で縛り、
--     他人の行への更新・他人の id への付け替えを防ぐ。
--   - 列レベルの制限（battle_tag だけ更新可）は RLS では表現しづらいため、アプリ層
--     （Server Action / Repository）で battle_tag のみを更新するクエリに固定する
--     ＝マスアサインメント対策の二層目（discord_id / is_admin 等は触らせない）。
-- 対応: docs/DB設計書.md（6章 RLS / users）
-- 冪等性: drop policy if exists 付き。

alter table public.users enable row level security;

drop policy if exists "users_update_self" on public.users;
create policy "users_update_self"
  on public.users for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
