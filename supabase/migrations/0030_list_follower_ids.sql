-- 通知③（出来事→通知生成）: フォロワー集約用の security definer 関数
-- 背景: follows の RLS（0029）は SELECT=本人のフォローのみ。しかし出来事→通知生成の
--       宛先集約（3.6.1）では「対象のフォロワー全員」が必要で、通常クライアントからは
--       他人のフォロー行が見えず集められない。
-- 方針: security definer 関数で RLS をバイパスし、指定対象（event/user/series）を
--       フォローしている follower_id の集合を返す。返すのは user_id のみ（フォロー関係の
--       詳細は出さない）。サーバー（Server Action）の通知生成からのみ呼ぶ想定。
--   - match_results の can_report_match（0015）と同じ security definer パターン。
-- 対応: docs/DB設計書.md（6章 RLS / 通知）/ docs/要件定義書.md（3.6.1）
-- 冪等性: create or replace。

create or replace function public.list_follower_ids(
  p_target_type follow_target,
  p_target_id uuid
)
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select follower_id
  from public.follows
  where target_type = p_target_type
    and target_id = p_target_id;
$$;
