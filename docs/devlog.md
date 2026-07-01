# GameEventBoard 開発ログ (devlog)

開発の進捗・意思決定・その根拠を時系列で記録する。**新しいエントリは上に追記**（新しい順）。
各エントリは「やったこと / 決めたこと（なぜ） / 次にやること」を基本構成とする。

関連: [要件定義書](./要件定義書.md) / [DB設計書](./DB設計書.md) / [ER図](./ER図.md) / [アーキテクチャ設計書](./アーキテクチャ設計書.md)

---

## 2026-07-01 — 通知 PR-A2a: アプリ内通知の生成・一覧・🔔（応募承認1種を接続）

通知機能の土台の本体。応募が承認されると応募者本人に通知が飛び、`/notifications` 一覧とヘッダー🔔（未読バッジ）で見られるようにした。**Realtime は分けて PR-A2b で**（本PRは「承認→リロードで通知が出る」まで）。スキーマ変更なし（RLS は 0027 で適用済み）。

### やったこと
- **通知 Repository `src/lib/repositories/notifications.ts`（新規）**: `insertNotificationEvent`（出来事1件）／`insertNotification`（宛先へ1件・二重は 23505→`{duplicate:true}`）／`listMyNotifications`（新しい順）／`countMyUnreadNotifications`（未読数・head count）／`markNotificationRead`（本人 id 条件）。RLS 0027 で本人の行のみ。
- **通知文面 Service `src/lib/services/notification-content.ts`（新規・純粋関数）**: `NotificationType`（3.7 の type 定数＝唯一の正）＋ `buildRegistrationApprovedContent`（title/body/link をサーバー固定生成）。テスト +3（文面・link・type 文字列）。
- **既存 `decideRegistration`（Controller）に通知生成を差し込み**: 承認成功直後に `notifyRegistrationApproved`（repository＋service を Controller で束ねる＝Service は repository を呼ばない流儀を維持）。**ベストエフォート**（try/catch でログのみ・承認は成功扱い）。`findRegistrationWithEvent` に `user_id・events(title)` を追加（宛先・文面用）。
- **一覧ページ `/notifications`（新規・保護）**: 未ログインは `/login?redirect=` へ。`NotificationItem`（クライアント）はクリックで既読化（楽観的表示）→ `markRead` Action → link_url へ遷移。文面は React 自動エスケープ（XSS 対策）。JST 表示。
- **ヘッダー `site-header.tsx` に🔔＋未読バッジ**: ログイン時のみ・`countMyUnreadNotifications` で件数取得・99+ 表示・どの画面からも `/notifications` へ。
- lint / typecheck / test(315緑＝312+3) / build 通過。
- **実機確認済み（Playwright＋service_role でダミー応募を承認）**: 承認→`notifications`/`notification_events` 生成（type=`registration_approved`・宛先=応募者本人・文面・link_url すべて正）→🔔に未読1→`/notifications` に1件（JST表示）→クリックで既読（`is_read=true`）＆イベントページへ遷移、を全て確認。

### 実機で見つけたバグと修正（RLS × .select() 読み返し）
- **症状**: 承認は成功（200）するのに通知が生成されず、ログに `42501 new row violates row-level security policy for table "notification_events"`。ベストエフォート設計が正しく働き承認だけ通っていた。
- **原因**: repository の INSERT が `.insert(...).select("id").single()` と**読み返し**をしていた。`notification_events` は SELECT ポリシー無し（0027）、`notifications` は SELECT=宛先本人のみ。承認者（主催者）≠宛先（応募者）なので、INSERT 直後の `.select()` が RLS で拒否され 42501。
- **修正**: id をアプリ側で `crypto.randomUUID()` 事前生成し INSERT に渡す→`.select()` を削除（読み返さない）。RLS 設計（SELECT不可・本人のみ）を崩さず解決。「サーバー処理専用データは読み返さない」方針とも一貫。自動テストでは捕まらない（RLS＋実セッションが絡む）ため実機確認の収穫。

### 決めたこと（なぜ）
- **オーケストレーションは Controller に置く**（既存流儀の踏襲）。Service は repository を import しない純粋関数（全 service が repository 非依存を確認）。通知も「repository（DB）＋service（文面）を Controller で束ねる」に揃えた。
- **通知失敗はベストエフォート**（壁打ち確定）。承認（status 更新）が成功したら通知 INSERT が失敗しても承認は成功扱い（ログのみ）。通知は「見落とし防止のブースト」で、確実な土台＝status 更新を巻き添えにしない（要件定義書 3.5.2）。二重は UNIQUE(user_id, source_event_id) が最終防衛。
- **文面はサーバー固定生成**: title は固定文言・イベント名は body に埋め、React 自動エスケープに任せる（マスアサインメント＋XSS 対策）。
- **RLS 配下の INSERT は読み返さない**（実機で確定）: SELECT が制限されたテーブルへの INSERT は `.select()` を付けず、必要な id はアプリ側で事前生成する。

### 次にやること
- [x] 実機確認（承認→通知→🔔→一覧→既読＆遷移）完了。
- [ ] PR-A2b: Realtime（自分宛て INSERT を購読して🔔と一覧をライブ更新）。

---

## 2026-07-01 — 通知 PR-A1: 通知3テーブルのRLSポリシー（0027）

通知機能の土台の第一歩。0001 で RLS は ON なのにポリシーゼロ＝全拒否だった `notifications` / `notification_events` / `notification_deliveries` にポリシーを整備し、「自分宛ての通知を読める」土台を用意する。DB のみ（アプリ実装は次の PR-A2）。

### やったこと
- **`0027_notifications_rls.sql` を追加**（手動適用はこれから）。既存 0004〜のポリシー書式（`drop if exists`→`create`・`to authenticated`・`auth.uid()`）に準拠。
  - `notifications`: SELECT/UPDATE=**宛先本人のみ**（`user_id=auth.uid()`）。INSERT=authenticated（`with check true`）。
  - `notification_events` / `notification_deliveries`: INSERT=authenticated のみ。**SELECT ポリシーは意図的に作らない**＝一般ユーザーは直接読めない（サーバー処理専用データ）。
- **DB設計書6章の `notifications` 実装状況を詳細化**（0027 の SELECT/UPDATE/INSERT 方針・events/deliveries が SELECT 不可の理由）。

### 決めたこと（なぜ）
- **SELECT/UPDATE は宛先本人のみで固く守る**（壁打ち確定）。通知は全ユーザー分が1テーブルに混在するため、盗み見（他人宛ての SELECT）と勝手な既読化（他人宛ての UPDATE）を DB 層で物理的に防ぐ。「本人」＝通知の宛先ユーザー（`user_id`）。
- **INSERT は type 別の引き金判定を DB 層でやらない**（壁打ちで方針を2回修正して確定）。当初「INSERT=主催者のみ」と設計しかけたが、カタログ（3.7）を見ると**引き金を引く主体が type ごとに違う**（応募承認=主催者 / スクリム登録=チームメンバー / 直前リマインド=Cron…人ですらない）。特定の人に紐づく RLS を共通化できないため、INSERT は authenticated まで許可し、「どの type を・誰の業務が・誰宛てに作るか」の正当性は各 Server Action（アプリ層）が担保する（[[rls-authz-asymmetry]]: 操作系は if 主役・RLS は補助）。
- **通知の文面は開発側がサーバーで固定生成**（マスアサインメント防止）。主催者・参加者が中身を編集する領域ではない。RLS は中身の正しさは見ない。
- **events/deliveries は SELECT 不可**: UI に出さないサーバー処理専用データ。出来事・配信状況を一般ユーザーに直接読ませない。

### 次にやること
- [ ] 0027 を Supabase SQL Editor で手動適用（[[migration-apply-practice]]）。
- [ ] PR-A2: `/notifications`一覧＋ヘッダー🔔＋Realtime＋応募承認→通知1件生成（#1 `registration_approved`）。

---

## 2026-07-01 — 通知機能の着手方針（壁打ち・全体分割と土台PRの確定）

「イベント形式＋ラウンド別BO」（#67〜#70）が完結したので、次の宿題＝**通知機能**の着手方針を壁打ちで確定した。通知はこのアプリの中心価値（要件定義書 3.5 で「通知設計の中心的な価値」と明記）だが、**スキーマは0001で全部先行投入済み・アプリ側は完全ゼロ**という状態。実装コードは書かず、分割と土台PRの設計だけを固めた回。

### 現状（一次情報で裏取り）
- **スキーマは揃っている**（0001）: `follows` / `event_series` / `series_members` / `series_invites` / `notification_events` / `notifications` / `notification_deliveries` ＋ `events.series_id` / `events.discord_webhook_url` / `events.auto_announce` ＋ enum（`follow_target` / `delivery_channel(discord_dm,discord_webhook)` / `delivery_status`）。`types.ts` にも型あり。
- **アプリ側はゼロ**: `app/` 配下に follows/notification/series/discord のヒット皆無。UI・Action・Service・Repository すべて未実装。
- **⚠️ RLSポリシーの穴**: 上記7テーブルは0001で `enable row level security` されているが、**0004以降のポリシー整備に一切含まれていない**＝「RLS有効・ポリシーゼロ＝全拒否」。このままだと自分の通知すら読めない。→ **どのPRから始めるにせよ、RLSポリシー追加が最初の必須作業**。

### 決めたこと（なぜ）
- **アプリ内通知とDiscord通知は別レイヤー・両方セット**（要件定義書 3.5.2）。同じ1出来事を「①アプリ内（DB記録＋Realtime＝確実な土台）」＋「②Discord Webhook（全体告知）」＋「③Discord Bot DM（個人）」に流す。DM単独は「DM拒否設定の人に届かない＝通知が消える」事故になるため、**アプリ内に必ず記録した上でDiscordをブーストとして乗せる**。
- **着手はアプリ内の土台から**（壁打ち確定）。外部設定ゼロでローカル完結でき、3.5.2 の実装順（アプリ内→直後にDM）とも一致。
- **全体分割（依存順・7段）**:
  1. **①A アプリ内通知の土台**（今回ここ）: RLSポリシー＋`/notifications`一覧＋ヘッダー🔔＋未読バッジ＋Realtime＋「応募確定」1種だけ接続
  2. フォロー基盤（`follows` CRUD＋フォローボタン event/user）
  3. 出来事→通知生成（`notification_events`→宛先集約→重複排除。フォロー多重の事故防止＝3.6.1）
  4. Discord Webhook（全体告知・Bot不要＝外部設定が一番軽い）
  5. Discord Bot DM（個人向け・Bot作成/サーバー導入＝外部作業が重い）
  6. シリーズ概念（`event_series`/`series_members`。フォロー対象をシリーズまで拡張）
  7. Cron（スケジュール通知。3・4が動いてから）
- **土台①Aの内訳（今回作るPR）**:
  - **PR-A1**: RLSポリシー追加マイグレーション（0027）。`notifications` は本人のみ SELECT／UPDATE（既読化）。`notification_events`・`notification_deliveries` はサーバー専用（一般SELECT不可）。既存 0004〜 のポリシー書式に揃える。
  - **PR-A2**: `/notifications`一覧＋ヘッダー🔔＋未読バッジ＋Realtime＋**応募承認時に通知1件生成**（③の最小雛形を1本だけ通す）。自分で応募→承認で🔔にバッジ・一覧に1件・クリックで `link_url` へ、が**手動SQLなしで**E2Eに通るのをゴールにする。
- **RLSより先に「何に通知が飛ぶか」を確定**（壁打ち・指摘を受けて）。RLS・一覧UI・宛先集約はすべて「通知イベントの一覧」を前提にするため、先に**通知イベントカタログ**を要件定義書 3.7 に切って確定した。11イベントを `type` 文字列・宛先分類（全体/個人）・起点（直接関係者/フォロー集約）・担当PRの表にした。`type` 命名規則は `snake_case`・「対象名詞_過去分詞」。**土台①Aで接続するのは #1 `registration_approved` のみ**（宛先が応募者本人で自明・フォロー不要・既存承認フローに乗せるだけ）。
- **宛先の決まり方で2分類**（3.7の核心）: 「直接関係者（DB関係から一意に引ける・集約不要）」と「フォロー集約（フォロワー和＋重複排除＝3.6.1・②③が前提）」。土台が #1 なのは前者の最小例だから。
- **カタログの2つの穴を潰した**（壁打ちの指摘を受けて）:
  - **旧#4「イベント公開」を削除・#4 `series_season_announced` に統合**。非公開イベントはフォローできない＝公開の瞬間に event フォロワーはゼロで空振り。「新しい開催回が公開された」の宛先は 3.5.1 に従い series フォロワー ∪ 主催者フォロワー。単発（series_id=null）は主催者フォロワーのみ。1DB操作＝1出来事で 3.6.1 の二重通知も回避。
  - **リマインド（#7/#8）は「開始2時間前」の相対発火に確定**。当初要望の「PM18:00」は例で、実体は「予定の2時間前」。試合とスクリムは type を分ける（`match_starting_soon`/`scrim_starting_soon`）ことで文面をサーバー側で出し分ける。Cron は数分間隔で「この後2時間以内開始・未送信」を拾い `UNIQUE` で二重送信防止。
- **一覧の置き場所は専用ページ `/notifications`＋全ページ共通ヘッダーに🔔**（壁打ち確定）。見落とし防止が価値なのでどの画面からも気づける導線を優先。`/me` はプロフィール専用のまま役割分担を維持。
- **実装ガイドライン準拠の要点**: 通知生成は Service（出来事→宛先集約の純粋ロジック）＋Repository に分離し Controller は薄く。`/notifications` は保護ページ（A:リダイレクト＋B:Actionで弾く）。既読化は本人のもののみ（アプリ層if＋RLS）。`title/body/link_url` はサーバー側で固定生成（マスアサインメント防止）。`UNIQUE(user_id, source_event_id)` を最初から効かせ二重通知を物理的に防ぐ。マイグレーションは Supabase SQL Editor で手動適用。

### 次にやること
- [ ] PR-A1: RLSポリシー追加マイグレーション（0027）を `feature/notifications-rls` で作成。
- [ ] PR-A2: `/notifications`＋ヘッダー🔔＋Realtime＋応募承認→通知1件生成。
- [ ] 後続②〜⑦は上の依存順で。Discord連携（④⑤）着手時に外部設定（Webhook発行／Bot作成・サーバー導入）の手順を別途壁打ち。

---

## 2026-07-01 — PR-4: 決勝Tブラケットのラウンド別BO一括編集UI

「イベント形式＋ラウンド別BO」設計の最終PR。決勝Tブラケット画面で**ラウンド単位の一括BO編集**を可能にする。トーナメントは生成し直すとラウンド数が変わる（4チーム2R/8チーム3R）ため、生成前固定ではなく**生成後にラウンド単位で編集**する方式（既存 `matches.best_of` を活用＝追加カラム不要）。

### やったこと
- **`bracket.ts` に純粋関数 `computeRoundBoGroups` 追加**（テスト+5）。ブラケット試合を「BO編集グループ」に束ねる。基本はラウンド単位・**最終ラウンドの3位決定戦(position=1)は決勝(position=0)と別グループ**・グループに結果のある試合が1件でもあれば `locked=true`・代表BOは最小positionの試合の値。
- **`matches.ts` に2関数**: `updateRoundBestOf`（phase=tournament＋event_id＋round で絞り、3位決定戦は position=1 のみ・本戦は position!=1 で一括更新）／`listTournamentMatchesForBoEdit`（ロック判定用に round/position/best_of/結果有無を取得）。
- **`actions.ts` に `updateRoundBestOfAction`**。主催者確認＋Zod（BOは**奇数1〜15のみ**）＋**結果のあるラウンドはロック拒否**（同じ純粋関数 `computeRoundBoGroups` で判定）→ 一括更新。
- **`schema.ts` に `updateRoundBestOfSchema`**（round/thirdPlace/bestOf・奇数 refine）。
- **`tournament-board.tsx` に `RoundBoRow` サブコンポーネント＋「ラウンド別 BO 設定」セクション**（主催者・ブラケット生成済みのみ）。ラウンド名＋BOセレクト（奇数のみ）＋保存。locked 行はセレクト無効＋「結果入力済みのため変更不可」注記。
- lint / typecheck / test(312緑＝307+5) 通過。実機確認（準々決勝をBO5へ変更→保存→永続化→他ラウンドは不変、を確認）。

### 決めたこと（なぜ）
- **結果のあるラウンドは編集不可（ロック）**（壁打ち確定）。BO変更で既存スコアが不整合になる（BO3の2-1をBO5にすると勝利条件が変わる）。「結果を取り消してからBO変更」の運用。ロックにより、編集対象は必ず結果なし＝不整合は構造的に起きない。
- **3位決定戦は別枠**（壁打ち確定）。決勝(pos0)と3位決定戦(pos1)は同じ最終ラウンドだがBOを分けたい需要がある。編集単位を `round`＋`thirdPlace` で表現。
- **BOは奇数のみ**: トーナメントは引分を構造的に出さない（本戦-5b `toOddBestOf` と整合）。セレクトの選択肢を奇数に限定。
- **グルーピングは純粋関数に集約**: 表示（page）とロック判定（action）で同じ `computeRoundBoGroups` を使い、UIとサーバー検証の判定を一致させる。

### 次にやること
- [ ] （イベント形式＋ラウンド別BO設計はこのPRで完結）

---

## 2026-06-30 — PR-3: トーナメントのみ形式のシード生成分岐

PR-2 で出し分けた `events.format` のうち、**トーナメントのみ形式で実際にブラケットを生成できるようにする**。これまで決勝T生成は「予選順位（ranking_enabled）」前提だったのを、形式でシード経路を分岐する。

### やったこと
- **`bracket.ts` に純粋関数 `seedTournamentOnly` 追加**（テスト+6）。`TournamentSeedTeam[]`（teamId・score・order）を受け、**スコアあり=score降順／スコアなし・同スコア=作成順(order)昇順**でシード順 team_id 配列を返す。スコアあり・なし混在はスコアありを上位に。
- **`tournament.ts` に `computeTournamentOnlySeeds` 追加**。予選が無いので **approved チーム全員**を母集団に、`listTeamsWithMembers`＋`teamScore()`（regular 実効 final_score 平均）でスコアを出し、配列添字を作成順(order)に使う。
- **`generateTournament`（actions）のシード生成を形式で分岐**: 予選を持つ形式は従来どおり `computeBlockSeeds`→`extractSeededTeams`（ranking_enabled 必須・各ブロック上位N）。**トーナメントのみは `computeTournamentOnlySeeds`→`seedTournamentOnly`（順位機能不要・全approved）**。ブラケット生成（`generateBracket`/`seedOrder`）は全形式で共通再利用。
- **`tournament/page.tsx` の teamNameById・プレビューを形式分岐**。トーナメントのみは `computeTournamentOnlySeeds` から名前解決とプレビューを作る（予選経路の空 teamNameById でブラケット名が出ない不具合を回避）。
- **`tournament-board.tsx` に `groupStage` prop 追加**。トーナメントのみでは「順位機能が必要」警告を出さず・進出数入力を隠し・生成可（`canGenerate = groupStage ? rankingEnabled : true`）・コピーを「参加チーム全員をシード（スコア順／参加順）」に差し替え。確認ダイアログ文言も形式連動。
- **PR-2 積み残し回収**: actions の「決勝トーナメントには順位機能が必要です」メッセージを `hasGroupStage` 分岐の内側へ移動（トーナメントのみでは出ない）。
- lint / typecheck / test(307緑＝301+6) 通過。

### 決めたこと（なぜ）
- **トーナメントのみの母集団は approved チーム全員**（壁打ち確定）。予選が無く「上位N」の基準が無いため。進出数(advance_count)は予選形式専用。
- **スコアなしの適当順は作成順(created_at)**（壁打ち確定）。決定的・再現可能・DB取得順そのまま。生成後に既存の1回戦 D&D swap で主催者が手動微調整できる前提。
- **シード並べ替えは純粋関数に集約**: スコア降順・作成順・混在の規則をテストで固定（dev-flow-practice）。DB 取得（リポジトリ）と順序決定（サービス）を分離。

### 次にやること
- [ ] 実機確認: トーナメントのみイベント（スコアあり/なし）でブラケット生成→シード順が score降順/作成順になること・順位機能OFFでも生成できること。
- [ ] PR-4: ラウンド別BO一括編集UI（決勝Tブラケット画面でラウンド単位の一括 best_of 編集）。

---

## 2026-06-30 — PR-2: イベント形式に応じた画面分岐（予選/決勝Tの出し分け）

PR-1 で保存できるようにした `events.format` を、実際の画面表示に効かせる。**形式の出し分けのみ（トーナメントのみ形式の実シード生成は PR-3）。**

### やったこと
- **Service 層に `event-format.ts` を新設**（純粋関数）。`hasGroupStage(format)`（総当たりを含むか＝予選あり）/ `hasTournamentStage(format)`（トーナメントを含むか＝決勝Tあり）/ `eventFormatLabel(format)`（日本語ラベル）。詳細・観戦ビュー・各 board の複数箇所で使うため一元化し、単体テスト 8 件で 3形式×2ステージの真理値を網羅。
- **イベント詳細**（`[id]/page.tsx`）: 本戦セクションの導線を形式で出し分け。予選なし（トーナメントのみ）はブロック分け/対戦表リンクを出さない、決勝Tなし（総当たりのみ）は決勝Tリンクを出さない。**従来は詳細に決勝T導線が無かったが、決勝Tを持つ形式では出すように追加**。ヘッダーに形式バッジを追加。
- **各 board ページの 404 ガード**: 形式上ありえないページは `notFound()`。`/groups`・`/matches` は予選なし形式で 404、`/tournament` は決勝Tなし形式で 404。URL 直叩きを抑止（壁打ちで 404 方式に確定）。
- **board 間ナビの出し分け**: `/matches` の「決勝トーナメントへ →」は決勝Tを持つ形式のみ、`/tournament` の「← 対戦表・順位表へ」は予選を持つ形式のみ表示。
- **チーム編成**（`/teams`）の「ブロック分けへ →」はトーナメントのみ形式では「決勝トーナメントへ →」に差し替え（404 リンクを出さない）。
- **観戦ビュー**（`/watch`）: セクション表示を「形式 → 空判定」の2段で絞る。トーナメントのみはブロック/予選順位/予選結果を出さず、総当たりのみは決勝Tセクションを出さない。リンク（`matchesHref`・tournament）は該当セクション内のみなので 404 リンクは生じない。
- lint / typecheck / test(297緑＝289+8) 通過。

### 決めたこと（なぜ）
- **形式判定は Service の純粋関数に一元化**: 5+ 箇所で同じ判定をするため。`format === ...` をベタ書きすると分岐漏れ（例: 詳細だけ更新し忘れ）が起きる。dev-flow-practice（自動テストで契約担保）に沿って関数化＋テスト。
- **ありえないページは 404（リダイレクト/案内ではなく）**: URL を共有されても迷わせない・空ページや混乱の余地を残さない・導線非表示と整合する。主催者にも出さない（壁打ち確定）。
- **シード生成は含めない**: 現状トーナメント生成は `ranking_enabled`（予選順位）前提。トーナメントのみ形式の実生成ロジックは独立性が高く PR-3 に分離。本 PR は純粋に画面の出し分けに限定。

### 実機FB対応（呼称の形式連動）
実機確認で「総当たりのみなのに『予選』順位/試合結果」「トーナメントのみなのに『決勝トーナメント』」と出るのを指摘され、**呼称も形式連動**にした。`event-format.ts` に2関数を追加（テスト+4）:
- `groupStageLabel(format)`: 後段に決勝Tがあれば「予選」、総当たり完結なら「総当たり」。
- `tournamentStageLabel(format)`: 前段に予選があれば「決勝トーナメント」、トーナメント単独なら「トーナメント」。
適用箇所: 観戦ビュー（順位/試合結果/トーナメント見出し）・詳細（本戦説明文＋導線ラベル）・決勝Tページ h1・チーム編成のフォールバック導線。実機で「トーナメントのみ」イベントが「トーナメント」表記になるのを確認。

### 実機FB対応（編集フォームの本戦設定も形式連動）
実機確認で「総当たりのみなのに『3位決定戦を行う』が出る」を指摘され、**作成/編集フォームの本戦設定も形式連動**にした。`event-form.tsx` の format セレクタを `useState` で制御し、`hasGroupStage`/`hasTournamentStage` で出し分け:
- **総当たりBO**（group_best_of 入力）= 予選を持つ形式のみ表示（トーナメントのみでは非表示）。
- **3位決定戦チェック**（tournament_third_place）= 決勝Tを持つ形式のみ表示（総当たりのみでは非表示）。ラベルも予選有無で「決勝トーナメントで…/トーナメントで…」を切替。
- 非表示時の未送信値は schema 既定（groupBestOf=3・tournamentThirdPlace=false）で安全に吸収（schema/actions 変更不要）。
- 実機: トーナメントのみ→BO非表示・3決「トーナメントで」表示／総当たりのみへ切替→BO表示・3決消滅、をリアクティブに確認。

### 次にやること
- [ ] 実機確認の残: 「総当たりのみ＋結果あり」イベントで watch が「総当たり 順位/試合結果」になること（既定=予選・トナメ単独=トーナメントは確認済み）。
- [ ] PR-3: tournament のシード生成分岐（スコアなし=適当順 / スコアあり=teamScore降順）。

---

## 2026-06-30 — PR-1: イベント形式 `events.format` カラム＋作成/編集フォームの形式セレクタ

同日に壁打ちで確定したイベント形式設計の最初の一歩。**形式の保存までを扱う（形式別の画面分岐＝予選/決勝Tの出し分けは PR-2 以降）。**

### やったこと
- **マイグレーション 0026**: `event_format` enum（round_robin / tournament / round_robin_then_tournament）を冪等に作成（`do$$` で重複回避）。`events.format` 列を追加、**既定は `round_robin_then_tournament`＝従来挙動**（既存イベントの見た目を変えない）。
- types.ts に Row/Insert/Update＋Enums（型・Constants）の format を反映（DB型再生成の手当て）。
- schema.ts に `format` の Zod enum（既定 round_robin_then_tournament）。actions.ts の3箇所（formData読取・values組み立て・EventEditableValues型）と events Repository の更新ホワイトリストに追加。
- event-form.tsx の「本戦設定」冒頭に**形式セレクタ（select）**を追加（BOより上＝構成を先に決める順）。edit ページの defaults に `event.format` を渡し、編集時に現在値が初期表示されるように。
- DB設計書（events 表・enum 一覧）更新。lint / typecheck / test(289緑) 通過。

### 決めたこと（なぜ）
- **既定を round_robin_then_tournament にする**: 既存データ・現状UIの挙動を一切変えないため。形式を意識しない主催者は従来通り使える。
- **本 PR はカラム＋設定UIまで**: 形式に応じた画面分岐（round_robin で決勝T非表示など）は影響範囲が広く、独立してレビューしたいので PR-2 に切る。

### 次にやること
- [ ] **マイグレーション 0026 を Supabase SQL Editor で手動適用**（migration-apply-practice）。適用前は `event.format` 参照でエラーになるため、実機確認は適用後。
- [ ] PR-2: 形式に応じた画面分岐（各 board・観戦ビュー・詳細での予選/決勝T 出し分け）。

---

## 2026-06-30 — 設計壁打ち: イベント形式の選択＋ラウンド別BO（実装は次回・PR分割確定）

実機確認のフィードバックから、イベント設計の根幹に関わる論点を壁打ちで確定。**本エントリは設計記録のみ（コード変更なし）**。実装は別 PR 群で進める。

### 決めたこと（なぜ）
- **イベント形式 `events.format` を新設**（enum 3値）。これまで暗黙に「総当たり予選→決勝T」固定だったのを選べるようにする。
  - `round_robin`（総当たりのみ）/ `tournament`（トーナメントのみ）/ `round_robin_then_tournament`（総当たり→決勝T・既定）。
  - なぜ: 「総当たりが必ず予選とは限らない」「トナメ単独もある」という運用実態。現状の「本戦設定」一括BOが不適切だった根本原因はここ。
- **BO はラウンド単位で可変に**。総当たりは `events.group_best_of` 一括（現状維持）、決勝Tは**生成後にブラケット画面でラウンド単位の一括編集**（既存 `matches.best_of` を活用＝**追加カラム不要**）。
  - なぜこの保存場所か: トーナメントは進出数を変えて作り直すたびにラウンド数が変わる（4チーム=2R/8チーム=3R）。生成前に固定値で持つと噛み合わない。生成後の matches を編集する方式なら可変問題を自然に回避でき、既存の試合単位 BO をそのまま使える。
- **トーナメントのシード（並べ方）は `generateBracket`+`seedOrder` を全形式で再利用し、入力の「シード順 id 配列」の作り方だけ分岐**:
  - `round_robin_then_tournament`: 予選成績順（既存 `extractSeededTeams`）。
  - `tournament`＋スコアなし: 適当順（作成順/ランダム）＋既存の1回戦D&D swap で手動調整。
  - `tournament`＋スコアあり: **`team-score.ts` の `teamScore()`（regularの実効final_score平均）降順**でシード配列を作る。`seedOrder` が「上位 vs 下位」を散らす標準シード配置にしてくれる（テニスのドロー配置と同型。俗に言う「強さを散らす」並べ方）。
  - なぜ手動併用か: 自動シードに主催者の意図（地域・因縁の回避など）を後から反映できるよう、既存 swap を活かす。追加UI最小。

### 関連する既存実装の確認（壁打ちで判明）
- `match_phase` enum（group/tournament）と `matches.best_of`（1〜15・試合単位）は**最初から存在**。BO は既に試合粒度で持てる。
- スコアリングは**実装済み**（services/scoring・scored-application・team-score）。`teamScore()` がそのままシード指標に使える。

### 次にやること（PR分割・依存順）
- [ ] PR-1: `events.format` カラム追加＋作成/編集フォームに形式セレクタ（マイグレーション＋UI）。
- [ ] PR-2: 形式に応じた画面分岐（round_robin は決勝T非表示 / tournament は予選非表示。観戦ビュー・詳細・各 board）。
- [ ] PR-3: tournament のシード生成分岐（スコアなし=適当順 / スコアあり=teamScore降順）。
- [ ] PR-4: 決勝Tブラケット画面にラウンド別BO一括編集UI。
- 別テーマ（未着手）: 募集上限のチーム/人数切替＋人数制の過応募可視化／観戦ビューの開催日時表示。

---

## 2026-06-30 — 観戦ビューの仕上げ修正（試合結果の偏り・ラウンド名・戻る導線）

実機確認（#63 観戦ビュー）で見つかった3点を修正。バグというより観戦者体験の磨き込み。スキーマ変更なし。

### やったこと
- **予選試合結果の「最新5件」がブロック偏りする問題を修正**。従来は `groupMatches.slice(-5)`（試合の生成順＝ブロック単位の並び）の末尾を取っており、後ろのブロックの試合だけが並んでいた。`match_results.updated_at`（結果確定時刻）を取得に追加し、**確定時刻降順で先頭5件**＝実際の消化順に変更。観戦者が「直近に終わった試合」を見られるようになった。
- **決勝トーナメントのラウンド名を整備**。観戦ビューは「ラウンド N」の素朴表示だったが、詳細ページ（tournament-board.tsx の `roundLabel`）と同じ規則を移植: 最終=決勝 / その前=準決勝 / 準々決勝 / それ以外 N回戦。**3位決定戦**（最終ラウンド・bracket_position 1）にもラベルを出すよう、`bracket_position` を表示データに持たせた。
- **各詳細ページから観戦ビューへ戻る導線を追加**。teams / groups / matches / tournament の各ヘッダーに「観戦ビューへ」リンクを追加。観戦ビューの「詳しく見る→」で詳細へ飛んだあと観戦ビューに戻れず、ブラウザの戻るしかなかったのを解消。
- lint / typecheck 通過。実機（のり検証1）で3点とも反映を確認。

### 決めたこと（なぜ）
- **「最新」の基準は `updated_at`（結果確定時刻）**: `scheduled_at`（試合予定）は未設定があり得るので欠測に弱い。結果確定時刻なら必ず存在し、観戦者の「直近に終わった試合」の語感に最も近い。
- **ラウンド名ロジックは詳細ページを正として移植**（重複だが）: 共通化より、既に実機で正しく出ている詳細ページの規則をコピーする方が安全。将来 services へ切り出す余地はあり。

### 次にやること（壁打ち待ち・本日整理した大きめ論点）
- [ ] **イベント形式の選択**（総当たりのみ / トーナメントのみ / 両方）をイベント編集で設定可能に。
- [ ] **BO（Best of N）をフェーズ・ラウンド単位で可変に**（予選一律/決勝の各ラウンド個別）。現状の「本戦設定」一律BOは不適切（総当たりが予選になり得る・決勝も回戦で割れる）。
- [ ] **募集上限をチーム単位/人数単位で切り替え**。人数制は上限超の過応募をキャンセル補充用に運営が認識できるように。チーム制は応募人数に上限を設けない（編成で参加可否が決まるため）。
- [ ] 観戦ビューに予選/トーナメントの開催日時（いつ行われたか）表示（既存 `scheduled_at` 活用）。

---

## 2026-06-29 — 文言クリーンアップ（旧名 GAMEEVENTBOARD→MATCHPOINT・区分ラベルを regular/reserve に統一）

実機確認前の軽微な整備。ユーザーに見えるラベルの表記ゆれ・旧名残りを直す。

### やったこと
- login 画面のロゴ上ラベル `GAMEEVENTBOARD` → `MATCHPOINT`（サービス名変更の取りこぼし）。
- チーム編成（teams-board）の区分見出しを観戦集約ページ（#63）と統一: 出場ゾーン見出し `出場` → `regular`、リザーブゾーン見出し `リザーブ（控え）` → `reserve`。
- 線引き: **区分ラベル（ゾーン見出し）だけ英字化**。説明文（「出場メンバーがいません」「出場平均」等）や内部コメントは日本語のまま（英日混在の不自然さを避ける）。prototype 配下は本番外なので対象外。
- check(289緑)/build 通過。

### 次にやること
- [ ] まとめて実機確認（#61〜#64）。将来: Discord通知連携。

---

## 2026-06-29 — 観戦集約ページ（/events/[id]/watch）

観戦者が大会の全体像を1ページで通覧できる集約ビューを追加。これまで詳細→ブロック分け→対戦表→参加チームと個別ページを行き来する必要があったのを、1ページにまとめた。

### やったこと
- **新ページ `/events/[id]/watch`**（観戦専用・編集UIなし）。構成は上から: イベント概要 / 参加チーム / ブロック分け / 予選順位 / 予選試合結果 / 決勝トーナメント。
- 各セクション＝「見出し＋詳しく見る→（各ページ）＋サマリー」。**空セクション（未実施）は丸ごと非表示**にし、進行に応じてセクションが増える。
- **参加チームはメンバー登録名も表示**（regular/reserve を英語ラベルで区分・reserve は居れば行追加）。観戦者区分のため Discord名・バトルタグは出さない（[[display-name-design]]）。
- 予選順位は `computeStandings`（純粋関数）流用・ブロックごとトップ。試合結果は消化数＋最新5件。決勝Tは round ごとの対戦カード簡易ブラケット。
- 既存 Repository（listTeamsWithMembers / listGroupsWithTeams / listGroupMatches / listMatchResultsByEvent / listTournamentMatches）を再利用。**新規DB変更なし**。
- 詳細ページの本戦セクションに「観戦ビューでまとめて見る →」を追加（主導線）。
- lint/typecheck/test(289緑)/build 通過。実機確認はユーザーがまとめて実施予定。

### 決めたこと（なぜ・壁打ち済み）
- **新ページにする**（詳細拡張でなく）: 詳細は応募導線・主催者管理で既に詰まっており、全情報を足すと長すぎる。観戦専用ビューとして役割分離。
- **サマリー＋導線方式**: 既存 board は600〜900行と重く編集ロジック込み。集約ページに積むと重い。要約＋詳細リンクで「全体像を掴む」目的を軽く達成。
- 閲覧は canViewEvent（公開は誰でも・下書きは主催者のみ）。

### 次にやること
- [ ] 実機確認（進行段階ごとの表示・空セクション非表示）はユーザーがまとめて。
- [ ] 将来: Discord通知連携・login文言をMatchpointへ・通知/フォロー。

---

## 2026-06-29 — マイページ（/me）実装＋バトルタグ登録（応募時は必須・人単位で保存）

仮ページだった /me を「プロフィール管理」として作りきり、これまで登録手段が無かった battle_tag の登録/編集を可能にした。

### やったこと
- **マイグレーション（手動適用済み）** `0025_users_update_self.sql`: users の UPDATE RLS（本人のみ `id = auth.uid()`）。0009 で「別途」としていた更新ポリシーをここで整備。
- **users repository 拡張**: `findMyProfile` / `findBattleTag` / `updateBattleTag`（**battle_tag のみ更新に固定＝マスアサインメント対策の二層目**。discord_id/is_admin 等は触らせない）。
- **マイページ /me を作りきり**: プロフィール表示（Discord名=編集不可・アバター）＋ バトルタグ編集フォーム。参加/主催一覧は出さずプロフィール管理に専念（トップと役割分担）。
- **バトルタグの2つの入口**（users.battle_tag という1つの値を編集）:
  - マイページ: 任意（空で未登録に戻せる）
  - 応募フォーム（apply-form＋ApplyButton）: **必須**。既定値は登録済み battle_tag（登録済みなら自動補完）。応募時の入力で users.battle_tag を上書き更新（次回応募で自動補完される）。
- registerForEvent は `(eventId, displayName, battleTag)` に拡張。バトルタグの Zod は入口で必須/任意を分ける（battleTagSchema / battleTagRequiredSchema / applyBattleTagSchema）。
- テスト: バトルタグ必須・trim・users更新の契約を追加。check(289緑)/build 通過。実機で未ログインの /me→/login ガード・回帰なしを確認。

### 決めたこと（なぜ・壁打ち済み）
- **マイページ作成は強制しない**: 観戦者を大事にする方針（フェーズB）に反するため。users 行はログイン時に自動生成（0003）済みで、足りないのは battle_tag の値だけ。
- **バトルタグは「必要になった瞬間（応募時）」に訊く**（Just-In-Time）＋マイページで事前登録も可。両方の入口で「未登録なら入力・登録済みなら自動補完」の親切な体験を完成。
- **応募時バトルタグは必須**（ユーザーすり合わせ）: 対戦相手とゲーム内で会うため応募には必ず要る。`require_battle_tag` フラグの議論は不要に（常に必須）。
- **バトルタグは users（人単位）**: 登録名（registrations・イベントごと）と違い、その人のゲーム内IDでイベントごとに変わらない。既存設計と一致。詳細は [[display-name-design]]。

### 次にやること
- [ ] ログイン後フロー（マイページ保存・応募フォームの既定値/必須）の最終目視は手元で。
- [ ] 将来: 通知/フォロー（マイページ配下）・Discord通知連携・観戦集約ページ。login画面の "GAMEEVENTBOARD" 文言も Matchpoint へ。

---

## 2026-06-29 — トップページ整備（サービス名「Matchpoint」決定・状態で2つの顔・共通ヘッダー）

`/` が Next.js 初期テンプレートのまま放置されていたのを、サービスの入口として整備した。あわせて全ページ共通ヘッダーを導入。

### やったこと
- **サービス名を「Matchpoint」に決定**（壁打ちで選定）。ゲーム横断で使える試合×拠点の語感。metadata.title・lang="ja"・login の文言も是正対象（今回は layout とヘッダー・トップを主スコープ）。
- **トップ `/` を状態で2つの顔に出し分け**:
  - 未ログイン（LPの顔）: ヒーロー（サービス名＋説明＋Discordログイン/イベントを探す）＋ 募集中イベント（新着6件＋すべて見る）
  - ログイン後（ダッシュボードの顔）: あいさつ（こんにちは、Discord名さん）＋ 参加中イベント ＋ 主催イベント（あれば一覧／なければ作成CTA）＋ 募集中イベント
- **全ページ共通ヘッダー** `components/site-header.tsx`（サーバーコンポーネント）を layout.tsx に配置。ロゴ=トップ / イベント一覧 / イベント作成 ＋ ログイン状態（未=ログインボタン・ログイン=Discord名→/me＋ログアウト）。
- **Repository 新設** `listMyParticipatingEvents(userId)`: 自分の応募から参加イベントを引く。rejected/withdrawn 除外、開催日時の降順（古いものが下）、events 埋め込みは多対一の単一オブジェクト（[[supabase-embed-cardinality]]）。
- DB変更なし。lint/typecheck/test(288緑)/build 通過。実機で未ログインLP・ヘッダー・既存ページへの影響なしを確認。

### 決めたこと（なぜ・壁打ち済み）
- **トップ＝ランディング(未ログイン)とダッシュボード(ログイン後)の2つの顔を1つの `/` で出し分ける**（Connpass/GitHub と同パターン）。ユーザーが挙げた「参加/主催/募集/マイページ」は全てログイン後の要素だった。
- **参加中は終了イベントも含め時系列で出す**（古いものが下）。最初はシンプルに、数が増えたら過去を畳む。
- **主催はあれば一覧・なければ作成CTA**: 将来主催する人を後押しする（0件でも入口を見せる）。
- **マイページ導線・通知/フォローは今回出さない**: 未実装のため。ヘッダーの名前→/me で足りる。

### 次にやること
- [ ] ログイン後ダッシュボードの最終目視は手元で（Discordログイン要）。
- [ ] 将来: マイページ（/me）の本実装・通知/フォロー・Discord通知連携・観戦集約ページ。login画面の "GAMEEVENTBOARD" 文言も Matchpoint へ。

---

## 2026-06-26 — 名前の3概念の表示ルール整理（登録名・Discord名・バトルタグの併記と出し分け）

登録名導入の続き。3つの名前（①Discord名=内部識別 ②バトルタグ=ゲーム内ID ③登録名=公開名乗り）の役割を踏まえ、各画面で何を出すかを整理した。前PRで `discordName` フィールドに登録名フォールバックを入れていた負債（変数名と実態のズレ）も是正。

### やったこと
- **表示ルール（立場で2分岐: 運営 / それ以外）**:
  - 運営（主催者）: 登録名（主）＋ Discord名 ＋ バトルタグ（併記）
  - それ以外（応募者・観戦者）: 登録名（主）＋ バトルタグ（併記）。**Discord名は出さない**
- **プライバシー＝データを送らない**: Discord名は `isOrganizer ? discord_name : null` で、運営以外にはクライアントへ渡さない（teams/page・registrations/page の整形時に落とす）。
- **変数名の是正**: `RegistrationRowData` / `BoardMember` の `discordName`（中身は登録名だった）を `displayName`（公開表示名）にリネームし、新たに `discordName`（素のDiscord名・nullable・運営のみ）を追加。teams-board 内の `.discordName` 参照5箇所も `.displayName` へ。
- **対象画面**: 応募者一覧（registration-row）・チーム編成/参加チーム（teams-board のメンバーカードに補助行を追加）。
- DB変更なし（既存カラムの表示調整のみ）。lint/typecheck/test(288緑)/build 通過。実機（観戦者視点）で Discord名が漏れていないことを裏取り（バトルタグのみ表示）。

### 決めたこと（なぜ・壁打ち済み）
- **運営にはDiscord名が必須**: 登録名だけだと「この人は Discord の誰？」が分からず、承認・連絡で詰まる。OW2コミュニティ運営の実態（Discordで本人に連絡）に合わせる。
- **観戦者・応募者にバトルタグは出す・Discord名は出さない**: バトルタグは「選手をゲーム内で探す」公開用途あり。Discord名は内部識別なので公開不要＝プライバシー。
- **応募者は観戦者と同じ扱い**: 出し分けを2分岐（運営/それ以外）に保ち実装をシンプルに。
- 詳細は [[display-name-design]]。

### 次にやること
- [ ] ログイン必須フロー（運営視点でDiscord名が併記表示されるか）の最終目視は手元で。
- [ ] 将来: Discord 通知連携 / 観戦集約ページ / トップページ整備。

---

## 2026-06-26 — 登録名機能（応募者・主催者の「そのイベントでの公開表示名」）

これまで表示名は `users.discord_name`（認証抽出）固定だった。これを改善し、応募者・主催者がイベントごとに名乗れる「登録名」を追加した。登録名は観戦者にも見える公開表示名。

### やったこと
- **マイグレーション（手動適用済み）** `0024_display_name.sql`: `registrations.display_name`（応募者の登録名・nullable）、`events.organizer_display_name`（主催者の登録名・nullable）。どちらも既存行は null のまま、表示側は `display_name ?? discord_name` フォールバックで Discord 名を出すためデータ移行不要。
- **入力（既定は Discord 名）**:
  - スコアあり応募フォーム（apply-form）に登録名欄。必須・trim 1〜32 文字（`displayNameSchema`）。
  - スコアなし即時応募（ApplyButton）にも登録名欄。`registerForEvent(eventId, displayName)` に拡張し `simpleApplicationSchema` で検証。
  - イベント作成/編集フォーム（共通 EventForm）の最上部に登録名欄（`organizerDisplayName`・任意・空ならフォールバック）。
  - フォームの初期値は認証時の Discord 名（`findDiscordName` を新設した users repository で取得）。保存値はユーザーが目視した値（空欄→Discord 名に化ける方式は不採用＝スナップショット性を守る）。
- **表示（フォールバック）**: 応募者一覧（登録名主表示＋Discord 名併記）・チーム編成（主催者）・参加チーム一覧（観戦者 read-only）・イベント詳細の「主催: ×××」。詳細ページは `organizer:users!events_organizer_id_fkey(discord_name)` を 1:1 で埋め込み join。
- **テスト**: 登録名の必須・trim・スナップショット保存の契約を追加（scored/simple 両応募）。lint/typecheck/test(288緑)/build 通過。実機（観戦者視点）で主催表示・チーム一覧・応募者一覧のフォールバック表示を確認。

### 決めたこと（なぜ・壁打ち済み）
- **置き場所は応募ごと（registrations）と主催者ごと（events）に分ける**: 登録名は「そのイベントでの表示名」という1つの意味。応募者はスコアと同じく応募時点のスナップショット、主催者はイベント単位の名乗り。詳細は [[display-name-design]]。
- **観戦者は「名乗らない」が「登録名で見える」**: 観戦者には入力欄を出さない（名乗る必要なし）。一方、観戦者が見る画面の個人名は Discord 名でなく登録名で表示する（Discord 名=内部識別・登録名=公開名乗り、という役割分担）。
- **スコアなし即時応募にも登録名を付ける**: 中心価値（Discord 名固定の改善）を全応募ルートで一貫させるため、ApplyButton をボタン一発から「登録名入力＋ボタン」に。

### 次にやること
- [ ] ログイン必須フロー（実際に応募して登録名が保存・一覧反映されるか）の最終目視は手元で。
- [ ] 将来: Discord 通知連携 / 観戦集約ページ / 名前の3概念の整理（①Discord 名 ②バトルタグ ③登録名）。

---

## 2026-06-25 — フェーズB: 閲覧の全面公開（観戦者に対戦表・順位・トナメ・チームを開放）

応募していない観戦者（③・非ログイン）にも、公開イベントの対戦表・順位表・トーナメント表・参加チーム・ブロック分け・配信・結果を見られるようにした。盛り上げポリシーの本丸。

### やったこと
- **マイグレーション（手動適用要）** `0023_public_viewing.sql`: matches/match_results/groups/group_teams/teams/team_members/registrations の SELECT を anon（観戦者）に開放。条件は「公開イベント（status<>'draft'）に属する行」（security definer `is_public_event`）。users は「公開イベントの応募者 or 主催者の行」だけ開放（関係者のみ＝出場選手は見える・無関係ユーザーの名簿露出は避ける）。既存の `to authenticated` ポリシーは温存（OR 結合）。操作系は一切変更なし。
- **ページ認可ガード**（matches/tournament/groups/teams/registrations）: `if(!user) redirect(/login)` を撤廃し、`canViewEvent`（公開済みは誰でも・下書きは主催者のみ）に統一。`viewerId = user?.id ?? null`。編集は readOnly/canReport で従来どおり制御。
- **観戦者向けの導線**: イベント詳細の本戦リンクを「公開済みなら誰でも」表示に。各画面のナビリンクも観戦者に開放。
- **観戦者ノイズの除去**: teams に `spectator` 概念を追加（試算シミュレーション枠・未割当プールを出さず確定チームだけ純粋閲覧。タイトルは「参加チーム」・バナーは「参加チームを閲覧」・リザーブ欄は「なし」表示）。groups も観戦者には未割当プールを隠す。matches の「日時・配信は未設定」は編集権者だけに表示。
- lint/typecheck/test(286緑)/build 通過。

### 決めたこと（なぜ・壁打ち済み）
- **閲覧はRLS主役で開放・操作はifで弾く**（[[rls-authz-asymmetry]]の流儀を anon まで広げる）。
- **下書きは観戦者に見せない**: アプリ層 canViewEvent（404）＋ RLS is_public_event（anon に行を返さない）の二重防御。
- **users は関係者のみ開放**: 出場選手の名前は観戦者に見える（応援に必要）が、イベント無関係ユーザーの名簿露出は避ける。
- **「起動時に強制ログイン」は実は無かった**（middleware はセッション更新のみ）。強制は各操作ページの redirect だけ＝それを外すのがフェーズBの実体。
- **観戦者には作業中の情報を一切見せない**（実機FB）: 試算枠・未割当プール・「未設定」「ここにドラッグ」等の編集者向け表示を観戦者から除去。

### 次にやること
- [ ] **マイグレーション0023を Supabase SQL Editor で手動適用**（適用前は観戦者に試合データが見えない）。
- [ ] 将来: 観戦集約ページ（参加チーム/ブロック/トナメ/結果を1ページに）、登録名（display_name）機能、自分の試合/スクリム/通知。

---

## 2026-06-25 — フェーズA: 試合の付随情報（日時・配信・リプレイコード）

試合に「日時・配信URL/配信者・マップ別リプレイコード」を入力できるようにした。予選・決勝Tの両画面に対応。次フェーズB（観戦者への閲覧全面公開）の前段＝「見せる中身を入れる」。

### やったこと
- **マイグレーション（手動適用要）**:
  - `0021_match_replay_codes.sql`: match_results に `replay_codes text[]`（マップ別・1マップ1コード）。
  - `0022_matches_update_reporter.sql`: matches UPDATE を `can_report_match`（主催者or対戦両チーム代表）に拡張（日時を代表も編集可にするため）。
- **Service** match-result.ts: `mapsPlayed`（=両者スコア合計＝行われたマップ数）/ `normalizeReplayCodes`（マップ数に長さを揃える）。テスト+5=286。
- **datetime-local.ts**: `jstLocalToUtcIso` / `utcIsoToJstLocal` を共有ヘルパ化（JST入力↔UTC保存）。
- **Repository**: `upsertMatchResult` に replayCodes 追加。matches.ts に `updateMatchSchedule`（日時）/ `updateMatchStream`（配信）。list系の select に scheduled_at/stream_url/streamer_name/replay_codes を追加。
- **Server Action**（matches/actions.ts・予選決勝T共用）: `reportResult`/`reportTournamentResult` にリプレイコード保存を追加。`updateSchedule`（主催者or代表・JST→UTC・recompute無し）/ `updateStream`（主催者のみ）を新設。
- **UI**: 結果入力フォームに**スコア合計に連動するマップ別リプレイコード欄**。試合カードに「詳細を編集」（日時＝権限者・配信＝主催者のみ）＋表示（🕒日時・📺配信リンク）。matches-board / tournament-board 両方に実装。
- lint/typecheck/test(286緑)/build 通過。

### 決めたこと（なぜ・壁打ち済み）
- **閲覧体験が主役**という方針を確認（観戦者＝非参加者も巻き込むのが盛り上げポリシー）。それを踏まえ**A→B分割**: まず付随情報を入れて「見せる中身」を作り（A・今回）、次に観戦者への全面公開（B）。
- **項目ごとに権限が違う**: 結果・日時・リプレイ＝主催者or代表 / 配信＝主催者のみ。日時と配信は **Action を分けて**認可を明快に（代表が配信を送り込めない）。
- **リプレイは1マップ1コード**＝行われたマップ数（スコア合計・奇数BOは可変）分だけ欄を出す。任意入力（空可）・各16文字・配列長上限15。
- **日時・配信は recompute を呼ばない**（ブラケット構造に無関係）。結果（リプレイ含む）は従来どおり。

### 次にやること
- [ ] **マイグレーション0021・0022を Supabase SQL Editor で手動適用**（適用前は実機で付随情報の保存がエラー）。
- [ ] 実機確認（リプレイ欄のスコア連動・日時/配信の権限差・予選決勝T両方）。
- [ ] フェーズB: 閲覧の全面公開（対戦表・結果・順位・トーナメント表・配信を観戦者＝非ログインに開放。RLSをanon開放＋各page認可ガード見直し）。

---

## 2026-06-25 — 本戦-5 実機確認FB: 結果入力導線＋自動進出の修正

決勝トーナメント（5a〜5c）を Playwright で通し実機確認し、自動テストでは拾えない3件のバグを発見・修正。

### やったこと（修正3件）
- **① 勝者が自動進出しない（重大）**: `fetchTournamentForRecompute` が `match_results`（match_id が PK の1:1関係）を**配列**として扱っていたが、Supabase の埋め込みは1:1だと**単一オブジェクト**を返す。`Array.isArray` が常に false で結果が読めず、recompute に勝者が渡らず決勝・3位決定戦が「未定」のままになっていた。→ 単一オブジェクト/配列の両形に対応。
- **② 最初の結果が入力できないデッドロック（重大）**: 1回戦が結果ゼロ時は D&D モードのみで結果入力フォームを開く導線がなく、最初の1試合の結果を入力できなかった。→ 試合カードに「結果を入力」ボタン（試合に1個。チームスロットごとではない）を追加。
- **③ 片方入力すると他カードの入力ボタンが消える**: 結果が1件入ると `swapEnabled=false` で全カードが「カード本体クリック」式に切り替わり、ボタンが消えて導線が変わっていた。→ 結果入力ボタンを D&D 可否に関係なく**常に表示**するよう統一。結果ありは「結果を修正」ラベルに。
- lint/typecheck/test(281緑)/build 通過。実機で①②③の修正を確認（生成→結果→自動進出→表彰台→連鎖リセット→D&D入替）。

### 決めたこと（なぜ）
- **結果入力ボタンは試合に1個**（チームスロットごとではない）。「2個入力するの?」という誤解を避ける（実機FB）。
- **入力導線は D&D 可否で変えない**。1試合入力した瞬間に残りカードの導線が変わると分かりにくいため、ボタンを常設して一貫させる。
- **実機確認用シード**を `supabase/dev_seed_tournament.sql` / `dev_seed_tournament_clean.sql` として整備（「のり検証1」に8チーム＋予選結果を投入）。

### 教訓
- Supabase の埋め込み join は、**1:1（PK 参照）は単一オブジェクト・1:N は配列**で返る。1:1 を配列前提で書くと黙って空になる。Repository 層の戻り形は実データで確認する。
- 純粋関数（recompute）は単体テストで緑でも、**入力データを作る Repository 層の取り違え**は実機でしか出ない。通し実機確認の価値。

---

## 2026-06-25 — 本戦-5c: 決勝トーナメント仕上げ（3位決定戦・手動微調整・表彰台）

決勝トーナメントの仕上げ。3位決定戦、1回戦のD&D手動微調整、優勝者の表彰台表示。

### やったこと
- **マイグレーション** `0020_tournament_third_place.sql`: events に `tournament_third_place`（boolean・default false）。**SQL Editor で手動適用が必要**。
- **Service** `bracket.ts`（テスト+10＝計38）:
  - `generateBracket(seeded, { thirdPlace })`: 準決勝が2試合（4チーム以上）かつ ON のとき、最終roundに position=1 で3位決定戦を追加。
  - `recomputeBracket`拡張: 3位決定戦を勝者進出ループから分離し、`loserOf`（準決勝2敗者）で専用にスロットを埋める。準決勝修正→決勝・3位決定戦の両方が連鎖無効化。
  - `tournamentPodium`: 優勝/準優勝/3位（3決勝者 or 準決勝敗者2チーム3位タイ）を返す純粋関数。
- **Server Action**: `swapBracketTeams`（matchId＋slot a/b の2スロット指定で中身入替・チームid受け取らない。結果1件でもあれば全体ロック・両方round=1・同イベント検証・recompute追従）。`generateTournament`に3位決定戦設定を渡す。
- **UI**: tournament-board に①1回戦スロットのD&D入替（dnd-kit・結果なし時のみ・BYE/シードも対象）②表彰台バナー③3位決定戦カードのラベル出し分け。イベント編集フォームに「3位決定戦を行う」トグル。
- lint/typecheck/test(281緑・新規10)/build 通過。

### 決めたこと（なぜ・壁打ち済み）
- **3位決定戦は最終roundにposition=1で表現**（新カラム不要）。ただし recompute は「勝者進出」と別物（敗者進出）なので**専用処理に分離**（穴洗い出しで判明：通常ループに混ぜると最終round2試合化でスロット計算が壊れる）。
- **手動微調整は1回戦のチーム入替に限定・D&Dでswap**。BYE/シードチームも1回戦カードに居るので対象に含まれる（ユーザー指摘で確認）。**結果が1件でもあれば全体ロック、結果ゼロなら全1回戦カードを動かせる**。
- **swapはチームidを受け取らずスロット参照（matchId+a/b）で入替**（マスアサインメント対策）。
- **表彰台はベスト4（準決勝敗者）も表示**。3位は3決勝者 or 3決なしは準決勝敗者2チームを3位タイ。
- **呼称は「3位決定戦」で統一**（「3決」と略さない）。

### 次にやること
- [ ] **マイグレーション0020を Supabase SQL Editor で手動適用**。
- [ ] 決勝トーナメント（5a〜5c）通しで実機確認（生成→結果入力→自動進出→修正で下流リセット→3位決定戦→表彰台→手動入替）。
- [ ] 本戦-6+: スケジュール・リプレイコード / Realtimeライブ更新。

---

## 2026-06-25 — 本戦-5b: 決勝トーナメント（結果入力＋勝者の自動進出）

トーナメント試合の結果入力と、勝者の次ラウンドへの自動進出。結果修正で勝者が変わると下流を連鎖リセット。

### やったこと
- **Service** `bracket.ts` 追加（テスト+11＝計28）:
  - `recomputeBracket(matches, results)`: 全再計算。1回戦のシード配置を起点に勝者を伝播。BYE自動進出・多段連鎖を1パスで処理。各試合の「あるべきteamA/B」＋「結果無効化すべきか（チームが変わったら削除）」を返す純粋関数。
  - `toOddBestOf(bo)`: トーナメントは引分を構造的に出さないため BO を奇数へ補正。5aの生成（group_best_of流用）が偶数だと詰む問題を手当て。
- **Repository**: matches.ts `applyBracketRecompute`（スロット更新＋無効化結果の一括削除）。tournament.ts `fetchTournamentForRecompute`（再計算入力の取得）。
- **Server Action**（tournament/actions.ts）: `reportTournamentResult(input, confirmed)` と `clearTournamentResult`。予選 reportResult と同型の防御（認可＝主催者or対戦両チーム代表・BO/POTG検証・winnerサーバー算出）＋後段で全再計算を本適用。**下流に消える結果があり未承諾なら needsConfirm を返して保存しない**（ドライランで件数を先に算出）。
- **UI**: tournament-board に結果入力を実装。ブラケットカードを**クリックで展開**しスコア（＋POTG）入力。勝者は🏆＋強調。下流が消える修正のときだけ条件付き AlertDialog で確認。`clearTournamentResult` で取り消し。`router.refresh` で再取得。
- マイグレーション不要。lint/typecheck/test(271緑・新規11)/build 通過。

### 決めたこと（なぜ・壁打ち済み）
- **全再計算方式**（差分更新でなく）。巻き戻し漏れ・二重反映が原理的に起きない。純粋関数でテスト網羅（勝者伝播・修正で下流リセット・多段連鎖・BYE・無効化判定）。
- **無効化判定＝チームが変わったら削除**。winner_team_id が再計算後の新スロットに居ない／両スロット未確定に戻った試合の結果を削除。奇数BO強制で引分が出ない＝判定がシンプルに噛み合う。
- **トーナメントは奇数BO強制**。引分が出ると進出先が決まらないため。5aの見落としを5bで toOddBestOf として手当て。
- **条件付き確認**（下流に結果がある修正のときだけ）。ドライラン→needsConfirm→確認後に本適用。通常入力は即保存で煩わせない。
- **結果入力は予選ロジックを最大限流用**。reportResult系・decideWinner・validateBoScore/Potg・認可は phase 非依存で再利用。5bの新規は「自動進出・連鎖リセット」だけ。

### 次にやること
- [ ] 本戦-5c: 3位決定戦＋進出チームの手動微調整UI＋優勝者確定表示。
- [ ] 5c まで揃ったら通しで実機確認（生成→結果入力→自動進出→修正で下流リセット）。

---

## 2026-06-25 — 本戦-5a: 決勝トーナメント（ブラケット生成基盤）

決勝トーナメント（シングルエリミネーション）の土台。各ブロック上位N をシードに、シングルエリミのブラケットを生成・永続化・表示する。結果入力・勝者の自動進出は本戦-5b。

### やったこと
- **マイグレーション** `0019_tournament_advance_count.sql`: events に `tournament_advance_count`（各ブロック上位N・0〜99・default 0）。**SQL Editor で手動適用が必要**。
- **Service** `bracket.ts`（純粋関数・テスト17件）:
  - `bracketSize`（進出数以上の最小2の累乗）/ `seedOrder`（標準シード並び。上位シードが反対の山）/ `generateBracket`（全ラウンドのカード生成・BYEは上位シードに割当→自動進出）/ `extractSeededTeams`（各ブロック上位N抽出＋シード群→群内横断ソート）。
- **Repository**: `tournament.ts` `computeBlockSeeds`（groups/matches/results を取り `computeStandings` でブロック順位→SeedTeam[]。生成と表示で共用）。matches.ts に `listTournamentMatches`/`replaceTournamentMatches`/`deleteTournamentMatches`。events.ts に `updateTournamentAdvanceCount`。
- **Server Action** `generateTournament(eventId, advanceCount)`: ログイン→主催者→順位機能ON確認→Zod→シード抽出→ブラケット生成→既存T全削除して一括 insert→進出数保存。
- **UI**: `/events/[id]/tournament` 新設。生成エリア（上位N入力＋進出予定プレビュー）＋shadcn AlertDialog（作り直しは結果消去を警告）＋ブラケット表示（ラウンドごとに横並び・準決勝/決勝ラベル）。対戦表画面からの導線追加。
- lint/typecheck/test(260緑・新規17)/build 通過。

### 決めたこと（なぜ・壁打ち済み）
- **シングルエリミ＋3位決定戦**を対象（ダブルエリミは将来）。まずブラケット描画・自動進出の土台を確実に。3位決定戦・手動微調整は5c。
- **進出は各ブロック上位N（主催者がN設定）**。ブロック数×Nで進出総数→2の累乗ブラケット＋BYE。参加チーム数で進出数が変わるため設定可能に。
- **シード順=ブロック同順位をシード群に**（A1,B1…=1群）。群内は勝点→得失→POTGで横断比較。全体順位テーブルは作らず軽量に。
- **生成＝DB永続化**（matches に phase='tournament' 行を insert）。5bの結果入力がそのまま乗る。予選の対戦表生成と同じ構造。
- **再生成は結果リセット＋警告**（本戦-4と同じ流儀）。順位機能OFFのイベントは進出抽出不可なので生成をブロック。
- **DBはトーナメント織り込み済み**（phase/round/bracket_position/nullable team）を活用。新規列は進出数Nの1列のみ。

### 次にやること
- [ ] **マイグレーション0019を Supabase SQL Editor で手動適用**（適用前は実機でT画面がエラー）。
- [ ] 本戦-5b: 結果入力＋勝者の自動進出＋修正時の下流連鎖リセット（警告付き）。
- [ ] 本戦-5c: 3位決定戦＋進出チームの手動微調整＋優勝者確定表示。

---

## 2026-06-25 — 本戦-4: 自動ブロック分け（スネークドラフト）

ブロック分け画面に「自動でブロック分け」を追加。主催者がブロック数を指定すると、承認済み全チームをスコア降順スネークドラフトで配り直す。手動 D&D 振り分け（本戦-1）を土台にした便利機能。

### やったこと
- **Service**: `snake-draft.ts` 純粋関数 `snakeDraft(teams, blockCount)`（スコア降順・null末尾の安定ソート → 蛇行配置で平均強さを均す。端数は余りなしで自然吸収）と `blockName(i)`（A,B,C…AA採番）。単体テスト13件（割り切れる/割り切れない/null末尾/全null/同スコア安定/N=1/0件/N>チーム数/負数）。
- **Repository**: `listApprovedTeamsForDraft`（割当状態問わず全 approved チーム＋スコア源）と `replaceGroupsWithAssignments`（既存ブロック全削除→A,B,C…一括作成→group_teams 一括 insert）を groups.ts に追加。
- **Server Action**: `autoAssignGroups(eventId, blockCount)`。ログイン→主催者確認→**対戦表生成済みなら拒否（locked）**→Zod＋「1〜承認チーム数」検証→teamScore で整形→snakeDraft→一括適用。RLS（0013）が最終防衛。
- **UI**: groups-board に「自動でブロック分け」エリア（ブロック数 input＋実行）。実行は **shadcn AlertDialog** で破壊的操作を確認。適用後は楽観更新せず `router.refresh()` でサーバーの正の状態を再取得。`readOnly`/`locked` 時は非表示。
- **マイグレーション不要**（既存スキーマ・RLS で完結）。lint/typecheck/test(243緑)/build 通過。

### 決めたこと（なぜ・壁打ち済み）
- **入力はブロック数指定＋スネークドラフト**。総当たり進出枠がブロック数で決まる運用に直感的。端数は**余りを出さず一部ブロックが1少ない形で吸収**（メモリの「偏ってOK」と整合）。
- **全リセットして組み直す**（未割当だけ足すのではなく）。対象は全 approved チーム。手動の途中状態より「ゼロから均す」方が結果が読める。破壊的なので AlertDialog で確認。
- **即適用＋手動微調整**（プレビューUIは作らない）。叩き台という位置づけ＝結局手で直すなら二度手間。生成後は既存 D&D で「このチームとこのチームは別ブロックに」等の運営意図を反映できる。
- **確認は shadcn AlertDialog**（window.confirm でなく）。後で Claude Design で UI 調整する予定があり、ネイティブダイアログはデザイン対象外になるため。破壊的操作の確認はこれを標準にする。
- **router.refresh で再取得**（楽観更新でなく）。全消し＋一括生成で状態が大きく変わり、ブロックIDの組み立てが事故りやすいため、サーバーが正を返す形にした。

### 次にやること
- [ ] 実機確認（自動振り分け→手動微調整の通し。端数イベント・非 require_score イベントも確認）。
- [ ] 本戦-5: 決勝トーナメント（phase=tournament）。

---

## 2026-06-25 — C-6: 主催者がチーム代表を指名できる（実機確認の追加フィードバック）

実機確認で「応募者（代表）が結果入力できない」と判明。DB を確認したところ、原因は**主催者編成チームには代表（captain）がいない**こと（self 確定チームだけ captain_registration_id が入る）。代表がいないチームは reportResult の captainUserIds 判定に誰も乗らず、主催者しか結果入力できなかった。

### やったこと
- **Repository**: `setTeamCaptain`（teams.captain_registration_id を楽観ロックで更新＋team_members.is_representative を同チーム内で1人だけ true に同期）と `isTeamMember`（指名対象が所属メンバーかの事前検証）を追加。
- **Server Action**: `setTeamCaptain(teamId, registrationId)`。ログイン→所有者確認（requireOrganizer）→所属メンバー検証→楽観ロック更新。RLS（0010）が最終防衛。
- **UI**: チーム編成画面（主催者・実チームのみ）で各メンバーに「代表にする」ボタンと、代表に「★代表」バッジを表示。楽観更新で captainRegistrationId を差し替え。
- これにより指名された代表は自チームの試合結果を入力できる（`findMatchForReport` が captain_registration_id→registrations.user_id を辿るため、捕捉は自動）。
- マイグレーション不要（既存カラム・RLS で主催者の teams/team_members 更新は許可済み）。lint/typecheck/test(230緑)/build 通過。

### 決めたこと（なぜ・壁打ち済み）
- **「主催者が代表を指名できる」案を採用**（メンバー全員に許可ではなく）。代表を1人に定めることで「誰が入力したか」の責任が明確。self 確定チームは従来どおり確定時の代表のまま。
- **captain_registration_id と is_representative を両方更新**。前者が正（reportの認可に使う）だが、後者も表示・整合のため1人 true に揃える。
- **代表は1チーム1人**（指名で他は false に落ちる）。

### 次にやること
- [ ] 実機確認の残り（②応募者の試算モードでの実チーム固定は未確認）。フィードバック対応は概ね完了。

---

## 2026-06-24 — C-5: D&D のドロップ判定を浅い位置で受け付ける（実機確認の追加フィードバック）

実機確認で「リザーブ→未割当プールへ D&D するとき、応募者カードが横長のせいか領域へ深く押し込まないとドロップを受け付けない」と判明。

### やったこと
- teams-board / groups-board の DndContext に `collisionDetection={dropCollision}` を追加。`dropCollision` は **pointerWithin（ポインタ位置が領域内か）を第一**にし、どのゾーンにも重ならないときだけ closestCenter にフォールバックする合成関数。
- 既定の `rectIntersection` は「ドラッグ中カードの矩形とドロップ先の交差面積」で判定するため、横長カードだと深く入れないとヒットしなかった。ポインタ基準に変えて「カーソルが乗れば浅い位置で受け付ける」挙動にした。
- lint/typecheck/test(230緑)/build 通過。

### 決めたこと（なぜ）
- **pointerWithin 第一・closestCenter フォールバック**。pointerWithin だけだと領域の隙間（プールの余白など）でヒット 0 になりドロップを取りこぼすので、その時だけ最近傍ゾーンを拾う。誤爆を避けつつ取りこぼしも防ぐ。
- **teams と groups 両方に適用**（同じ D&D 体験の一貫性）。報告は teams 画面だが groups も同じ既定挙動で同じ不便があるため横展開。

### 次にやること
- [ ] 実機確認で見つかったもう1件（主催者編成チームに代表がいないと結果入力できない）→ 主催者が代表を指名できるようにする（別PR）。

---

## 2026-06-24 — C-4: チーム編成の未割当プール操作改善（フィードバック⑫）

「チームが増えると D&D のカーソル移動が大変」への対応。壁打ちで**主戦場はブロック分けではなくチーム編成画面**だと判明（ブロック数↔チーム数の差は小さいが、チーム数↔応募者数は応募者が数十人規模になりうる＝未割当プールが縦に長大化する）。teams-board に3つの手を入れた。

### やったこと
- **並び替え/絞り込み（探す負担の軽減）**: 未割当プール上部にセレクタを追加。`全体（応募順）`/`全体（スコア順）`/`第1希望タンク`/`第1希望DPS`/`第1希望サポート`。ロール別は第1希望が該当ロールの人だけに絞りスコア降順。純粋関数 `sortPool` で**表示用に派生**（state の元配列＝応募順は壊さない）。見出しは絞り込み時「N / 総数」表示。
- **「▾ チームへ送る」ボタン（運ぶ負担の軽減）**: 未割当カードにセレクトを追加し、クリックで対象チームの出場（第1希望ロール）へ割当。D&D 不要。`handleAssignToTeam` で楽観更新＋`assignMember`。pointer-down 伝播を止めて誤ドラッグを防ぐ。試算モードは SIM 枠への追加のみ。
- **オートスクロール（D&D 派の軽減）**: DndContext に `autoScroll={{ threshold: { y: 0.2 } }}` を明示。長い一覧でもドラッグ中に端でスクロールする。
- lint/typecheck/test(230緑)/build 通過。

### 決めたこと（なぜ・壁打ち）
- **ユーザー提案のソート＋合意済みの送るボタン/オートスクロールを全部入り**。ソートは「探す」、送るボタンとオートスクロールは「運ぶ」をそれぞれ軽減し、クリック派/D&D 派の両方に効く。
- **ソート項目はロール別をスコア順固定**（強い順に並ぶ＝上限内編成を組むとき選びやすい）。
- **ソートは表示の派生に留め state は不変**（応募順を失わないため。再ソートしても元に戻せる）。
- `sortPool` は "use client" ファイル内に閉じるためユニットテストは付けず手動確認に回す（[[dev-flow-practice]] と整合）。

### 次にやること
- [ ] フィードバック14件は一通り対応完了。**まとめて実機確認**（A〜D の修正が想定どおり効くか・回帰がないか）。

---

## 2026-06-24 — C-3: 対戦表「生成」と「追加」を近接配置（フィードバック⑩）

「対戦表を生成」（一括）と「対戦を追加」（個別）が離れていて操作しにくい問題の解消。

### やったこと
- matches-board の `GroupMatches` を再構成。従来は生成ボタン＝ヘッダ右上・手動追加フォーム＝カード最下部で離れていた。**両操作を「操作エリア」1枠にまとめ、ヘッダ直下（対戦カード一覧の上）に配置**。「総当たりを一括生成」「個別に追加」とラベルを付け、まず生成→足りなければ個別追加、の流れを示す。
- 操作エリアは `!readOnly && teams>=2` のときだけ表示（2チーム未満は従来どおり「2チーム以上必要」案内）。順位表・対戦カード一覧はその下のまま（干渉なし）。
- lint/typecheck/test(230緑)/build 通過。

### 決めたこと（なぜ）
- **生成ボタンをヘッダから操作エリアへ移動**。生成と追加は「対戦カードを用意する」同じ目的の操作なので1箇所に集約するのが自然。ヘッダはタイトル＋件数だけにして見出しを軽くした。
- ロック（⑬）との関係: ロックは groups 側（ブロック組み替え）の話で matches 側の生成/追加は従来どおり可。今回の配置変更はロック導線と無干渉。

### 次にやること
- [ ] ⑫ チーム数が多いときの D&D 操作負担の軽減。済んだら実機確認。

---

## 2026-06-24 — D-1: 「予選」表記を外す（フィードバック⑥）

「総当たり≠予選。トーナメント進出があるときのみ予選表記」というフィードバックへの対応。現状は決勝トーナメント（本戦-5）が未実装＝全イベントが総当たりのみなので、一律「予選」表記は不適切。

### やったこと
- UI 表示テキストの「予選」を外した（6箇所・5ファイル）:
  - groups/page.tsx: h1「予選ブロック分け」→「ブロック分け」、リンク「予選対戦表へ」→「対戦表・順位表へ」
  - matches/page.tsx: h1「予選対戦表」→「対戦表・順位表」
  - teams/page.tsx: リンク「予選ブロック分けへ」→「ブロック分けへ」
  - events/[id]/page.tsx: 本戦セクション説明「予選ブロックの組み分け」→「ブロックの組み分け」
  - event-form.tsx: フォームラベル「予選BO」→「BO（1試合のマップ数）」
- lint/typecheck/test(230緑)/build 通過。

### 決めたこと（なぜ）
- **UI 文言だけ変更。コメント・関数名・スキーマ説明・DBの `phase='group'` は据え置き**。「予選＝group phase」は内部の正しい概念で、決勝T（phase='tournament'）実装時に再び意味を持つ。表に出る文言だけ中立化する。
- **決勝T実装時に「予選/決勝」の出し分けを復活**させる前提（その画面でだけ「予選」と表記して区別）。

### 次にやること
- [ ] 残りの UX（⑩生成と追加の配置・⑫D&D操作負担）。一通り済んだら実機確認。

---

## 2026-06-24 — C-2: 対戦表まわりの表示改善（フィードバック④⑦⑪）

対戦表画面（matches-board）の見やすさ・入力しやすさを、関連する3点まとめて改善。

### やったこと
- **④ BO表記**: `match-result.ts` に純粋関数 `describeBestOf(bestOf)` を追加（奇数→「3マップ中2本先取」・偶数→「全4マップ・引分あり」）。対戦カードの `BO3` バッジに `title` ツールチップで意味を添え、`cursor-help` で説明があると示す。テスト2件追加。
- **⑦ 勝者強調**: 勝者チーム名に 🏆＋背景強調（`bg-primary/15`・bold）を付け、敗者は控えめ（muted）に。スコアも勝者側の数字を太字・primary 色で強調。引分はバッジ化。従来は勝者が text-primary のみで弱かった。
- **⑪ スコア初期値**: 結果入力の取マップ数の初期値を空欄→`0` に変更（空欄だと毎回カーソルを置いて消す手間があった）。POTG は元々 0 始まり。
- lint/typecheck/test(230緑)/build 通過。

### 決めたこと（なぜ）
- **④はバッジ自体は短いまま（BO3）、補足はツールチップ**。一覧の省スペースを保ちつつ、初見の人には hover で意味が伝わる。BOの意味文は純粋関数に切り出してテスト可能にした。
- **⑩（生成ボタンと対戦追加の近接）は今回見送り**。生成はカード右上・追加は最下部で離れているが、近接させると⑬のロック/警告導線や順位表の配置と干渉しうるため、レイアウト全体の検討は別途。

### 次にやること
- [ ] 残りの UX/文言（⑩生成と追加の配置・⑫D&D操作負担・⑥「予選」表記）。一通り済んだら実機確認。

---

## 2026-06-24 — C-1: D&D の事故防止（フィードバック②⑬）

ドラッグ&ドロップで「触れてはいけないものを動かせてしまう」2点の事故防止。

### やったこと
- **②（teams-board・チーム試算）**: 応募者の試算モードで他人の実チームのメンバーまで D&D できてしまう問題。`MemberCard`/`Zone`/`TeamCard` に `draggable`/`membersDraggable` を通し、**試算モードでは自分の「シミュレーション」枠と未割当プールだけ操作可・他の実チームはカード固定**にした。`handleDragEnd` 冒頭にも「試算モードで SIM 以外の実チームへは入れない」保険ガードを追加（ドラッグ元を固定済みなので通常到達しないが二重防御）。
- **⑬（groups-board・ブロック分け）**: 対戦表を生成した後もブロックを動かせてしまい、対戦カードと所属ブロックがズレて事故る問題。groups の page.tsx で `listGroupMatches` を引き、**1件でも生成済みなら `locked`** として GroupsBoard へ渡す。ロック時は主催者でも **D&D・ブロック削除を無効化**し、琥珀色の警告（「対戦表側で試合を削除してから戻って」）を出す。**改名はロック中も可**（対戦表の整合性に影響しないため）。
- 表示は `editable = !readOnly && !locked` に統一。lint/typecheck/test(228緑)/build 通過。

### 決めたこと（なぜ・壁打ち済み）
- **②は「試算枠のみ操作可・実チームは読取専用」**。試算機能（他チームを見て自分の編成を考える）は残しつつ、他人のカードは掴めなくして不安を解消。実チームを非表示にする案より、参考情報を残せる方を採用。
- **⑬は生成済みなら主催者でもロック**。これは UX というより整合性の事故防止（実害あり）。ただし完全凍結ではなく、改名は許可・「対戦表で試合削除→戻る」という解除導線を文言で示す。

### 次にやること
- [ ] 残りの UX/文言（④BO表記・⑦勝者強調・⑩生成と追加の近接・⑪スコア初期値0・⑫D&D操作負担・⑥「予選」表記）。一通り済んだら実機確認。

---

## 2026-06-24 — B-2: 応募者から本戦ページへの閲覧導線（フィードバック⑧）

応募者がブロック分け／対戦表・順位表を見にいく導線が無かった問題の解消。

### やったこと
- **調査で判明**: groups/matches ページの認可は既に「主催者 or そのイベントの応募者」を許可し read-only 表示まで実装済み（本戦-1/2 で対応済み）。**足りていたのは導線（リンク）だけ**だった。イベント詳細にはブロック分け/対戦表へのリンクが誰にも（主催者にも）無かった。
- **`events/[id]/page.tsx`**: イベント詳細に「本戦」セクション（カード）を新設。「ブロック分けを見る」「対戦表・順位表を見る」リンクを置く。主催者・応募者の双方に同じ導線を出して一元化（各ページ側で主催者=編集可／応募者=閲覧のみに出し分く既存仕様に乗る）。
- 表示条件 `canViewTournament` = `status !== 'draft' && (主催者 || 応募者)`。groups/matches ページの認可と一致させ、下書きでは出さない。lint/typecheck/test(228緑)/build 通過。

### 決めたこと（なぜ・壁打ち済み）
- **独立した「本戦」セクションを新設**（応募済みボックス内のリンク追記ではなく）。応募者にも主催者にも同じ場所に導線を出し、本戦への入口を一元化して分かりやすくする。
- **認可ロジックは触らない**。ページ側で既に正しく出し分けているので、詳細ページは「見せる導線の有無」だけを既存認可と一致する条件で制御する（二重定義を避ける）。

### 次にやること
- [ ] 残りのフィードバック対応（C. UX系：②他人チームのD&D 等）。一通り済んだら実機確認。

---

## 2026-06-24 — B-1: チームスコア上限（team_score_cap）の設定UI（フィードバック①）

主催者がイベント作成/編集フォームでチームスコア上限を設定できる UI を追加。

### やったこと
- **背景（バグ）**: `team_score_cap` は DB・消費側（teams-board の上限表示／✓上限内・⚠超過判定）・Service には既にあるが、**入力UI・schema・actions が無く主催者が設定できなかった**。その経路を通した。
- **`overwatch-ranks.ts`**: 帯→略称マップ `TIER_ABBREV`（B/S/G/P/D/M/GM/C）と、スコア→略称ヘルパー `scoreToRankAbbrev`（例 23→"D3"）を追加。設定欄のランク換算ガイド用。
- **`schema.ts`**: `createDraftEventSchema` に `teamScoreCap` を追加（任意・空可・1〜40の整数。`capacity` と同じ「空文字＝未設定」preprocess パターン）。
- **`repositories/events.ts`**: 許可カラム（マスアサインメント対策のホワイトリスト）に `team_score_cap` を追加。
- **`actions.ts`**: `parseEventFormData`（作成/編集共有）で `teamScoreCap`→`team_score_cap` にマップ。空文字は `null`（上限なし）で保存。
- **`event-form.tsx`**: スコアリング設定 fieldset 内（requireScore 配下）にトグル「チームスコアに上限を設ける」＋数値欄＋ランク換算ガイド（`23 (D3)`）を追加。OFF のときは hidden で空文字を送り null 保存。編集時は cap の有無からトグル状態を復元。
- **編集ページ defaults**: `teamScoreCap` を渡して保存値を表示。
- テスト追加（`scoreToRankAbbrev` の略称・schema の境界 0/41/小数を弾き 1〜40 を通す）。lint/typecheck/test(228緑)/build 通過。

### 決めたこと（なぜ・壁打ち済み）
- **デフォルトは「上限なし」**。空欄＝上限なしの暗黙ではなく「上限なし」と明示文言を出す。
- **入力範囲 1〜40 の整数**。cap はチーム出場メンバー final_score の「平均」上限なので、ボーナス（実質ペナルティ）が乗っても平均で見れば実用上 1〜40 で足りる。
- **配置は requireScore 配下**。スコアなしイベントには上限の概念が無いため。トグルは useBonus と同じパターン。

### 次にやること
- [ ] B-2: 応募者から本戦以降（ブロック/対戦表/順位表）への閲覧導線（⑧）

---

## 2026-06-24 — A-3: capacity（定員＝チーム数）の実効化（フィードバック③）

主催者が定員超過のチームを作れてしまう／承認時に超過チェックが効かない不具合の修正。

### やったこと
- **原因**: `createTeam`（主催者編成・即 approved 成立）が `current_count` を一切カウントしていなかった。このため上限チェックもされず、主催者編成チームが定員を無視して作れ、`approveTeam` の上限判定（current_count 基準）も実態とずれていた。
- **修正**:
  - `createTeam`: capacity を排他 +1（`incrementEventCount` を再利用。満員/競合なら作成を弾く）。insert 失敗時はカウントを補償で戻す。`approveTeam` と対称。
  - `deleteTeam`: 削除対象が **approved なら −1** 戻す（pending/rejected は未カウントなので触らない）。`findTeamWithStatus` で status を見て分岐。
  - 承認待ちセクションに **申請が早い順（#1…）＋確定日時（JST）** を表示（追加要望）。先着順で承認・残りを却下する判断のため。
  - **承認/却下/取り下げの楽観更新**を追加（実機確認で発覚）。従来は承認しても画面の status が更新されず、承認待ちセクションに残り続けていた（再度押すと「承認待ちのチームのみ」警告で承認済みと分かる状態）。approve→approved・reject→rejected・cancel→除外を即時反映、失敗時はロールバック。
- DB設計書 5.1 に「current_count の増減経路」を整理して追記。lint/typecheck/test(218緑)/build。

### 決めたこと（なぜ・壁打ち）
- **current_count は approved（成立）チーム数**。主催者編成（即成立）も self 承認も等しく +1、approved 削除で −1。これで「定員＝成立チーム枠」が全経路で一貫。
- **self の pending は枠を食わない（現状維持）**。承認時にのみカウントし、定員が埋まる場合は申請が早い順に承認・残りを却下する運用。そのため pending の応募順を可視化した。
- 既存データは過去分のカウント漏れがあるため、確認前に `current_count` を実態へ合わせる SQL（`dev_seed_fix_current_count.sql`）を用意。

### 次にやること
- [ ] B-1: チームスコア上限(team_score_cap)の設定UI（①）

## 2026-06-24 — A-2: 順位の3すくみが同順位にならないバグ修正（フィードバック⑨）

実機確認（2026-06-24）で、3すくみ（A>B,B>C,C>A の循環）で全員1勝1敗・全タイブレーク同値なのに順位が割れていた。原因と修正：

### やったこと
- **原因特定**: rank 付与時に `fullyTied`（隣接2チームだけのミニリーグで head_to_head 再判定）を使っていたため、並べ替え（グループ全体のミニリーグ）と判定基準が食い違っていた。3すくみで a-b だけ見ると a>b になり、b に別 rank が付く。再現テスト2件を追加して FAIL 確認 → 修正で GREEN。
- **修正**: `orderTied` を「順序付きサブグループ列（`string[][]`）」を返す形に変更。tiebreakers で差がついた所で塊が分かれ、最後まで差がつかない塊は同順位。rank 付与は**塊単位**で行い（同じ塊は同 rank・次は人数分飛ばす）、矛盾の元だった `fullyTied` を削除。
- standings.ts の仕様コメント更新。lint/typecheck/test(210緑)/build。
- 実機データ（イベント「のり検証1」Aブロック）で確認: 3チームが勝点同着・得失0・POTG同数の完全対称 → 修正後は **1,1,1（全員1位）** が正しく出る。

### 決めたこと（なぜ・壁打ち）
- **「並べ替えに使った塊の分割」を順位確定の唯一の根拠にする**。順序と同順位判定を必ず一致させ、循環（3すくみ）でも矛盾しない。隣接ペアの再判定はしない。
- 完全対称な3すくみ（全試合2-1・得失0・POTG同数）は **1,1,1（全員同順位）** が正。実データで得失やPOTGに差があれば従来どおり順位がつく（それは正しい）。

### 次にやること
- [ ] A-3: capacity 実効化（③）

## 2026-06-24 — A-1: 試合結果のBO整合バリデーション（フィードバック⑤）

BO5で2-1・0-0・4-1、POTG 0-0 のような「あり得ない結果」が通っていた問題を厳格化。

### やったこと
- **純粋関数 `validateBoScore` / `validatePotg`**（`match-result.ts`・テスト24件追加）:
  - 奇数BO: 過半数先取で即終了。勝者=(best_of+1)/2 ちょうど・敗者0〜勝者-1・引分なし（BO5→3-0/3-1/3-2、BO3→2-0/2-1）。
  - 偶数BO: 全 best_of マップ消化＝合計は必ず best_of。引分=best_of/2同士（BO4→4-0/3-1/2-2、BO2→2-0/1-1）。
  - POTG: 毎マップ選出＝POTG合計＝総マップ数（両者スコア合計）と一致。
- **Server Action `reportResult`**: 旧「各チーム≤best_of」の緩いチェックを上記の厳格検証に置換。POTG検証は **tiebreakers に potg があるイベントだけ**適用（POTG欄を出さないイベントは 0/0 のまま通す）。
- **クライアント側**（matches-board）: 同じ純粋関数で保存前に弾き、理由をその場に表示（従来は無言で return していた）。
- DB設計書 3.15 に検証仕様を追記。lint/typecheck/test(216緑)/build 通過。

### 決めたこと（なぜ・壁打ち）
- **「過半数ちょうどで即終了」を厳格に強制**（奇数BO）。OW2の実態（先取したら試合終了）に忠実で、4-1のような不能スコアを弾ける。
- **偶数BOは全マップ消化**（合計=best_of）。偶数BOは「引分の目を残すため最後まで戦う」運用なので、1-0のような途中終了スコアはあり得ない。
- **POTG検証はpotg使用イベント限定**。UIのPOTG欄出し分けと整合させ、非使用イベントの正常入力を弾かない。

### 次にやること
- [ ] A-2: 順位3すくみ調査・修正（⑨）

## 2026-06-24 — 本戦フェーズ 実機確認（通し1回）とフィードバック整理

主催者編成・self応募・ブロック分け・対戦表・結果入力・順位表まで通しで実機確認。ダミー20人seed（`dev_seed_dummy_registrations_20.sql`・dummy20_）を投入して複数チームを編成。14件のフィードバックを得て、A(バグ)→B(機能不足)→C(UX)→D(文言) の優先で改善していく方針を確定。

### 検出したフィードバック（14件）と分類
- **A. バグ**
  - ⑤ 試合結果がBOと不整合（BO5で2-1や0-0が通る・POTG必須マップなのに0が通る）→ 結果バリデーション厳格化。ただし**偶数BO（引分けあり）イベントは引分けスコアを例外的に許可**。
  - ⑨ 3すくみ（A>B,B>C,C>A）なのに順位が決まる（同順位になるべき）→ standings ロジック調査・修正（実データ確認要）。
  - ③ チーム数上限(capacity)が効かない（応募者の6枠目応募・主催者の6チーム目作成・承認時の超過チェック無し）。
- **B. 機能不足**
  - ① チームスコア上限(team_score_cap)を主催者が設定するUIが無い（self応募で上限内に組む運用に必須）。
  - ⑧ 応募者から本戦以降（ブロック/対戦表/順位表）への閲覧導線が無い。
- **C. UX**
  - ② 応募者が他人のチームをD&Dできてしまい不安を与える（確定しなければ送信されないが要改善）。
  - ④ BO[n]表記をわかりやすく。⑦ 勝者強調が弱い。
  - ⑩ 「対戦表生成」と「対戦カード追加」を近くに配置。⑪ スコア入力デフォルトを空欄→0。
  - ⑫ チームが増えるとD&Dのカーソル移動が大変。⑬ 対戦表生成後もブロック画面でD&Dできて事故る。
- **D. 文言**
  - ⑥ 「予選」固定は不適切（総当たり≠予選。トーナメント進出があるときのみ予選表記）。

### 決めたこと（なぜ）
- **バグ最優先**。データ整合性・順位の正しさ・定員の実効性は信頼性に直結するため、UX/文言より先に固める。
- **⑭ 認識合わせ（記録のみ）**: 総当たりの各試合は1日完結とは限らない。長期イベントは練習→試合→練習→試合のサイクルがある。**本戦-5（スケジュール/リプレイ）のスコープに反映**する前提で記録。

### 次にやること
- [ ] A-1: 試合結果のBO整合バリデーション（⑤）
- [ ] A-2: 順位3すくみ調査・修正（⑨）
- [ ] A-3: capacity 実効化（③）
- [ ] B以降は上記の後

## 2026-06-23 — 本戦フェーズ PR-3d（BO設定：1試合のマップ数）

順位集計（3c）の壁打ちで判明したBO（Best of＝1試合のマップ数）設定を実装。スコア入力の上限をBOに連動させ、3a/2の後出し前提を回収。

### やったこと
- **マイグレーション 0018**: events に `group_best_of`（予選デフォルトBO）、matches に `best_of`（試合ごとのBO）。ともに default 3・CHECK 1〜15。**未適用 → Supabase SQL Editor で手動適用が必要**。
- **予選BO設定**: イベント作成/編集フォームに「本戦設定」fieldset を新設し「予選BO」を入力（schema.ts・actions.ts・events.ts に group_best_of を反映。新規/編集は parseEventFormData 共有）。
- **生成時にBO一括セット**: 総当たり生成・手動追加時に events.group_best_of を全試合の best_of へ載せる。
- **スコア上限のBO連動**: 結果入力のスコア欄 max を best_of に連動（固定20→best_of）。Server Action でも「各チーム ≤ best_of」を検証（緩め＝合計・過半数までは強制しない）。
- **対戦カードにBOバッジ表示**（BO3 等）。
- lint/typecheck/test（204緑）/build 通過。

### 決めたこと（なぜ・壁打ち）
- **BOは試合単位（matches.best_of）に持ちつつ、予選は生成時に events.group_best_of を一括セット**。これで「総当たりは全試合共通・決勝トーナメントは試合ごと」を1列で両立。決勝Tの試合ごと個別編集UIは本戦-5へ。
- **best_of は偶数も許容**（奇数=過半数先取で引分なし、偶数=BO2 等で1-1引分あり。OW2実態に合わせる）。
- **スコア上限連動は緩め**（入力上限を best_of にするだけ。合計・過半数の厳密検証はしない＝主催者の良識に任せる）。
- **group_best_of を変えても既存試合の best_of は変わらない**（再生成で反映＝割り切り。本戦-2の「チーム変えたら再生成」と同じ流儀）。

### 次にやること
- [ ] `0018_best_of_settings.sql` を Supabase SQL Editor で適用
- [ ] **本戦フェーズの実機確認を通しで1回**（チーム→承認→ブロック→対戦→結果→順位）。BO連動も確認
- [ ] 本戦-4（自動ブロック分け）／本戦-5（決勝トーナメント・試合ごとBO個別編集）

## 2026-06-23 — 本戦フェーズ PR-3c（順位集計・表示）

本戦の見せ場。結果（PR-3a）＋順位設定（PR-3b）が全部つながり、**ブロックごとの順位表が出る**。

### やったこと
- **Service `standings.ts`**（純粋関数・テスト10件）: 結果と順位設定から順位を集計。勝/敗/分・勝点（カスタム）・得失マップ差（全試合合計）・POTG数（全試合合計）→ ①勝点 ② tiebreakers の順で多段ソート。head_to_head は**同着チーム同士のミニリーグ勝点**、map_diff/potg は全試合合計で比較。全タイブレークで決まらなければ**同順位**（rank 共有）。
- **マイグレーション 0017**: match_results に `potg_a / potg_b`（int・0埋め・0〜99のCHECK）。**未適用 → Supabase SQL Editor で手動適用が必要**。
- **POTG入力**: reportResult に POTG を追加（winner と同様にスコアと並べて保存）。結果入力UIに**tiebreakers に potg があるイベントだけ**POTG欄を表示。
- **順位表UI**: `/matches` のブロックごとに順位表（順位・チーム・勝/分/敗・勝点・得失・(POTG)）。`ranking_enabled=false` なら非表示。勝者は対戦カードで強調表示。
- lint/typecheck/test（204緑）/build 通過。

### 決めたこと（なぜ・壁打ち）
- **集計はブロック単位・結果のある試合のみ**（未消化は無視＝途中段階でも順位が出る）。
- **head_to_head の3チーム以上同着は同着ミニリーグ勝点で比較**（リーグの定石。三すくみはミニ勝点同点→次の基準へ流れる）。引分の直接対決は決着つかず次の基準へ。
- **得失マップ差・POTGは全試合合計**（順位表に常時表示する得失列と一致。分かりやすさ優先）。得失は常に表示、POTGは potg 使用時のみ列表示。
- **完全同着は同順位表示**（1,1,3）。最終判断は主催者が手動で。
- POTGは「Aチーム○回・Bチーム△回」を数で持つ（potg_a/potg_b）。1マッチ＝複数マップでマップごとにPOTGが出る実態に合わせる。

### 別PRへ切り出した（壁打ちで判明）
- **BO設定（本戦-3d）**: matches.best_of（試合単位）。予選は生成時に「イベントの予選BO」を全試合一括、決勝Tは試合ごと。スコア入力上限のBO連動も。3cの順位集計には不要なため切り出し。

### 次にやること
- [ ] `0017_match_results_potg.sql` を Supabase SQL Editor で適用
- [ ] **実機確認（通しで1回）**: チーム→承認→ブロック→対戦→結果→順位。本戦フェーズの一区切り
- [ ] 本戦-3d（BO設定）／本戦-4（自動ブロック分け）／本戦-5（決勝トーナメント）

## 2026-06-23 — 本戦フェーズ PR-3b（順位設定：events拡張＋フォーム対応）

結果入力の基盤（PR-3a）に続き、順位を出すための**イベントごとの順位設定**を追加。順位の集計・表示は PR-3c。

### やったこと
- **マイグレーション 0016**: events に順位設定5列を追加。`ranking_enabled`（順位ON/OFF）/ `points_win`/`points_draw`/`points_loss`（勝点・0〜99のCHECK）/ `tiebreakers text[]`（タイブレーク優先順位・許可値CHECK）。**未適用 → Supabase SQL Editor で手動適用が必要**。
- **schema.ts 拡張**: 順位設定のZod検証を追加。勝点は0〜99の整数（大小制約なし）。tiebreakers はフォームのカンマ区切り文字列を順序付き配列に正規化し、許可値（head_to_head/map_diff/potg）のみ・重複なしを検証。
- **型定義**: types.ts（Row/Insert/Update）/ events.ts（EventEditableColumns）/ actions.ts（EventEditableValues・parseEventFormData）に5列を反映。新規・編集は parseEventFormData を**共有**するため両方に自動で効く（保存漏れなし）。
- **フォームUI**: event-form.tsx に「順位設定」fieldset を新設。`ranking_enabled` 親トグルで配下を出し分け（requireScoreと同型）。勝点3欄＋**タイブレークは「使う/使わない」2エリアのD&D**（dnd-kit）。使うエリアの上から順＝優先順位を hidden input のカンマ区切りで送信（DBの tiebreakers[] と直接対応）。編集ページの defaults にも5列を反映。
- **テスト**: schema.test.ts に順位設定8件追加（既定値・勝点範囲・tiebreakers正規化/重複/不正値）。
- lint/typecheck/test（194緑）/build 通過。

### 決めたこと（なぜ・壁打ち）
- **順位設定だけ独立セクションで追加**（進行形式 entry_type/team_formation のフォーム化は別PR）。順位設定は進行形式の一部だが、進行形式フォームごと作ると肥大化するため切り離した。
- **tiebreakers は text[] 配列で優先順位を表現**（先頭ほど優先）。順序変更が配列の並べ替えで済み、集計も順に評価すればよい。
- **タイブレークUIは「使う/使わない」2エリアのD&D**。所属エリア＝使う/使わない、使うエリア内の順＝優先順位が視覚的に明確で、配列と素直に対応（groups の D&D 資産を流用）。
- **勝点は0〜99の整数・大小制約なし**（柔軟性優先。変な設定は主催者の自己責任、過大入力だけ防ぐ）。
- 順位設定は下書き/公開とも任意（順位を使わないイベントもあるため公開時必須化しない）。

### 次にやること
- [ ] `0016_event_ranking_settings.sql` を Supabase SQL Editor で適用
- [ ] 本戦-3c: 順位集計（カスタム勝点＋多段タイブレーク）＋順位表表示。POTG取得チーム等の追加入力列も match_results に追加
- [ ] 実機確認（3c まで揃ったら：チーム→承認→ブロック→対戦→結果→順位 を通しで）

## 2026-06-23 — 本戦フェーズ PR-3a（試合結果入力の基盤）

予選対戦表（PR-2）に続き、各試合にスコア（取マップ数）を入力して勝者を記録する基盤を実装。順位機能は設定依存が大きいと判明したため本戦-3 を 3分割（3a結果基盤 / 3b順位設定 / 3c順位集計・表示）し、本PRは 3a。

### やったこと
- **Service `match-result.ts`**（純粋関数・テスト4件）: スコアから勝者を判定（同点=引分=null）。winner はクライアントから受け取らずこの関数でサーバーが算出（マスアサインメント対策）。
- **RLS 0015**: match_results のポリシー整備。閲覧は主催者 or 参加者。書き込みは「主催者 or 対戦両チームの代表（captain）」。代表判定は `match_results → matches → teams → registrations` の多段になるため security definer 関数 `can_report_match` に切り出し（再帰評価回避）。**未適用 → Supabase SQL Editor で手動適用が必要**。
- **結果入力UI**: `/events/[id]/matches` の各試合カードに統合。スコア入力 → winner自動判定 → 表示（勝者を強調・引分表示）。修正・取り消し可。入力できるのは主催者（全試合）＋対戦両チーム代表（自チームが絡む試合のみ）。
- **再生成の結果保護**（本戦-2 の積み残しを回収）: 「対戦表を生成」は結果が入っている試合を残し、結果なしの試合だけ削除して足りないペアを追加する方式に変更。誤って結果を消さない。
- **防御**: winner_team_id / reported_by はサーバー固定。team_a/team_b が null（チーム外れ）の試合は結果入力不可。スコアは Zod で非負整数・上限20。
- lint/typecheck/test（186緑）/build 通過。

### 決めたこと（なぜ・壁打ち）
- **順位機能は設定依存が大きい**（順位を争うか否か・勝点内訳カスタム・タイブレーク優先順位＝直接対決/得失マップ差/POTG）。1PRに詰めると巨大化＋イベント作成フォーム改修まで波及するため 3分割。
- **本戦-3a は結果入力の基盤に集中・順位は出さない**。スコアは取マップ数、引分は winner=null で保存。
- **POTG等の追加列は 3c（タイブレーク実装時）に追加**（YAGNI。3a で使わない列を先走らせない）。
- 結果入力は「自チームが絡む試合のみ」代表に開放（他チーム同士は不可）。

### 次にやること
- [ ] `0015_match_results_rls.sql` を Supabase SQL Editor で適用
- [ ] 本戦-3b: events に順位設定（順位ON/OFF・勝点カスタム・タイブレーク優先順位）追加＋イベント作成/編集フォーム対応
- [ ] 本戦-3c: 順位集計（カスタム勝点＋多段タイブレーク）＋順位表表示＋POTG等の追加入力
- [ ] 実機確認（3c まで揃ったら：チーム→承認→ブロック→対戦→結果→順位 を通しで）

## 2026-06-23 — 本戦フェーズ PR-2（予選対戦表：総当たり生成＋手動追加/削除）

予選ブロック分け（PR-1）に続き、ブロック内総当たりの対戦カードを生成・管理する画面を実装。結果入力・順位は本戦-3、日時・配信・リプレイは本戦-5。

### やったこと
- **Service `round-robin.ts`**（純粋関数・テスト9件）: チーム id 配列から総当たり全ペア（N×(N-1)/2）を生成。順不同の重複判定 `pairKey` / `pairExists` も同居。
- **RLS 0014**: matches のポリシー整備（groups 0013 と同じ流儀。操作は主催者・閲覧は同イベント参加者）。**未適用 → Supabase SQL Editor で手動適用が必要**。
- **対戦表画面 `/events/[id]/matches`**: ブロックごとに「対戦表を生成」（既存を全削除→作り直し・確認ダイアログ）、手動で1試合追加（同ブロックのチームをプルダウン選択）、試合削除。試合は生成順で表示。
- **重複防止**: アプリ層で「同ブロックに同じペア（順不同）が無いか」を確認して弾く（DB制約なし＝意図的な再戦は手動で作れる余地を残す＝壁打ち確定）。
- **チーム消失の割り切り**: matches.team_a/b は on delete set null のまま。片方 null のカードは「未定/削除済み」と赤表示し、主催者に再生成を促す。
- **導線**: /groups ⇄ /matches を相互リンク。
- lint/typecheck/test（182緑）/build 通過。

### 決めたこと（なぜ・壁打ち）
- **生成はブロックごと・再生成は全削除→作り直し**（本戦-2 時点では結果概念が無いため単純化。結果保護は本戦-3 で追加）。
- **カード入れ替えは D&D を使わず「削除→追加」で代替**。総当たりは本来そのブロックのメンバーで全ペアが自動決定するため入れ替えはレア。D&D（試合内2スロットを狙う＋重複/欠けの整合）の複雑さを持ち込まない判断。
- **未割当チームは生成対象外**（プールに残ったチームは対戦に入らない）。**1チーム以下のブロックは0試合**で静かに通す。
- 本戦-2 は対戦生成に絞る（日時・配信・リプレイ・結果・順位は後続）。

### 次にやること
- [ ] `0014_matches_rls.sql` を Supabase SQL Editor で適用
- [ ] 本戦-3: 結果入力（主催者＋対戦両チーム代表）＋順位表（集計表示）。再生成時の結果保護もここで。
- [ ] 実機確認（本戦-3 まで揃ったら：チーム→承認→ブロック→対戦→結果→順位 を通しで）

## 2026-06-23 — 本戦フェーズ PR-1（予選ブロック分け：作成＋D&D振り分け）

チーム編成（organizer/self）が完成したので、本戦フェーズに着手。最初のピースは「承認済みチームを予選ブロックへ振り分ける」編成。対戦生成・結果・順位・決勝トーナメントは後続。

### やったこと
- **RLS 0013**: groups / group_teams のポリシーを整備（チーム編成 0010/0011 と同じ流儀）。操作（作成・改名・削除・振り分け）は主催者のみ、閲覧は「主催者 or 同イベント参加者」に開放（0011 の `is_event_participant` を再利用）。**未適用 → Supabase SQL Editor で手動適用が必要**。
- **ブロックのCRUD＋D&D振り分け**: `/events/[id]/groups` を新設。承認済み（approved）チームを未割当プールに出し、D&D で A/B/C… ブロックへ振り分け。移動モデル（別ブロックへ移すと元から消える＝1チーム1ブロック）。ブロック削除で中身はプールへ戻る（group_teams の cascade）。
- **チーム平均スコア表示**: `lib/services/team-score.ts` の `teamScore` を再利用し、各チームの出場メンバー平均を表示（require_score=false なら非表示）。
- **導線**: チーム編成画面（/teams）のヘッダーに「予選ブロック分けへ →」リンク（主催者のみ）。
- lint/typecheck/test（173緑）/build 通過。

### 決めたこと（なぜ・壁打ち）
- **「ブロック」＝既存 `groups` テーブル**（新概念を足さない）。主催者が必要な数だけ作成、ブロック数・振り分け人数に**上限なし**（割り切れず偏ってOK）。バリデーションが減りシンプル。
- **単発イベント（予選なし・総当たりのみ）は「ブロック1個」で自然表現**。専用対応は作らない。
- **振り分け対象は approved チームのみ**（pending/rejected は本戦に進まない）。
- **主催者はいつでもブロック分け画面を触れる**（event.status で縛らない。締切前でも後でも可）。
- **自動ブロック分け（スコアで高/中/低を散らすスネークドラフト）は後続PR**。まず手動D&Dを土台にし、自動は叩き台として乗せる（公平性は最終的に主催者が手動調整）。
- 認可は前日言語化した「操作系はif＋RLS二重・閲覧系はRLS主役」（実装ガイドライン 3.1）に忠実。

### 次にやること
- [ ] `0013_groups_rls.sql` を Supabase SQL Editor で適用
- [ ] 実機で「主催者がブロック作成→承認済みチームを振り分け→別ブロックへ移動」「参加者は閲覧のみ」を確認
- [ ] 本戦-2: グループ内総当たりの対戦カード自動生成＋手動微調整（matches phase=group）
- [ ] 本戦-3: 結果入力（主催者＋対戦両チーム代表）＋順位表（集計表示）

## 2026-06-23 — 設計メモ: 操作系と閲覧系で認可の主役を変える（RLSの使い分け）

PR-3b 完了後の振り返りで言語化した、本アプリの認可設計の根幹。実装ガイドライン 3.1 に規約として反映した（本エントリは経緯の記録）。

### 決めたこと（なぜ）
- 「アプリ層＋DB層RLSの2層で守る」は全機能共通だが、**どちらが主役かは操作系/閲覧系で非対称**になる。守る対象の数が違うため。
- **操作系（UPDATE等）はアプリ層の if が主役**。守る対象はその操作の1件だけなので `if (organizer_id !== userId)` で十分。早期に弾いて**親切なエラー文言を返す**のがアプリ層の役目。RLS は「if を書き忘れた／直接APIを叩かれた」場合の最終防衛（保険）。
- **閲覧系（SELECT）は RLS が主役**。守る対象は「見えうる行の全件それぞれ」。これをアプリ層でやると「全件取得→フィルタ」になり、(1) 危険な行が一瞬アプリに乗る＝漏洩経路、(2) 画面ごとにフィルタを書く＝書き忘れ穴、(3) ページング不能＝遅い、で破綻する。だから**判定をWHERE句（RLS）に押し込み、危険な行をそもそもDBから出さない**。速さより安全が主目的。
- RLS内で自己参照が再帰する判定は **security definer 関数に切り出す**（`is_event_participant` / `can_self_captain` 等。0011/0012 で実践）。

### 背景（具体例）
- 操作系: `approveTeam` は `requireOrganizer`（if）で弾きつつ、teams/events の UPDATE は 0010/0004 のRLSでも主催者限定。
- 閲覧系: PR-3a の 0011 は registrations/teams/team_members の SELECT を「本人 or 主催者 or 同イベント参加者」にRLSで開放。アプリ層は可視性を絞らず素直にクエリを投げるだけ。

## 2026-06-22 — self応募 PR-3b（確定・主催者の承認・capacity排他制御）

self応募の最後のピース。PR-3a で「応募者が編成を試算できる（保存しない）」状態を作った。本PRはその試算を **確定して主催者の承認に乗せる書き込みフロー** を実装し、応募フロー＋チーム編成を完成させた。

### やったこと
- **RLS 0012**: teams / team_members に self 応募者向けの INSERT/DELETE ポリシーを追加（主催者の 0010 と並存）。判定は security definer 関数 3 本に切り出し（`can_self_captain` / `is_approved_registration` / `is_own_pending_self_team`）、自己参照ポリシーの再帰評価を回避。**未適用 → Supabase SQL Editor で手動適用が必要**。
- **self確定**: `submitSelfTeam`（応募者本人が叩く Server Action）。試算チームを `teams(status='pending')` ＋ `team_members` として一括INSERT。代表＝確定者本人を `captain_registration_id` ／ `is_representative` に設定。Supabase JS はトランザクションを張れないため、members 失敗時は作成した team を補償削除。
- **取り下げ**: `cancelSelfTeam`（代表本人・pending のみ）。
- **主催者の承認/却下**: `approveTeam` / `rejectTeam`。承認時に **capacity（=チーム数）を排他カウント**（events の version 条件付きUPDATE）。満員/競合は弾く。status 更新が競合したらカウントを補償的に戻す。却下は pending を rejected にするだけ（カウント不変）。
- **UI**: 編成画面上部に主催者向け「承認待ちのチーム応募」セクション（承認/却下）。応募者の試算モードに「このチームで確定」バー（シミュレーション枠）＋自分が代表の確定チームの取り下げボタン。チームカードに承認状態バッジ（承認待ち/承認済み/却下）。
- lint/typecheck/test（173緑）/build 通過。

### 決めたこと（なぜ）
- **capacity カウントは承認（approved）時**（DB設計7章の方針を確定へ）。定員＝「成立チーム数」なので、未承認の pending を数えると「申請しただけで枠を食う」副作用と却下時の戻し処理が増える。pending は枠を確保しない。
- **self確定の対象は `team_formation='self'` のイベント（self/team/mixed）の approved 応募者全員**。`entry_type`・`wants_matching` では絞らない。理由＝あっせん希望者(wants_matching=true)も誘われて self でチームを組むことが実運用で起こるため。二重所属は `UNIQUE(registration_id)` が構造的に防ぐ。
- **代理確定OK・通知/異議申立てなし**（合意はアプリ外Discord）。RLSで「確定者本人が代表かつメンバーに含まれる」を必須化し、最低限の巻き込み防止のみ担保。通知は後続PRへ切り出し。
- **承認は主催者の `events` UPDATE（0004ポリシー）で排他**。service_role を使わず、主催者RLSの範囲で version 条件付きUPDATEを行う。最終防衛は CHECK(current_count <= capacity) と UNIQUE(registration_id)。

### 次にやること
- [ ] `0012_self_team_submit.sql` を Supabase SQL Editor で適用
- [ ] 実機で「別アカウント（応募者）で確定→主催者で承認→定員カウント」「満員時に承認が弾かれる」を確認
- [ ] self確定時のメンバーへの通知・異議申立て（巻き込み防止の強化）
- [ ] 本戦機能（グループ/対戦表）。チーム編成（organizer/self）はこれで完成

## 2026-06-22 — self応募 PR-3a（応募者への閲覧開放＋試算モード）

self応募（応募者が自分でチームを組んで応募）の第一歩。OSL実態（代表者が Google フォームで提出。応募データは全共有）に倣い、まず「応募者も応募者一覧・チーム編成画面を見られ、自由に編成を試算できる（保存しない）」状態を作る。確定・承認・排他制御は PR-3b。

### やったこと
- **RLS 0011**: registrations / teams / team_members の SELECT を「本人＋主催者」→「**＋同イベントの参加者（応募者）**」に緩和。再帰評価を避けるため `is_event_participant(event_id, uid)` を security definer 関数で実装。**未適用 → Supabase SQL Editor で手動適用が必要**。
- **応募者一覧を応募者に開放**: 認証ガードを「主催者 or 応募者なら閲覧可、それ以外404」に変更。`RegistrationRow` に `canManage`（主催者のみ）を追加し、承認/却下・スコア上書きは主催者だけに表示。応募者には「参加者として閲覧中」バナー。
- **チーム編成画面を応募者に開放＋試算モード**: `TeamsBoard` に `readOnly` を追加。試算モードでは D&D で自由に組み替えられる（チーム平均がリアルタイム算出される）が、**Server Action を呼ばず保存しない**。チーム作成欄・チーム削除・✕解除・交代ボタンを非表示。「試算モード・変更は保存されません」バナー。
- **導線**: イベント詳細の「応募済み」表示に「応募者一覧を見る」「チーム編成を試算する」リンクを追加。
- lint/typecheck/test（173緑）/build 通過。

### 決めたこと（なぜ）
- **公開範囲は算出根拠含め全公開・全イベント**（壁打ち確定）。OSL は Google フォーム提出物を全共有していた運用に忠実。プライバシーより編成の実用性・透明性を優先（リスクは認識済み）。
- **試算は保存しない／確定だけ保存**（PR-3b）。合意はアプリ外（Discord）で取るため、合意前の編成を DB に残さない。self応募では「確定/キャンセル」モデルが必然（PR-2 の即時保存とは逆）。
- **試算モードでも D&D は可能**（read-only=閲覧専用ではなく「保存しない編成」）。主催者と同じ画面でスコア試算する、という構想に忠実。

### 次にやること
- [ ] `0011_self_application_visibility.sql` を Supabase SQL Editor で適用
- [ ] 実機で「別アカウント（応募者）で応募者一覧・編成試算が見える／保存されない」を確認
- [ ] PR-3b: 確定（teams pending 作成）・主催者の承認・capacity 排他制御（DB設計5章）

## 2026-06-22 — チーム編成 PR-2（レギュラー/リザーブ＋交代シミュレーション）

チーム編成の本丸。OSL運営が最も苦労した「リザーブを誰と交代すれば上限を超えないか」を自動化。

### やったこと
- **チームカードを2ゾーン化**（出場=レギュラー／リザーブ）。ゾーン間も D&D で移動（`team_members.position` 切替）。droppable id を `${teamId}:regular` / `${teamId}:reserve` の複合キーに。
- **チーム平均は出場（regular）メンバーのみで算出**（PR-1 の全員仮平均を厳密化）。`team_score_cap` 超過を色分け警告。出場人数を「出場 N/team_size」表示（超過は警告のみ・**ブロックなし**）。
- **交代シミュレーション**: リザーブをクリック → 全レギュラー総当たりで「誰と交代すれば上限内か」を提示 → **「交代する」でワンクリック実行**（position 入れ替え）。
- Repository: `updateMember`（position/role 任意更新）／`swapMemberPositions`（2件UPDATE・失敗時ロールバック）／`findMemberWithEventOwner`（所有権・同一チーム確認用）。
- Server Action: `updateMember`／`swapMembers`（2メンバーが同一チーム・同一主催者・out=regular/in=reserve を確認）。Zod `updateMemberSchema`／`swapMembersSchema`。

#### 実機確認のフィードバック反映（同PR内）
- **推定ランク表示を削除**: カードの「ダイヤ1相当」等（`scoreToRankLabel`）を撤去。スコア数値があれば推定ランクは無価値、という判断。希望ロールは残す。
- **role_swap 不可なら出場ゾーンをロール行（タンク/DPS/サポート）に分割**: 担当ロールが分かるように。ロール行へドロップすると `team_members.role` が確定。人数は自由（タンク2人も可）・超過は警告のみ。role_swap 可は従来どおりフラット表示。droppable id を `${teamId}:regular:${role}` の3階層に拡張。
- **即時保存＋「✓ 保存しました」フィードバック**: 「確定/キャンセル」モデルは採らず（下書き状態管理・競合で複雑化するため）、即時保存のまま操作成功時に右下トーストを2秒表示して安心感を出す。
- `findEventById` の games JOIN に `team_size` を追加（出場人数上限の表示用）。
- Service `team-score.ts` は PR-1 で実装済み（`teamScore`/`isOverCap`/`swapCandidates`）。ロジックは流用、テスト17件そのまま緑。

### 決めたこと（なぜ）
- **リザーブはロール無概念＝どのロールもできる控え**（OSL実運用）。→ 交代候補は同ロール限定ではなく**全レギュラー総当たり**が正。保留メモ（プロト=同ロール限定 vs 確定擬似コード=総当たり）はこれで決着。要件/DB設計に明記。
- **リザーブも `team_members.role` は形式上保持**（NOT NULL の便宜）→ **スキーマ変更なし**でPR-2完結。
- **出場枠の人数上限はブロックせず警告のみ**（PR-1 の「希望ロール逸れも警告しない＝運営の自由を尊重」と一貫。編成中の柔軟さを優先）。
- **交代はワンクリック実行まで**（提示だけだと手でD&Dし直しになり「OSLの手作業自動化」の価値が半減）。

### 次にやること
- [ ] 実機で2ゾーンD&D・交代シミュレーション・ワンクリック交代を確認
- [ ] PR-3: self 応募の承認フロー（teams.status・代表・capacity 排他制御）

## 2026-06-22 — 修正: チーム作成が即座に反映されない（PR-1 フォローアップ）

実機確認で発覚。「+チームを追加」押下後、リロードするまでチームカードが出なかった。

### やったこと
- 原因: 作成だけ楽観更新を省き `revalidatePath` 任せにしていたが、revalidate はクライアント state（useState の teams）を更新しないため、リロードまで反映されなかった（割当・解除・削除は楽観更新済みで作成だけ不整合）。
- `createTeam` Action の戻り値に作成チームの `teamId` を追加（`CreateTeamState`）。
- クライアントは返った id でチームカードを即座に楽観追加するよう修正。
- lint/typecheck/test（173 緑）/build 通過。

### 決めたこと（なぜ）
- **作成も他操作と同じ楽観更新に揃える**。Server Action の revalidate は Server Component の再取得用で、クライアント state には効かない。D&D ボードは state 駆動なので、操作の即時反映は楽観更新で統一する。

## 2026-06-22 — チーム編成 PR-1（organizer 振り分け＋D&D）

応募フロー完成を受け、本命のチーム編成に着手。PR-1 は「運営が応募者をチームへ D&D で割り当てる」基盤。設計ドキュメント（要件 3.1.2 / DB設計 4.2-4.3）は確定済みで、テーブル・enum も 0001 で定義済みだったため、実装は UI とロジックが中心。

### やったこと
- **編成画面 `/events/[id]/teams`**（主催者専用。registrations ページと同型の認証ガード = 未ログインは /login、本人以外は 404）。
- **D&D ボード**（`@dnd-kit` 導入）。左=未割当プール（approved の応募）／右=チーム群。**カード全体ドラッグ**（ハンドルなし。activation distance=6px で「その場クリック（✕・削除ボタン）」と両立）。楽観更新＋失敗時ロールバック。
- **判断材料をカード表示**: 希望ロール（第1→2→3）・ランク帯（`scoreToRankLabel`）・実効スコア（override 優先）。
- **チーム平均のリアルタイム表示**＋上限（team_score_cap）超過の色分け。
- **require_score=false 出し分け**: スコア/ランク/平均を丸ごと非表示（registrations の showScore と同型）。
- **Service**: `lib/services/team-score.ts` に `teamScore`/`effectiveScore`/`isOverCap`/`swapCandidates` を純粋関数で実装（prototype/data.ts のロジックを昇格・確定仕様に整合）。ユニットテスト +17。
- **Repository** `lib/repositories/teams.ts`、**Server Action** `actions.ts`（createTeam/renameTeam/deleteTeam/assignMember/unassignMember）、**Zod** `schema.ts`。
- **RLS `0010_teams_policies.sql`**（teams/team_members とも「対象イベント主催者のみ CRUD」。0006 と同じ EXISTS。team_members は teams 経由の2段）。**未適用 → Supabase SQL Editor で手動適用が必要**。
- イベント詳細に「チーム編成」導線を追加。lint/typecheck/test（173 緑）/build すべて通過。

### 決めたこと（なぜ）
- **PR を3つに刻む**（スコアリングと同思想）。PR-1: organizer 振り分け＋D&D ／ PR-2: レギュラー/リザーブ＋cap判定＋交代シミュレーション ／ PR-3: self 応募の承認フロー。リザーブ枠は cap 判定と不可分なため PR-2 へ（PR-1 で2枠だけ作っても価値が出ない）。
- **希望ロール逸れの警告は出さない**（あくまで希望、という運営判断）。
- **チーム平均は保存せず常に算出**（DB設計 4.2。保存すると交代のたびに手更新が要る）。PR-1 は全所属者の平均を仮表示し、PR-2 で regular 限定へ厳密化。
- **割当は insert→失敗時 move**（UNIQUE(registration_id) で1応募1チーム。別チームへのドラッグは team_id 更新）。

### 次にやること
- [ ] `0010_teams_policies.sql` を Supabase SQL Editor で適用
- [ ] 実機で D&D 動作・チーム平均・require_score 出し分けを確認
- [ ] PR-2: レギュラー/リザーブ 2枠 D&D ＋ team_score_cap 判定 ＋ 交代シミュレーション
  - 保留メモ: prototype の `swapCandidates` は同ロール限定だが確定擬似コードは全レギュラー総当たり。PR-2 着手時にどちらが実運用に正しいか確認しドキュメント側を更新。
- [ ] PR-3: self 応募の承認フロー（teams.status・代表・capacity 排他制御）

## 2026-06-22 — 実機確認の修正（応募者名の表示・モーダル文言）

別アカウントでの応募フロー実機確認で見つかった2点を修正。

### やったこと
- **A: 応募者名が「-」になる問題を修正**。`users` は 0001 で RLS 有効・SELECT ポリシー未整備（デフォルト拒否）だったため、registrations→users の JOIN で discord_name 等が返らず一覧で名前が出なかった。`0009` で users に SELECT ポリシー（authenticated は参照可）を追加。
- **B: 詳細モーダルの未認定文言**から「（縦軸）（横軸）」を削除（前回③でフォーム側だけ消し、registration-row 側が消し漏れだった）。
- テストは 156 緑のまま（RLSマイグレーションと文言のみ）。

### 実機確認で確認できたこと（OK）
- 希望ロール3つが順位表示（「希望 DPS→タンク→サポート」）。
- スコア算出・表示（ダイヤ3×9 → 23）。詳細モーダルで算出根拠をランク名表示。
- 承認/却下が機能（却下で「不参加」表示になることを確認）。

### 決めたこと（なぜ）
- **users の SELECT は authenticated に開放**: 表示名・アバター・Battle Tag は表示用の公開情報（DB設計書6章）。JOIN で名前を出すのに必要。更新は別途（本人のみ）。

### 次にやること
- [ ] 0009 適用後、応募者一覧で名前が出ることを再確認
- [ ] チーム編成・交代シミュレーション（final_score を使う本命）
- [ ] パターン②（ランク収集×算出なし）

## 2026-06-22 — 応募フロー修正（希望ロール第1〜第3・スコア丸め・文言）

実機確認のフィードバックを反映。3点修正。

### やったこと
- **① 希望ロールを第1〜第3に**（実運用: 全員が第1希望に就けない）。`registrations` に `preferred_role_1/2/3` を追加（0008）。応募フォームは第1・第2を選ぶと**第3は残り1つを自動決定**（`deriveThirdRole` 純粋関数）。第1=第2は送信不可。応募者一覧は「希望 タンク→DPS→サポート」と順位表示。`preferred_role`（旧・単体）は第1希望のミラーとして残し後方互換。
- **② スコアを小数第1位に丸めて保存**（小数第2位を四捨五入）。`scoring.ts` の `calcScore` で individual/final を `round1`。保存値・表示・振り分けを一貫（例 70/3→23.3）。
- **③ 未認定の選択肢から「（縦軸）（横軸）」の文言を削除**（例示だったため）。
- types.ts 手動更新（preferred_role_1/2/3）。DB設計書も追記。
- テスト +6（計156 緑）: round1（割り切れない平均の丸め）／deriveThirdRole（自動決定・同一/未選択でnull）／schema の第1〜第3相異検証・action の3ロール保存。

### 決めたこと（なぜ）
- **第3希望も3カラムで保存**（自動算出値も明示保存）。チーム編成で「第何希望に就けたか」を集計・表示しやすい。
- **丸めは算出時点**（表示だけでなく保存値も）。振り分け・チーム平均が表示と食い違わないように。
- **チーム編成は今回スコープ外**（認識合わせ）。応募＝参加表明まで。チーム編成（自分で組む/主催者が組む）は teams/team_members を使う別フェーズ。

### 次にやること
- [ ] 0008 適用後、別アカで応募の実機確認（希望ロール3つ・スコア算出・承認・上書き）
- [ ] チーム編成・交代シミュレーション（応募→チーム化、final_score を使う本命）
- [ ] パターン②（ランク収集×算出なし）

## 2026-06-21 — 応募者一覧のスコア表示＋運営上書き（スコアあり応募 PR-E）

応募者一覧に算出スコアを表示し、詳細モーダルで算出根拠を確認しつつ運営がスコアを上書き（誤入力修正）できるようにした。

### やったこと
- **Repository**: `listRegistrationsByEvent` にスコア列（preferred_role/individual_score/final_score/organizer_override_score/score_breakdown）を追加。`setOverrideScore`（organizer_override_score の設定/解除）を追加。
- **Action** `overrideRegistrationScore`: 主催者のみ（承認/却下と同じ2テーブル跨ぎ所有権確認＝IDOR）。空文字でクリア（算出値に戻す）、それ以外は0以上の数値を検証。算出元のランク・score_breakdown は保持し最終スコアだけ上書き。
- **UI** 応募者一覧を `RegistrationRow`（client）に刷新: スコア表示（override優先＝振り分け実効値）＋詳細モーダル。モーダルは score_breakdown を「ダイヤ3 / 未認定」のようにランク名で表示（`scoreToRankLabel` 逆引き）＋補完方式＋ボーナス＋上書き入力。承認/却下も同コンポーネントに統合（旧 decide-buttons は廃止）。
- **スコアレス出し分け**: require_score=false のイベントはスコア列・詳細・上書きを出さない（算出してないので無意味）。
- **Service** `overwatch-ranks.ts`: `scoreToRankLabel`（スコア→ランク名逆引き。補完中間値は「○○相当」）を追加。
- テスト +9（計150 緑）: 逆引き／overrideRegistrationScore 結合（IDOR・値検証・クリア・成功）。
- ブラウザ実機確認: 応募者一覧ページがエラーなく表示（応募0件の空状態）。

### 決めたこと（なぜ）
- **上書きは organizer_override_score**: 計算元ランクを保持し最終スコアだけ上書き。根拠（score_breakdown）を壊さず、振り分け・平均では override を優先（設計どおり）。
- **モーダルで根拠を見せてから上書き**: 「なぜこのスコアか」を理解した上での修正に。誤入力修正の確実性が上がる。
- **スコアレスはスコアを出さない**: 算出しないイベントにスコア列は無意味。require_score で出し分け。
- **パターン②（ランク収集だが算出しない）は別PR**: スコアリング設計.md に記録。collect_rank フラグ追加＋応募フォーム分岐＋一覧ランク表示が要るため独立させる。

### 次にやること
- [ ] 明日: 別 Discord アカウントで応募フロー実機確認（スコアあり/なし両方・承認・上書き）
- [ ] パターン②（ランク収集×算出なし）の設計＋実装
- [ ] チーム編成・交代シミュレーション（final_score を使う本命機能）

## 2026-06-21 — スコアあり応募フォーム＋算出スナップショット（スコアあり応募 PR-D・完）

スコアあり応募の総仕上げ。PR-A（マスタ）・PR-B（算出）・PR-C（設定）が全部つながり、応募時にランクを入力 → スコア算出 → registrations へスナップショット保存できるようになった。

### やったこと
- **専用ページ** `/events/[id]/apply`（require_score=true のイベント用）。ガード: 未ログイン→/login、主催者/下書き/スコアなし/応募済み→詳細へリダイレクト。
- **応募フォーム**（client）: 希望ロール選択＋ランクグリッド（各セル=単一ドロップダウン、40段階を帯ごとに optgroup＋「未認定」）。role_swap=true は3ロール、false は希望ロール1つ分を表示。ボーナス有効時は peak 到達選択。
- **Service** `scored-application.ts`: フォームのセル文字列→Cellグリッド変換、対象ロール決定、peak 検証（純粋関数）。
- **Repository** `insertRegistration` を拡張: preferred_role / individual_score / final_score / score_breakdown を受ける（スコアなし応募と共有。未指定は null）。
- **Action** `registerWithScore`: 認可（主催者不可・公開中・require_score限定・重複）→ 希望ロール/peak を Zod 検証 → グリッドを formData から parse → **calcScore（PR-B）で算出** → registrations にスナップショット（**user_id/status はサーバー固定**）。score_breakdown に算出根拠＋入力グリッドを保存。
- **詳細ページ**: require_score=true なら「応募フォームへ」リンク、false なら従来の即時応募ボタンに出し分け。
- テスト +17（計141 緑）: scored-application 単体／registerWithScore 結合（なりすまし防止=user_id固定・IDOR・require_score限定・重複・role_swap両分岐の算出値・ボーナス・全未認定null）。
- ブラウザ実機確認（単一アカウント範囲）: apply ページの主催者→詳細リダイレクト、詳細の管理表示。

### 決めたこと（なぜ）
- **専用ページ**: グリッド入力は項目が多く、詳細ページに混ぜると重い。応募に集中できる /apply に分離。
- **ランクセルは単一ドロップダウン＋未認定選択肢**: 最大9セルでも画面が破綻せず実装が素直。帯ごと optgroup で探しやすく。
- **insertRegistration を共有拡張**: スコアなし/ありで応募の骨格は同じ。scored 系を任意引数にして1関数に集約。
- **算出は応募時に確定しスナップショット**: 後のランク変動・マスタ変更で過去記録が変わらないよう score_breakdown に根拠も保存。
- **単一アカウント検証の限界**: 主催者≠応募者が作れず、applicant 向けグリッド応募の実機通しは未確認。算出・スナップショット・IDOR の中核は結合テストで担保。

### 次にやること（スコアあり応募は一区切り）
- [ ] PR-E（任意）: 応募者一覧でのスコア表示・運営上書き（organizer_override_score）
- [ ] 別アカウントでの応募フロー実機確認（スコアあり/なし両方）
- [ ] チーム編成・交代シミュレーション（final_score を使う本命機能）

## 2026-06-21 — イベントのスコアリング設定（階層導線）（スコアあり応募 PR-C）

主催者がイベント作成/編集時に、未認定の補完方式・スコア計算の有無・ボーナスを設定できるようにした。

### やったこと
- **マイグレーション 0007**（手動適用）: `uncertified_handling` enum（fill_by_role/fill_by_season/exclude）を新規作成し、events に同カラム追加（既定 exclude）。
- **types.ts を手動更新**: 新 enum と events.uncertified_handling を Row/Insert/Update/Enums/Constants に追記（Supabase CLI 未導入のため手作業）。
- **schema.ts**: `requireScore`（既定 true）/`uncertifiedHandling`（enum・既定 exclude）を受理。
- **EventForm を階層導線に**: 「個人スコアを計算する」親トグル → ON のとき申告シーズン数・未認定方式・ロールスワップ・「到達ボーナスを使う」孫トグルを表示 → ボーナス ON のとき加点欄を表示。useState で出し分け。
- **actions/Repository**: parseEventFormData に require_score / uncertified_handling を追加。編集の許可カラム（EventEditableColumns）と編集ページ defaultValues も更新。
- テスト +5（計124 緑）: requireScore 既定/false、uncertifiedHandling 3方式・既定・不正値。
- ブラウザ実機確認: 親OFFで子が全消え／親ON＋ボーナスONで加点欄出現／未認定 select の3方式。

### 決めたこと（なぜ）
- **未認定方式は enum 型**: 3方式で確定し増える見込みが薄いため、既存 enum 群と統一して型安全に。
- **スコア計算の有無は既存 require_score で表現**: 新カラムを増やさず、「計算する→配下を出す」の親に流用。
- **ボーナス有効化は専用カラムを足さない**: bonus_* の値（0=オフ）で十分。フォームのトグルは UI 上の出し分けのみ（保存値は加点数）。
- **types.ts は手動更新**: CLI 未導入のため。マイグレーションと手で整合を取り、将来 CLI 導入時に再生成で照合。

### 次にやること
- [ ] PR-D: スコアあり応募フォーム（ランクグリッド入力・希望ロール・未認定選択）＋ calcScore 適用 → registrations にスナップショット

## 2026-06-21 — スコア算出 Service（スコアあり応募 PR-B）

スコア算出ロジックを純粋関数として実装し、網羅テストで固定した。UI・DB には触れず、ロジックだけを確定させる回。

### やったこと
- 端ケースを壁打ちで確定し、スコアリング設計.md の「未確定」を確定仕様に更新:
  - 縦軸補完で同ロール全シーズン未認定 → その行を除外／横軸補完で同シーズン全ロール未認定 → その列を除外。
  - 除外後に有効値ゼロ（全未認定）→ base=null（スコアなし）。
  - role_swap=false で希望ロール未認定 → 応募可・score=null（運営が手動振り分け）。
- `src/lib/services/scoring.ts`: `calcScore(input)` を実装。
  - role_swap=false → 担当ロールの平均。true → 2次元グリッドを補完方式で算出。
  - 補完3方式（exclude / fill_by_season=縦軸 / fill_by_role=横軸）。
  - ボーナス（peak 到達加点）を final_score に加算。breakdown に根拠を残す。
- テスト +12（計119 緑）: role_swap分岐 × 補完3方式 × 端ケース（行/列除外・全未認定null）× ボーナスを**手計算値**で網羅。

### 決めたこと（なぜ）
- **base=null を許容（スコアなし）**: 全未認定や希望ロール未認定でも応募自体は通す。スコアが無くても運営が手動で振り分けられる柔軟性を残す。
- **補完材料が尽きたら行/列を除外**: 「未認定を補完する」方式でも材料ゼロなら補完不能。その行/列を平均から外して残りで評価するのが OSL 定石。
- **breakdown を必ず残す**: 後から根拠を追えるよう score_breakdown(jsonb) に入れる材料を返す。
- **Service だけに集中（PR-B）**: 応募フォーム・イベント設定は次PR。純粋ロジックを先に固める。

### 次にやること
- [ ] PR-C: イベント設定拡張（uncertified_handling カラム・ボーナス有効化）
- [ ] PR-D: スコアあり応募フォーム＋ calcScore 適用 → registrations スナップショット

## 2026-06-21 — スコアリング設計の確定＋rank_definitions seed（スコアあり応募 PR-A）

スコアあり応募の壁打ちで、OSL実運用に基づき設計を更新・文書化。実装の第1歩として OW2 のランクマスタを seed した。

### やったこと
- **設計文書 `docs/スコアリング設計.md` を新規作成**（正）。壁打ちで確定した内容を集約:
  - ランクは**応募時入力**（プロフィール常設しない／次回初期値にも使わない。OWのランクは流動的）。
  - 入力は **declared_seasons × ロールの2次元グリッド**（何シーズン参照かは主催者が決める）。
  - **role_swap で分岐**: false=担当ロール1つのスコアそのまま／true=全ロール平均で個人ファイナルスコア。
  - **未認定（uncertified）は新概念**。補完3方式を主催者が選択（横軸/縦軸/除外）。
  - 到達ボーナスはイベントのオプション。希望ロール入力は必須。
  - 実装を4〜5PRに分割（PR-A seed → PR-B 算出Service → PR-C イベント設定 → PR-D 応募フォーム → PR-E 表示）。
- DB設計書4.1 を新方針へ更新（旧モデルは参考として残し、正をスコアリング設計.mdに）。
- **PR-A 実装**: `supabase/seed.sql` に rank_definitions を追加。OW2 8帯×ディビジョン5〜1=40段階、線形スコア1〜40。未認定はマスタに入れずアプリ層で表現。冪等（UNIQUE(game_id,label)）。
- `src/lib/services/overwatch-ranks.ts`: seed と同一ルールでランク40件を生成する純粋関数（後続のフォーム選択肢・スコア変換で再利用）。
- テスト +7（計107 緑）: 40件・一意・線形1〜40・帯境界・sort一致を固定（seed とアプリの値ずれ防止）。

### 決めたこと（なぜ）
- **設計を独立文書化**: 機能が大きくセッションをまたぐ可能性が高いため、消えない形（docs正＋メモリ要点）で残す。ガイドライン6章「設計判断は doc 更新」に合致。
- **ランク事前登録→応募時入力に転換**: 実運用でランクは毎日変動。常設管理は古い値での応募事故を招く。→ user_season_ranks は当面使わない。
- **未認定はマスタに入れない**: 40段階は数値ありランクのみ。score なし行を混ぜると計算側で除外処理が散る。未認定は入力UI側の状態として扱う。
- **seed と同ルールの純粋関数を別に持つ**: SQL seed は直接ユニットテストしにくい。同ルールの TS 関数をテストで固定し、フォーム/算出でも再利用。

### 次にやること
- [ ] PR-B: スコア算出 Service（2次元グリッド・補完3方式・role_swap分岐・ボーナス。テスト主役）
- [ ] PR-C: イベント設定拡張（uncertified_handling カラム・ボーナス有効化）
- [ ] PR-D: スコアあり応募フォーム＋算出スナップショット

## 2026-06-21 — 最小応募フロー（スコアなし）＋応募者管理（一覧・承認/却下）

参加応募フローの縦1本目。設計（応募は2軸×スコア×フォームビルダーと大きい）のうち、**スコアなしの最小応募**を先に通した。初めて「他人のイベントに自分のデータを書き込む」機能で、IDOR が2方向になるためセキュリティを重点設計。

### やったこと
- **RLS 0006**（手動適用）: registrations のポリシー。SELECT=本人 or 主催者（**events への EXISTS サブクエリ**＝本コードベース初）、INSERT=本人のみ、UPDATE=主催者のみ。
- **Service** `registration-status.ts`: `canRegister`（公開中のみ）/`canDecide`（pendingのみ）/`registerRejectionReason`。純粋関数。
- **Repository** `registrations.ts`: `insertRegistration`（status=pending固定・UNIQUE違反23505を duplicate で返す）/`findRegistration`（重複判定）/`listRegistrationsByEvent`（users JOIN）/`findRegistrationWithEvent`（所有権確認用に events JOIN）/`decideRegistration`（pendingのみ更新）。
- **Action**: `registerForEvent`（ログイン→存在→**主催者は応募不可**→公開中→重複判定→**user_id セッション固定で insert**）/`decideRegistration`（ログイン→**2テーブル跨ぎ所有権確認**→pendingのみ→更新）。
- **UI**: 詳細ページに応募導線（非主催者・公開中。応募済みなら状態表示）＋主催者の「応募者を見る」。応募者管理ページ `/events/[id]/registrations`（主催者のみ・404ガード、承認/却下ボタン）。
- **テスト** +20（計100 緑）: 状態ロジック単体／アクション結合（なりすまし防止＝user_id固定・IDOR・重複・状態遷移・承認/却下・競合）。
- ブラウザ実機確認（単一アカウント範囲）: 主催イベントに応募ボタンが出ない・「応募者を見る」表示／管理ページが主催者で開ける・他不在イベントは404。

### 決めたこと（なぜ）
- **スコアなし最小応募から**: スコアは応募の"中身"で骨格でない。まず registrations に1行入り主催者が見られる骨格を通し、スコアは後から差す。`individual+none`（VC集合型）の実パターンが完成し捨て実装にならない。
- **応募フロー固有のセキュリティ**: ①user_id は入力でなくセッション固定（なりすまし／マスアサインメント対策）②承認は registration→event→organizer の2テーブル跨ぎで所有権確認（IDOR）③第三者には応募が見えない（RLS）。SQLi=クエリビルダのみ／XSS=React自動エスケープは従来どおり。
- **重複は事前チェック＋UNIQUE最終防衛**: アプリ層で親切メッセージ、同時連打の競合は DB の UNIQUE(event_id,user_id) が23505で弾く二段。
- **承認/却下の権限の最終防衛は RLS（0006 UPDATE）**: アプリ層チェックに加え DB 層でも主催者以外を弾く。
- **単一アカウント検証の限界**: 「主催者≠応募者」の組合せが作りにくいため、なりすまし/IDORの中核は結合テストで担保し、ブラウザは可能な範囲（ボタン出し分け・404）に絞った。

### 次にやること
- [ ] スコアあり応募（rank_definitions マスタ seed → ユーザーランク登録 → 応募時スコア算出・スナップショット）
- [ ] 希望ロール・マッチング希望・自由メモ（require_* トグル＋フォームビルダー）
- [ ] 応募の取り下げ（withdrawn）／定員の排他制御

## 2026-06-21 — イベント編集・自分のイベント一覧・下書き削除（③対応）

動作確認フィードバック③「下書きを保存後に編集できない」に対応。編集機能と、その入口となる「自分のイベント一覧」、下書き削除をまとめて実装。

### やったこと
- **作成/編集フォームを共通化**: `new-event-form.tsx` を廃し、`event-form.tsx`（`EventForm`）に統合。`defaultValues` で初期値を流し込め、作成は空・編集は保存済み値を渡す。日時ピッカーも defaultValue 対応済みでそのまま流用。
- **自分のイベント一覧 `/events/mine`**: 主催者本人の下書き＋公開を新しい順・状態バッジ付きで表示。各行に詳細/編集導線。
- **編集 `/events/[id]/edit`**: 所有者のみ（他人・存在しないは 404）。UTC→JST 変換で初期値を埋め、`EventForm` ＋ `bind` した `updateEvent` で保存→詳細へリダイレクト。
- **下書き削除**: 詳細ページに主催者向け導線（編集はいつでも、削除は下書きのみ）。確認ダイアログ→Server Action→一覧へ。
- **Repository**: `updateEvent`（許可カラムのみ・organizer_id＋version で楽観ロック・**slug不変**）／`listEventsByOrganizer`／`deleteDraftEvent`（本人の draft のみ）。
- **Action**: `updateEvent`（認可→所有者→Zod→楽観ロック）／`deleteDraftEvent`（本人の下書きのみ）。フォーム解析を `parseEventFormData` に共通化。
- **テスト** +10（計80 緑）: update/delete の認証・IDOR・マスアサインメント・楽観ロック・成功リダイレクト。
- ブラウザ実機確認: 一覧表示／編集プリフィル（UTC↔JST往復）／タイトル編集保存／下書き削除で一覧から消える／他人(不在)編集は404、を確認。

### 決めたこと（なぜ）
- **公開後も全項目編集可・slug は不変**: 応募フローがまだ無いため、定員の下限制約や日程変更通知は前提機能（応募/通知）実装時に追加する。slug はタイトル編集でも固定（共有URLを壊さない）。→ メモ [[event-edit-constraints]] に明記。
- **/events/mine に自分の全イベント**: 「イベント管理」の拠点。下書き/公開を1か所で扱い、編集・公開・削除の導線をまとめる。
- **RLS マイグレーション不要**: 0005（公開済み or 本人）が本人の下書きも返すため、一覧クエリ（organizer_id 一致）はそのまま通る。更新/削除の防御も 0004 の events_update_own でカバー済み。
- **フォーム共通化（リファクタ）**: 作成/編集の重複を避け、今後の項目追加を1か所で済ませる。

### 次にやること
- [ ] 参加応募フロー（registrations。定員下限制約はここで実装）
- [ ] Discord 自動告知／通知（日程変更通知はここで実装）

## 2026-06-21 — 日時カスタムピッカー（確定/キャンセル導線・②対応）

動作確認フィードバック②「カレンダー外クリックでしか確定できず不便」に対応。ネイティブ datetime-local を shadcn ベースのカスタム日時ピッカーに置換。

### やったこと
- shadcn/ui の `calendar` / `popover` を導入（`shadcn add`。react-day-picker / date-fns が依存に追加）。プロジェクトは Base UI 版 shadcn（`base-nova`）のため Popover は `@base-ui` 由来。
- `src/components/datetime-picker.tsx`: カレンダー＋時/分セレクト＋**クリア/キャンセル/確定**ボタンを持つピッカー。ポップアップ内はドラフト状態で編集し、確定まで本値に反映しない（外クリックで勝手に確定しない）。
- `src/lib/datetime-local.ts`: Date↔"YYYY-MM-DDTHH:mm" 変換ヘルパー（純粋関数）。**出力形式を datetime-local と完全一致**させ、Server Action（jstLocalToUtcIso）と Zod を無変更に保つ。
- 時刻は15分刻み（00/15/30/45）を維持。
- new-event-form の日時入力3つ（開始/終了/締切）をピッカーに置換。
- テスト +9（計70 緑）: 変換ヘルパーの単体（往復一致・形式・選択肢）。
- ブラウザ実機確認: 確定で値反映／キャンセルで破棄／ピッカー間の独立／作成→詳細でJST往復一致、を確認。

### 決めたこと（なぜ）
- **土台は shadcn の Calendar**: 既に shadcn 採用済みでデザインに馴染み、キーボード操作・a11y も入る。ゼロ自前実装は日時UIの難所（月末・うるう年等）で車輪の再発明になるため避けた。
- **wire 形式を datetime-local と同一に固定**: ピッカーは「入力UIの差し替え」に徹し、保存・変換ロジックには一切触れない。影響範囲を最小化しテストも変換ヘルパーに集約。
- **ドラフト/確定を分離**: 利用者要望の核心。確定するまで本値を変えない実装で「外クリックで確定」問題を解消。

### 次にやること
- [ ] **③下書き編集**（下書き一覧／マイページと同時実装）— このピッカーは defaultValue 対応済みで編集時もそのまま使える
- [ ] Discord 自動告知／参加応募フロー

## 2026-06-21 — イベント作成フォームのUX修正（動作確認フィードバック反映）

ブラウザ動作確認で出たフィードバックのうち、小修正の2点を対応。

### やったこと
- **定員を公開時も任意に（④）**: `publishEventSchema` から定員必須を外した。フォームのラベルは「任意」なのに公開時だけ必須で食い違っていた問題を解消。定員未定のまま公開・募集できる。値を入れる場合のみ1以上を検証。公開ボタン補足文も「開催日時・募集締切が必要（定員は任意）」に修正。
- **日時入力を15分刻みに（①）**: 開催開始/終了/募集締切の `datetime-local` に `step={900}` を付与。分の選択が00/15/30/45刻みになり、不要に細かい分指定の手間を解消。
- テスト更新（計61 緑）: 「定員未設定でも公開できる」へ反転（schema/action 両方）。
- ブラウザ実機確認: step=900 が全日時入力に反映 / 定員「未設定」のまま公開成功 を確認。

### 決めたこと（なぜ）
- **定員は公開時も任意**: 定員未定でも募集を始めたい運用があるため。前回の公開フローで必須にしていたが、運用判断で任意へ変更。
- **15分刻みは UI の step のみ**: ホイール操作を刻みにするだけで実用上十分。キーボードでの任意分入力までは弾かない（サーバー検証は過剰として見送り）。

### 次にやること
- [ ] **②カスタム日時ピッカー**（確定/キャンセル導線）— ネイティブ datetime-local 置換。早めに着手予定
- [ ] **③下書き編集**（下書き一覧／マイページと同時実装）
- [ ] Discord 自動告知／参加応募フロー

## 2026-06-21 — イベント閲覧画面（一覧／詳細）＋可視性ルール

作成→公開してきたイベントを閲覧する画面を追加。一覧＝概要、詳細＝全項目。あわせて「誰が何を見られるか」の可視性ルールを RLS とアプリ層の二重で整えた。

### やったこと
- **可視性ルール（RLS 0005）**: events の SELECT を全公開（0004 の using true）から「**公開済み（status≠draft）は全員 / 下書きは organizer 本人のみ**」に変更。アプリ層の絞り込みと二重で下書き漏れを防ぐ。
- **Repository**: `listPublishedEvents`（公開済み・新しい順）／`findEventBySlug` を追加。一覧は概要列のみ取得。
- **一覧 `/events`**: 公開済みイベントを新しい順でカード表示。リンクは公開=slug／なければ id。
- **詳細 `/events/<id>`**: slug 形式なら slug 検索・それ以外は id 検索の**2系統対応**。`canViewEvent`（Service・純粋関数）で「公開済みは誰でも／下書きは本人のみ」を判定し、本人以外の下書きは `notFound()`（存在を隠す）。
- **テスト**（+3、計61 緑）: `canViewEvent` の可視性判定（公開＝全員・下書き＝本人のみ・未ログイン拒否）。
- DB設計書 6章に events の SELECT/更新ポリシーの実装状況を追記。

### 決めたこと（なぜ）
- **閲覧の中にも出し分けが要る**: 「閲覧系は公開」が原則だが、下書きは例外。一覧は公開済みのみ、下書きは本人だけが詳細を見られる。
- **下書き漏れは RLS で最終防衛**: アプリ層のクエリ書き漏れに備え、DB層でも draft を本人以外に返さない（「DBで最終防衛」思想）。
- **URL は公開=slug・下書き=uuid の2系統**: slug 採番の目的（きれいな公開URL）を活かしつつ、未公開はそのまま uuid。詳細ページは両方で引けるようにした。
- **他人の下書きは 404**: 「権限がない」と返すと存在が漏れる。存在しないかのように 404 で隠す。
- **下書き一覧（マイページ）・UIデザインは後続**: 今回は公開一覧と最低限の構造のみ。見た目は機能が出揃ってからまとめて。

### 次にやること
- [ ] 自分の下書き一覧（マイページ的導線）
- [ ] Discord 自動告知（公開の副作用）
- [ ] 参加応募フロー（次フェーズの中核）
- [ ] UIデザインの作り込み（機能実装が一段落した後）

## 2026-06-21 — 公開時の slug 採番（ID ベース）

公開時に公開URL用の slug を採番する仕組みを追加。UUID べた貼りより共有しやすいURLにする。

### やったこと
- **Service 層** `src/lib/services/event-slug.ts`: ID ベースの slug 生成（`event-` ＋ 英数字6桁）。乱数源を差し替え可能にして決定的にテスト。紛らわしい文字（0,1,o,l,i）を除外。
- **Repository**: `slugExists`（重複チェック）を追加。`publishEvent` を slug も保存するよう拡張。
- **Action** `publishEvent`: 採番ステップを追加。生成→存在チェック→衝突ならリトライ（最大5回）。`event.slug ?? 採番` で既存 slug は再利用（再公開でURLを変えない）。
- **テスト**（+9、計58 緑）: slug 生成（決定的）・形式検証・公開時の slug 保存・**衝突時リトライ**。

### 決めたこと（なぜ）
- **タイトル非依存の ID ベース slug**: タイトルが日本語になりがちで、そのままだと URL エンコードで汚くなる。ID ベースなら日本語・重複・タイトル変更時のリンク切れを一括回避でき、実装も堅牢。
- **採番は「公開時」に1回**: 下書きは公開URLを共有しないため UUID のままで十分。公開＝外に出すタイミングで確定URLを採番する。
- **一度発行した slug は固定**: `event.slug` があれば再利用。URLは共有済みかもしれず、変えるとリンク切れになるため。
- **形式は `event-`＋6桁**: 個人/コミュニティ規模では衝突はまれ。重複チェック＋リトライで吸収。
- **スコープは採番・保存まで**: `/events/<slug>` ルーティングは閲覧画面PRとまとめる（今回は軽く保つ）。

### 次にやること
- [ ] `/events/<slug>` ルーティング（閲覧画面PRと合流）
- [ ] Discord 自動告知（公開の副作用・外部送信）
- [ ] イベント一覧/詳細の閲覧画面（下書き/公開の出し分け）

## 2026-06-21 — CI 導入（GitHub Actions で品質ゲート自動化）

PR・main push ごとに `npm run check`（lint・typecheck・test）を自動実行する CI を導入。

### やったこと
- `.github/workflows/ci.yml` を新規作成。`pull_request`(→main) と `push`(→main) で起動。
  - Node 22（LTS）／`npm ci`（lockfile 厳密一致で再現性確保）／`npm run check` を実行。
  - `concurrency` で同一ブランチの古い実行を打ち切り（CI時間の節約）。

### 決めたこと（なぜ）
- **CI は機能追加より優先**: 全機能に効く土台であり、手戻りを減らす。あわせて「動作確認は1機能ごとでなく動線が1本通った節目でまとめて行う」運用に切り替えたため、マージ前の自動品質ゲートが前提になる。
- **`npm run check` をそのまま流す**: ローカルと CI で同一コマンド。差分を生まず「ローカルで緑なら CI も緑」を保つ。
- **`npm ci` を採用**: `install` ではなく lockfile 厳密一致でインストールし、依存解決の揺れを排除。

### 次にやること
- [ ] slug 採番（公開URL整備）／Discord 自動告知
- [ ] イベント一覧/詳細の閲覧画面（下書き/公開の出し分け）
- [ ] （任意）CI に build ステップ追加 / ブランチ保護ルールで check 必須化

## 2026-06-21 — イベント公開フロー（draft→published）＋テスト

2段階バリデーションの「公開側」を実装。下書きで緩めた必須項目を公開時に貼り、あわせて公開フロー固有の防御（所有者確認・状態遷移・楽観ロック）を入れた。

### やったこと
- **Service 層を新設** `src/lib/services/event-status.ts`: 状態遷移の純粋関数 `canPublish`（draft のときだけ公開可）と `publishRejectionReason`。複雑/重要ロジックを Controller から切り出す方針の初適用。
- **公開スキーマ** `publishEventSchema`（schema.ts）: 保存済みイベントの値に対し、開催開始・募集締切・定員を必須化。期間/締切の整合も再確認。
- **Repository** `publishEvent`: `organizer_id` ＋ `status='draft'` ＋ `version` を条件に更新し version をインクリメント（IDOR・二重公開・競合を構造的に防ぐ多層防御）。
- **Server Action** `publishEvent`（actions.ts）: ①ログイン ②所有者確認（存在しない/他人は同一の権限なし応答で列挙防止）③状態遷移 ④必須化 ⑤楽観ロック更新 → `revalidatePath`。
- **詳細ページ**: 固定の「下書きで作成しました」を status 連動表示に変更。主催者本人かつ下書きのときだけ公開ボタン（`publish-button.tsx`・client）を表示。
- **テスト**（+21、計49 緑）: 状態遷移 `event-status.test.ts`／公開スキーマ `publish-schema.test.ts`／公開アクション `publish-action.test.ts`（認証・IDOR・遷移・必須化・楽観ロック）。

### 決めたこと（なぜ）
- **「公開」は status を上げるだけの操作。内容は作成/編集時に保存済み**: そのため公開スキーマの検証対象はフォーム入力ではなく「保存済み Row の値」。公開フォームを別に設けない。
- **公開は IDOR の本丸なので所有者確認を必須化**: 作成（自分のIDで作るだけ）と違い、公開は ID 指定で他人の行を叩ける。アプリ層で `organizer_id` 確認 ＋ DB の RLS で二重防御。
- **存在しない／他人の行は同一応答**: イベントの存在有無を漏らさない（列挙対策）。
- **楽観ロック（version）を最小導入**: 公開と編集の競合を検出。フルなロック UI は後続。
- **状態遷移は純粋関数に切り出してテスト**: 遷移ルールは今後 recruiting/closed… と増える。Service 層に集約し単体テストで守る。

### 次にやること
- [ ] slug 採番（公開URLの整備）／Discord 自動告知（公開の副作用・外部送信）
- [ ] 募集開始（published→recruiting）など後続の状態遷移とそのテスト
- [ ] イベント一覧/詳細の閲覧画面（下書き/公開の出し分け）
- [ ] CI で `npm run check` を回す設定

## 2026-06-21 — テスト基盤の導入＋イベント作成の単体・結合テスト

イベント作成機能のテストを整備。あわせて、これまで無かったテスト基盤（Vitest）と静的解析の統合コマンドをこのタイミングで導入した。

### やったこと
- **テスト基盤を新規導入**: Vitest を devDependency に追加。`vitest.config.mts` は environment=node・tsconfig paths ネイティブ解決（`@/*`）。
  - npm scripts に `test` / `test:run` / `typecheck`(`tsc --noEmit`) / `check`(lint→typecheck→test を順に実行) を追加。
- **単体テスト** `src/app/events/__tests__/schema.test.ts`（16ケース）: 2段階バリデーションの下書き側契約を固定。
  - 必須はタイトル・ゲームのみ／任意項目の null・空文字の正規化／既定値（申告シーズン=3・ボーナス=0）／期間・締切 refine は「両方そろったときだけ」効くこと。
- **結合テスト** `src/app/events/__tests__/actions.test.ts`（8ケース）: `createEvent` を Supabase/Repository/redirect をモックして検証。
  - 未ログインは DB に触れず戻り値でエラー（認証バイパス対策）／`organizer_id`・`status` のサーバー固定（マスアサインメント対策）／JST→UTC 保存／成功で `/events/:id` へ redirect。
- 静的解析: `prototype/**`（使い捨て UI 実験）を ESLint 除外。`npm run check` が緑（lint・typecheck・28テスト）。

### 決めたこと（なぜ）
- **ランナーは Vitest**: TS/ESM ネイティブで設定が軽く、Zod・Next と相性が良い。既存テスト資産が無いため Jest を選ぶ利点が薄い。
- **描画系（フォーム/ページ）の単体テストは今回見送り**: 公式ガイドどおり Vitest は async Server Component 未サポート。描画の動線確認は E2E に委ね、今回はロジック（schema）と Server Action の契約に集中。
- **実DB・RLS の結合テストは別途**: Supabase ローカル環境が必要で重い。今回は Supabase をモックした Server Action レベルの結合に留め、RLS 検証は後続で分離する。
- **prototype は静的解析の対象外**: 本番品質ゲートに試作のラフさ（React Compiler メモ化警告など）を混ぜない。本番コードは引き続き lint 対象。

### 次にやること
- [ ] イベント公開フロー（公開時の必須項目チェック・status 遷移）とそのテスト
- [ ] イベント一覧/詳細の閲覧画面（下書き/公開の出し分け）
- [ ] （後続）Supabase ローカルでの RLS 結合テスト ／ CI で `npm run check` を回す

## 2026-06-20 — イベント下書き作成の実装＋RLSポリシー整備

イベント作成機能（feature/event-create）の最初の縦1本を実装。「下書き」を最小入力で保存できるところまで通し、ブラウザで動作確認した。途中で詰まった作成失敗の原因は RLS 未整備だったため、ポリシー本体（0004）も併せて整備した。

### やったこと
- **イベント下書き作成（Server Action）**: フォーム → `createEvent`（Controller・薄い）→ Zod 検証 → `insertEvent`（Repository）→ 確認画面へリダイレクト の縦1本。
  - `src/app/events/schema.ts` を**2段階バリデーション**に書き換え。下書きはタイトル・ゲームのみ必須、日程/説明/定員等は任意で保存可能（後から詰める運用に合わせる）。公開時の必須チェックは別スキーマで後続PR。
  - `src/app/events/actions.ts`: 冒頭でログイン確認（認証バイパス対策）、`organizer_id`/`status` はサーバー側で固定（マスアサインメント対策）、JST入力→UTC保存。
- **RLSポリシー本体 `0004_rls_policies.sql` を新規作成**:
  - `games`: 全員 SELECT 可（公開マスタ。選択肢が空だった原因）。
  - `events`: SELECT 公開、INSERT/UPDATE/DELETE は主催者本人（`organizer_id = auth.uid()`）のみ。
  - すべて `drop policy if exists` 付きで冪等。

### 決めたこと（なぜ）
- **下書きはタイトル・ゲームのみ必須の2段階に分ける**: 日程未定でも企画を箱として先に作りたい運用に合うため。必須チェックを公開時へ寄せ、作成の心理的ハードルを下げる。
- **作成失敗の真因は RLS 未整備だった**: 0001 で全テーブル RLS を ON（デフォルト拒否）にしていたが、`games`/`events` のポリシーが未定義で「行はあるのに見えない/作れない（42501）」状態だった。アプリ層チェックだけでなく DB層 RLS を整えて最終防衛とする。
- **events の閲覧は当面すべて公開**: 下書き/公開の出し分けは UI が揃ってから詰める。現段階では作成→確認の動線を優先。

### 次にやること
- [ ] イベント公開フロー（公開時の必須項目チェック・status 遷移）
- [ ] イベント一覧/詳細の閲覧画面（下書き/公開の出し分け含む）
- [ ] イベント作成機能の単体・結合テスト

## 2026-06-20 — 実装ガイドライン策定（セキュリティ・設計の横断ルール）

イベント作成機能の設計壁打ちを通じて、セキュリティ・設計・データ層の方針が多く確定した。今後の全機能で統一して守るため、横断ルールとして明文化した。（実装はまだ未着手）

### やったこと
- `docs/実装ガイドライン.md` を新規作成。全機能で必須の横断ルールを集約：
  - セキュリティ（SQLi / IDOR / XSS / 認証バイパス / マスアサインメント / CSRF / 秘密鍵）の具体的対策。
  - 入力検証は Zod、guard 層は作らない。想定内＝戻り値／想定外＝`error.tsx`。
  - 認可は「閲覧系は公開・操作系は保護」、保護は A(リダイレクト)＋B(Server Action で弾く)。
  - 層構造（Controller→Service→Repository）、日時（JST入力→UTC保存→JST表示）。
  - ドキュメント運用（実装＋devlog＋関連doc更新を1セット）。
- `CLAUDE.md` に「実装ルール（必ず守る）」セクションを追加し、ガイドラインへ誘導＋遵守事項を要約。

### 決めたこと（なぜ）
- **ルールは docs（人間向け正式版）＋ CLAUDE.md（実装時の強制力）の二段構え**: docs だけだと実装時に参照漏れが起きるため、Claude Code が毎回読む CLAUDE.md にも要約を置く。
- **guard 層・例外処理専用層は作らない**: Next.js のバックエンドは薄く、過剰な層分けはオーバーエンジニアリング。検証は Controller の責務＋Zod スキーマ、例外は標準の `error.tsx` に乗せる。
- **IDOR の最終防衛は RLS（DB層）。ただし本体は別PR(0002)**: イベント作成PRの肥大化を避け、作成（自分のIDで作るだけ＝低リスク）のアプリ層チェックのみ今回実装。

### 次にやること
- [ ] イベント作成機能の実装（feature/event-create）。本ガイドラインを適用する初の機能。
  - seed.sql で games に OVERWATCH 投入 / events に ends_at 追加（開催期間対応）
  - フォーム → Server Action(Zod検証) → DB保存 → 確認画面 の縦1本
- [ ] RLSポリシー本体（0002マイグレーション）
- [ ] イベント作成機能の単体・結合テスト（機能PRの後続）

## 2026-06-20 — middleware を proxy 規約へ移行（Next.js 16 対応）

Next.js 16 で `middleware` ファイル規約が非推奨化されたため、`proxy` 規約へ移行。基盤の後始末として、機能が増える前に技術的負債を解消した。（PR #8、マージ済み）

### やったこと
- 公式移行ガイド（`node_modules/next/dist/docs/.../proxy.md`）を確認のうえ手動移行。
  - `src/middleware.ts` → `src/proxy.ts` にリネーム（`git mv` で履歴維持）。
  - エクスポート関数を `middleware` → `proxy` に変更。
  - 関連コメントの参照を `proxy` に統一（`lib/supabase/middleware.ts` / `server.ts`）。
- 検証: `npm run build` 成功（型チェック通過・出力に `ƒ Proxy (Middleware)`）、dev 再起動で deprecation 警告消失、`/login` 200・コンソールエラー0件。

### 決めたこと（なぜ）
- **機能変更は一切せず、規約変更への追従のみに限定**: 名前の変更だけなのでリスク最小。挙動（リクエストごとの Supabase セッション更新）は従来どおり。
- **ファイル `lib/supabase/middleware.ts` 自体は改名しない**: Supabase SSR の慣用ヘルパ名であり、Next の規約とは無関係なため温存。コメントの参照のみ整合を取った。
- **着手タイミングを「機能実装の前」に**: コード量が少ない今が最も安く、警告を抱えたまま機能を積み増すのを避けた。

### 次にやること
- [ ] イベント作成/管理（最小実装）— スコア登録本実装の前提となる「イベントが1件DBにある」状態を作る
- [ ] スコア登録の本実装（イベント設定を読んで DB 保存・スナップショット）
- [ ] （継続）初回ログイン時の Battle Tag 登録 ＋ users テーブル保存 / RLSポリシー本体

## 2026-06-19 — Discord OAuth ログインの実装（認証の土台）

設計どおり Discord OAuth ログインを実装し、ブラウザで一周（ログイン→認可→復帰→ログイン状態表示）を確認。

### やったこと
- Discord Developer Portal でアプリ登録、Redirect URL に Supabase コールバックを設定、Client ID/Secret を Supabase の Discord プロバイダに登録。Supabase の Redirect URLs に `http://localhost:3000/**` を追加。
- 実装:
  - `src/middleware.ts` + `src/lib/supabase/middleware.ts`: リクエストごとにセッション更新（SSR認証の定番）。
  - `src/app/login/page.tsx`: 「Discordでログイン」ボタン（`signInWithOAuth`）。
  - `src/app/auth/callback/route.ts`: 認証後の `code` をセッションに交換するコールバック。
  - `src/app/me/page.tsx` + `logout-button.tsx`: ログイン状態の確認・ログアウト。
- ブラウザで実ログイン成功・`/me` に Discord 情報表示を確認。

### 決めたこと / 詰まり（と対処）
- **今回は認証の土台のみ**: usersテーブル保存や Battle Tag 登録は次段階。「Discordログインが動くか」だけを最小実装で確認（段階を分けて確実に）。
- **詰まり: /login が500 → 原因は複数の dev サーバーが `.next` を取り合っていた**。残存 node プロセスを停止＋`.next` をクリアし、Ready を待ってから疎通したら解決。コードは正常だった。教訓: dev は1つだけ起動し、確認前に Ready を待つ。

### 次にやること
- [ ] 初回ログイン時の Battle Tag 登録 ＋ users テーブルへの保存（プロフィール作成フロー）
- [ ] RLSポリシー本体（0002マイグレーション）

## 2026-06-19 — Supabase クラウド接続・型生成

実装フェーズ開始。Supabase プロジェクトを作成し、ローカルアプリからの接続と型生成まで完了。

### やったこと
- Supabase プロジェクト作成（東京リージョン・Freeプラン）。作成時設定: Data API=ON / 新テーブル自動公開=OFF / 自動RLS=ON（デフォルト拒否・安全側）。
- SQL Editor で `0001_initial_schema.sql` を実行 → 全28テーブル作成（type衝突は public スキーマをリセットして再実行で解決）。
- 鍵（URL/anon/service_role）を `.env.local` に記入。形式・role取り違えを検証。
- 接続ヘルスチェック（一時 `/health` ページ）で「ローカル→クラウド接続成功・games 0件」を確認 → ページ削除。
- `supabase gen types` で `src/lib/supabase/types.ts`（全28テーブルの型）を生成。`client.ts`/`server.ts` に `<Database>` を組み込み。build 成功。

### 決めたこと / 詰まり（と対処）
- **作成時のセキュリティ設定**: 「新テーブル自動公開=OFF」を選択（手動制御＝デフォルト拒否の思想）。「自動RLS=ON」でRLSかけ忘れ防止。
- **型生成は CLI + アクセストークン**: `npx supabase gen types --project-id ...`。トークンは30日のまま（強い権限は短命に。使い終わったら revoke 推奨）。
- **PowerShellの `>` が UTF-16 で書き出す罠**: 生成直後の types.ts が UTF-16+BOM になり検索不一致。UTF-8へ変換＋BOM除去で解決。次回はGit Bashか `Out-File -Encoding utf8` を使う。
- **.env.local は gitignore 済み**で漏れない。`supabase/.temp/` も gitignore に追加。

### 次にやること
- [ ] Discord OAuth 設定（STEP6）
- [ ] RLSポリシー本体（0002マイグレーション）
- [ ] 認証フロー実装（Discordログイン → 初回Battle Tag登録）

## 2026-06-19 — アーキテクチャ設計書に層構造・テスト方針・データアクセス選定を追記

開発環境とアーキテクチャの概念整理（壁打ち）を経て、確定した方針をアーキテクチャ設計書に明文化。

### やったこと
- アーキテクチャ設計書に追記:
  - **3.3 ORM/データアクセス選定**: Supabaseクライアント（クエリビルダー）＋ `gen types` の型自動生成を採用。**Prisma等の追加ORMは不採用**（理由を表で明記）。
  - **3.5 層構造とテスト方針**（新設）: Controller(Server Action)/Service(lib/services)/Repository(lib/repositories) の責務分割、メリハリ（複雑ロジックのみ層分け）、テスト方針。
  - ディレクトリ構成図に services/ repositories/ types.ts を追加、§5 にテストランナー選定を追加。

### 決めたこと（と、その理由）
- **Prisma不採用**: Prismaはユーザーセッションを通さず直接DB接続するため **RLSをすり抜けやすい**。本設計はRLSを最終防衛の柱にしているため相性が悪い。加えてAuth/Realtimeと別系統・マイグレーション二重化のデメリット。Prismaの主目的（型安全）は `supabase gen types` で代替できるため、Supabaseクライアント＋型生成に統一。
- **三層構造はNext.jsでも維持**: フロント/バックのデプロイ境界が曖昧なことと、コードの責務分割は独立。Controllerは Server Actions によりHTTP窓口仕事が自動化され薄くなる。Repositoryの中身がPrisma→Supabaseクライアントに変わるだけで、従来の設計思想はそのまま活きる。
- **テスタブル設計 ≠ TDD**: 層構造で単体テストを書きやすくするのが目的。テストは書くが、先に書く順序（TDD）は必須としない。複雑ロジック（スコア算出・交代シミュレーション）をServiceに寄せ単体テストの主役にする。
- **メリハリ**: 全機能の厳格な3層化はオーバーエンジニアリング。複雑ロジックは層分け＋テスト、単純CRUDは薄く。

### 次にやること（候補）
- [ ] Supabaseクラウド接続（プロジェクト作成 → 0001マイグレーション実行 → `supabase gen types` で型生成 → Discord OAuth設定）
- [ ] 認証フロー実装 / 本実装

## 2026-06-18 — プロトタイプ（イメージ確認用）

実装本番に入る前に、設計イメージの答え合わせ用の静的プロトタイプを作成。

### やったこと
- `src/app/prototype/` に認証・DB非依存のプロトタイプを作成（ダミーデータ・クライアント完結）。
  - `/prototype` — 入口（2画面へのリンク）
  - `/prototype/teams` — **チーム編成・交代シミュレーション**（中核）。チーム平均スコア表示、リザーブ選択で「誰と交代すれば上限内か」を全候補提示、上限超過は交代ボタン無効化。
  - `/prototype/apply` — **応募フォーム**。シーズン×ロールのランク申告＋高ランク到達ボーナス → 個人ファイナルスコアをライブ算出。
  - `data.ts` — ダミーデータ・型・スコア/交代ロジック（設計の用語に準拠）。
- ゲーマー向けダークテーマ（shadcn の `.dark` 変数）。
- build 成功・Playwright で実レンダリングと交代シミュレーションの動作を確認。
- スクショ類は .gitignore に追加。

追記: 主要4画面に拡張（イベント一覧・詳細 / 応募フォーム / チーム編成 / 試合スケジュール・順位表）。
- `/prototype/events`・`/prototype/events/[id]` — カード一覧（シリーズ/タグ/定員/状態）と詳細（定員バー・応募/フォロー導線・回遊）。
- `/prototype/schedule` — 日付別の対戦カード（フェーズ・配信バッジ・終了スコア）＋グループ順位表（上位2チーム=進出ハイライト）。
- 4画面とも build・Playwright で表示確認。ユーザーが全画面を確認し「イメージ通り」とフィードバック。

### 決めたこと（と、その理由）
- **プロトタイプは認証・DBに繋がない静的実装**: 目的は「イメージの答え合わせ」であり手戻り防止。ロジックは作り込まず、見た目と流れだけ確認できればよい。
- **中核（交代シミュレーション）は実際に動かす**: 数値計算が動くことで設計の価値（OSL運営の手作業自動化）を体感的に確認できるため、ここだけはダミーデータ上で計算を動作させた。
- **本実装とは分離（prototype/ 配下）**: 後で破棄/置換しやすいよう隔離。
- **Next.js 16 の作法を確認して実装**: 動的ルートの `params` が Promise（await必須）であることをローカルドキュメントで確認して使用。

### 次にやること（候補・明日以降）
- [ ] プロトタイプを土台に本実装へ（修正・本実装は翌日から）
- [ ] Supabaseクラウド接続 → 認証フロー実装

## 2026-06-18 — ✅ マイルストーン: 設計フェーズ完了

構想から設計・基盤構築までを1日で一気に進め、**設計ドキュメント5本＋開発基盤＋Git運用**が揃った状態に到達。実装フェーズへ移行できる段階。

### 到達点サマリ
**ドキュメント（docs/ 5本）**
- 要件定義書 / DB設計書 / ER図 / アーキテクチャ設計書 / devlog

**確定した主要な設計判断**
- 認証: Discord OAuth のみ（識別 vs 認証を分離、Battle Tagはプロフィール）
- スコアリング: ①individual_score → ②final_score → ③チームスコア（出場者平均・保存せず算出）
- チーム編成: 交代シミュレーション（リザーブを誰と替えれば上限内か自動提示）＝アプリの中核価値
- 応募フロー: 2軸（entry_type × team_formation）でデータ化、多パターン共存
- 募集フォーム: 構造化項目トグル＋フォームビルダー（固い/柔らかいデータの分離）
- シリーズ概念: 開催回(event)と継続企画(series)を分離、共同運営(owner/admin)
- 通知: 種別2分類×宛先2分類。全体=Webhook / 個人=Bot DM。二段構え（アプリ内＋Discord）、出来事起点で重複排除
- スクリム管理: チーム単位の練習試合をカレンダー＋個人通知（Phase3 #7）
- 横断思想: 早すぎる分離を避ける / 変わる定義はデータで持つ / データの固さで持ち方を変える / DBで最終防衛

**DB**: 全28テーブルの migration SQL（0001、ENUM・制約・RLS有効化まで）

**基盤**: Next.js 16 + TypeScript + Tailwind v4 + shadcn/ui + Supabase クライアント。ビルド・dev 確認済み。Docker不要構成。

**Git/運用**: GitHub private リポジトリ、CLAUDE.md にGit運用ルール（main直push禁止・PR必須・feature命名・1機能1PR・日本語統一）。PR #1〜#3 でフロー定着。

### 次フェーズ（実装）の入口
- [ ] Supabaseクラウド接続（プロジェクト作成 → 0001マイグレーション実行 → Discord OAuth/Bot/Webhook設定。※ユーザー作業、手順ガイドあり）
- [ ] RLSポリシー本体（0002マイグレーション）
- [ ] 認証フロー実装（Discordログイン → 初回Battle Tag登録）
- [ ] 画面設計（特にチーム編成画面＝交代シミュレーションのUI）

---

## 2026-06-18 — アーキテクチャ設計書の作成

設計の意思決定が出揃ったので、散在していた「How（どう作るか）」を1本に集約。

### やったこと
- `docs/アーキテクチャ設計書.md` を新規作成（中粒度・図と表中心）。
- 内容: ①システム構成（全体像・Mermaid構成図・レイヤー責任）②データ/処理フロー（認証/応募スコア/チーム編成・交代シミュレーション/通知/排他の各シーケンス）③ディレクトリ構成・コード方針（Server/Client使い分け・データアクセス方針）④認証・認可(RLS)・セキュリティ（2層防御・RLS方針表・キー管理）。

### 決めたこと（と、その理由）
- **「How」を1本に集約する**: 要件定義書(What/Why)・DB設計書(データ構造)とは別に、アーキテクチャの全体像が抜けていた。重複を避け、本書はアーキテクチャの意思決定と構造に集中。情報が出揃った今が書き時。
- **中粒度・図と表中心**: 過剰な詳細はメンテ負担で陳腐化するため避け、読めば構造が分かる実用性を優先。
- **ディレクトリは `features/<機能>` 凝集を想定**: app/ はルーティングに徹し、機能ロジックは features に集約する方針を明文化（※想定として記載、実装で確定）。
- **Server既定・Clientは葉に閉じる / 変更は Server Actions / 重い計算はサーバー**: 実装規約として明記。

### 次にやること（候補）
- [ ] Supabaseクラウド接続（migration実行・Discord OAuth・Bot/Webhook設定はユーザー作業）
- [ ] RLSポリシー本体（0002マイグレーション）
- [ ] 認証フロー実装 / 画面設計

## 2026-06-18 — Discord通知の宛先設計とスクリム管理の追加

「Discordに通知を飛ばせるか？」という問いから、通知の宛先設計を整理し、スクリム管理を要件に正式追加。

### やったこと
- 要件定義書: 3.5.2（通知の宛先分類とDiscord連携3レイヤー・二段構え）、3.4.3（スクリム管理）を新設。Phase3に #7 スクリムを追加。
- DB設計書: users に `discord_dm_opt_in`、events/event_series に `discord_webhook_url`(events に `auto_announce` も)、`scrims`・`notification_deliveries` テーブル追加、ENUM 2種(delivery_channel/delivery_status)。
- migration SQL(0001) を同期更新。
- ER図に scrims / notification_deliveries を反映。

### 決めたこと（と、その理由）
- **通知を「宛先」で2分類**: 全体向け(イベント公開/「本日各試合」)=Discord Webhook(告知チャンネル)、個人向け(参加確定/「あなたの試合は21時」/スクリム)=Discord Bot DM。理由: 個人向けを全員のチャンネルに流すのはノイズ＆本人の見落とし。ユーザーの指摘どおり宛先で配信先を分ける。
- **Discord連携は3レイヤー**: アプリ内通知(Realtime) / Webhook(チャンネル,Bot不要) / Bot DM(個人)。Webhookは軽くPhase1から、DMはBot必要。
- **個人向けは「二段構え(アプリ内＋Discord DM)」を正式要件に**: ユーザーの「DMでほぼ必ず予定に気づける」価値を中心に据える。ただしDM単独だとDM拒否の人に届かず通知が消えるため、アプリ内に必ず記録＋DMで見落とし防止。誰も取りこぼさない。`notification_deliveries` で配信状況(skipped=DM拒否等)を記録。
- **実装順: アプリ内通知 → 直後にBot DM**: 既存の notification_events→集約 の土台に配信レイヤーを足すだけなので自然に乗る。要件には正式採用しつつ確実な土台(アプリ内)の上に乗せる。
- **スクリム(練習試合)管理を正式採用(Phase3 #7)**: カレンダーを活かすチーム単位の練習管理。本戦matchesと別概念(scrims、勝敗は順位に無関係)。登録/変更で対象チームへ個人通知。

### 次にやること（候補）
- [ ] Supabaseクラウド接続（migration実行・Discord OAuth・Bot/Webhook設定はユーザー作業）
- [ ] RLSポリシー / 認証フロー実装 / 画面設計

## 2026-06-18 — リモートリポジトリ作成とGit運用ルール

### やったこと
- GitHub に private リポジトリ作成・push: https://github.com/miyanoritallest-afk/GameEventBoard
- CLAUDE.md に Git運用ルールを追加（RaiseChat から流用・調整）。
- settings.json から「gh pr create → 自動 Issue 作成」hook を削除。

### 決めたこと（と、その理由）
- **Git運用ルール（CLAUDE.md）**: main直接push禁止＋PR必須 / `feature/xxx` 命名 / 1機能・1フェーズ=1PR / コミット・PR・devlog は日本語統一。RaiseChat の運用を踏襲。
- **PR→Issue自動生成hookは不採用**: GitHubはIssueとPRで番号を共有するため、PRごとにIssueを作ると1作業で2番号消費し番号が浪費される（ユーザーが実際に困っていた）。本来は Issue(やること)→PR(やったこと) の順で、逆向きのため削除。
- **main保護は自主規制のみ（CLAUDE.md）で運用**: private リポの GitHub ブランチ保護は無料プラン非対応（Pro or public が必要）。public化やローカルpre-pushフックも検討したが、1人開発の現段階では CLAUDE.md のルール遵守で十分と判断。必要になれば後で強制手段を導入。
- **初回pushのみmain直接を例外**: リポジトリ作成のため。以降は feature ブランチ＋PR で進める。

### 次にやること（候補）
- [ ] 以降の作業は feature ブランチを切って進める
- [ ] Supabaseクラウドのプロジェクト作成 → 0001マイグレーション実行 → Discord OAuth設定（ユーザー作業）
- [ ] RLSポリシー本体 / 認証フロー実装 / 画面設計

## 2026-06-18 — 環境構築（Next.js + Supabase + shadcn/ui）

設計が固まったので開発の土台を構築。

### やったこと
- `create-next-app` で Next.js 16.2.9 (App Router) + TypeScript + Tailwind v4 + ESLint を作成。プロジェクトルート直下に展開（docsと共存）。
- shadcn/ui を初期化（button + lib/utils.ts 生成）。
- Supabase クライアント導入（`@supabase/supabase-js` / `@supabase/ssr`）。`src/lib/supabase/client.ts`(ブラウザ用) と `server.ts`(サーバー用、Next16のasync cookies対応) を作成。
- `.env.local.example` を用意（URL / anon / service_role）。
- DB設計書の全25テーブルを `supabase/migrations/0001_initial_schema.sql` に落とした（ENUM 13種・制約・index・RLS有効化まで。ポリシー本体は0002以降）。
- README をプロジェクト用に書き換え（セットアップ手順）。
- `npm run build` 成功・`npm run dev` で HTTP 200 を確認。

### 決めたこと（と、その理由）
- **Docker は使わない**: AWS経験者の「Dockerいらない？」という疑問に対し、Vercel(push→自動ビルド)＋Supabase(マネージドDB)の構成では本番もローカルもDocker不要と整理。学習対象を最小化するため、ローカルはクラウドSupabaseに直接接続する。ローカルDB分離が必要になったら Supabase CLI(Docker) を任意導入。
- **プロジェクトはルート直下に展開（モノレポにしない）**: 1人開発・Vercelデプロイの単純さを優先。docsは通常フォルダとして共存。
- **RLSは全テーブルで有効化し、デフォルト拒否から始める**: ポリシー未定義＝アクセス不可の安全側。ポリシー本体は次のマイグレーションで段階的に。
- **Next.js 16系は破壊的変更に注意**: 生成された AGENTS.md が「コード前に node_modules/next/dist/docs/ を読め」と警告。実装時に必ず参照する。

### 次にやること（候補）
- [ ] Supabaseクラウドのプロジェクト作成 → 0001マイグレーション実行 → Discord OAuth設定（ユーザー作業）
- [ ] RLSポリシー本体の定義（0002マイグレーション）
- [ ] 認証フロー実装（Discordログイン → 初回Battle Tag登録）
- [ ] 画面設計（特にチーム編成画面＝交代シミュレーションのUI）

## 2026-06-18 — チームスコアの動的計算と交代シミュレーション

「チーム人数上限はteamsに持つべきか？」という問いから、OSL運営で最も苦労した「リザーブ交代時のスコア再計算」問題に発展。設計の核心の一つを固めた。

### やったこと
- 人数上限を `events.reserve_slots` に追加（teamsには持たない）。最大人数 = games.team_size + reserve_slots。
- スコアを3段に用語固定: ①individual_score → ②final_score(=①+ボーナス) → ③チームスコア(出場者のfinal_score平均)。`registrations` に final_score を追加。
- `events.team_avg_cap` を `team_score_cap` に改名・定義明確化（出場者final平均の上限）。
- 交代シミュレーションのロジック（DB設計書4.3）を定義。`match_lineups`（Phase2任意）を追加。
- 要件定義書(3.1.1 用語/3.1.2 新設)・DB設計書(4.1〜4.3)・ER図(2.3更新)を更新。

### 決めたこと（と、その理由）
- **人数上限は teams でなく events に持つ**: 「全チーム共通のルールか、チーム個別の属性か」が判断基準。上限はイベント内の全チームで同じ→eventsが正しい。teamsに持つと冗長・不整合リスク・意味的に誤り。
- **チームスコアは保存せず算出**: チームスコアは「今誰が出場しているか」に依存する動的な値。保存列にすると交代のたびに手更新が必要になり、まさにOSLの苦労が再現する。出場者(regular)のfinal_score平均をその場で計算。
- **判定は出場者のみ、リザーブは含めない**: ユーザーの運用実態（平常時はメインのスコアのみ参照）に一致。
- **「登録」と「出場」を概念分離**: ロスター(team_members全員)とラインナップ(実際に出る人)は別。OSLはExcelで混同して手計算していた。データで分ければ自動化できる。
- **交代シミュレーションを編成画面の中核機能に(Phase1)**: 「リザーブを誰と交代すれば上限内か」を全パターン自動提示。OSLが手作業で総当たりしていた計算＝このアプリの差別化価値。final_scoreが既知なら即時算出可能。
- **試合ごとの出場記録(match_lineups)はPhase2任意**: OSLでも毎試合は計算せず編成・登録時に判断していた。まず編成画面のシミュレーションを作り込む。

### 次にやること（候補）
- [ ] 環境構築（Next.js + Supabase の土台、スキーマをマイグレーションに落とす）
- [ ] 画面設計（特にチーム編成画面＝交代シミュレーションのUI）

## 2026-06-18 — シリーズ概念の導入とフォロー/通知の再設計

ユーザーから「イベントをフォローしても次回開催の通知が届かないのでは？」という鋭い指摘。設計の欠陥を認め、再設計した。

### やったこと
- `event_series`（シリーズ）概念を新規導入し、開催回(events)と分離。`events.series_id` を追加。
- 共同運営 `series_members`（owner/admin × invited/active）、招待リンク用 `series_invites`（将来）を追加。
- フォロー対象を series/event/user の3種に拡張。
- 通知を2層化（`notification_events`＝出来事 / `notifications`＝配信）し、重複排除を設計。
- 要件定義書(3.5.1, 3.6.1)・DB設計書・ER図(2.5追加)を更新。

### 決めたこと（と、その理由）
- **シリーズを独立概念に**: 「イベント=開催回」は継続主体ではなく、第1回フォローでは第2回告知が届かない。継続して追う対象＝シリーズを別テーブルに。理由: 主催者交代に強い・1人が複数シリーズを持てる・シリーズトップを作れる。単発イベントは series_id=null で吸収。
- **共同運営は owner/admin の2段階**: owner=運営追加削除/シリーズ削除、admin=運営業務。理由: 「運営が勝手にオーナーを蹴る」事故防止。開催中の運営追加も可能。
- **招待は検索招待＋本人承認**: Battle Tag/Discord名で検索→招待→相手が承認(invited→active)。フォロワー/よく絡む人を候補サジェスト。理由: 権限付与は本人同意が健全。フォロー有無に依存しない汎用性。招待リンク(Discord向け)は将来の補助。
- **通知の重複排除を「出来事起点」で設計**: 複数フォローで1出来事に複数通知が飛ぶ事故を防ぐため、フォロー起点でなく出来事起点。`notification_events`→宛先集約・ユニーク化→`notifications`。`UNIQUE(user_id, source_event_id)`でDB物理防御(冪等)。排他制御と同じ「DBで最終防衛」思想。
- **シリーズはスキーマ先行投入、通知ロジックはPhase3**: シリーズは後付けだと既存イベントの紐付け直しが高コストなので土台に入れる。重複排除の実装はPhase3で。

### 次にやること（候補）
- [ ] 環境構築（Next.js + Supabase の土台、スキーマをマイグレーションに落とす）
- [ ] 画面設計（主要画面のワイヤーフレーム）

## 2026-06-18 — ER図の作成

### やったこと
- DB設計書の全20テーブルを Mermaid 記法のER図に起こした（`docs/ER図.md`）。
- 全体図に加え、関心領域ごとの分割ビュー4枚を用意（ユーザー＆ランク / イベント＆応募 / チーム編成 / 進行＆結果）。
- カーディナリティの読み解きと、設計上の注意点を補足。

### 決めたこと（と、その理由）
- **分割ビューを併設**: 全体図は20テーブルで密になり読みにくいため、ドメインごとに4分割した図も用意。理由: 設計の理解とレビューのしやすさを優先。
- **`follows.target_id` はポリモーフィック参照として明示**: イベント/ユーザー両方をフォローできるため、FK制約は張らずアプリ層で担保する旨をER図に注記。理由: RDBのFKは単一テーブルしか指せないため。
- **属性は主要キー・区分値・特徴列に絞って記載**: 全列はDB設計書を正とし、ER図はリレーション把握に集中。理由: 二重メンテの負荷を避け、図の可読性を保つ。

### 次にやること（候補）
- [ ] 環境構築（Next.js + Supabase の土台、スキーマをマイグレーションに落とす）
- [ ] 画面設計（主要画面のワイヤーフレーム）
- [ ] DB設計の残未決事項（standingsのビュー化可否・bracket構造 等）

## 2026-06-18 — 構想〜要件定義・DB設計の確定

最初の壁打ちセッション。アプリの構想から要件定義・DB設計の骨格までを一気に固めた。

### やったこと
- プロジェクトの背景・課題整理（Discord+Googleフォーム+Excel+手作業の運営フローを統合する）
- 要件定義書（`docs/要件定義書.md`）を作成
- DB設計書（`docs/DB設計書.md`）を作成（全20テーブル）
- 開発の流儀・設計判断をメモリに記録、本devlogを開始

### 決めたこと（と、その理由）

**1. プロダクトの核 = 「Discordを置き換えず、面倒な部分だけアプリに移す」**
- 理由: コミュニティの拠点はDiscordのままが自然。全部移そうとすると定着しない。通知だけDiscordに飛ばす役割分担が現実的。

**2. スコープはPhase制（フル機能を段階実装）**
- Phase1=告知/応募/参加者管理/チーム振り分け、Phase2=マッチアップ/スケジュール/配信/結果順位、Phase3=検索/フォロー通知/カレンダー/タグ/排他制御。
- 理由: フルスコープを一度に作ると破綻する。「まず1イベントを回せる最小構成」から積む。

**3. 技術スタック = Next.js フルスタック + Supabase + Vercel + Discord連携**
- 理由（フルスタックを分離しない判断）:
  - バックエンドが薄い（大半がCRUD・Webhook・振り分け計算）。専用APIサーバーを立てる重さがない。
  - 開発者が1人 → 分離の利点（チーム独立開発）が効かず、リポジトリ/デプロイ/型同期のコストだけ被る。
  - 型が一気通貫（DB→API→画面）。
  - デプロイ・無料枠が単純。
- 許容するデメリット: ベンダーロックイン気味・重い処理に弱い・独立スケール不可。
  → 今回の規模（同時数十〜数百人）では問題化せず、重い処理は将来 Supabase Edge Functions/Cron に切り出せる。**早すぎる最適化（分離）を避ける**。

**4. リアルタイム/通知の実現方式を整理（重要な技術的論点）**
- 「サーバーレスだとWebSocket不可では？」という疑問に対し、リアルタイムは関数で持たず **Supabase Realtime**（Supabaseが常時接続を保持）に任せると整理。
- 通知を2分類: (A)ライブ更新=Realtime / (B)スケジュール通知(「21時開始」)=**Cron発火→Discord Webhook+DBフラグ→Realtimeで画面反映**。
- 理由: WebSocketとスケジュール起動は別レイヤーの話。混同しないことで無料枠のまま全要件を満たせる。

**5. 認証 = Discord OAuth のみ。Battle Tag はプロフィール必須**
- 「識別（誰か）」と「認証（本人か）」を分離。Discord IDが認証＋識別、Battle Tagは識別・表示用（誰でも名乗れるので認証には使えない）。
- 理由: コミュニティ全員がDiscord保有で登録ハードルゼロ、パスワード・メール管理不要、通知の宛先が自動で紐付く。

**6. ランクの数値化 = マスタテーブル `rank_definitions` に外出し**
- 「ブロンズ5=1 … チャンピオン1=40」の対応表をDBデータとして持つ。
- 理由: コード直書きは多タイトル対応で破綻。運用でスコア調整したくなる。多タイトル方針（設計だけ汎用化）と一致。

**7. スコアリングはOSL実運用を忠実にモデル化**
- ユーザーのランクは「シーズン×ロール」の2軸（ロールスワップ可なら最大9個）。
- 高ランク到達ボーナスは人単位（master/gm/champion、加点はイベントごと設定可）。減衰対策（高ランク経験者を低スコアで獲得させない）。
- 個人スコアは応募時点で算出し `registrations` に**スナップショット保存**（後のランク変動で過去の振り分け記録を変えないため。スプレッドシートの「個人スコア平均」列と同発想）。

**8. 応募フローを2軸でデータ化（多パターン共存の核心）**
- `entry_type`(individual/team/mixed) × `team_formation`(self/organizer/none) の組合せで全パターンを表現。
- OSLのハイブリッド（個人=運営振り分け / チーム=自分で組む）は mixed + `registrations.wants_matching` で表現。
- 理由: **「フローをif文で書かず、データで持つ」**。新イベント形式が出てもコード改修不要にする。capacity=チーム数で確定。

**9. 募集フォームを「固いデータ/柔らかいデータ」で分離**
- 構造化項目（ランク/希望ロール/マッチング希望/Battle Tag）→ `events` のON/OFFトグル（初心者向けはランクOFF可）。
- 自由項目（意気込み等）→ フォームビルダー `event_form_fields`/`registration_answers`（基本5型）。
- 理由: **「計算に使うデータは構造化、表示するだけのデータは柔軟に」**。混ぜると後で平均計算できない等の事故になる。

**10. 外部ランクAPIは不採用**
- 理由: FPSのランクAPIは非公式・不安定・タイトル依存。パスワードを預かる方式は存在しない（規約違反・窃取リスク）。本人申告＋運営上書きで運用し、API連携は将来の拡張候補に留める。

### 横断的に貫いている設計思想
- **早すぎる最適化・分離を避ける**（必要になってから切り出す）。
- **変わりうる定義はデータで持つ**（ランク体系・応募フロー・フォーム項目をコードに焼き込まない）。
- **データの"固さ"で持ち方を変える**（計算用は構造化、表示用は柔軟）。
- **判断の根拠とデメリットも残す**（後から「なぜこうしたか」を辿れるように）。

### 次にやること（候補）
- [ ] ER図を起こす（Mermaid等でテーブル間リレーションを視覚化）
- [ ] 環境構築（Next.js + Supabase の土台、スキーマをマイグレーションに落とす）
- [ ] 画面設計（主要画面のワイヤーフレーム）
- [ ] DB設計の残未決事項（standingsのビュー化可否・season_labelの持ち方・bracket構造 等／DB設計書 §7）
