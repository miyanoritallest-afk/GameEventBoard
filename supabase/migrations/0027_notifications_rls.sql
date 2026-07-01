-- 通知 PR-A1: notifications / notification_events / notification_deliveries の RLS ポリシー
-- 背景: 0001 で 3 テーブルとも RLS は ON（デフォルト拒否）だが、0004 以降のポリシー整備に
--       含まれておらず「RLS 有効・ポリシーゼロ＝全拒否」。このままだと自分宛ての通知すら
--       読めない。通知機能の土台（アプリ内通知一覧）を作る前提として、ポリシーを整備する。
-- 方針(壁打ち確定・要件定義書 3.5.2 / 3.7):
--   - 通知は全ユーザー分が 1 テーブルに混在するため、盗み見（他人宛ての SELECT）と
--     勝手な既読化（他人宛ての UPDATE）を DB 層で固く防ぐ ＝ どちらも「宛先本人のみ」。
--   - INSERT（通知の生成）は type ごとに「引き金を引く主体」が異なる（応募承認=主催者 /
--     スクリム登録=チームメンバー / 直前リマインド=Cron…）。DB 層で type 別の引き金判定を
--     共通ルール化するのは無理なので、INSERT は「ログイン済み」までを許可し、
--     「どの type を・誰の業務が・誰宛てに作るか」の正しさは各 Server Action（アプリ層）が
--     担保する（rls-authz-asymmetry: 操作系は if 主役・RLS は補助）。
--   - 通知の文面（title/body/link_url）は開発側がサーバーで固定生成する（マスアサインメント
--     防止）。主催者や参加者が中身を編集する領域ではない。RLS は中身の正しさは見ない。
--   - notification_events（出来事）/ notification_deliveries（外部配信状況）は UI に出さない
--     サーバー処理専用データ。一般ユーザーの SELECT は不可。INSERT はアプリ層（Server Action /
--     将来の宛先集約）から行うため authenticated まで許可する。
-- 対応: docs/DB設計書.md（6章 RLS） / docs/要件定義書.md（3.5.2 / 3.7）
-- 冪等性: drop policy if exists してから create（再適用しても壊れない）。

-- ===== notifications（各ユーザーへの実配信＝アプリ内通知一覧の実体）=====
alter table public.notifications enable row level security;

-- 閲覧: 宛先本人のみ（自分宛ての通知だけ見える）。
drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
  on public.notifications for select
  to authenticated
  using (user_id = auth.uid());

-- 更新: 宛先本人のみ（自分の通知だけ既読化できる。他人の通知を勝手に既読にできない）。
-- 既読化以外の更新（title/body 等の書き換え）は起きない想定だが、対象行の限定で最終防衛。
drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
  on public.notifications for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 作成: ログイン済みまで許可。type 別の「正当な引き金か」は各 Server Action が担保する。
drop policy if exists "notifications_insert_authenticated" on public.notifications;
create policy "notifications_insert_authenticated"
  on public.notifications for insert
  to authenticated
  with check (true);

-- ===== notification_events（通知の発生源＝出来事。サーバー処理専用）=====
alter table public.notification_events enable row level security;

-- 作成: ログイン済みまで許可（出来事の記録は Server Action / 宛先集約から）。
drop policy if exists "notification_events_insert_authenticated" on public.notification_events;
create policy "notification_events_insert_authenticated"
  on public.notification_events for insert
  to authenticated
  with check (true);
-- SELECT ポリシーは意図的に作らない ＝ 一般ユーザーは出来事テーブルを直接読めない。

-- ===== notification_deliveries（外部配信の状況: Discord DM / Webhook。サーバー処理専用）=====
alter table public.notification_deliveries enable row level security;

-- 作成: ログイン済みまで許可（配信レコードの記録は Server Action / 将来の Discord 配信から）。
drop policy if exists "notification_deliveries_insert_authenticated" on public.notification_deliveries;
create policy "notification_deliveries_insert_authenticated"
  on public.notification_deliveries for insert
  to authenticated
  with check (true);
-- SELECT ポリシーは意図的に作らない ＝ 一般ユーザーは配信状況テーブルを直接読めない。
