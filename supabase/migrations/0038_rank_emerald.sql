-- OVERWATCH ランク体系にエメラルドを追加（40段階 → 45段階）
-- 背景: OVERWATCH に新ランク「エメラルド」が新設された。序列はプラチナとダイヤの間
--       （上位から チャンピオン / GM / マスター / ダイヤ / エメラルド / プラチナ / ゴールド /
--        シルバー / ブロンズ）。既存の 8帯 40段階 を 9帯 45段階 に拡張する。
-- 方針:
--   - スコアは従来どおり線形（ブロンズ5=1 … チャンピオン1=45）。式も不変:
--     score = ord*5 + (5 - division) + 1。エメラルドの ord=4 を挿し、ダイヤ以上を +1 する。
--   - よって「ダイヤ以上（旧 score >= 21）」の score / sort_order が一律 +5 される。
--     プラチナ以下（1〜20）は不変。
--   - seed.sql は `on conflict (game_id, label) do nothing` のため既存行を更新しない。
--     既存 DB の再採番は本マイグレーションの責務（seed だけでは直らない）。
-- 影響（重要）:
--   registrations.individual_score / final_score / events.team_score_cap は
--   「マスタへの参照」ではなく数値のスナップショットで保存されている。したがって本
--   マイグレーションは**それらを書き換えない**（意図的）。旧データは旧スケールのままとなり、
--   同じ数値が一段低い帯として表示される。デモイベントの値調整は別途 SQL で行う。
-- 対応: docs/DB設計書.md 3.5 / docs/要件定義書.md 3.3 / supabase/seed.sql
-- 冪等性: 再採番は「エメラルドが未挿入のとき」だけ実行する。挿入は on conflict do nothing。

do $$
declare
  v_game_id uuid;
begin
  select id into v_game_id from public.games where name = 'OVERWATCH';
  if v_game_id is null then
    -- games が未 seed の環境（新規構築時など）。seed.sql が 45段階で入れるので何もしない。
    return;
  end if;

  -- 既にエメラルドがあるなら再採番済み。二重に +5 しないよう抜ける（冪等性の要）。
  if exists (
    select 1 from public.rank_definitions
    where game_id = v_game_id and tier = 'エメラルド'
  ) then
    return;
  end if;

  -- 1. ダイヤ以上を +5 して 21〜25 を空ける。
  --    UNIQUE(game_id, label) は label に対する制約で score には無いが、
  --    sort_order の重複を避けるため降順に更新する必要はない（一括 UPDATE は
  --    ステートメント単位で評価されるため中間状態の衝突は起きない）。
  update public.rank_definitions
  set score      = score + 5,
      sort_order = sort_order + 5
  where game_id = v_game_id
    and tier in ('ダイヤ', 'マスター', 'グランドマスター', 'チャンピオン');

  -- 2. エメラルド 5段階を挿入（ord=4 → score 21〜25）。
  insert into public.rank_definitions (game_id, tier, division, label, score, sort_order)
  select
    v_game_id,
    'エメラルド',
    d.division,
    'エメラルド' || d.division::text,
    (4 * 5 + (5 - d.division) + 1)::numeric,
    (4 * 5 + (5 - d.division) + 1)
  from (values (5), (4), (3), (2), (1)) as d(division)
  on conflict (game_id, label) do nothing;
end $$;
