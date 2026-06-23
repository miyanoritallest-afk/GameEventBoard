-- 本戦フェーズ PR-3b: events に順位設定を追加（順位ON/OFF・勝点・タイブレーク優先順位）
-- 背景: 本戦-3a で試合結果（スコア）を入力できるようになった。順位を出すには、イベントごとに
--       「順位を争うか・勝点の内訳・同着のタイブレーク基準と優先順位」を設定する必要がある。
--       これらは OSL 等の順位イベントと初心者/エンジョイの非順位イベントで分かれ、勝点内訳・
--       タイブレーク優先順位もイベントごとに変わる（壁打ち確定）。
-- 方針(壁打ち確定):
--   - ranking_enabled: 順位機能を使うか（親トグル）。false なら配下は無効・順位を出さない。
--   - points_win/draw/loss: 勝点の内訳（0〜99の整数。大小制約は課さない＝主催者の自由）。
--   - tiebreakers: 同着の優先順位を「順序付き配列」で表す（先頭ほど優先）。
--     値は head_to_head（直接対決）/ map_diff（得失マップ差）/ potg（POTG取得数）。
--     使う基準だけを優先順に格納（フォームの「使う」エリアの上から順と直接対応）。
--   - 集計・表示は本戦-3c。本 PR は設定を保存できるところまで。
-- 対応: docs/DB設計書.md（3.7 events） / docs/要件定義書.md（3.4.1）
-- 冪等性: add column if not exists。

alter table public.events
  add column if not exists ranking_enabled boolean not null default false,
  add column if not exists points_win  int not null default 3,
  add column if not exists points_draw int not null default 1,
  add column if not exists points_loss int not null default 0,
  add column if not exists tiebreakers text[] not null default '{}';

-- 過大入力の最終防衛（勝点は 0〜99。アプリ層 Zod でも検証する）。
alter table public.events
  drop constraint if exists events_points_range_chk;
alter table public.events
  add constraint events_points_range_chk
  check (
    points_win  between 0 and 99
    and points_draw between 0 and 99
    and points_loss between 0 and 99
  );

-- tiebreakers の各要素は許可値のみ（不正値の混入を最終防衛）。
alter table public.events
  drop constraint if exists events_tiebreakers_values_chk;
alter table public.events
  add constraint events_tiebreakers_values_chk
  check (
    tiebreakers <@ array['head_to_head', 'map_diff', 'potg']::text[]
  );
