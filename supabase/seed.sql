-- GameEventBoard 初期データ（seed）
-- 対応: docs/DB設計書.md
-- 冪等: 再実行しても重複しない（name は unique）。

-- ゲームマスタ: OVERWATCH
-- 注意: かつての「Overwatch 2」はリブランディングで名称が「OVERWATCH」に戻った。
-- ロール: tank / dps / support、チーム人数: 5（5v5）。
insert into games (name, roles, team_size)
values ('OVERWATCH', array['tank', 'dps', 'support']::role[], 5)
on conflict (name) do nothing;
