-- 新規認証ユーザー作成時に public.users へ自動で行を作る（Supabase 公式推奨のトリガー方式）
-- 背景: events.organizer_id 等は public.users(id) を参照する FK。Discord ログインで
--       auth.users に行ができても public.users が無いと FK 違反になる。
--       「DBで最終防衛」の思想に合わせ、users 行の生成も DB 層で保証する。
-- 対応: docs/DB設計書.md / docs/アーキテクチャ設計書.md (4.1)

-- battle_tag は Discord OAuth では取得できず、ユーザーが後で登録する。
-- 「未登録」を NULL で表現できるよう NOT NULL を外す（未登録は応募不可をアプリ層で制御）。
alter table users
  alter column battle_tag drop not null;

-- 新規ユーザー作成ハンドラ。auth.users のメタデータから取れる範囲で埋める。
-- SECURITY DEFINER: auth スキーマ／public.users への書き込み権限で実行する。
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, discord_id, discord_name, discord_avatar_url)
  values (
    new.id,
    -- Discord のユーザーID（provider_id、無ければ sub）
    coalesce(
      new.raw_user_meta_data ->> 'provider_id',
      new.raw_user_meta_data ->> 'sub'
    ),
    -- 表示名（global_name 優先、無ければ full_name / name）
    coalesce(
      new.raw_user_meta_data #>> '{custom_claims,global_name}',
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      'unknown'
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing; -- 二重作成を防ぐ（冪等）
  return new;
end;
$$;

-- auth.users への INSERT で発火。
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- 既存ユーザーのバックフィル: トリガー導入前にログイン済みの auth.users を
-- public.users へ流し込む（冪等。既存行は on conflict で無視）。
insert into public.users (id, discord_id, discord_name, discord_avatar_url)
select
  u.id,
  coalesce(
    u.raw_user_meta_data ->> 'provider_id',
    u.raw_user_meta_data ->> 'sub'
  ),
  coalesce(
    u.raw_user_meta_data #>> '{custom_claims,global_name}',
    u.raw_user_meta_data ->> 'full_name',
    u.raw_user_meta_data ->> 'name',
    'unknown'
  ),
  u.raw_user_meta_data ->> 'avatar_url'
from auth.users u
on conflict (id) do nothing;
