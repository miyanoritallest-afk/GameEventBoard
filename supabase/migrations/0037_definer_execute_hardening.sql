-- security definer 関数の認可バイパス修正（0034 の一括修正から取り残された兄弟関数）
-- 背景（ロジック層のセキュリティ監査で発見）: 0034 は series 共同運営の definer 関数
--   （invite/respond/remove/search）について「actor=auth.uid()・anon から EXECUTE REVOKE」を
--   徹底したが、同じ穴を持つ2関数が取り残されていた。Postgres は definer 関数の EXECUTE を
--   PUBLIC へデフォルト付与するため、REST /rpc/<fn> を直接叩ける。
--
--   1. create_series_with_owner（0032）: actor を p_created_by 引数で受けており、他人の UUID を
--      渡すと「他人名義（owner）のシリーズ」を勝手に作れた（0034 で塞いだ権限昇格と同型）。
--   2. upsert_notification_event（0031）: EXECUTE=PUBLIC のまま。任意ユーザーが notification_events
--      に任意 type/source/dedup_key の行を作れた（内部認可なし・サーバー処理専用のはず）。
--      dedup_key を先回り占有して正規の通知生成を抑止したり、テーブルを汚染できた。
--
-- 方針（0034 の流儀に合わせる）:
--   1. create_series_with_owner は p_created_by を廃止し、関数内で auth.uid() を使う
--      （他人 UUID を渡す攻撃を原理的に不可能にする）。未認証は例外。
--   2. 両関数の EXECUTE を anon（と upsert_notification_event は authenticated も）から REVOKE。
--      - create_series_with_owner: actor=auth.uid() なので authenticated には残す（anon のみ剥がす）。
--      - upsert_notification_event: サーバー処理専用（Server Action が service_role で呼ぶ）なので
--        anon / authenticated 双方から剥がす（通常クライアントから呼ばせる理由がない）。
-- 対応: docs/DB設計書.md（6章 RLS）
-- 冪等性: drop function（引数変更のため旧版を落とす）/ revoke・grant は繰り返し実行可。

-- ========================================================================
-- 1. create_series_with_owner: actor=auth.uid()（p_created_by 廃止）
-- ========================================================================
-- 引数が変わる（3→2）ため旧シグネチャを drop してから作り直す。
drop function if exists public.create_series_with_owner(text, text, uuid);

create or replace function public.create_series_with_owner(
  p_name text,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  insert into public.event_series (name, description, created_by)
  values (p_name, p_description, v_uid)
  returning id into v_id;

  insert into public.series_members (series_id, user_id, role, status, joined_at)
  values (v_id, v_uid, 'owner', 'active', now());

  return v_id;
end;
$$;

-- actor は関数内 auth.uid() なので anon から呼ばせる理由はない。authenticated のみに限定。
revoke execute on function public.create_series_with_owner(text, text) from public;
grant execute on function public.create_series_with_owner(text, text) to authenticated;

-- ========================================================================
-- 2. upsert_notification_event: EXECUTE をサーバー専用に絞る
-- ========================================================================
-- サーバー処理専用（Server Action が service_role で呼ぶ）。通常クライアント（anon /
-- authenticated）から直接呼ばせない。service_role は superuser 相当で REVOKE の影響を受けない。
revoke execute on function
  public.upsert_notification_event(text, follow_target, uuid, text, jsonb)
  from public;
revoke execute on function
  public.upsert_notification_event(text, follow_target, uuid, text, jsonb)
  from anon;
revoke execute on function
  public.upsert_notification_event(text, follow_target, uuid, text, jsonb)
  from authenticated;
