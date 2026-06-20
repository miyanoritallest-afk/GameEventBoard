-- events に開催終了日時 ends_at を追加（開催期間対応）
-- 背景: 長期イベント（1週間〜1ヶ月）は単一の starts_at（点）では表現できず、
--       開催期間（starts_at〜ends_at）が必要。個々の試合日時は matches テーブルが持つ。
-- 対応: docs/DB設計書.md / docs/ER図.md

alter table events
  add column ends_at timestamptz;

-- 終了は開始以降であること（DB層の最終防衛。アプリ層では Zod でも検証する）。
-- どちらか NULL の場合は制約をかけない（既存行・任意入力を許容）。
alter table events
  add constraint events_period_order
  check (ends_at is null or starts_at is null or ends_at >= starts_at);
