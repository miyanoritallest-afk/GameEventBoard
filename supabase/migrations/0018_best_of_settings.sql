-- 本戦フェーズ PR-3d: BO（Best of）設定 ─ 1マッチのマップ数
-- 背景: 1試合（AチームvsBチーム）は複数マップを戦い、何マップ先取か（BO1/2/3/5/7…）は
--       運営が決める。これまでスコア入力上限は固定だったが、本来は BO で決まる。
-- 方針(壁打ち確定):
--   - events.group_best_of: 予選（総当たり）のデフォルト BO。総当たり生成時に全試合へ一括セット。
--   - matches.best_of: 試合ごとの BO（決勝トーナメントは試合ごとに変えられる。本 PR は生成一括のみ）。
--   - best_of = N は「最大 N マップ」。奇数(3,5,7)=過半数先取で引分なし、偶数(2)=1-1 引分あり。
--     OW2 実態に BO2 があるため偶数も許容。
--   - スコア入力上限を best_of に連動（各チーム 0〜best_of）。合計・過半数の厳密検証はしない（緩め）。
--   - group_best_of を変えても既存試合の best_of は変わらない（再生成で反映＝割り切り）。
-- 対応: docs/DB設計書.md（3.7 events / 3.14 matches） / docs/要件定義書.md（3.4.1）
-- 冪等性: add column if not exists。

alter table public.events
  add column if not exists group_best_of int not null default 3;

alter table public.matches
  add column if not exists best_of int not null default 3;

-- 過大入力の最終防衛（1〜15。アプリ層 Zod でも検証する）。BO1〜BO7+ を許容しつつ上限。
alter table public.events
  drop constraint if exists events_group_best_of_range_chk;
alter table public.events
  add constraint events_group_best_of_range_chk
  check (group_best_of between 1 and 15);

alter table public.matches
  drop constraint if exists matches_best_of_range_chk;
alter table public.matches
  add constraint matches_best_of_range_chk
  check (best_of between 1 and 15);
