-- イベント形式（events.format）を追加する。
-- 背景: これまで暗黙に「総当たり予選 → 決勝トーナメント」固定で、イベント形式を選ぶ手段が
--       なかった。実運用では「総当たりのみ」「トーナメントのみ」「総当たり＋決勝T」が分かれる
--       （壁打ち確定・2026-06-30。docs/devlog.md 同日エントリ）。
-- 方針(壁打ち確定):
--   - format = round_robin（総当たりのみ）/ tournament（トーナメントのみ）/
--     round_robin_then_tournament（総当たり→決勝T）。
--   - 既定は round_robin_then_tournament（=従来の挙動。既存イベントの見た目を変えない）。
--   - 形式に応じた画面分岐（予選/決勝T セクションの出し分け）は後続 PR。本 PR は列の追加と
--     作成/編集フォームでの設定までを扱う。
-- 対応: docs/DB設計書.md（events）。
-- 冪等性: enum は do$$ で重複作成を避け、列は add column if not exists。

-- 1) enum 型（冪等。既にあれば作らない）。
do $$
begin
  if not exists (select 1 from pg_type where typname = 'event_format') then
    create type event_format as enum (
      'round_robin',
      'tournament',
      'round_robin_then_tournament'
    );
  end if;
end$$;

-- 2) events に format 列を追加。既存行は従来挙動（総当たり→決勝T）を既定とする。
alter table public.events
  add column if not exists format event_format
    not null default 'round_robin_then_tournament';
