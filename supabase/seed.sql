-- GameEventBoard 初期データ（seed）
-- 対応: docs/DB設計書.md
-- 冪等: 再実行しても重複しない（name は unique）。

-- ゲームマスタ: OVERWATCH
-- 注意: かつての「Overwatch 2」はリブランディングで名称が「OVERWATCH」に戻った。
-- ロール: tank / dps / support、チーム人数: 5（5v5）。
insert into games (name, roles, team_size)
values ('OVERWATCH', array['tank', 'dps', 'support']::role[], 5)
on conflict (name) do nothing;

-- =========================================================
-- ランク↔スコア対応表（rank_definitions）: OVERWATCH
-- 8帯（ブロンズ〜チャンピオン）× ディビジョン5〜1 = 40段階。
-- スコアは線形 1〜40（ブロンズ5=1 … チャンピオン1=40）。sort_order も同様。
-- ディビジョンは 5 が最下位・1 が最上位（OW2 仕様）。
-- 未認定は rank_definitions に入れない（数値のあるランクのみ）。未認定はアプリ層で表現する。
-- 冪等: UNIQUE(game_id, label) で再実行しても重複しない。
-- 対応: docs/DB設計書.md 3.5 / docs/スコアリング設計.md
-- =========================================================
insert into rank_definitions (game_id, tier, division, label, score, sort_order)
select
  g.id,
  t.tier,
  d.division,
  t.tier || d.division::text,                       -- 例: "ブロンズ5"
  -- 線形スコア: 低い帯(ord 0)×div5 を 1、高い帯×div1 を 40。
  (t.ord * 5 + (5 - d.division) + 1)::numeric,       -- score 1〜40
  (t.ord * 5 + (5 - d.division) + 1)                 -- sort_order 1〜40
from games g
cross join (values
  ('ブロンズ', 0),
  ('シルバー', 1),
  ('ゴールド', 2),
  ('プラチナ', 3),
  ('ダイヤ',   4),
  ('マスター', 5),
  ('グランドマスター', 6),
  ('チャンピオン', 7)
) as t(tier, ord)
cross join (values (5), (4), (3), (2), (1)) as d(division)
where g.name = 'OVERWATCH'
on conflict (game_id, label) do nothing;
