-- 本戦フェーズ PR-5c: events に「3位決定戦を行うか」を追加
-- 背景: 決勝トーナメント（本戦-5a/5b）で優勝までは決まるが、3位を決める「3位決定戦」の
--       要否はコミュニティで分かれる（OSL 等はあり、エンジョイ系はなし）。主催者が選べるようにする。
-- 方針(壁打ち確定):
--   - tournament_third_place: 3位決定戦を作るか（既定 false）。
--     true かつ準決勝が2試合あるとき（4チーム以上）だけ、決勝と同じ最終ラウンドに
--     bracket_position=1 として3位決定戦を生成する（準決勝の2敗者が入る）。
--   - 表現は既存の round / bracket_position で完結（新テーブル・他の新カラムなし）。
-- 対応: docs/DB設計書.md（3.7 events） / docs/要件定義書.md（3.4.1）
-- 冪等性: add column if not exists。

alter table public.events
  add column if not exists tournament_third_place boolean not null default false;
