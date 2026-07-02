-- 通知（event フォロワー集約）: notification_events に冪等キー dedup_key を追加
-- 背景: 結果更新（#6）や日程更新（#5 短期）は同じイベントで何度も起きる。毎回
--       notification_events に新 id を作ると notifications の UNIQUE(user_id, source_event_id)
--       が効かず、フォロワーへ通知が洪水する。
-- 方針: 「1出来事＝1日1回」を DB で物理保証するため、notification_events に
--       dedup_key（例 "event:<id>:result:2026-07-02"）を持たせ UNIQUE にする。
--   - 同じ日の2回目は key 衝突で INSERT できない → 既存行を再利用 → 同じ source_event_id →
--     notifications の UNIQUE がその日の2通目を弾く（3.6.1: DB で最終防衛）。
--   - nullable。#1/#4 のような「毎回別の出来事」（1回性）は従来どおり dedup_key=null で
--     毎回新規行を作る。UNIQUE 制約は NULL 同士を重複と見なさないため共存できる。
-- 対応: docs/DB設計書.md（3.18 notification_events）
-- 冪等性: add column if not exists / create unique index if not exists。

alter table public.notification_events
  add column if not exists dedup_key text;

create unique index if not exists notification_events_dedup_key_uidx
  on public.notification_events (dedup_key);

-- dedup_key で「1出来事＝1行」を find-or-create し、その id を返す security definer 関数。
-- 背景: notification_events は SELECT ポリシーを持たない（0027・サーバー処理専用）ため、
--       通常クライアントでは既存行を探せない。RLS をバイパスして upsert し id を返す。
-- 動作: 同じ dedup_key があればその行の id を返す（再利用）。無ければ INSERT して返す。
--       ON CONFLICT DO NOTHING＋再 SELECT で、同時実行でも1行に収束する。
-- サーバー（Server Action）の通知生成からのみ呼ぶ。
create or replace function public.upsert_notification_event(
  p_type text,
  p_source_type follow_target,
  p_source_id uuid,
  p_dedup_key text,
  p_payload jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.notification_events (type, source_type, source_id, dedup_key, payload)
  values (p_type, p_source_type, p_source_id, p_dedup_key, p_payload)
  on conflict (dedup_key) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id
    from public.notification_events
    where dedup_key = p_dedup_key;
  end if;

  return v_id;
end;
$$;
