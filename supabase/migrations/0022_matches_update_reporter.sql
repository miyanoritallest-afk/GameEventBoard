-- フェーズA（試合付随情報）: matches の UPDATE を「主催者 or 対戦両チーム代表」に拡張
-- 背景: 試合日時（scheduled_at）は主催者だけでなく対戦両チームの代表も変更できるようにする
--       （壁打ち確定）。現状の matches_update_organizer は主催者のみ。
--       配信（stream_url/streamer_name）は主催者のみだが、これはアプリ層の Server Action で
--       「配信は主催者のみ」を担保する（RLS は誰が matches 行を更新できるかの最終防衛）。
-- 方針:
--   - matches UPDATE を can_report_match（0015・主催者 or 対戦両チーム代表）で許可する。
--   - 「何のカラムを書けるか」（配信は主催者のみ・日時は代表も）はアプリ層が担保。
--     RLS はカラム単位の制御をしないため、行レベルで「代表も matches を更新可」に広げる。
--   - 他人のイベントへの付け替え防止のため using/with check 両方に同条件を課す。
-- 対応: docs/DB設計書.md（6章 RLS）
-- 冪等性: drop policy if exists / create policy。

drop policy if exists "matches_update_organizer" on public.matches;
drop policy if exists "matches_update_reporter" on public.matches;
create policy "matches_update_reporter"
  on public.matches for update
  to authenticated
  using (public.can_report_match(matches.id, auth.uid()))
  with check (public.can_report_match(matches.id, auth.uid()));
