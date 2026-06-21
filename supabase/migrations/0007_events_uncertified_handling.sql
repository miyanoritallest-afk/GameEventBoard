-- events に未認定補完方式 uncertified_handling を追加（スコアあり応募 PR-C）
-- 背景: スコア算出（スコアリング設計.md）で、role_swap=true の全ロール平均時に
--       未認定セルをどう補完するかを主催者が選ぶ。3方式を enum 型で持つ。
-- 方針: 既存の enum 群（event_status 等）と統一し型安全にする。
-- 対応: docs/DB設計書.md / docs/スコアリング設計.md
-- 冪等性: 型・カラムとも存在チェック付きで追加する。

-- 未認定補完方式の enum 型（fill_by_role=横軸 / fill_by_season=縦軸 / exclude=除外）。
do $$
begin
  if not exists (select 1 from pg_type where typname = 'uncertified_handling') then
    create type uncertified_handling as enum ('fill_by_role', 'fill_by_season', 'exclude');
  end if;
end $$;

-- events に追加。既定は exclude（最も保守的＝未認定を平均に含めない）。
alter table events
  add column if not exists uncertified_handling uncertified_handling not null default 'exclude';

-- require_score（個人スコアを計算するか）は 0001 で既存（default true）。
-- ボーナス有効化は bonus_* の値で表現（0=実質オフ）。新カラムは追加しない。
