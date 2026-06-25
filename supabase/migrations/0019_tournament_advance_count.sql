-- 本戦フェーズ PR-5a: events に決勝トーナメントの進出数 N を追加
-- 背景: 本戦-3c で予選（ブロック内総当たり）の順位が出るようになった。決勝トーナメントを
--       生成するには「各ブロックから上位何チームが進出するか」をイベントごとに設定する必要がある。
--       参加チーム数によって進出数は変わるため、主催者が設定できるようにする（壁打ち確定）。
-- 方針(壁打ち確定):
--   - tournament_advance_count: 各ブロック一律「上位N」。ブロック数 × N で進出総数が決まり、
--     進出数以上の最小2の累乗をブラケットサイズにして不足枠はBYE（不戦勝）で埋める。
--   - シングルエリミネーション＋3位決定戦が対象（3位決定戦の有無など他のT設定は後続PR）。
--   - 0 は「決勝トーナメントを使わない」を表す既定値。1以上で進出設定とみなす。
--   - ブラケット生成・表示は本 PR。結果入力・自動進出は本戦-5b。
-- 対応: docs/DB設計書.md（3.7 events / 3.14 matches） / docs/要件定義書.md（3.4.1）
-- 冪等性: add column if not exists。

alter table public.events
  add column if not exists tournament_advance_count int not null default 0;

-- 過大入力の最終防衛（0〜99。アプリ層 Zod でも検証する）。
alter table public.events
  drop constraint if exists events_tournament_advance_count_chk;
alter table public.events
  add constraint events_tournament_advance_count_chk
  check (tournament_advance_count between 0 and 99);
