-- 本戦フェーズ PR-3c: match_results に POTG 取得数を追加（タイブレーク用）
-- 背景: 順位設定（0016）でタイブレークに potg（POTG取得数）を選べるようにした。
--       同着の順位決定に使うため、各試合で両チームの POTG 取得数を記録する。
-- 方針(壁打ち確定):
--   - potg_a / potg_b: その試合で team_a / team_b が取った POTG の数（マップごとに出るため数で持つ）。
--   - 0 埋め（potg 不使用イベントでは常に 0）。アプリ層 Zod で 非負整数・上限を検証。
--   - 結果入力 UI では tiebreakers に potg があるイベントだけ入力欄を出す。
--   - 順位集計（Service standings.ts）は全試合合計の POTG 数で比較する。
-- 対応: docs/DB設計書.md（3.15 match_results） / docs/要件定義書.md（3.4.1）
-- 冪等性: add column if not exists。

alter table public.match_results
  add column if not exists potg_a int not null default 0,
  add column if not exists potg_b int not null default 0;

-- 過大入力の最終防衛（0〜99。アプリ層 Zod でも検証する）。
alter table public.match_results
  drop constraint if exists match_results_potg_range_chk;
alter table public.match_results
  add constraint match_results_potg_range_chk
  check (potg_a between 0 and 99 and potg_b between 0 and 99);
