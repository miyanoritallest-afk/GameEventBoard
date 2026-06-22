-- registrations に希望ロールの順位（第1〜第3）を追加
-- 背景: OW は3ロールあり全員が第1希望に就けない。第1・第2希望を取り、第3は自動決定する。
--       チーム編成で「第何希望に就けたか」を参照・集計できるよう順位カラムを持つ。
-- 既存 preferred_role は第1希望のミラーとして残す（一覧表示の後方互換）。
-- 対応: docs/DB設計書.md / docs/スコアリング設計.md
-- 冪等性: if not exists 付きで追加。

alter table registrations
  add column if not exists preferred_role_1 role,
  add column if not exists preferred_role_2 role,
  add column if not exists preferred_role_3 role;
