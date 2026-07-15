-- 観戦ビュー Realtime: matches / match_results の Supabase Realtime 有効化
-- 背景: 観戦ビュー（/events/[id]/watch）はサーバー描画のため、主催者が結果を入力しても
--       観戦者はリロードするまで気づけない。試合結果の確定/修正・試合日時/配信の変更を検知して
--       「次の試合」「予選順位」「試合結果」をライブ更新したい。
-- 方針: matches / match_results を supabase_realtime publication に追加する。
--   - Realtime は RLS を尊重する。両テーブルの SELECT は 0023 で公開イベント（status <> 'draft'）を
--     anon にも開放済みなので、購読者（匿名観戦者含む）には公開イベントの変更だけが届く
--     （下書きイベントの変更は is_public_event で弾かれ配信されない）。RLS 追加は不要。
--   - 受信側（クライアント）は変更検知で router.refresh() し、観戦ビューをサーバー再取得する
--     （表示は常に DB 真値。差分の手組みはしない＝通知の Realtime と同じ流儀）。
-- 対応: docs/DB設計書.md（6章 RLS / Realtime）
-- 冪等性: publication への追加は「既に含まれていれば no-op」になるよう存在チェックする。

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'matches'
  ) then
    alter publication supabase_realtime add table public.matches;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'match_results'
  ) then
    alter publication supabase_realtime add table public.match_results;
  end if;
end
$$;
