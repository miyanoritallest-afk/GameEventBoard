-- 登録名機能: 応募者・主催者の「そのイベントでの表示名」を追加
-- 背景: これまで表示名は users.discord_name（認証抽出）固定だった。これを改善し、
--       イベントごとに名乗れる「登録名」を持たせる。登録名は観戦者にも見える公開表示名。
-- 方針(壁打ち確定):
--   - registrations.display_name: 応募者の登録名。スコア（individual_score 等）と同じく
--     「応募時点のスナップショット」として registrations に持つ（イベントごとに変えられる）。
--   - events.organizer_display_name: 主催者としての表示名。イベント詳細の「主催」に出す。
--   - どちらも nullable。既存行は null のまま、表示側は display_name ?? discord_name の
--     フォールバックで Discord 名を出すため、データ移行は不要。
--   - デフォルトは応募/作成フォームで認証時の discord_name を defaultValue に入れる
--     （保存値＝ユーザーが目視した値）。空ならフォールバックで discord_name 表示。
--   - 長さ上限（1〜32文字・trim）はアプリ層 Zod で検証する。
-- 対応: docs/DB設計書.md（3.7 events / 3.9 registrations）, docs/ER図.md
-- 冪等性: add column if not exists。

alter table public.registrations
  add column if not exists display_name text;

alter table public.events
  add column if not exists organizer_display_name text;
