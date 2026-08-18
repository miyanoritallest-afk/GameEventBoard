-- ============================================================
-- 【既存DB用】エメラルド追加に伴うデモイベントのスコア再分配
-- ============================================================
-- 対象: デモ大会「Matchpoint Open Vol.1」(slug='event-mpvbcd') の応募70件。
--
-- 背景:
--   ランク体系が 40段階 → 45段階 になった（エメラルドをプラチナとダイヤの間に新設。
--   マイグレーション 0038）。registrations のスコアは「マスタ参照」ではなく数値の
--   スナップショットのため 0038 では追従せず、同じ数値が一段低い帯として表示される。
--   デモ大会はポートフォリオの見せ球なので、45段階での分布として自然になるよう
--   スコアを再分配する（過去の歴史的正しさは不要という判断）。
--
-- 方針: 応募スコアを一律 +2。
--   旧 15〜30 → 新 17〜32。45段階の帯は P=16-20 / E=21-25 / D=26-30 / M=31-35 なので、
--   エメラルド帯（21〜25）を最大勢力としてプラチナ〜マスターに分布する
--   ＝「エメラルドの参加者が実在する大会」として見える。
--   ・+5（旧帯を維持）は 20 の次が 26 になり境界に穴が空くため不採用。
--   ・0（放置）は全員が一段下の帯に見えるため不採用。
--
-- team_score_cap: 26 → 28（45段階で 28 ≒ ダイヤ3）。
--   +2 により全12チームの出場メンバー平均は最大 27.6 になるため、
--   「全チームが上限内」という現在の状態を保つには 28 以上が必要。
--
-- 冪等性: **このスクリプトは冪等ではない**（再実行すると更に +2 される）。
--   実行済みかどうかは下部の確認クエリで判定すること（最大値が 32 なら適用済み）。
--
-- 前提: マイグレーション 0038 適用済み。
-- 使い方: Supabase SQL Editor に貼って実行。
-- 対応: docs/devlog.md 2026-08-18 / supabase/prod_seed_demo_event.sql
-- 注意: auth.users へは触らないため本番適用可（dev_seed_* とは別扱い）。
-- ============================================================

-- 適用前の確認（最大値が 30 なら未適用・32 なら適用済み）。
select
  min(final_score)  as min_score,
  max(final_score)  as max_score,
  count(*)          as regs
from public.registrations r
join public.events e on e.id = r.event_id
where e.slug = 'event-mpvbcd';

-- 1. 応募スコアを +2（individual / final の両方。override は使っていないので触らない）。
update public.registrations r
set individual_score = r.individual_score + 2,
    final_score      = r.final_score + 2,
    updated_at       = now()
from public.events e
where e.id = r.event_id
  and e.slug = 'event-mpvbcd'
  and r.individual_score is not null;

-- 2. チームスコア上限を 28 へ。
update public.events
set team_score_cap = 28
where slug = 'event-mpvbcd';

-- 3. 結果確認: 帯ごとの人数（45段階の帯境界で集計）。
select
  case
    when final_score <= 15 then 'ゴールド以下'
    when final_score <= 20 then 'プラチナ'
    when final_score <= 25 then 'エメラルド'
    when final_score <= 30 then 'ダイヤ'
    when final_score <= 35 then 'マスター'
    else 'GM以上'
  end                                   as tier,
  count(*)                              as members
from public.registrations r
join public.events e on e.id = r.event_id
where e.slug = 'event-mpvbcd'
group by 1
order by min(final_score);

-- 4. 結果確認: 各チームの出場メンバー平均が team_score_cap 以内か。
select
  t.name                                        as team,
  round(avg(r.final_score), 2)                  as avg_score,
  e.team_score_cap                              as cap,
  avg(r.final_score) <= e.team_score_cap        as within_cap
from public.teams t
join public.events e        on e.id = t.event_id
join public.team_members tm on tm.team_id = t.id and tm.position = 'regular'
join public.registrations r on r.id = tm.registration_id
where e.slug = 'event-mpvbcd'
group by t.name, e.team_score_cap
order by avg_score desc;
