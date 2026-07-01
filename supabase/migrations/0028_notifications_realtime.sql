-- 通知 PR-A2b: notifications の Supabase Realtime 有効化
-- 背景: アプリ内通知（0027 で RLS 整備・A2a で生成/一覧/🔔）はサーバー描画のため、
--       通知が来ても再読み込みするまで気づけない。自分宛て通知の INSERT を検知して
--       🔔バッジと一覧をライブ更新したい。
-- 方針: notifications を supabase_realtime publication に追加する。
--   - Realtime は RLS を尊重するため、購読しても 0027 の SELECT=宛先本人のみ が効き、
--     各ユーザーには「自分宛ての INSERT」だけが届く（他人の通知は漏れない）。
--   - 受信側（クライアント）は変更検知で router.refresh() し、未読数・一覧をサーバー再取得する。
-- 対応: docs/DB設計書.md（6章 RLS / Realtime）
-- 冪等性: publication への追加は「既に含まれていれば no-op」になるよう存在チェックする。

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;
