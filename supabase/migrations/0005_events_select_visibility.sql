-- events の閲覧可視性を見直す（一覧/詳細PRに合わせて）
-- 背景: 0004 では events SELECT を全公開（using true）にしていたが、閲覧画面の導入で
--       「他人の下書きが一覧・直URLで見えてしまう」問題が顕在化する。
-- 方針: 公開済み（draft 以外）は全員閲覧可、下書き（draft）は主催者本人のみ。
--       アプリ層（Repository の絞り込み）＋ DB層 RLS の二重で下書き漏れを防ぐ（最終防衛）。
-- 対応: docs/DB設計書.md / docs/実装ガイドライン.md
-- 冪等性: 既存ポリシーを drop してから作成する。

-- 旧: 全公開 SELECT を置き換える。
drop policy if exists "events_select_all" on public.events;

-- 新: 「公開済み（status <> 'draft'）」または「自分が主催者の下書き」を閲覧可。
drop policy if exists "events_select_public_or_own" on public.events;
create policy "events_select_public_or_own"
  on public.events for select
  using (
    status <> 'draft'
    or organizer_id = auth.uid()
  );
