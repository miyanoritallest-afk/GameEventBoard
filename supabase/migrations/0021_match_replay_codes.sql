-- フェーズA（試合付随情報）: match_results にマップ別リプレイコードを追加
-- 背景: OW のリプレイコードは「1マップ＝1コード」。1試合（BO[N]）で行われたマップ数分
--       （＝両者スコア合計・奇数BOは可変、偶数BOは best_of 固定）だけ発行される。
--       既存の matches.replay_code（単一 text）では複数マップに対応できないため、
--       試合結果に紐づくマップ別コードの配列を持たせる（結果入力時に一緒に保存）。
-- 方針(壁打ち確定):
--   - replay_codes text[]（既定 空配列）。要素は各マップのリプレイコード（任意・空文字可）。
--   - 入力者は結果と同じ「主催者 or 対戦両チーム代表」（match_results の RLS 0015 をそのまま使う）。
--   - 配列長の上限・各要素の長さはアプリ層 Zod で検証（過大入力防止）。
--   - 既存の matches.replay_code は当面未使用（将来削除候補）。
-- 対応: docs/DB設計書.md（3.15 match_results）
-- 冪等性: add column if not exists。

alter table public.match_results
  add column if not exists replay_codes text[] not null default '{}';
