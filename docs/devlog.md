# GameEventBoard 開発ログ (devlog)

開発の進捗・意思決定・その根拠を時系列で記録する。**新しいエントリは上に追記**（新しい順）。
各エントリは「やったこと / 決めたこと（なぜ） / 次にやること」を基本構成とする。

関連: [要件定義書](./要件定義書.md) / [DB設計書](./DB設計書.md) / [ER図](./ER図.md) / [アーキテクチャ設計書](./アーキテクチャ設計書.md)

---

## 2026-07-15 — security definer 関数の認可バイパス修正（ロジック層の監査で発見）

デザイン刷新より前に書かれた（＝Claude review 導入前の）ロジック層を、セキュリティ観点で監査した。actions/RLS/definer/schema を横断で読み、認証・認可・マスアサインメント・IDOR・入力検証を確認。全体は堅牢だったが、**0034 の series 共同運営セキュリティ修正から取り残された同型の穴を2件**発見し修正した（0037）。

### 監査で問題なしと確認した領域
- actions 全体の認証→認可→書き込みの順序（共通ヘルパー currentUserId/requireOrganizer/requireReporter）。
- 結果入力の認可はアプリ層(requireReporter)＋DB層(can_report_match)で二重・完全一致。
- マスアサインメント対策: registerWithScore はスコアをサーバー算出(calcScore)、winner/reported_by/status/organizer_id 等はサーバー固定。
- IDOR: assignTeam は他イベントのチーム混入を event_id 一致で拒否。
- series 共同運営(0034)は actor=auth.uid()・anon から EXECUTE REVOKE・TOCTOU 対策まで完備（模範的）。

### 発見・修正した2件（0037）
1. **create_series_with_owner（0032）— 他人名義のシリーズ作成（実害あり）**: actor を `p_created_by` 引数で受け＋EXECUTE が PUBLIC のままで、REST 直叩きで他人の UUID を渡せば他人を owner にしたシリーズを勝手に作れた（0034 で塞いだ権限昇格と同型）。→ `p_created_by` を廃止し関数内 `auth.uid()` を使う・anon から EXECUTE REVOKE（authenticated のみ grant）。Repository/Server Action/types.ts も2引数に追従（正規経路は元々 user.id を渡していたので挙動不変）。
2. **upsert_notification_event（0031）— 通知イベントの外部生成（予防）**: EXECUTE が PUBLIC のままで、任意ユーザーが notification_events に任意行を作れた（dedup_key 占有で正規通知を抑止/汚染）。→ サーバー処理専用なので anon/authenticated 双方から EXECUTE REVOKE（Server Action は service_role で呼ぶので影響なし）。

### 決めたこと（なぜ）
- **0034 の流儀に完全に揃える**（actor=auth.uid()・不要な EXECUTE を REVOKE）。特殊対応を足すのではなく、既にある正しいパターンへ寄せる。
- 監査は「1本ずつ全部読む」ではなく、共通ヘルパー/definer の土台を重点確認し、そこが堅ければ派生も堅い、という当たりの付け方で出力を抑えた。

### 確認
- `npm run check`（lint 0 error／typecheck OK／test 387 passed）。
- **実機（anon 直叩きで攻撃経路の遮断を確証）**: (1) 旧3引数の create_series_with_owner → 404（旧シグネチャ消滅）、(2) 新2引数を anon で → 400 "not authenticated"（auth.uid() が null で例外＝他人名義作成不可）、(3) upsert_notification_event を anon で → 401 permission denied（REVOKE 済み）。
- 正規経路（ログインしてシリーズ作成）の実ログイン E2E は Discord OAuth のためヘッドレス未実施。型/ビルド整合＋関数ロジック不変（actor 取得元が引数→auth.uid() に変わっただけ・Server Action は元々自分の id を渡していた）＋anon 2引数が本体まで到達している事実で担保とする。

### 次にやること
- 監査は主要領域（actions/definer/RLS/コア認可）を完了。残りの service 純粋ロジック（スコア/順位/ブラケット）は自動テストで担保済みのため深掘りは保留。ユーザー判断待ち。

## 2026-07-15 — 観戦ビューの Realtime ライブ更新（匿名観戦者にも配信）

観戦ビュー（/events/[id]/watch）を、主催者の結果入力・日時/配信変更の瞬間に**リロードなしで自動更新**するようにした（拡張候補②のライブ更新部分）。これで②は完了。

### やったこと
- `matches` / `match_results` を `supabase_realtime` publication へ追加（0036・手動適用）。RLS 追加は不要（両テーブルの anon SELECT は 0023 で公開イベント向けに開放済み）。
- 観戦ページ用の購読 Client Component `watch-realtime.tsx` を追加。変更検知で `router.refresh()`（表示は常に DB 真値＝差分の手組みはしない。通知の Realtime と同じ流儀）。
  - `matches`: `event_id=eq.<id>` で絞って購読（「次の試合」の日時・配信に追従）。
  - `match_results`: event_id カラムが無く postgres_changes の filter は単一カラム等値のみのため、フィルタなし購読＋クライアントで「このイベントの match_id 集合」に含まれる変更だけ refresh（無駄 refresh の間引き）。DELETE（結果取消）も match_id が PK＝replica identity に含まれるので `payload.old` から拾える。
  - 認証: subscribe 前に setAuth。ログイン時はセッション、**匿名時は anon キーの JWT** を渡す（[[realtime-rls-setauth]]）。
- 副産物のバグ修正: StandingsPanel の順位表 `<tr key={r.rank}>` は**同着で rank が重複するとキー衝突**するため `key={r.teamName}`（ブロック内で一意）へ。既存バグだが、ライブ更新で結果が入り同着が出た瞬間に React の重複キー警告として顕在化したので回収。

### 決めたこと（なぜ）
- **WebSocket は「変わった」シグナルとしてだけ使い、描画は既存 Server Component に任せる**（router.refresh）。差分を手組みして画面を書き換えるより、DB 真値を取り直す方がズレない。既存の描画ロジックは一切変えずに済む。
- **匿名購読を採用**（観戦ビューの主役は非ログイン観戦者）。anon キーの JWT を setAuth で渡す。RLS が公開イベントのみ配信するので、下書き・非公開は匿名に漏れない。
- **重要な確認: 匿名でも Realtime が届く**ことを実機で確証した（下記）。これが着手前の最大の不確実性だった。

### 確認
- `npm run check`（lint 0 error／typecheck OK／test 387 passed）。`npm run build` 成功。`/code-review high` → correctness 0件（DELETE payload の match_id 欠落懸念は、match_id が PK のため replica identity に必ず含まれ非該当と確認）。
- **実機（Playwright・匿名観戦者）**: cookie/storage を消して匿名状態にし観戦ビューを開いたまま、service_role で別経路から (1) 予選結果を INSERT → リロードなしで「予選消化 0/6→1/6」＋試合結果セクション出現、(2) matches.scheduled_at を変更 → リロードなしで「次の試合」の時刻が 07/14 12:04→07/20 22:00 に更新、を確認。**両テーブル・匿名で届く**ことを確証。書き込みは backup→検証→**完全復元**（結果0件・日時あり2件＝元通り）。

### 次にやること
- 拡張候補は①②③④すべて完了。一区切り。次は実機で全体を触っての気づき拾い等、ユーザー判断待ち。

## 2026-07-15 — 観戦ビューに「次の試合」ブロックを追加（案Cハイブリッド）

観戦ビュー（/events/[id]/watch）に、直近の未消化試合を最大2件だけコンパクトに見せる「次の試合」ブロックを追加した。観戦者が「次はいつ・どのカードを・どこで見られるか」を上部で拾えるようにする（拡張候補②の静的表示部分）。

### やったこと
- ヒーローの下に独立カードとして「次の試合」ブロックを配置（Claude Design 案C＝ハイブリッド：次の1件を大きく・2件目は1行）。
  - 抽出＝**予選＋決勝Tを合流し、未消化（結果なし）かつ scheduled_at ありを日時昇順で先頭2件**。0件なら丸ごと非表示（既存の空セクション作法）。
  - データは新規取得なし。既存 `listGroupMatches`/`listTournamentMatches` が既に `scheduled_at`/`stream_url`/`streamer_name`/`best_of` を返していたので、ページ内の型に不足フィールドを足すだけで済んだ。
  - 表示ヘルパー: `jstParts`(年月日/時刻を部品化)・`relativeDayLabel`(今夜/明日/まもなく)を追加。既存 `roundLabel`/`fmtJstShort` は流用。
  - フェーズチップ=予選はブロック色背景、決勝Tはラウンド名。配信は stream_url があれば「▶ 配信を見る by 配信者」、なければ「配信予定なし」。BYE（片側null）は除外。
- 当初ヒーローに視覚連結（上角丸なし）していたが、ユーザー要望で**独立カードに分離**（mt-11・全周ボーダー・角丸2xl）。
- design-ref を軽量版で保管（docs/design-refs/watch-next-matches.html）。

### 決めたこと（なぜ）
- **観戦ビューに独立セクションとして追加**（新規ページは作らない）。既存6セクションと同じ `Section` 作法・トークンに揃えることが「浮かせない」正解（別で作り込む方がむしろ浮く）。
- **縦に伸ばしすぎない**懸念に対し、案C＝「次の1件だけ大きく・2件目は1行・最大2件・0件は非表示」で対応。イベント形式で出し分ける専用ロジックは書かず、「日時が入っているか」というデータで自然に出し分く。
- 拡張候補の再調査で、**①通知（Discord Bot DM 含む）は実装済み・③発見性（検索/フィルタ/並び替え）も一覧に実装済み**と判明。残る本物の候補は②（本項）と、そのRealtimeライブ更新（別PR）のみ。

### セキュリティ（レビューで発見・回収）
- **stream_url のストアドXSS を入力層で塞いだ**。`updateStreamSchema` の streamUrl が `.string().max(500)` のみでスキーム無制限だったため、`javascript:...` を保存でき、観戦ページ（匿名閲覧可）の `<a href>` でクリック実行される恐れがあった（React 自動エスケープは href スキームを消さない）。`new URL()` で http/https のみ許可する refine を追加。**この修正で既存の3描画箇所（matches-board / schedule-list / tournament-board）も同時に守られる**（深い＝スキーマ層での修正）。テスト6件追加。
- レビューでコメント孤立（ProgressChip の doc コメントが新コンポーネント挿入で TeamDot 上に残った）も指摘され修正。

### 確認
- `npm run check`（lint 0 error／typecheck OK／test 387 passed＝+6）。`npm run build` 成功。
- **実機（Playwright・のり視点）**: 「のり検証1」で featured（まもなくバッジ・大きな時刻・▶配信を見る by のり）＋2件目（決勝Tラウンド名・配信予定なし）を確認。0件時に丸ごと非表示になることも確認。書き込み（scheduled_at/stream_url の一時投入）は backup→検証→**完全復元**（14件 mismatch 0）。

### 次にやること
- ②のRealtimeライブ更新（結果入力の瞬間に予定・順位が自動更新）。着手可否はユーザー判断待ち。

## 2026-07-15 — イベント編集の定員下限制約（延期していた運用制約の回収）

イベント編集（feature/event-edit）着手時に「前提機能（応募/通知）が無い」ため意図的に延期していた運用制約のうち、**定員は減らせない（増やすのみ）**を実装した。前提機能が出揃った今の回収作業。

### やったこと
- `updateEvent`（Controller）に定員下限チェックを追加。**公開後（status != draft）に、新しい定員 < 現在の承認済みチーム数（`events.current_count`）なら保存を拒否**し、定員フィールドにエラーを返す。
  - `current_count` は承認済みチーム数の権威値（成立時 +1・approved チーム削除で -1・`capacity` と直接比較される既存カウンタ）。新規に数える必要がなく、読むだけで判定できた。
  - 想定内の失敗なので例外にせず戻り値（`fieldErrors.capacity`）で返す（実装ガイドライン準拠）。既存のバリデーションエラーと同じ扱いで定員欄の下に表示される。
- 併せて、古くなっていた `updateEvent` の doc コメントを実態に修正（**日程変更通知は既に実装済み**だった。「前提機能実装時に追加する」の記述を削除）。
- テスト3件追加（edit-action.test.ts）: 公開後に下回る定員は拒否／定員=現在数（境界）は締め出さないので許可／下書き中は下回っても許可。

### 決めたこと（なぜ）
- **制約は公開後のみ**（下書き中は自由に増減可）。下書きは `current_count` が実質 0 で守る対象が無く、既存の日程更新通知（`status != draft` で発火）と同じ思想で一貫させた。
- **境界（定員 = 現在数）は許可**。目的は「既に成立している応募者を締め出さない」ことなので、ちょうど埋まった状態にするのは正当。
- **保存を拒否してエラー表示**（警告だけで通さない）。締め出しを物理的に防ぐのが目的なので、通してしまうと目的を果たせない。
- **定員 null（無制限）への変更は常に許可**。上限を外す方向は誰も締め出さない。
- 調査で判明: 4つ挙げた拡張候補のうち **①通知（Discord Bot DM 含む）・③発見性は既に実装済み**だった（メモリが 13〜23 日前で古かった）。実際に残っていた本物の候補は ④（本項）と ②（観戦ビューの「試合予定」＝未消化試合を scheduled_at 順に並べる＋Realtime）の2つ。

### 確認
- `npm run check`（lint 0 error＝既存 actions.ts 警告のみ／typecheck OK／test 381 passed＝+3）。`npm run build` 成功。
- `/code-review high` → correctness 0件。capacity を書き込む全経路（createDraftEvent＝下書きで守る対象なし／publishEvent＝既存値をそのまま渡す／updateEvent＝本項でガード）を確認し、バイパス経路が無いことを確認。
- **実機（Playwright・のり視点）**: 「のり検証1」（current_count=5・capacity=10）で、定員3（<5）→ 定員欄に「定員は現在の承認済みチーム数（5）以上にしてください。」が出て保存されず／定員5（=5）→ 保存されイベント詳細へリダイレクト、を確認。**書き込みを伴うため capacity を 10 に完全復元**（current_count は不変）。

### 次にやること
- 残るは ②観戦ビューの「試合予定」セクション（未消化試合を scheduled_at 順・Realtime ライブ更新）。着手可否はユーザー判断待ち。

## 2026-07-14 — 目視レビューのフィードバック対応（文言修正5点＋バグ2点）

ユーザーの全画面目視確認で挙がった7点に対応。文言・スタイルの修正5点と、バグ/UX の修正2点。

### 文言・スタイル（5点）
- **① イベント作成のタイトル例文**: 「第7回 Matchpoint Open — シーズン中盤 5v5」→「第1回 Matchpoint Open」（AI っぽさの解消）。
- **② 通知ベル**: ヘッダーの絵文字 🔔 が浮いていたので、線画ベル SVG（`text-muted-foreground` ＋ hover で foreground）に置換。他ナビと同じトーンで馴染ませた。未読バッジ（ブランド色）は維持。
- **③ イベント詳細の日程タイル説明**: 「スクリム・練習の予定」→「試合の予定」。日程タイルは主催者/観戦者向けで公式戦（試合）が主目的（スクリム/練習はチームが管理し運営は不干渉）。schedule 画面本体の説明は現状維持（実際に3種を扱う画面なので）。
- **④ シリーズ化ボタンの色**: 主催者メニューの「シリーズ化する」がブランドオレンジで目立ちすぎ（大半のイベントは単発でシリーズ化は稀）。他メニュー項目と同じ `text-foreground/90` の控えめリンクに。
- **⑤ マイページの Discord 表記**: 「Discord アカウント（変更不可）」→「Discord から取得した名前です」。「アカウントを切り替えられない」という誤解を招く表記を、何が変更不可か（＝名前の出所）が伝わる形に。

### バグ/UX（2点）
- **⑥ ブロック分けが再描画されないバグ（修正）**: 「自動で振り分け」（`router.refresh()` 依存）を押しても画面に反映されず、リロードが必要だった。原因は `useState(initialGroups)` が初回マウント時の props で固定され、`router.refresh()` で props が変わっても state に反映されないこと。**page 側で `<GroupsBoard>` に「ブロック割当のシグネチャ」を key として渡し**、割当が変わると再マウント→最新状態で初期化されるようにした（effect 内 setState は lint 違反になるため key 方式）。ドラッグ等の楽観更新系は router.refresh を呼ばず props が変わらないので key も変わらず、楽観状態は保持される。**実機で自動振り分け→リロードなし再描画を確認**（テスト用に予選 matches を一時削除→検証→復元）。
- **⑦ トーナメント「上位N」の分かりにくさ（UX改善）**: 「上位6を選んでも8チームになる」の真因は **予選結果が未入力で全チームが同順位（rank=1）→ 上位N で絞れない**こと（ロジックは正常）。加えて、生成前プレビュー（`previewSeeded`）が props 由来で `advanceCount` 変更に追随していなかった。**修正**: (a) `seedTeams`（全ブロックの順位データ）と `teamNames` を props で渡し、クライアントで `extractSeededTeams` を `useMemo` で再計算して**プレビューを入力に追従**させた。(b)「進出予定 N チーム」の件数見出しと、「ブロックのチーム数超過は全員進出」「入力に応じて更新」の注記を追加。(c) **全チーム同順位（rank 未確定）のときは警告注記**「いまは全チームが同順位扱いのため、上位N を変えても全員進出。結果を入力すると絞り込める」を出す。**実機で未生成画面のプレビュー追従・警告注記を確認**（決勝T matches を一時削除→検証→復元）。

### コードレビュー（/code-review high）→ correctness 0件
- ⑥の key 方式が楽観更新と競合しないこと（router.refresh を呼ぶのは自動振り分けのみ）を確認。⑦の警告注記判定（全 rank=1）が「各ブロック1チーム」の稀ケースで文言不正確になる指摘を受け、文言を「いまは全チームが同順位扱いのため」に直して両ケース対応。

### 確認
- `npm run check`（lint 0 error＝既存 actions.ts 警告のみ／typecheck OK／test 378 passed）。`npm run build` 全ルート成功。
- **実機（Playwright・のり視点）**: ②⑤（マイページ）・①（作成タイトル例文）・③④（イベント詳細）・⑥（ブロック分け再描画）・⑦（トーナメント プレビュー追従＋警告注記）を確認。書き込みを伴う⑥⑦はテストデータをバックアップ→検証→**完全復元**（matches 14＝予選6/決勝8 に戻したことを確認）。

---

## 2026-07-14 — デザイン刷新 後始末: コンポーネント共通化（重複ヘルパー抽出）

デザイン刷新の過程で画面間に溜まった重複ヘルパーを共通コンポーネントに抽出。**見た目・挙動を変えない純粋なリファクタリング**（ロジック・Server Action は無関係）。`src/components/matchpoint/` に集約。

### 方針（過去の「共通化しすぎない」判断を踏襲）
- **「名前が同じ」と「実装が同じ」は別**。全定義を diff で厳密比較し、**確実に同一なものだけ**抽出。別物（型/ロジックが違う）は触らない（ScoreStepper で学んだ轍を踏まない）。

### やったこと（3コンポーネント抽出・7ファイルから重複削除・純減 -197行）
- **`FormCard` / `FormField`**（`form-card.tsx`）: event-form / apply-form / series-form の番号カード＋入力フィールド。3ファイルのローカル定義を削除して import に統一。**統一時にラベルの描画順を required(*)→opt に揃えた**（event-form は旧 opt→required だったので、開催開始/終了など required＋opt を両方持つ2フィールドで `JST *`→`* JST` に見た目が変わる。機能影響なし）。series-form は htmlFor/id 紐付け→label 内包に変更（暗黙ラベルで focus 挙動は同じ・id 参照は他に無いことを確認）。
- **`FilterTab`**（`filter-tab.tsx`）: events / mine の件数バッジ付きタブ。差分は `font-mono` 1クラスのみだったので font-mono 込みに統一（events のタブ件数も等幅に）。
- **`EventStatusBadge`**（`event-status-badge.tsx`）: events / mine / top の状態バッジ。mine が draft 対応（accent 色・✎・破線・bg 12%）の上位互換だったので**mine 版に統一**（events/top は draft を出さないので無害・bg 14%→12% の差は視認不可）。`STATUS_LABEL`・トーン色分けもここに内包し3ファイルの重複解消。

### 触らなかったもの（意図的・別物）
- **StatusBadge の他4種**（registrations=登録status・series=別statusColor・events/[id]=tone/labelを引数で受ける別API・teams=承認バッジ専用）は型もロジックも別。**共通化しない**（各画面ローカルのまま）。
- **EventCard**（events/mine/top で props やデータ形が違う）、**件数チップ**（SummaryCount/LegendChip は名前も中身も別物）。
- **Avatar**（`series/[id]/avatar.tsx`）は series 内でのみ使うので移動不要。

### コードレビュー（/code-review high）→ correctness 0件
- 8アングルで精査。抽出漏れ・未使用 import・id 削除の影響なしを確認。唯一の見た目変化（FormField ラベル順 `* JST`）を報告（意図的・目視確認時の注意点）。

### 確認
- `npm run check`（lint 0 error＝既存 actions.ts 警告のみ／typecheck OK／test 378 passed）。`npm run build` 全ルート成功。
- **実機（Playwright）**: events 一覧（FilterTab・EventStatusBadge）・イベント作成フォーム（FormCard/FormField）が刷新前と同じ見た目で描画されることを確認。**書き込みなし**。

### 次にやること
- ユーザーによる全画面の目視確認 → 違和感は修正・拡張は検討（②）。

---

## 2026-07-14 — デザイン刷新 ログイン（🏁 全画面のデザイン刷新 完了）

ログイン画面（`/login`）を Claude Design 案（`.theme-matchpoint`）で刷新。**デザイン刷新の最後の1画面**。**認証ロジック（`signInWithOAuth`・`safeRedirect`・OAuth フロー・loading/error・Suspense）は一切触らず、UI とデータ整形のみ**。案HTMLは `docs/design-refs/login.html`（軽量版）に保管。

### 情報設計の壁打ち（1論点を確定）
- **ブランド感のある中央カード**（中央寄せ1カードを維持しつつ上質化）。第一印象を決める画面なので少しリッチに。

### やったこと
- **login/page.tsx**: `.dark`→`.theme-matchpoint`。**背景ステージ**（ブランド＋アクセントの radial-gradient グロー＋グリッド線・中央フェードマスク）＋**カード**（surface グラデ＋上端のブランド→アクセントのグラデ帯＋発光ロゴドット）。ロゴ「● Matchpoint」＋kicker「Sign in」＋タイトル＋lede。**Discord ボタン**（`--mp-discord` #5865F2・Discord アイコン・ローディング時スピナー＋「リダイレクト中...」・disabled）。エラー表示（⚠・role=alert）。区切り＋「← トップに戻る」（`/` 実在）。

### 案と現行のギャップ（現行を優先）
- **案の左上ミニヘッダーは実装しない**（ルートレイアウトが共通 `<SiteHeader />` を全ページに出すため二重になる）。**規約/プライバシーリンクは作らない**（実在しないページ・プロンプトの「実在しない導線を作らない」に従いテキストも省略）。Discord 以外のログイン手段・メール欄なども無し。

### コードレビュー（/code-review high）→ 1件修正
- **min-h の magic number**: `min-h-[calc(100vh-3.5rem)]` が SiteHeader の実高さ（h 固定でなく py-3＋内容依存 ~64px）と一致せず中央が僅かにズレる/短い viewport でスクロールの恐れ。→ 原状の `min-h-screen`（magic number 非依存・ヘッダーが自然に押し下げる）に戻して解消。`safeRedirect`・OAuth・loading/error・Suspense は不変を確認。

### 確認
- `npm run check`（lint 0 error＝既存 actions.ts 警告のみ／typecheck OK／test 378 passed）。`npm run build` 全ルート成功。
- **実機（Playwright）**: 背景グロー/グリッド・カードのグラデ帯・ロゴ・kicker/タイトル/lede・Discord ボタン（`rgb(88,101,242)`＝#5865F2 が tree-shake されず色付き・アイコン付き）・「← トップに戻る」を確認。ローディング/エラーは state 依存（実 OAuth は発火させず、条件分岐はコードで担保）。**書き込み・OAuth 発火なし**。

### 🏁 デザイン刷新フェーズ 完了
**全20ページの `.dark` → `.theme-matchpoint` 刷新が完了**。フォーム系（new/edit/apply）→運用画面（registrations/mine/schedule/notifications）→シリーズ3画面→ログイン、と全画面を Claude Design 案ベースで刷新。各画面「実装＋devlog＋関連 doc 更新」を1セット・code-review high・Playwright 実機確認を通した。

### 次にやること（デザイン刷新の後始末・任意）
- **follow-up: コンポーネント共通化**。刷新済み画面間で重複したヘルパーを `src/app/events/_components/`（または共通 UI）へ抽出する候補が溜まっている: フォーム系の `Card`/`Field`（new/edit/apply）、一覧系の `EventCard`/`StatusBadge`/`FilterTab`（events/mine/series）、件数チップ（registrations/notifications/mine）、頭文字 `Avatar`（series）。区切りのよいところで着手する。
- 機能開発に戻る場合は `docs/デザイン刷新-引き継ぎメモ.md` は役目を終える（刷新は完了）。

---

## 2026-07-13 — デザイン刷新 シリーズ3画面（一覧/詳細/作成）

シリーズ（継続企画）の3画面（`/series` 一覧・`/series/[id]` 詳細・`/series/new` 作成）を Claude Design 案（`.theme-matchpoint`）でまとめて刷新。**判定・保存ロジック（Server Action `createSeries`/`inviteMember`/`removeMember`/`respondInvite`/`searchInviteCandidates`・立場判定 isStaff/isOwner/isInvited）は一切触らず、UI とデータ整形のみ**。案HTMLは `docs/design-refs/series-{list,detail,new}.html`（軽量版）に保管。

### 情報設計の壁打ち（4論点を確定）
- **3画面まとめて1PR**（相互遷移する小グループ・デザイン言語を揃えて一気に）。
- **一覧＝/events 風カードグリッド**、**詳細＝1カラム・ヒーロー＋セクション**（events/[id] 作法）、**作成＝event-form 風の1カードフォーム**（.mp-form・番号カード）。
- **管理パネル＝カード内に行＋.mp-form 検索**（現行構造維持・上質化・invitedIds/confirm 不変）。
- **頭文字アバターを使う**（discord_avatar_url でなく名前の頭文字＋決定的グラデ・外部画像依存なし）／**メタ件数は現行が持つ分だけ**（オーナー/開催回/運営・フォロワー数はクエリ追加になるので出さない）。

### やったこと
- **series/page.tsx（一覧）**: `.dark`→`.theme-matchpoint`。見出し行（kicker「Series」＋件数＋lede＋作成ボタン〔ログイン時〕）＋カードグリッド（左アクセント帯を id から決定色・name＋説明・矢印）＋空状態（作成可否で導線変更）。**listSeries は id/name/description のみ（開催回数・オーナーを持たない）ので一覧では出さない**。
- **series/new/page.tsx＋series-form.tsx（作成）**: パンくず＋ヒーロー＋「01 基本情報」カード（.mp-form の name/description）。**本人専用リダイレクト・createSeries・fieldErrors は不変**。
- **series/[id]/page.tsx（詳細）**: ヒーロー（紫アクセント・SERIES＋タイトル＋FollowButton〔既存流用〕＋メタ〔オーナーアバター/開催回/運営〕＋説明＋「次の開催回を作成」〔isStaff〕）＋開催回セクション（#番号・status バッジ・矢印）＋運営メンバー（owner=管理パネル / 非owner=読み取りチップ）。**立場判定・FollowButton・?series= プリフィル導線は不変**。
- **members-panel.tsx**: admin-note＋メンバー行（アバター・ロールチップ〔★オーナー/運営/⏳招待中〕・左アクセント帯・削除/退会/取消）＋検索招待（.mp-form・検索アイコン付き input）。**confirm 削除・検索 submit・invitedIds 管理・Server Action は不変**。
- **invite-banner.tsx**: warning バナーを上質化（アイコン＋承認/辞退）。**respondInvite・承認/辞退ロジック不変**。
- **avatar.tsx（新規）**: 頭文字アバターの共通コンポーネント（server/client 両対応・純粋）。page と members-panel で共有。

### 案と現行のギャップ（現行を優先）
- サイトヘッダー・toast・「シリーズを編集」ボタン（編集機能なし）・add-round 破線ボタン（「次の開催回を作成」に統一）・フォロワー数・検索リアルタイム（submit 維持）はデモ専用/現行維持で不採用。案の `esc()`/innerHTML 文字列組み立ては React 自動エスケープに置き換え（dangerouslySetInnerHTML 禁止）。

### コードレビュー（/code-review high）→ 指摘なし
- 8アングルで3画面を精査。立場ゲート・5つの Server Action バインド・confirm 削除・invitedIds・検索フロー・XSS を維持。avatar 抽出はクリーン。

### 確認
- `npm run check`（lint 0 error＝既存 actions.ts 警告のみ／typecheck OK／test 378 passed）。`npm run build` 全ルート成功。
- **実機（Playwright・のり視点）**: 実データ空だったため**テストデータ（シリーズ2件＋series_members〔owner=のり active／admin active／admin invited〕＋開催回2件紐付け）を REST 投入 → 確認 → 全削除で原状復帰**（シリーズ0・series_id付きevent 0）。一覧（カードグリッド・説明なしカード）、詳細（owner 視点＝ヒーローメタ・開催回・管理パネル・招待中・検索フロー〔「D30タンク盾」検索→＋招待ボタン〕）、作成フォームを確認。**招待/削除/作成の書き込みは実行せず**。

### デザイン刷新の進捗
**刷新済み19 / 未刷新1**（残り: `/login` のみ）。次で完了。

### 次にやること
- `/login`（軽い・単独）を刷新すれば**全画面のデザイン刷新が完了**。

---

## 2026-07-13 — デザイン刷新 運用画面: 通知一覧（運用画面フェーズ完了）

通知一覧ページ（`/notifications`）を Claude Design 案（`.theme-matchpoint`）で刷新。**運用画面フェーズ（registrations / mine / schedule / notifications）の最後**。**判定・保存ロジック（Server Action `markRead`・クリック既読化＋遷移・XSS 対策）は一切触らず、UI とデータ整形のみ**。案HTMLは `docs/design-refs/notifications.html`（軽量版）に保管。

### 情報設計の壁打ち（2論点を確定）
- **行カード＋未読サマリー**（未読を左帯＋ブランド背景で強調・既読は控えめ）。通知に**種別（type）列は無い**（notifications テーブルは title/body/link_url/is_read/created_at のみ）ので**共通ベルアイコンで統一・色分けしない**（テキストからの推測もしない）。
- **「すべて既読にする」は追加しない**（新規 Server Action が要る＝今回の「UI のみ」スコープ外）。
- 日時は**絶対日時のみ**（相対時刻は現在時刻依存で hydration mismatch/分ズレのリスクがあり見送り）。

### やったこと
- **page.tsx**: `.dark`→`.theme-matchpoint`。パンくず＋ヒーロー（kicker「お知らせ」＋タイトル「通知」＋補足＋**未読件数チップ**〔取得済み配列を is_read=false で数えるだけ・未読ありでブランド強調〕）。リスト見出し＋空状態を刷新（共通 `BellIcon`）。**本人専用リダイレクト・listMyNotifications は不変**。
- **notification-item.tsx**: 行カード（ベルアイコン＋未読は青ドット・未読=左アクセント帯＋強調背景・既読=通常）。title は太さ、body は任意、日時 mono、link ありで矢印＋hover。**handleClick（未読なら楽観的既読→markRead→link_url へ push・link 無しは既読化のみ）・XSS（title/body は React 自動エスケープ・innerHTML で組み立てない）は現行を厳密踏襲**。

### 案と現行のギャップ（現行を優先）
- サイトヘッダー・ヘッダー通知バッジ・toast はデモ専用/新規基盤で不採用。相対時刻・イベント委譲（案は listEl に addEventListener）は採らず、現行の React 各アイテム onClick を維持。案の DOM 構築（createElement+textContent）は React 自動エスケープに置き換え。

### コードレビュー（/code-review high）→ 指摘なし
- 8アングルで精査。handleClick・XSS・未読/既読分岐・link 矢印ゲート・props 契約を維持。ベル SVG/チップの軽微な重複は既知の共通化 follow-up と同テーマで許容。

### 確認
- `npm run check`（lint 0 error＝既存 actions.ts 警告のみ／typecheck OK／test 378 passed）。`npm run build` 全ルート成功。
- **実機（Playwright・のり視点）**: 通知が実データ空だったため**テストデータ（notification_events 6＋notifications 6件〔未読3/既読3・link あり/なし・body あり/なし〕）を REST 投入 → 確認 → 全削除で原状復帰**（notifications 0・test events 0）。ヒーロー未読チップ・未読/既読の見た目分岐・link 矢印・body 有無を確認。**未読1件をクリック → link 先へ遷移 → 戻ると既読化され未読 3→2**（markRead が効いていることを実証）。

### デザイン刷新の進捗
運用画面フェーズ完了。**刷新済み16 / 未刷新4**（残り: `/series` 3画面・`/login`）。

### 次にやること
- 残り: `/series` 3画面（一覧/詳細/作成・まとめて刷新が効率的）、`/login`（軽い・単独）。次はシリーズ3画面 or login。

---

## 2026-07-12 — デザイン刷新 運用画面: 日程・スクリム予定

チーム日程ページ（`/events/[id]/schedule`）を Claude Design 案（`.theme-matchpoint`）で刷新。公式戦/スクリム/練習を種別色分けで時系列に並べるリスト＋登録/編集モーダル。**判定・保存ロジック（Server Action `createScrim`/`editScrim`/`removeScrim`・Zod・`buildScheduleItems` の並び替え/消化ライン/濃淡判定）は一切触らず、UI とデータ整形のみ**。案HTMLは `docs/design-refs/schedule-team.html`（軽量版）に保管。

### 情報設計の壁打ち（2論点＋2判断を確定）
- **縦リスト・種別左帯を上質化**（未消化を上・消化済みを下に薄く、の2セクションを維持）。
- **モーダル維持・.mp-form で上質化**（種別ラジオをセグメント風トグルに）。
- **削除確認は現行の confirm() を維持**（案の確認モーダルは新規 state が要るので不採用）。
- **種別色は案の色をインラインで使う**（公式戦 #F2596B / スクリム #4C9BE8 / 練習 #3FD08A）。ロール識別色とは別物。

### やったこと
- **page.tsx**: `.dark`→`.theme-matchpoint`。パンくず＋ヒーロー（kicker「チーム日程」＋タイトル「日程」＋イベント名＋**種別凡例チップ**〔件数付き・`LegendChip`〕＋注記）。**buildScheduleItems・canManage 判定は不変**。
- **schedule-list.tsx**: **日付ブロック**（M/D(曜)＋時刻＋年）＋種別の左アクセント帯/色ドット/バッジの行カード。他チーム公式戦は減光（emphasis=other）、消化済みセクションは薄く。公式戦（自チーム）に**「自動生成」ロック表示**、scrim/practice に編集✎/削除🗑 アイコンボタン。配信リンクは消化済みで「アーカイブを見る」。登録/編集モーダルを上質化（blur・ヘッダー・**種別セグメント `KindOption`**・`.mp-form` 入力・フッター）。**DateTimePicker（既存）・送信 name（kind/scheduledAt/opponentName/memo）・scrim のみ相手欄・成功で閉じる・confirm 削除・editable/canManage ゲートは不変**。

### 案と現行のギャップ（現行を優先）
- 立場切替セグメント（view-switch）・toast はデモ専用/新規基盤なので不採用。案の独自 DateTimePicker でなく既存コンポーネントを使用。案の `esc()` 文字列組み立ては移植せず React 自動エスケープに任せる（dangerouslySetInnerHTML 禁止・CLAUDE.md）。相手 maxLength は現行 schema の 60 を維持（案は 40）。

### コードレビュー（/code-review high）→ 指摘なし
- 8アングルで精査。JST 変換・Server Action バインド・送信 name・権限ゲート・種別分岐・confirm 削除を維持。追加要素（自動生成ロック・アーカイブ表記・メモ折り返し）は表示の質向上で回帰なし。

### 確認
- `npm run check`（lint 0 error＝既存 actions.ts 警告のみ／typecheck OK／test 378 passed）。`npm run build` 全ルート成功。
- **実機（Playwright・主催者視点）**: scrims/matches が実データ空だったため**テストデータ（scrim 3件〔スクリム/練習・未消化/消化済み〕＋公式戦 1件〔配信付き〕）を REST 投入 → 確認 → 全削除で原状復帰**（scrims 0・sched付きmatches 0 に戻したことを確認）。ヒーロー凡例・日付ブロック・種別バッジ/左帯・自動生成ロック・配信リンク・消化済み・モーダル（種別セグメント・日時プリフィル・練習で相手欄が消える分岐）を確認。**保存/削除の書き込みは実行せず**。

### 次にやること
- 残り運用画面: `/notifications`（通知一覧）。その後 `/series` 3画面・`/login`。引き継ぎメモの優先度を更新。

---

## 2026-07-11 — デザイン刷新 運用画面: 自分のイベント一覧（主催者）

自分のイベント一覧（`/events/mine`）を Claude Design 案（`.theme-matchpoint`）で刷新。刷新済みの公開イベント一覧（`/events`）の姉妹画面として作法を完全に揃えた。**遷移規則・取得ロジックは不変・UI とフィルタ整形のみ**。案HTMLは `docs/design-refs/mine-organizer.html`（軽量版）に保管。

### 情報設計の壁打ち（2論点を確定）
- **`/events` と同じカードグリッド**（sm:2列/lg:3列）。EventCard/StatusBadge/FilterTab/EmptyState の作法を踏襲。
- **ステータスタブ（下書き含む）**「すべて/下書き/公開中/終了」。mine は主催者本人の画面なので **draft を独立タブ**で扱う（`/events` は公開のみで draft を出さない）。

### やったこと
- **event-list-filter.ts（Service 層）**: mine 専用の純粋関数を追加（`MyEventsTab`・`MY_TAB_LABEL`・`normalizeMyTab`・`statusesForMyTab`・`countByMyTab`）。**既存の `/events` 用（`TAB_*`）は変更せず分離**。`statusTone` に `draft` トーンを追加（`StatusTone` union を拡張）。`/events`・トップの `StatusBadge` は三項フォールバックなので draft 追加でも無害（draft はそこで描画されない）ことを確認。
- **event-list-filter.test.ts**: mine 用関数のテスト11件を追加（367→378）。draft の網羅・normalize の安全弁・件数の網羅性。
- **mine/page.tsx**: `.dark`→`.theme-matchpoint`。見出し行（kicker「My Events」＋総件数＋作成ボタン）＋4タブ（件数バッジ・URL クエリ `?tab=` で絞る）＋カードグリッド。EventCard に**詳細/編集の管理導線**を追加。**下書きカードは破線＋トーン減＋編集ボタンをブランド色**（公開を促す）、**終了カードは減光**。空状態を刷新（タブ別文言）。**未ログイン→/login・detailHref（draft=uuid / 公開=slug）・編集=uuid・取得順は不変**。

### 案と現行のギャップ（現行を優先）
- サイトヘッダーはデモ専用なので実装しない。status 名は案の独自名（open/live/ended）でなく現行（draft/published/…/finished）→ StatusBadge のトーンでマッピング。フィルタは `/events` と同じ URL クエリ方式。

### コードレビュー（/code-review high）→ correctness 指摘なし
- 共有 `statusTone` の draft 追加が3利用箇所（mine/events/top）すべてで安全なことを確認。フィルタは Service 層＋テスト。FilterTab 等が `/events` と重複（follow-up・共通化候補）だが今回はスコープ外。

### 確認
- `npm run check`（lint 0 error＝既存 actions.ts 警告のみ／typecheck OK／test 378 passed）。`npm run build` 全ルート成功。
- **実機（Playwright・主催者視点）**: のり（draft 6・published 6）で全タブ・カード・空状態を確認。下書き=破線＋ブランド色の編集ボタン、公開=実線＋控えめ、下書きタブで draft のみ絞り込み、終了タブ(0件)で空状態を確認。**書き込みなし**（閲覧・タブ切替のみ）。

### 次にやること
- 残り運用画面: `/events/[id]/schedule`（日程）、`/notifications`（通知一覧）。次は schedule か notifications。引き継ぎメモの優先度を更新。
- **follow-up 継続**: フォーム系（Card/Field）＋一覧系（EventCard/StatusBadge/FilterTab）で刷新済み画面間のコンポーネント重複。区切りで `src/app/events/_components/` に共通化を検討。

---

## 2026-07-11 — デザイン刷新 運用画面: 応募者一覧・承認（主催者）

応募者一覧・承認ページ（`/events/[id]/registrations`）を Claude Design 案（`.theme-matchpoint`）で刷新。主催者の運用画面の第一歩。**判定・保存ロジック（Server Action `decideRegistration`・`overrideRegistrationScore`・スコア計算）は一切触らず、UI とデータ整形のみ**差し替え。案HTMLは `docs/design-refs/registrations-organizer.html`（軽量版）に保管。

### 情報設計の壁打ち（3論点を確定）
- **リッチな行カードの縦リスト**（現状の1応募=1行を維持しつつ上質化）。テーブル/ステータス別セクション分けは不採用（横スクロールや新規グループ化ロジックが増えるため）。
- **ヒーローに件数サマリーチップ**（応募 N / 承認待ち N〔warning強調〕/ 参加確定 N）。取得済み配列を status で数えるだけ（新規クエリ不要・全立場に公開）。
- **詳細モーダル維持・見た目を上質化**（陳腐化対策の「保存後に閉じる」現行挙動を維持）。

### 案と現行のギャップ（現行を優先）
- **立場切替セグメント（view-switch）はデモ専用UIなので実装しない**（実際は page.tsx がサーバー側で isOrganizer を決める）。
- **スコア再計算はしない**（案は tier/div から pt を再計算するが、現行は保存済み individual_score/final_score/score_breakdown を表示するだけ）。モーダルのランクグリッドは `breakdown.grid`＋`scoreToRankLabel` を使い、pt 列は現行に無いので出さない。
- **toast・アバターは入れない**（ユーザー選択：モーダルのグリッド化のみ採用）。承認/却下のフィードバックは現行のインラインエラー表示のまま。

### やったこと
- **page.tsx**: `.dark`→`.theme-matchpoint`。パンくず＋kicker＋ヒーロー（件数サマリーチップ `SummaryCount`）。非主催者向けの info バナー。リスト見出し＋空状態を刷新。**RegistrationRowData の構築・プライバシー分岐（Discord名は主催者のみ）は不変**。
- **registration-row.tsx**: リッチな行カード（表示名＋`StatusBadge`＋希望ロールの色チップ `PrefChips`〔第1→第2→第3・`--mp-tank/dps/support`〕＋メタ行＋右にスコア〔mono・上書きバッジ〕）。ステータス別の左アクセント帯（pending=warning・approved=success）・不参加/取り下げは減光。承認/却下ボタン（主催者・pending のみ）。詳細モーダルを上質化（blur・適用スコア・**ランクグリッド `RankGrid`**・算出内訳・上書き入力）。**Server Action 呼び出し・`canManage`/`showScore` ゲート・保存後に閉じる挙動は不変**。

### コードレビュー（/code-review high）→ 指摘なし
- 8アングルで精査。データ契約・プライバシー分岐・Server Action を忠実に維持しており correctness の回帰なし。cleanup も対応不要と判断。

### 確認
- `npm run check`（lint 0 error＝既存 actions.ts 警告のみ／typecheck OK／test 367 passed）。`npm run build` 全ルート成功。
- **実機（Playwright・主催者視点）**: のり検証1（応募38件）でヒーロー件数サマリー・行カード・希望ロール色チップ・詳細モーダルを確認。承認待ちの見た目（warning バッジ・左帯・承認/却下ボタン）確認のため**1件を一時 pending に変更 → 確認後 approved に復元**（DB クリーン）。ランクグリッドは grid ありデータ（実機検証カップ）で DPS/タンク/サポート×3シーズン・未認定扱い・到達ボーナス+2・小数スコア 30.8 が正しく出ることを確認。**承認/却下・上書きの書き込みは実行せず**。

### 次にやること
- 残り運用画面: `/events/[id]/schedule`（日程）、`/events/mine`（自分のイベント一覧）、`/notifications`（通知一覧）。次は mine か schedule。引き継ぎメモの優先度を更新。

---

## 2026-07-11 — デザイン刷新 フォーム系: 応募フォーム（参加者）

応募フォーム（`/events/[id]/apply`）を Claude Design 案（`.theme-matchpoint`）で刷新。**参加者が触る唯一のフォーム**。直前に刷新したイベント作成/編集フォーム（`.mp-form` スコープ・Card/Field 作法）を「正」として揃えた。**判定・保存ロジック（Server Action `registerWithScore`・Zod・希望ロールの conflict/自動決定・ランクグリッドの name 契約）は一切触らず、UI とデータ整形のみ**差し替え。案HTMLは `docs/design-refs/apply-form-participant.html`（軽量版）に保管。

### 情報設計の壁打ち（3論点を確定）
- **セクション = 番号付き3カードに統一**（01 プロフィール〔登録名＋バトルタグ〕/ 02 希望ロール / 03 ランク申告）。登録名＋バトルタグは短いので1カードに集約。
- **ランクグリッド = 現行構造維持で見た目だけ上質化**。ロール見出しにロール識別色ドット（`--mp-tank/dps/support`）＋英字タグ（Tank/Damage/Support）、シーズン列に「最新シーズン/1つ前/2つ前」＋`S-0` mono タグ、各ロールを surface-2 の枠カードに。
- **到達ボーナスは「03 ランク申告」カード末尾に同居**（useBonus のときだけ・区切り線）。独立カードにすると非表示時に番号が飛ぶため回避。

### 案と現行のギャップ（現行契約を優先）
- **送信 name を現行に統一**: 案の `rolePref*`/`rank[..]`/`peakBonus` は使わず、現行の `preferredRole1/2/3`・`rank_{role}_{s}`・`peak` を維持（サーバーが読む名前）。design-ref HTML も現行 name に直して保管。
- **ランク選択肢は `buildOverwatchRankDefinitions()` の score/label を使用**（案のハードコード `t*5+(6-d)` は使わない）。未認定既定・optgroup も現行どおり。
- **デモ専用UI（サイトヘッダー・イベントメタストリップ・「締切まで編集可」lede）は入れない**（page.tsx に実データが無い・編集フロー未実装のため現行 lede を維持）。

### やったこと
- **apply-form.tsx**: form ルートに `.mp-form`。3カード（Card ヘルパー）＋ Field ヘルパー（event-form と同作法。**grid 段ズレ対策として Field 自身は余白を持たず親 gap に一元化**）。第3希望を「🔒＋ロール色ドット＋自動・編集不可タグ」の readOnly ボックスに。conflict エラーはアイコン付き＋両 select に赤枠（`.mp-invalid`）＋送信無効化。role_swap=false は第1希望ロールのみ申告（現行の連動を維持）。
- **page.tsx**: `.dark`→`.theme-matchpoint`、`max-w-[720px]`。パンくず＋kicker「参加者エントリー」＋タイトル（イベント名をブランド色）＋lede に刷新。**リダイレクトガード（主催者/下書き/スコアなし/応募済み）は不変**。
- **globals.css**: `.mp-form .mp-invalid`（エラー時の赤枠）を追加。

### コードレビュー（/code-review high）→ 確定1件を修正
- **希望ロールのサーバー検証エラー（fe.preferredRole1）を「第2希望」Field に誤って紐付けていた** → ペア直下の代表表示に移動（どのロール欄が問題かを誤認させない）。
- **Card/Field が event-form.tsx と重複**（プロップ順に軽微ドリフト）→ 共通化候補だが今回はスコープ外（`events/_components/` 抽出は follow-up）。段ズレバグの再発が無いことは確認済み。

### 確認
- `npm run check`（lint 0 error＝既存 actions.ts 警告のみ／typecheck OK／test 367 passed）。`npm run build` 全ルート成功。
- **実機（Playwright・参加者視点）**: 全イベントの主催者が「のり」でガードに弾かれるため、**主催者/応募済みガードを一時無効化して確認 → 確認後に完全復元**（コミットには含めない）。swap あり（のり検証1）＝3ロールカード＋色ドット＋ボーナス、swap なし（OSL200）＝第1希望ロールのみ表示＆第1希望変更で連動、conflict で両 select 赤枠＋送信無効、ランク optgroup が40段階＋未認定で出ることを確認。**書き込み（応募）は試さず**DB汚染なし。

### 次にやること
- 残り未刷新（優先度 中）: `/events/[id]/registrations`（応募者一覧・承認）、`/events/[id]/schedule`、`/events/mine`、`/notifications`。フォーム系は一段落。次は registrations か mine あたり。引き継ぎメモの優先度を更新。
- **follow-up**: フォーム系3画面で重複した Card/Field を `events/_components/` に共通化（プロップ順の統一も兼ねる）。

---

## 2026-07-10 — デザイン刷新 フォーム系: イベント作成/編集フォーム

イベント作成（`/events/new`）・編集（`/events/[id]/edit`）の共通フォーム（`event-form.tsx`）を Claude Design 案（`.theme-matchpoint`）で刷新。作成と編集は同じ `EventForm` を共有するので**セットで1PR**。**判定・保存ロジック（Server Action・Zod スキーマ・トグル表示制御・タイブレーク D&D・hidden input 送信契約）は一切触らず、UI とデータ整形のみ**差し替え。案HTMLは `docs/design-refs/event-form-organizer.html`（軽量版・並べ替え済み）に保管。

### 情報設計の壁打ち（3論点を確定）
- **全体レイアウト = 1カラム・セクション強化**（現状の縦積みを維持しつつ各設定群をカード化）。2カラム＋サマリーレールは項目数的にレール側が瘦せるため不採用。
- **セクション = 全て番号付きカード**（01 基本情報 / 02 スコアリング / 03 本戦 / 04 順位 / 05 Discord）。フォームは常に全カード表示（トグルで中身が畳まれるだけ）なので番号は 01〜05 固定でよい（観戦ビューのような連番調整は不要）。
- **Discord 連携を最下部（05）へ移動**（ユーザー要望）。イベントのルールとは無関係の +α 機能なので、ルール系（基本/スコア/本戦/順位）の後ろに置く。案の 03 から末尾へ振り直し、`sub="任意・+α"` を付与。

### やったこと
- **event-form.tsx**: ルート `form` に `.mp-form` を付与。設定群を `Card`（番号付き kicker 見出し）に分割。チェックボックスを `Toggle`（sr-only input＋`peer-checked` でブランド色＋チェックマーク）に共通化。親→子→孫は `Nest`（左ボーダー＋インデント）。`Field` は `opt`（任意/JST 等）・`hint` を受けられるよう拡張。タイブレーク D&D カードにグリップ＋順位バッジを追加。**送信 name・controlled/uncontrolled の区別・teamScoreCap 単一フィールド・hidden(tiebreakers/series_id) は現行を厳密踏襲**。
- **new/page.tsx・edit/page.tsx**: `.dark`→`.theme-matchpoint`、`max-w-2xl`→`max-w-[720px]`。パンくず＋kicker「主催者ツール」＋タイトル＋lede のヒーローに刷新。
- **globals.css**: 入力要素の見た目（surface-3 背景・ブランド focus リング・select 矢印）を `.mp-form` スコープ（`@layer` 外の素ルール＝tree-shake 回避）で追加。フォーム配下限定で他画面に影響なし。

### コードレビュー（/code-review high）→ 確定1件を修正
- **grid 段ズレ（新規バグ）**: `Field` 直下に `[&+&]:mt-[18px]` を付けていたため、`grid-cols-2/3` の列2以降が18px下にズレて表示（ボーナス3列・勝分敗3列・申告/未認定・日時2列すべて）。→ Field から隣接余白を外し、縦間隔は親（`Card` body の `flex-col gap-[18px]` / `Nest` の gap / grid の gap）に一元化。実機で段ズレ解消を確認。
- 低優先の指摘（sr-only checkbox が `.mp-form ...:focus` にマッチ／input type 列挙の脆さ）は現状無害のため見送り。

### 確認
- `npm run check`（lint 0 error＝既存 actions.ts 警告のみ／typecheck OK／test 367 passed）。`npm run build` 全ルート成功。
- **実機（Playwright・主催者視点）**: 作成＝5カード・番号・トグル・形式分岐（トーナメントのみで BO 非表示・3位決定戦ラベル切替）・順位 D&D を確認。編集＝実データ（のり検証1）で日時 UTC→JST 復元・トグル復元（スコア/ボーナス/上限/順位）・タイブレーク順序復元を確認。**書き込みは試さず**原状復帰不要。

### 次にやること
- 残り未刷新画面（優先度 中）: `/events/[id]/apply`（応募）、`/events/[id]/registrations`、`/events/[id]/schedule`、`/events/mine`、`/notifications`。次は apply か registrations あたり。引き継ぎメモ（`docs/デザイン刷新-引き継ぎメモ.md`）の優先度リストを更新する。

---

## 2026-07-10 — デザイン刷新 第10画面（最終）: 観戦ビュー（集約ダッシュボード化）

観戦ビューページ（`/events/[id]/watch`）を Claude Design 案（`.theme-matchpoint`）で全面リデザイン。**デザイン刷新の最終画面**。他の刷新済み画面（ブロック/対戦表/トーナメント）の"ダイジェスト"を1ページに集約する観戦者向けダッシュボード。**判定・集計ロジック（standings 計算・BYE判定・勝者・進捗）は既存を流用**、UI とデータ整形のみ差し替え。案HTMLは `docs/design-refs/watch-spectator.html`（軽量版）に保管。

### 情報設計の壁打ち（4論点を確定）
- **全体レイアウト = 縦積み1カラム・リッチ化**。中央対向2カラム/グリッドは空セクション非表示（進行に応じて増える）挙動と相性が悪く不採用。時系列で読み下す「大会の物語」。
- **各セクション = ダイジェスト**（詳細画面のデザイン言語で凝縮・フル機能は各詳細ページへ）。
- **ヒーロー = 進捗チップ＋優勝ゴールド**（参加数/ブロック数/予選消化 12/16/決勝進行、優勝確定時🏆ゴールド）。
- **観戦者要素 = 配信📺を控えめに**（結果/トーナメントカード）。注目試合ハイライト・LIVE強調は見送り。

### 案と現行のギャップ（現行優先で調整）
- **順位**は案に合わせ勝分敗・得失も出す（computeStandings が既に計算済み・抽出を広げるだけ）。
- **チームのシード番号**は予選段階で未確定のため出さない（色スウォッチ＋ブロックバッジ＋代表★のみ）。
- **ステージ切替(stageseg)・LIVEチップ・サイトヘッダー**はデモ専用のため実装せず（実データの進行でセクション自動表示）。

### やったこと
- **watch/page.tsx**: `.dark`→`.theme-matchpoint`。パンくず＋ヒーロー（進捗チップ・優勝ゴールドチップ・観戦バナー）。5セクション（参加チーム/ブロック/予選順位/試合結果/決勝トーナメント）を Server Component 一本で描画（閲覧専用でインタラクション無し）。順位ダイジェスト（1位ゴールド・通過ライン）、結果カード（勝者強調・配信📺）、ブラケットダイジェスト（コネクタ線なし・勝者強調・BYE・優勝バナー）。**セクション番号は表示されるセクションだけ 01 から連番**（形式・進行で一部非表示でも飛ばさない）。プライバシー（登録名のみ）・空セクション非表示・slug/id 解決は既存挙動を維持。
- **_components/team-colors.ts / round-label.ts**: チーム識別色とラウンド名を共通化（server/client 両対応の純粋関数）。matches-board・tournament-board も差し替え。

### コードレビュー（/code-review high）→ 検出6件を全修正
1. **順位フィルタの既存バグを踏襲していた** — `standingsToShow` が引数を無視しグローバルな `finishedMatches.length` を見ていたため、結果0件のブロックでも全0点順位表が出ていた（コメントと矛盾）。各ブロック自身の `groupResults.length>0` で判定するよう修正。
2. **引分が両者敗者色**になっていた → 中立表示に修正。
3. **roundLabel のクロスファイル重複**（watch↔tournament）→ `_components/round-label.ts` に抽出。
4. 死んだ三項 `${champion ? "" : ""}` 削除。5. 未使用の型フィールド（scheduled_at/stream_url）削除。6. `blocksView` の色二重計算を `blocks` から派生させ解消。

### 確認
- `npm run check`（lint 0 error＝既存 actions.ts 警告のみ／typecheck OK／test 367 passed）。`npm run build` 全ルート成功。
- **実機（Playwright・観戦者視点）**: ヒーロー・進捗チップ・参加チーム（色/ブロックバッジ/★代表）・ブラケットダイジェストを確認。トーナメントに1試合結果を入れて**勝者の緑強調＋スコア＋自動進出**が観戦ビューに正しく伝播することを確認し、結果を取り消して原状復帰。セクション番号の連番化も確認。

### デザイン刷新フェーズ完了
第7〜10画面（ブロック/対戦表/決勝トーナメント/観戦ビュー）＋既存刷新分で、主要画面のリデザインが一通り完了。

### 次にやること
- [ ] （必要なら）予選結果ありの実データで順位・試合結果セクションの実機確認。

---

## 2026-07-09 — BO の上限を BO7 に統一（e-sports 実務の最大に合わせる）

BO（1試合のマップ数）の上限が BO15 まで設定できていたが、e-sports 業界の実務上の最大は BO7 のため、上限を BO7 に引き下げた。予選BO・トーナメントBO の両方が対象。

### 変更
- **UI**: `event-form.tsx` の予選BO入力 `max={15}→7`／`tournament-board.tsx` の `ODD_BO_OPTIONS` を `[1,3,5,7,9,11,13,15]→[1,3,5,7]`。
- **Zod（アプリ層の正）**: `events/schema.ts` の `groupBestOf` と `tournament/schema.ts` の `updateRoundBestOfSchema.bestOf` を `max(15)→max(7)`。
- **テスト**: `schema.test.ts` に「BO7 は成功／BO8 は失敗」の境界テストを追加（367 tests）。
- 関連コメントの「1〜15」を「1〜7」に統一。

### 決めたこと（なぜ）
- **DB の CHECK 制約（`best_of`/`group_best_of` between 1 and 15）は 15 のまま据え置き**、アプリ層（Zod）だけ 7 に絞る方針。理由: アプリ層で完全にガードされ 7 超えデータは入らず、DB CHECK は「最終防衛ライン」として広めに残すのが安全。BO上限を狭めるだけのためにマイグレーション（Supabase SQL Editor 手動適用）を1本増やすのは運用コストに見合わない（壁打ち確定）。
- `toOddBestOf` の内部 clamp（`n > 15 → 15`）も DB CHECK と整合するため据え置き。入力は Zod で 7 に絞られるため通常この clamp には到達しない旨をコメントに明記。
- 既存データは全て BO3（events 12件・matches 35件、REST で確認）で BO8+ は存在しないため、上限引き下げで既存データが編集不能になる問題はなし。

### 確認
- `npm run check`（lint 0 error＝既存 actions.ts 警告のみ／typecheck OK／test 367 passed）。
- 実機（Playwright）: tournament のラウンド別BOが BO1/3/5/7 の4択のみになったことを確認。

---

## 2026-07-09 — 決勝トーナメント（第9画面）のコードレビュー指摘6件を修正

第9画面（PR#97）に `/code-review high` を回し、検出6件を全修正した。うち2件は今回入れてしまった実リグレッション。UI・整形のみで判定・保存ロジックは引き続き未変更。

### 直した指摘
1. **BYE 誤判定（リグレッション）** — `matchState` が BYE 判定（1回戦・片側null）を `hasResult` より先に行っていた。DBの外部キーが `on delete set null` のため、結果入力済みの試合でチームが削除されると片側nullになり、**戦って決着した試合が「不戦勝」表示になりスコアが隠れる**不具合。`hasResult` を最優先に並べ替え。`slotState` も同様に done を先頭へ（削除チームの決着試合が「未定」表示になるのも解消）。
2. **BOピルが [1,3,5,7] のみ（リグレッション）** — `groupBestOf` は Zod で 1〜15 許容なのに、ラウンド別BOピルを4択に絞ってしまい **bestOf≥9 のラウンドが現在値も見えず変更不能**だった。旧 select と同じ `[1,3,5,7,9,11,13,15]` に戻した。
3. **日時・配信保存のエラー握り潰し** — `handleSchedule`/`handleStream` が `res.error` を読まず無条件 refresh していた。エラーを `validationError` に出すよう修正（旧 MatchDetail から引き継いだ挙動）。
4. **モーダルの useState 再シードなし** — 保存後・他者更新後に古い値が残る問題。`MatchModal` に**サーバー確定値を含む key** を付け、データが変わったら再マウントして編集フィールドを最新化。第8画面の live-resolution より確実。
5. **ScoreStepper のコピペ** — matches-board と byte 完全一致だったため `_components/score-stepper.tsx` に共通化し両画面で import。※MatchModal 本体は needsConfirm 確認・エラー処理・呼び出し配線が両画面で乖離しており、共通化するとかえって複雑化＋マージ済みファイルへの波及でレビュー負荷が増すため**今回は共通化を見送り**（判断を記録）。
6. **3位決定戦の magic number 散在** — `round===totalRounds && position===1` がボードとモーダルの複数箇所に散っていた。`BoardBracketMatch.isThirdPlace` を page.tsx で立て、判定を1箇所に集約。

### 確認
- `npm run check`（lint 0 error＝既存 actions.ts 警告のみ／typecheck OK／test 366 passed）。`npm run build` 全ルート成功。
- 実機ドライブは今回も未実施（Playwright のブラウザプロファイルが別セッションでロック中＋tournamentページは OAuth・実データが要る）。オーナーのローカルブラウザで確認予定。

### 次にやること
- [ ] 実機確認（生成→BYE表示→結果入力→勝ち上がり線→表彰台→観戦者クリック閲覧）。
- [ ] 残り画面（観戦ビュー）のデザイン刷新。

---

## 2026-07-09 — デザイン刷新 第9画面: 決勝トーナメント（本格ブラケット化）

決勝トーナメントページ（主催者/参加者/観戦者）を Claude Design 案（`.theme-matchpoint`）で**全面リデザイン**。この画面はもともと Claude Design に任せる前提で簡素なままだったため、第8画面（対戦表）以上に構造から作り替えた（縦積みの素朴なカラム → **コネクタ線付き本格ブラケット＋表彰台＋下部管理ツール＋セルクリックモーダル**）。**判定・保存ロジック（generateTournament・reportTournamentResult の needsConfirm 連鎖・recompute・swap・updateRoundBestOf・BYE/3位決定戦のデータ表現）は一切触らず**、UI とデータ整形のみ差し替え。案HTMLは `docs/design-refs/tournament-organizer.html`（軽量版）に保管。

### 情報設計の壁打ち（6論点を1つずつ確定）
本格ブラケットの弱点を、まっさらな状態からオーナーと1つずつ潰した（壁打ち確定）:
- **骨格 = 型A（左→右ツリー・コネクタ線）**。中央対向（型B）は3位決定戦/BYE/モバイル縮退が重すぎるため不採用。OW2 コミュニティの 4〜16 チーム規模に型Aが合う。
- **3位決定戦 = 決勝の真下に破線別枠**。本線のコネクタ線とは繋がない（勝ち上がり本線ではないため）。
- **BYE = 1回戦の片側 null カードに「BYE（不戦勝）」明示**。判定は `round===1 かつ 片側スロットだけ空`。2回戦以降の「未定（勝者待ち）」と区別。
- **レスポンシブ = 横スクロールのまま**。縦積みの別レイアウトは作らない（Challonge 等と同方針・主利用者は主催者PC）。
- **結果入力 = モーダルに統一**（第8画面 MatchModal と同作法）。インライン展開はカードが伸びてコネクタ線がずれるため不採用。
- **管理ツール = 未生成は中央パネル大きく / 生成後は下部ツールバー**（マトリクスのツールバー思想と統一）。

### 案と現行ロジックのギャップ（相談して確定）
- **POTG**: 案は「チーム選択＋選手名テキスト」だが、現行は「各チームの取得数（数値）」で順位タイブレークに使う確定設計。**現行の取得数ステッパーを維持**（選手名は見送り。DBスキーマ変更＋validatePotg作り直し＋順位波及が重いため別途）。
- **マップ名併記**: 現行はマップ名を保存しないため見送り（MAP 1 ラベルのみ）。
- **トーナメント削除ボタン**: 現行に無い新機能のため見送り（案の「削除」は入れず「作り直す」1つ）。

### やったこと
- **globals.css**: 表彰台の銀銅 `--mp-silver`/`--mp-bronze` を追加。インライン style 専用なので tree-shake 対策として `.theme-matchpoint` の素ルールにも再宣言（第8画面で踏んだ MP トークン削られ問題の再発防止）。
- **page.tsx**: `.dark` → `.theme-matchpoint`。パンくず＋ヒーロー（kicker「BRACKET · <立場>」＋ゲーム/参加数/ラウンド数/決着チップ＋導線）。参加チーム数・ラウンド数・優勝名を派生値として算出。
- **tournament-board.tsx**: 全面リデザイン。`Bracket`（SVG曲線コネクタを `getBoundingClientRect` で実測して描画・親子は position floor(pos/2)）／`PodiumPanel`（優勝ゴールド演出）／`BracketCard`＋`ScoreSlot`／`SwapSlot`（1回戦D&Dは維持）／`GeneratePanel`（未生成・中央）／`OrganizerToolbar`（下部・再生成＋ラウンド別BOピル）／`MatchModal`（第8画面と同構造・needsConfirm確認フロー維持・成功時のみ閉じる）。

### 確認
- `npm run check`（lint 0 error＝既存 actions.ts 警告のみ／typecheck OK／test 366 passed）。`npm run build` も全ルート成功。
- Tailwind 無効クラス（`border-border-strong` は素のクラスでは色が付かない）を `border-[color:var(--mp-border-strong)]` に全置換。
- 実機ドライブは Supabase 実データ（ブラケット生成済み・BYEあり・数試合結果あり・観戦者セッション）が要るため未実施。UI・整形の変更で型/テスト/ビルドで担保、各分岐はコード追跡で確認。

### 次にやること
- [ ] 実機確認（主催者で生成→BYE表示→結果入力→勝ち上がり線→表彰台→観戦者クリック閲覧）。
- [ ] 残り画面（観戦ビュー）のデザイン刷新。

---

## 2026-07-09 — 対戦表マトリクス（第8画面）のコードレビュー指摘4件を修正

デザイン刷新 第8画面（PR#96）に `/code-review high` を回し、検出した4件を修正した。UI とデータ整形のみで判定・保存ロジックは引き続き未変更。

### 直した指摘
1. **閲覧者が「日時・配信設定済みだが結果未入力」のセルを開けない（機能後退）** — セルの `clickable` が `hasResult || (!readOnly && canReport)` だったため、観戦者/参加者は未実施の試合を開けず、RoleBanner・注意書きの「セルをクリックで日時・配信を確認できる」約束が破れていた。付随情報の有無 `hasInfo`（`scheduledAtLocal !== "" || streamUrl !== null`）を条件に追加。ただし「＋」の入力アフォーダンスは `canReport` のときだけ出す（閲覧者には出さない）。
2. **保存後もモーダルが古い値を表示（日時・配信）** — モーダルが開いた瞬間の `match` スナップショットを保持し続けていた。`modal` state を `{groupId, matchId}` に変え、**描画時に最新 `initialGroups` から `modalMatch` を引き直す**。カードが消えていれば `modal && modalMatch` ガードで自然に閉じる（残る state は無描画で無害）。
3. **結果保存がサーバーエラーでも即モーダルを閉じて入力を破棄** — `onReport`/`onClear` が `run()` 直後に無条件 `setModal(null)` していた。`run(action, onSuccess?)` に成功コールバックを追加し、**成功時のみ閉じる**。検証エラー時はモーダルを開いたままにして入力（スコア/POTG/リプレイコード）を保持。
4. **勝敗色を winnerTeamId でなく生スコアで再判定（ロジック重複）** — マトリクスセルの色分けを `match.winnerTeamId` 参照に変更。勝者判定（`decideWinner`）を UI で再実装しない。

### 決めたこと（なぜ）
- **モーダルは id 保持＋描画時に引き直す**方針に統一。スナップショット保持は「保存後・他者更新後に古い値を出す」「エラー時に閉じて入力を捨てる」の温床。id 参照なら 1〜3 を同じ根で解消できる。
- 自動クローズは `useEffect` で `setState` せず（lint `react-hooks/set-state-in-effect` 準拠）、**描画ガードで表現**した。

### 確認
- `npm run check`（lint 0 error＝既存の `actions.ts` 警告1件のみ／typecheck OK／test 366 passed）。
- 実機ドライブは Supabase 実データ（グループ・日時設定済み試合・観戦者セッション）が要るため今回は未実施。状態ロジックの変更で型・テストで担保、各分岐はコード追跡で確認。

### 次にやること
- [ ] 残り画面（決勝T／観戦ビュー）のデザイン刷新。

---

## 2026-07-08 — D&D 持ち上げゴーストをカーソル追従に（横長カードのズレ修正）

チーム編成・ブロック分けの D&D で、**横長カードの右側を掴むとゴーストとカーソルが大きくズレる**問題を修正した。

### 問題
既定の `DragOverlay` は掴んだ元カードの左上を基準にゴーストを追従させる。メンバーカード／チームカードは横長（幅 ~282px）で、ゴーストは幅固定（230/236px）なので、カードの右側を掴むと**ゴーストがカーソルのはるか左に出る**（実測: カード右端付近を掴むとゴースト中心がカーソルから左に約137px、左端がカーソルから約253px ズレる）。直感的でない。

### 修正
- **`snapCenterToCursor` modifier を自前で実装**（`src/lib/dnd/snap-center-to-cursor.ts`）。掴んだ瞬間のポインタ座標（`activatorEvent`）とゴースト矩形（`draggingNodeRect`）から、ゴースト中心が掴んだ座標に一致するよう `transform` を補正する（`@dnd-kit/modifiers` の同名 modifier 相当・**依存追加なし**。`@dnd-kit/utilities` の `getEventCoordinates` を使用）。
- 両画面の `DragOverlay` に `modifiers={[snapCenterToCursor]}` を渡す（teams-board.tsx / groups-board.tsx）。**`DndContext` ではなく `DragOverlay` にのみ**渡すのが要点。ゴーストの見た目位置だけを変え、衝突判定（`collisionDetection`=pointerWithin）には影響させない。

### 実機確認（Playwright・DB変更なし）
- 修正前: カード右端付近を掴む→カーソル(700,400)でゴースト中心が(563,398) ＝ X に -137px ズレ。
- 修正後: 同操作でゴースト中心(701,398) ＝ **ズレ X+1 / Y-2px にほぼ解消**。
- **ドロップ判定は無傷**を確認: 横長カードの右端を掴んでカーソルをドロップ先ゾーンに置くと、そのゾーンが正しく `isOver`（発光）になり、ゴースト中心もカーソルに一致。modifier がゴーストの見た目だけに効き、判定はカーソル座標のままであることを実証。ドロップはせず ESC でキャンセル（保存なし）。
- `npm run check`（lint 0 error／typecheck OK／test 366 passed）。

### 次にやること
- [ ] 残り画面（対戦表・順位／決勝T／観戦ビュー）のデザイン刷新。

---

## 2026-07-09 — デザイン刷新 第8画面: 対戦表・順位（総当たりマトリクス化）

予選対戦表・順位ページ（主催者/参加者/観戦者）を Claude Design のデザイン言語（`.theme-matchpoint`）でリデザイン。この画面は前2画面と違い**構造から作り替え**た（縦一列の対戦カードリスト → 総当たりマトリクス＋順位表＋ブロックタブ＋セルクリックモーダル）。**判定・保存ロジック（standings 計算・reportResult・BO/POTG 検証・generateMatches/addMatch/deleteMatch・updateSchedule/updateStream・3モード出し分け）は一切触らず**、UI とデータ整形のみ差し替え。案HTMLは `docs/design-refs/matches-organizer.html`（デコード済み軽量版）に保管。

### 情報設計の壁打ち（マトリクス採用・課題を1つずつ潰した）
縦一列の対戦カードは28試合で間延びするため、**総当たりマトリクス**を採用。マトリクスの弱点をオーナーと1つずつ対策（壁打ち確定）:
- **チーム識別**（観戦者はシード番号を覚えていない）→ 行ヘッダー＝チーム名フル表示、列ヘッダー＝番号＋ホバーでツールチップ（フル名）。行を見れば全チーム名が読める。
- **長い名前の見切れ** → 列ヘッダーは番号のみ、名前はツールチップ。
- **複数ブロックの圧迫** → ブロックタブで切替（1ブロックなら非表示）。
- **編集欄がセルに入らない** → セルクリック→モーダルで編集（閲覧＝セル、編集＝モーダル）。
- **クリックできると分かる導線** → ホバーハイライト＋pointer カーソル＋未入力セルに「＋」＋注意書き一行＋行列の凡例、を併用。

### やったこと
- **page.tsx**: `.dark` → `.theme-matchpoint`。パンくず＋ヒーロー（kicker「STANDINGS · <立場>」＋ゲームチップ＋ブロック数＋**通過（各組 上位N）**＋**消化進捗 done/total**）。`tournament_advance_count` を board へ渡す。
- **matches-board.tsx（全面書き換え）**:
  - **ブロックタブ**（`initialGroups.length>1` のときのみ・色ドット＋進捗）。
  - **順位表**（`StandingsPanel`）: 1位ゴールド強調、色スウォッチ＋番号＋チーム名、勝分敗（色分け）／勝点／得失（色分け）／POTG（tiebreaker に potg があるときのみ列）。**予選通過ライン**（`tournament_advance_count` 由来・上位N行の後に緑ライン）。
  - **総当たりマトリクス**（`MatrixPanel`/`MatrixCell`）: 行＝ホーム/列＝アウェイ、セルは行チーム視点のスコア＋勝(緑)/敗(赤)/引分の色分け、対角線は斜線、未対戦は破線＋ホバーで「＋」（編集権のある人）。列ヘッダーに `title`/`data-tip` でフル名。ホバーで浮き上がり。
  - **セルクリック→モーダル**（`MatchModal`）: スコア（ステッパー±）・**POTG 取得数（数値・実装通り）**・マップ別リプレイコード（スコア連動）・日時・配信。観戦者/非権限者は入力欄が無効（閲覧のみ）。ESC・背景クリックで閉じる。既存の `validateBoScore`/`validatePotg` を踏襲。
  - **主催者ツールバー**（`OrganizerToolbar`）: 総当たり一括生成・個別追加（番号付きプルダウン）・削除。
- **`--mp-gold` トークン追加**（globals.css）: 順位1位のゴールド。インライン style でも使うため `@layer` 外の素ルールにも再宣言（tree-shake 対策・[[mp-token-treeshake-pitfall]]）。

### 決めたこと（なぜ）
- **POTG は実装通り「取得数（数値）」**（オーナー合意）。案は「POTG選手名の記録」だったが、実装は POTG 数を順位タイブレークに使う（standings.ts）。ロジックを壊さないため、モーダルの POTG 欄は「A-B の取得数ステッパー」にし、案の選手名入力・POTG_POOL は不採用。
- **予選通過ラインは案独自ではなく実装済み概念**だった。`events.tournament_advance_count`（0019 マイグレーション・各ブロック上位N進出）があり、案の緑ラインは根拠のある UI として実装。0 のときは非表示。
- **マップ名は出さない**（案は `MAP 1: King's Row` だが実装にマップ名データは無い）。`MAP 1/2/3` ラベル＋リプレイコード欄のみ。

### 実機確認（Playwright・検証データは掃除済み）
- 「のり検証1」の format を一時的に `round_robin_then_tournament`、`tournament_advance_count` を一時 3 に変更し、match_results を5件一時挿入して確認 → **ヒーロー・順位表（1位ゴールド・通過ライン）・マトリクス（勝緑/敗赤/対称スコア/対角線斜線）・セルクリックモーダル（ステッパー・BO3・日時配信・POTG非表示＝tiebreaker に potg 無し）を目視確認**。
- 確認後、**挿入した5件の結果を削除・format を `tournament`・advance を 20 に復元**（検証前の状態に完全復元済み）。
- `npm run check`（lint 0 error／typecheck OK／test 366 passed）。

### 次にやること
- [ ] 残り画面（決勝トーナメント／観戦ビュー）のデザイン刷新。観戦ビューでこの対戦表マトリクスを閲覧専用で展開する。
- [ ] 全画面が揃ったら `.theme-matchpoint` を `:root/.dark`（サイト全体）へ昇格（全 `--mp-*` が tree-shake で消えないか再チェック）。

---

## 2026-07-08 — デザイン刷新 第7画面: ブロック分け（予選）

予選ブロック分けページ（主催者/応募者/観戦者）を Claude Design のデザイン言語（`.theme-matchpoint`）でリデザイン。チーム編成（第6画面）の資産（ヒーロー・D&Dゴースト・ドロップ発光・カードホバー）を流用。**判定・保存ロジック（dnd-kit の onDragEnd・assignTeam/unassignTeam/autoAssignGroups・楽観更新・3モード出し分け・対戦表生成後のロック）は一切触らず**、見た目・アニメ・表示用の派生値だけを刷新した。案HTMLは `docs/design-refs/groups-organizer.html`（デコード済み軽量版）に保管。

### やったこと
- **page.tsx**: ラッパを `.dark` → `.theme-matchpoint`。パンくず＋ヒーロー（kicker「GROUP STAGE · Organizer」＋タイトル＋イベント名＋ゲームチップ＋承認チーム数）。**シード番号を算出**（全チームを平均スコア降順で順位付け・表示用の派生値・DB非保存）して各 BoardTeam に付与。
- **groups-board.tsx**:
  - **チームカード**（`TeamCard`）: シードチップ（#順位）＋チーム名＋AVG、ホバー発光（案の `.team-card:hover`）。
  - **持ち上げゴースト**（新規 `DragGhost` + `DragOverlay`）: 幅236px固定・-2deg回転・オレンジ淵・影＋グロー（案の `.drag-ghost`）。
  - **ブロックカード**（`GroupCard`）: A/B/Cカラーバッジ＋平均スコアゲージ（全体平均線＋delta バッジ）＋ドロップゾーンのオレンジ発光。
  - **ブロック間バランスオーバービュー**（新規 `BalanceOverview`）: 各ブロックの平均を共通スケールのバーで横並び比較＋スコア偏差（good/warn）。強さの偏りを一目で。
  - **自動ブロック分けパネル**: ステッパーUI（＋/−ボタン）に刷新。
  - **ロックバナー**を生 amber → 案の `.lock-banner`（オレンジグラデ＋鍵アイコン）に。観戦者バナー（`.spec-banner`）・保存トースト（下部中央）も案準拠。
- **色ヘルパー**（`groups-board.tsx`）: `BLOCK_COLORS`（A=brand/B=accent/C=support/…）・`groupAvg`・`barPct`・`deltaTag`。すべて `--mp-*` トークン（＋案準拠の紫 `#a78bfa`）。

### 決めたこと（なぜ）
- **見た目だけ案に合わせ・機能は現状維持**（ユーザー合意）。案には実装に無い機能（ブロック上限5チーム・満員拒否・「対戦表を生成」ボタン・「下書き保存」・チーム人数表示・検索）が含まれていたが、**存在しない制約を UI で見せると DB と不整合になり嘘のUIになる**ため入れない。算出可能なもの（シード・ブロック平均・バランスバー）だけ実装。
- **シード・平均・バランスは純粋な表示用派生値**。DB スキーマ変更なし。`BoardTeam.seed?` を足しただけ。

### 実機確認（Playwright・検証データは掃除済み）
- スコア付きフル状態は「のり検証1」の format を一時的に `round_robin_then_tournament` に変更して確認（チーム8個・平均ゲージ・ロックバナー）→ **format を `tournament` に復元**。
- 編集可能＋D&D は「実機検証カップ2」に承認チーム3個を一時作成→自動振り分けで2ブロック→**持ち上げゴースト（幅236px・-2deg・オレンジ淵）・ドロップ先のオレンジ発光・元カードの薄化・バランスバー（A/B）を目視確認**→ ESC でキャンセル。**ブロック・チーム・group_teams をすべて削除して原状回復**（両イベントとも検証前の状態に完全復元済み）。
- `npm run check`（lint 0 error／typecheck OK／test 366 passed）。

### 気づき（スコープ外・別途）
- 自動振り分け実行後、`router.refresh()` の結果が即時反映されず手動リロードで反映された（DB には正しく保存済み）。既存挙動で今回のデザイン改修とは無関係のため本 PR では触らない。

### 次にやること
- [ ] 残り画面（対戦表・順位／決勝T／観戦ビュー）も、案HTMLを `docs/design-refs/` に保管してから着手。
- [ ] 全画面が揃ったら `.theme-matchpoint` を `:root/.dark`（サイト全体）へ昇格（tree-shake で全 `--mp-*` が残るか再チェック・[[mp-token-treeshake-pitfall]]）。

---

## 2026-07-08 — チーム編成 D&D 磨き込み ＋ ロール色が消えていた不具合の修正

第6画面（チーム編成）の実機を見て、Claude Design 案との乖離が4点あることが判明したので磨き込んだ。あわせて **ロール識別色（青/赤/緑）が本番出力から丸ごと消えていた不具合**を発見・修正した（案では色付きだったが実装で白くなっていた）。参照用に **Claude Design の案HTML（デコード済み軽量版）を `docs/design-refs/` に保管**し、今後の乖離を構造的に防ぐ運用にした。

### 根本原因（ロール色が白くなっていた不具合）
- `--mp-tank`/`--mp-dps`/`--mp-support` は `globals.css` の `@layer components` 内 `.theme-matchpoint` に定義していたが、**Tailwind v4 のビルドがこの3変数だけを出力から tree-shake していた**（`getComputedStyle(.theme-matchpoint).getPropertyValue('--mp-tank')` が空文字になることを Playwright で確認）。
- 原因は**参照経路の違い**: 他の `--mp-*` は `text-[color:var(--mp-brand)]` のような Tailwind クラス構文で使われ content スキャンに載る。一方ロール3色は `teams-board.tsx` の JS 文字列（`tank: "var(--mp-tank)"`）→ インライン `style` でしか使われず、スキャンで拾えず「未使用」と判断されて削られていた。
- **修正**: この3変数を `@layer` の外の素のトップレベル `.theme-matchpoint {}` ルールで再宣言。素のルールは最適化対象外で必ず出力に残る。→ アイコンの実効色が青 `rgb(91,147,240)`／赤 `rgb(242,104,90)`／緑 `rgb(69,192,138)` になることを実機確認。

### D&D 磨き込み（4点・Claude Design 案 `docs/design-refs/team-formation-organizer.html` 準拠）
- **希望順の数字バッジ**（`RoleIcon`/`PreferredRoles`）: アイコン右上に希望順（1/2/3）の小さな丸バッジ（案の `.pref .rank`）。第1希望を大きく濃く・第2/3を小さく薄くする既存表現に「順番の明示」を追加。「左から順」が一目で分からない問題を解消。
- **持ち上げゴースト**（新規 `DragGhost` ＋ `DragOverlay`）: カード全体を運ぶのをやめ、幅 230px 固定・`-2deg` 回転・オレンジ淵（`--mp-brand`）・大きい影＋グローの専用プレビューに（案の `.drag-ghost`）。ドラッグ中カードが横長化する問題を解消。
- **ドロップ先の発光強化**（`Zone`/`Pool` の `isOver`）: ring だけ→**オレンジ2px枠＋外周グロー**（`box-shadow`）に。案の `.drop-target.can-drop/.hot` の「光る」感を dnd-kit の `isOver` に翻訳。
- **カードのホバー発光**（`MemberCard`）: hover で枠を `--mp-border-strong` へ・背景を `--mp-surface-3` へ・影＋1px 浮き上げ（案の `.app-card:hover`）。

### 決めたこと（なぜ）
- **案HTMLをリポジトリに残す運用に変更**（`docs/design-refs/`）。案が手元に無いと乖離しても突き合わせる基準がなく、実際にロール色・希望順・D&Dアニメが抜け落ちた。Claude Design の standalone エクスポート（画像 data URI 込みで 7MB 超）は重いので、`__bundler/template` を JSON デコードした軽量版（CSS/JSX が読める 472KB）だけを置く。手順は `docs/design-refs/README.md`。
- **ロジックは今回も無変更**。onDragEnd・割当・保存 Server Action・3モード出し分けは一切触らず、見た目・アニメ・CSS変数の出力のみ修正。

### 実機確認（Playwright）
- ロール色が青/赤/緑で解決されることを `getComputedStyle` で確認。
- ドラッグ中の状態を pointer イベントで再現し、ゴーストが **幅230px・matrix(-2deg 相当)・オレンジ淵・影＋グロー**、ドロップ先（プール）が**オレンジ枠＋グローで発光**、掴んだ元カードが薄くなる（`opacity-35`）ことを確認。ESC でキャンセルし DB 変更なし。
- `npm run check`（lint 0 error／typecheck OK／test 366 passed）。

### 次にやること
- [ ] 昇格作業（`.theme-matchpoint` → `:root/.dark`）の際、**tree-shake で消えていたロール3色を含め、全 `--mp-*` が本番出力に残ることを確認**する（サイト全体化で `@layer` 構成が変わるため再発チェック）。
- [ ] 残り画面（対戦表・ブロック分け・決勝T・観戦ビュー）も、案HTMLを `docs/design-refs/` に保管してから着手する。

---

## 2026-07-08 — デザイン刷新 第6画面: チーム編成（ロール色/アイコン・ヒーロー・スコアバー）

チーム編成ページ（主催者/応募者/観戦者の3ビュー）を Claude Design のデザイン言語（`.theme-matchpoint`）でリデザイン。**判定ロジック（dnd-kit の onDragEnd・割当/満員/上限判定・保存 Server Action・3モード出し分け）は一切触らず**、見た目・レイアウト・ロール表記・D&D のフィードバックだけを刷新した。

### やったこと
- **OW2 の3ロール識別色を追加**（`globals.css`）: `--mp-tank`（青）/ `--mp-dps`（赤）/ `--mp-support`（緑）。ロールアイコン・希望ロール・ロールレーンで共通利用。
- **ロールアイコン共通コンポーネント**（`teams-board.tsx`）: `RoleGlyph`（OW2 公式ロールマーク準拠のラインSVG・盾/照準/十字）＋ `RoleIcon`（色付き丸背景チップ）＋ `PreferredRoles`（第1希望を大きく・第2/3希望を小さく薄く）。希望ロール表記を「矢印区切りの文字列」からアイコン＋色＋優先度の視覚表現へ刷新。
- **ヘッダーをヒーロー化**（`page.tsx`）: パンくず（リンクをブランド色ホバーに）＋「TEAM BUILDER · <立場>」ラベル（観戦者には Organizer を出さない）＋タイトル＋イベント名＋ゲームチップ（赤ドット）＋編成メタ3つ（形式＋人数 `NvN`／平均スコア上限／定員）。ラッパを `.dark` → `.theme-matchpoint` に。
- **スコアバー可視化**（`TeamCard`）: 上限ありのとき、平均/上限の充填率バーを表示（超過=danger赤／以内=success緑）。カードを `rounded-2xl`＋影に。
- **未割当プールを欄内スクロール化**（`Pool`）: `max-h`＋`overflow-y-auto`＋`lg:sticky lg:self-start`。応募者が増えても「プール内スクロール→チームへ D&D」で対応。あわせて**「チームへ送る」セレクト UI を削除**し割当は D&D に統一（`assignMember` の保存ロジック自体は温存）。
- **生 amber 色をトークンへ**: 承認待ちセクション・ステータスバッジの `amber-*` を `--mp-warning`／承認済みを `--mp-success`（✓付き）に。
- **共通ヘッダーのロゴにオレンジランプ**（`site-header.tsx`）: `Matchpoint` 左にブランド色の丸ランプ（にじみ付き）。全ページ共通なので導線が統一される。
- **D&D ドロップゾーンのハイライト強化**: プール/ゾーンの `isOver` 時をブランド色ボーダー＋リング＋淡い背景に。

### 決めたこと（なぜ）
- **ロジックは絶対に触らない／見た目は全部 Claude Design に寄せる**（ユーザー合意）。判定・保存・出し分けの条件式は無変更で、JSX とクラスのみ差し替え。
- **「チームへ送る」ボタンは削除**（Claude Design 案の欄内スクロールを採用）。ボタンで距離を縮める代わりに、プールをスクロールして D&D する前提に統一。UI だけ消し、`assignMember` は D&D 経路で引き続き使用。
- **オレンジランプは `#ff6a2b` 直値**: `--mp-brand` は `.theme-matchpoint` スコープ限定で、共通ヘッダーの `.dark` スコープでは未定義のため、ブランド色を直接指定した。

### 実機確認（全パターン）
- 検証データの `require_score`/`role_swap_allowed`/`team_score_cap` を service_role で一時的に切り替え、**4パターン（スワップ可×上限なし／上限あり／スワップ不可×上限あり／スコアなし）を実機確認**（Playwright）。確認後、元の設定へ復元済み。
- **D&D はプール↔チーム双方向で動作確認**（保存トースト＝ Server Action 発火を確認）。移動した応募者は元に戻して原状回復。

### Claude Code Review 反映
- **プールの `lg:sticky` に `lg:self-start` が欠けており**、グリッド行の stretch で要素が全高に伸びて sticky が実質無効になり得た（イベント詳細ページの sibling は self-start を併用）。→ `lg:self-start` を追加して修正。

### 次にやること
- [ ] デザイン言語を残り画面（対戦表・ブロック分け・決勝T・観戦ビュー等）へ展開。
- [ ] 全画面が揃ったら `.theme-matchpoint` を `:root/.dark`（サイト全体）へ昇格。

---

## 2026-07-08 — デザイン刷新 第3〜5画面: 入口系（LP・ダッシュボード・マイページ）

入口系3画面（トップの未ログイン=LP／ログイン後=ダッシュボード／マイページ）を Claude Design のデザイン言語（`.theme-matchpoint`）でリデザイン。「入口→一覧→詳細」の導線が配色・カードで統一された。

### やったこと
- **トップ（`page.tsx`）を2つの顔で再構築**: LP＝ヒーロー（シアンのラベルチップ＋大見出し＋サブコピー＋CTA2つ＋背景演出のグリッド/ブランドグロー）＋募集中イベント。ダッシュボード＝DASHBOARD ラベル＋挨拶＋3セクション（参加中/主催/募集中、各件数・アクション付き）。**イベントカードは一覧ページと同じデザイン体系に統一**（`EventCard`/`StatusBadge` を一覧と揃える）。可視性・参加状態・主催判定などのデータロジックは無変更、見た目のみ差し替え。
- **マイページ（`me/page.tsx`）**: PROFILE ラベル＋プロフィールカード（アバターにブランド枠・Discord 色ドット）＋バトルタグ編集＋ログアウト。`BattleTagForm`/`LogoutButton` はセマンティッククラスなので `.theme-matchpoint` でそのまま新配色。
- **LP ヒーロー文言を調整**（ユーザーフィードバック）: 「本気の大会が、ここにある。」が殺伐すぎ→**「ゲーム仲間と、もっと盛り上がる。」**（コミュニティ大会向けの温度感）。サブコピーの不自然な改行も文の区切りで折り返すよう修正。
- **Discord 色トークン追加**（`globals.css`）: `--mp-discord`/`--mp-discord-hover`（LP・マイページの Discord 導線用）。
- **`listMyParticipatingEvents` に主催者名を追加**（参加中カードに主催者を出すため。消費者は `page.tsx` 1箇所のみ・フィールド追加のみで安全）。
- lint / typecheck / build（Compiled successfully）/ test(366緑) 通過。**LP・ダッシュボード・マイページの3画面すべて実機確認済み**（Playwright・ログアウトして LP も確認）。

### 決めたこと（なぜ）
- **統計セクション（登録プレイヤー数等）は今回省く**（拡張予定）。Claude Design はダミー数値を置いたが、実数は現状少なく（登録2・大会18 等）射抜かない。ヒーロー＋CTA＋募集中イベントで LP は成立する。将来ユーザーが増えたら復活させる。
- **イベントカードを一覧と完全共通の見た目に**。入口・一覧・詳細でカードがバラつくと「AI っぽさ」が残るため、体系を揃えるのが導線統一の肝。
- **ロジック無変更・JSX のみ**（デザイン刷新の原則）。

### Claude Code Review 反映
- 指摘ゼロ（UI 中心・ロジック温存・クエリ変更の blast radius も限定的と確認）。

### 次にやること
- [ ] デザイン言語をチーム編成・対戦表へ展開。
- [ ] 全画面が揃ったら `.theme-matchpoint` を `:root/.dark`（サイト全体）へ昇格。
- [ ] LP 統計セクションはユーザー規模が育ったら実データで復活。

---

## 2026-07-07 — デザイン刷新 第2画面: イベント一覧（＋フィルタ機能・@layer 退行修正）

イベント一覧を Claude Design のデザイン言語（`.theme-matchpoint`）でリデザイン。あわせてデザインに含まれていた**フィルタ機能（タブ・ゲーム絞り込み・並び替え・件数）を実装**。作業中に**第1画面の退行バグ（`.theme-matchpoint` が Tailwind v4 で出力から落ちて白背景化）も発見・修正**。

### やったこと
- **一覧を3カラムのカードグリッドに**（`events/page.tsx`）: 見出し（EVENTS ラベル＋件数＋「＋イベントを作成」）、フィルタタブ（すべて/募集中/開催中/終了・件数バッジ付き）、ゲーム/並び順ドロップダウン、カード（ゲームチップ＋状態バッジ＋日時 tnum＋主催者アバター＋矢印）、空状態。
- **フィルタ・並び替えを URL クエリ駆動で実装**（`?tab=&game=&sort=`）: Server Component が searchParams を読んで絞り込む。状態は URL が持つ（クライアント状態管理は最小）。`FilterSelect`（Client 島）で select 変更→即 `router.push`。**`dangerouslySetInnerHTML` は使わない**（当初 inline script で書きかけたがガイドライン禁止に気づき Client 島へ修正）。
- **フィルタ/状態グルーピングを純粋 Service に切り出し**（`lib/services/event-list-filter.ts`）: タブ↔status 群の対応（募集中=published/recruiting、開催中=closed/ongoing、終了=finished）、URL クエリの `normalizeTab`/`normalizeSort`（不正値を安全な既定へ丸める）、`countByTab`、`statusTone`。テスト13件（SQLi 様の不正 tab 値が all に丸まる検証含む）。
- **Repository 拡張**（`events.ts`）: `listPublishedEvents` に filterStatuses/sort/gameId 引数と主催者名の埋め込みを追加（全て Supabase クエリビルダ経由・SQLi 非該当）。`listGamesInPublishedEvents`（ゲーム絞り込みドロップダウン用）を新設。
- lint / typecheck / build（Compiled successfully）/ test(366緑・+13) 通過。**実機確認済み**（3カラム描画・タブ遷移・並び替えの URL 反映・ダーク配色を Playwright で確認）。

### 退行修正（重要）: `.theme-matchpoint` が効かない
- **症状**: 第1画面（イベント詳細・マージ済み）を含め `.theme-matchpoint` の CSS 変数が適用されず**白背景**になっていた（`--mp-bg` 空・ルールがスタイルシートに存在しない）。
- **原因**: Tailwind v4 は素の CSS クラス（`globals.css` 直書きの `.theme-matchpoint`）を出力から落とす/順序が崩れることがある。dev HMR では一時的に効いていたが、ビルドし直すと消えていた。
- **対応**: `.theme-matchpoint` を **`@layer components` で囲む**（必ず emit・base の後に適用）。両画面ともダーク描画に復帰。

### 決めたこと（なぜ）
- **フィルタは URL クエリ駆動**（クライアント状態でなく）。App Router の素直な形・リロード/共有に強い・Server Component で完結。
- **件数バッジはゲーム絞り込み後の母集合から算出**（Claude Code Review 反映）。ゲームを選ぶとタブ件数もそのゲーム内になり、バッジと実表示件数が一致する。この修正で表示用の絞り込みも母集合の**メモリ内フィルタ**に変え、DB クエリを1本削減（タブ切替でクエリを撃たない）。
- **状態→バッジ色の意味づけを Service に集約**（一覧・詳細で共通化の下地）。

### Claude Code Review 反映
- **タブ件数とゲーム絞り込みの不整合を修正**（correctness）: 件数を「ゲーム絞り込み後」の母集合から数えるよう変更。副次的に表示用の status 絞り込みをメモリ内フィルタ化し、2本目の DB クエリを削減。
- （low・据え置き）`FilterSelect` は非制御 select（`defaultValue`）。ナビゲーションで再マウントされる前提に依存するが現状問題なし。

### 次にやること
- [ ] デザイン言語をチーム編成・対戦表へ展開（[[design-iteration-flow]]）。
- [ ] 全画面が揃ったら `.theme-matchpoint` を `:root/.dark`（サイト全体）へ昇格。

---

## 2026-07-07 — デザイン刷新 第1画面: イベント詳細ページ（ダーク/OW2 調）

Claude Design で確立したデザイン言語（brand `#FF6A2B` / accent `#22D3EE` / 状態色 / ダーク階層 / Geist+Noto Sans JP / radius 6-18px / 影 e1-e3）を、最初の代表画面「イベント詳細ページ」に実装。無彩色の「AI っぽさ」から OW2 らしいダーク・e スポーツ調へ。**先行適用スコープ限定**（他画面に影響を出さない）。

### やったこと
- **トークンを `globals.css` にスコープ付きで追加**（`.theme-matchpoint`）: ブランド固有 `--mp-*` ＋ shadcn セマンティック変数（`--background`/`--primary` 等）をこのスコープで上書き。既存の `bg-background`/`bg-primary` 等のクラス・shadcn コンポーネントがそのまま新配色で描画される（クラス総書き換えを回避）。出自は Claude Design 生成物のトークン（`docs/DESIGN.md` に対応）。
- **イベント詳細ページ（`events/[id]/page.tsx`）を再構築**: パンくず＋ヒーロー（状態バッジ ✓公開中/●開催中 pulse・ゲーム/形式チップ・主催アバター・日時メタ）＋2カラム（左=概要/メタ facts/本戦タイル、右=sticky アクションレール: 応募カード/フォロー/主催者メニュー）。募集締切は warning 色、日時・数値は等幅 tnum。**可視性・応募状態・フォロー・本戦導線の出し分けロジックは一切変更せず、見た目（JSX）だけ差し替え**。
- **本戦導線をタイル化＋ Lucide アイコン**（既存導入の `lucide-react` を流用・依存追加なし）: 観戦ビュー=Eye（ブランド強調）/ 日程=CalendarDays / ブロック=LayoutGrid / 対戦表=Table2 / トーナメント=Trophy。絵文字より e スポーツ調が締まる。
- typecheck / lint（既存 warning 1 のみ）/ build（Compiled successfully）通過。**実機確認済み**（主催者=のり視点で dev サーバー描画・スクショ確認）。

### 決めたこと（なぜ）
- **トークンは `.theme-matchpoint` スコープ限定で先行適用**（サイト全体の `:root/.dark` にはまだ落とさない）。1 画面でデザイン言語を検証してから展開する方針（[[design-refresh-groundwork]]）。他画面（一覧・チーム編成・対戦表）は未調整なので、全体ダーク化すると未調整画面が大量に崩れるため。
- **shadcn セマンティック変数をスコープで上書き**する方式（`--mp-*` を直接クラスに撒くのでなく）。既存クラス・shadcn コンポーネントを壊さずに配色だけ差し替えられ、将来サイト全体へ展開する際も `:root/.dark` に同じマッピングを移すだけで済む。
- **ロジックは温存・JSX だけ変更**。認可・応募状態・フォロー・形式による導線出し分けは既存実装が正なので触らない（デザイン刷新でデグレさせない）。

### 次にやること
- [ ] 応募者/観戦者視点（非主催者）での見え方を実機確認（このコミットは主催者視点のみ確認）。
- [ ] 確立したデザイン言語を一覧・チーム編成・対戦表へ展開。
- [ ] 全画面のダーク化が揃ったら `.theme-matchpoint` を `:root/.dark`（サイト全体）へ昇格。

---

## 2026-07-07 — デザイン刷新の下準備（「AI っぽさ」脱却フェーズ開始）

通知カタログ（#1〜#11・DM 含む）の中身が出揃ったので、UI デザインの刷新フェーズに入る。方針: **Claude Design（Anthropic Labs の AI デザインツール）で見た目を壁打ち・案出し → Claude Code が本プロジェクトの作法で実装**（[[design-workflow]] を更新運用）。

### やったこと
- **現状のデザインシステムを棚卸し**して `docs/デザイン現状メモ.md` を作成（Claude Design に渡す「現状の地図」）。実コード（`globals.css` / `layout.tsx` / `site-header.tsx`）を読んで事実ベースで記述。
- **`docs/DESIGN.md` を追加**（追記 2026-07-07）: Claude Design が GitHub 連携時に**自動で読むデザインシステム正典**（`/DESIGN.md` or `/docs/DESIGN.md` 規約・コミュニティ標準の9セクション構成）。現状の主張は `file:line` を引用、色は現状=無彩色＋目標=ダーク/OW2調＋アクセント=TBD（**具体の hex は Claude Design に提案させる方針**）。GitHub 連携（リポジトリ直読み）＋この DESIGN.md で、壁打ちが「現状把握済み」から始められる。`/design-sync` は完成コンポーネントを送る機能で今は対象外（ライブラリ確立後に使う）。
- 判明した「AI っぽさ」の主因を特定: ①**色が完全な無彩色**（`oklch(L 0 0)`＝shadcn デフォルトのまま・ブランド/アクセント色ゼロ）、②**ダーク基調が未実装**（`.dark` の色定義はあるが `<html>` に付いておらず実質ライトモード・ヘッダーのみ局所ダーク）、③見出しフォント/タイポ体系なし、④共通コンポーネントが 4 つ（button/calendar/popover/alert-dialog）だけで大半は生 Tailwind 手書き＝画面ごとに不揃い。

### 決めたこと（なぜ）
- **1 代表画面でデザイン言語を確立してから展開**（一気に全画面より効率的・一貫性が出る）。対象は **イベント詳細ページ**（状態バッジ・日時メタ・応募/フォローボタン・本戦導線が一通り揃う「アプリの顔」）。
- **Claude Design はリポジトリ直読み＋`/design-sync`** を使う（公式が推奨。17 日前メモの「スクショ共有」より進化し、既存コンポーネント/Tailwind を理解した提案が可能に）。ハンドオフは「Send to Claude Code」で既存コードの続きから実装される。
- 棚卸しメモはコミットして残す（今後の壁打ち・実装の基準として参照）。

### 次にやること
- [ ] ユーザーが Claude Design でイベント詳細ページのデザイン言語を壁打ち・確立 → Send to Claude Code。
- [ ] Claude Code が本プロジェクト（Tailwind v4 + shadcn）で実装 → ブラウザ確認・微調整。
- [ ] 確立したデザイン言語を一覧・チーム編成・対戦表へ展開。

---

## 2026-07-07 — 通知 PR: Discord DM 送信基盤＋リマインド配線（⑤ #7/#8）

通知カタログ最後の未実装＝**個人宛 Discord DM**。既存はアプリ内通知＋Discord Webhook（全体告知）まで。今回は **DM 送信基盤**を作り、まず**リマインド系（#7 試合直前・#8 スクリム直前・どちらも⑦Cron発火）**に配線する。DM は「アプリ内通知（本命・必ず残る）」への**上乗せ配信**＝ベストエフォート。**マイグレーション不要**（`delivery_channel` enum の `discord_dm`・`users.discord_id`・`users.discord_dm_opt_in` は 0001 で既存）。

### 決めたこと（なぜ）
- **Bot は非常駐（Vercel 関数から REST 直叩き）**（壁打ち確定）。今回は送信専用でユーザーからの受信・コマンド応答は不要。常駐ゲートウェイ接続（discord.js の常時プロセス）は別サーバー・別デプロイ・別監視が要り過剰。送信に Bot トークンは要るが常駐は要らない、の切り分け。アーキ設計書 5章の未確定項目を確定に更新。
- **送るのはリマインド系だけ（#7/#8）から**（壁打ち確定）。DM の本命がリマインド。1機能=1PR で小さく出し、1経路でトークン運用・opt-in 判定・delivery 記録を通してから横展開（#3 承認等の Server Action 経路は次PR）。
- **即送信・ベストエフォート**（Webhook #④と同じ流儀）。通知作成の直後に DM も送る。#7/#8 は宛先＝チームメンバー数人なのでレート制限の実害小。凝ったリトライは今回作らない（429/失敗は `failed` 記録で終わり・必要なら次のCron周回で再送検討）。
- **opt-in 判定は入れる／トグルUIは別PR**。送信側で `discord_dm_opt_in=false` と `discord_id` 無しを除外（必須）。ユーザーが自分で切り替える設定画面は次PRに分けて軽く出す。当面は全員 default `true`。
- **トークン未設定でも通す**。`DISCORD_BOT_TOKEN` 未設定なら DM は `skipped` 記録で送らないだけ（ビルド・他処理・既存テストは通る）。CRON_SECRET と同じ運用。宮本さん側の宿題はトークン発行→サーバー招待→env 設定のみ（実装完了後に手順を渡す）。

### やったこと
- **送信基盤**（`sendDiscordDM` in discord.ts）: Bot トークンで `POST /users/@me/channels`（DMチャンネルを開く）→`POST /channels/{id}/messages`（送信）の2段。Webhook と同じ `{ ok } | 失敗` 型・5秒タイムアウト・例外を投げないベストエフォート。`allowed_mentions:{parse:[]}` でメンション誤爆防止。トークン未設定は `skipped`（理由付き）。
- **DM 文面**（`buildDirectMessageContent`・純粋関数）: 既存 `NotificationContent`（title/body/相対linkUrl）を DM 1メッセージに整形し、末尾リンクを **絶対URL**化（Discord から踏めるよう baseUrl と結合）。body が null なら title＋リンクのみ。テスト2件（絶対URL化・body null）。
- **Repository**（cron.ts）: ① `adminInsertNotification` を **notification_id を返す**よう変更（DM 配信を個人通知に紐づけるため。二重=23505 時は既存 id を引き直す）。② `adminInsertDelivery` に `channel`（既定 `discord_webhook`＝#9非破壊）・`notificationId` を追加。③ `listDiscordTargetsForUsers` 新設（宛先の `discord_id`・opt-in を admin で引き Map で返す）。
- **オーケストレーション**（`sendReminderDMs` in cron-notify.ts）: 宛先ごとに opt-in/discord_id を確認し、opt-out・id無しは送らない。トークン未設定は `skipped`、成功は `sent`、失敗は `failed` を `notification_deliveries`（channel='discord_dm'・notification_id 紐付け・target_ref=discord_id）に記録。DM 失敗はすべて握り、リマインド本体を巻き添えにしない。`runMatchReminders`(#7)・`runScrimReminders`(#8) の通知作成ループ後に呼ぶ。
- **env**: `DISCORD_BOT_TOKEN`（サーバー専用・未設定でも通る）を追加。`.env.local.example` は `.gitignore` の `.env*` で管理外のためコミットには含まれない（ローカルには追記済み）。項目の周知は本 devlog と下記「デプロイ時の宿題」に記す。
- lint(0 error・既存warning 1のみ) / typecheck / test(353緑・+2) 通過。

### Claude Code Review 反映（4件修正）
- **DM 上乗せがリマインド本体を巻き添えにする穴を修正**（correctness・最重要）: `sendReminderDMs` の宛先取得（`listDiscordTargetsForUsers`＝users の DB 読み）が**呼び出し側の try 内**で await され、一時的な読み取り失敗が本体の catch に伝播していた。#8 スクリムは出来事(dedup_key)を既に記録済みのため、この throw で `errors` が増えるだけでなく**次回 Cron で skip され DM が二度と飛ばない**。docstring は「例外を投げない」と書いていたが実際は投げていた。→ 宛先取得を**関数内 try で握って見送り**に変更（本体を巻き添えにしない）。
- **トークン未設定時の無駄クエリ＋skipped 行の洪水を修正**（efficiency）: `DISCORD_BOT_TOKEN` 未設定（feature 無効）でも、毎 Cron・毎リマインドで users を引き、opt-in 済み全員に `status='skipped'` の delivery 行を書いていた。→ **トークン未設定なら即 return**（取得も記録もしない）。宮本さんがトークンを入れるまでは完全に no-op。
- **2段 fetch のタイムアウト共有を修正**（correctness・軽）: `sendDiscordDM` の「DMチャンネルを開く→送る」2段が1つの AbortController(5秒)を共有し、開くのが遅いと送信の猶予が食われ「開けたのに送信だけ timeout」になり得た。→ `fetchWithTimeout` に切り出し**各リクエストに個別タイマー**。
- **23505 引き直しの握り潰しにログ追加**（軽）: 二重時の既存 id 引き直し SELECT のエラーを無視して `id:null`（DM 紐づけなし）になっていた。→ 本体はベストエフォートのまま、切り分け用に `console.error` を追加。
- 再 lint / typecheck / test(353緑) 通過。

### 次にやること
- [ ] 宮本さん: Discord Developer Portal で Bot トークン発行→OW2サーバーに招待→`.env.local` と Vercel に `DISCORD_BOT_TOKEN` 設定（手順は別途）。設定後に実機で DM 到達を確認。
- [ ] DM 配線を Server Action 経路（#2 却下・#3 承認・#10 スクリム登録・#11 招待 等）へ横展開（次PR）。
- [ ] `discord_dm_opt_in` の切替 UI（設定画面トグル）を追加（別PR）。

---

## 2026-07-06 — 通知 PR: スクリム直前リマインド（#8 `scrim_starting_soon`）

通知カタログ 3.7 #8。**開始2時間前**に、そのスクリム/練習のチームメンバーへアプリ内通知でリマインドする。試合の #7（`match_starting_soon`）と同じ⑦Cron拡張。試合とスクリムは type を分けて文面を出し分ける（要件定義書 3.7）。**マイグレーション不要**（列追加なし・二重防止は dedup_key 方式）。

### やったこと
- **文面**（`buildScrimStartingSoonContent`・純粋関数）: 種別（スクリム/練習）で「スクリム」「練習」を出し分け、開始時刻は `fmtJstDateTime` で JST 表示（`scrimKindLabel`/`fmtJstDateTime` を #10 から流用）。title「まもなくスクリムが始まります」・本文に「開始2時間前」・link はチームの日程ページ（`/events/[id]/schedule`）。`NotificationType.ScrimStartingSoon = "scrim_starting_soon"` を追加。テスト3件（type 文字列・スクリム/練習の出し分け）。
- **取得**（`listScrimsStartingSoon` in cron.ts・admin/RLSバイパス）: 2時間以内に始まる scrims を拾い、`scrims→teams→team_members→registrations→user_id` を埋め込みで辿る（#7 の `listMatchesStartingSoon` と同型・ただし notified_at 列は無いのでフィルタは scheduled_at のみ）。FK 曖昧回避に `teams!scrims_team_id_fkey` ヒント明示。
- **オーケストレーション**（`runScrimReminders` in cron-notify.ts）: **#9 型の before-check** で二重防止。`hasEventForKey(scrim:<id>:scrim_starting_soon)` が true なら送信済みとみなし skip、初回のみ通知作成。宛先はチームメンバー全員（#10 と違い**登録者も含む**＝当日リマインドは本人も対象）。各件ベストエフォート（1件失敗が全体を止めない）。
- **接続**（Route）: `/api/cron/notifications` の `Promise.allSettled` に `runScrimReminders` を追加（#7/#8/#9 が独立実行・1つ落ちても他は動く）。レスポンスに `scrimReminders` を追加。
- lint(0 error) / typecheck / test(351緑・+3) / build 通過。**実機確認済み**（service_role・検証用チームにのり／ひでを紐づけ90分後のスクリムを挿入 → Cron を2回 GET）: 1回目 `scrimsConsidered:1, notificationsCreated:2`＝**のり1件・ひで1件**（登録者のりも宛先に含むことを確認）、2回目 `notificationsCreated:0, skipped:1`＝**dedup_key の before-check で二重防止**が効き増えない。文面「まもなくスクリムが始まります」も確認。検証データ掃除済み。

### 決めたこと（なぜ）
- **二重防止は dedup_key のみ（列追加なし）**（壁打ち確定）。#7 match は `matches.notified_at` の条件付き UPDATE で枠取りするが、scrims に列を足すとマイグレーション＋DB設計書/ER図更新が要り重い。#9「本日告知」が既に**列なし・dedup_key の before-check だけで二重防止**する実装パターンを持っており、これを流用。Cron は単一実行のため並行時の枠取りは実害が薄く、`notification_events` の dedup_key（find-or-create）＋ `notifications` UNIQUE(user_id, source_event_id) で物理防止できる。列を足さない＝DB設計書更新も不要。
- **宛先は登録者も含む全メンバー**（#10 は本人除外だが #8 は含む）。#10 は「自分で登録した予定の通知が自分に来る」冗長さを避けたが、#8 は開始2時間前のリマインドなので**本人も当日忘れる**＝除外する理由がない。性質が違うので #10 と不揃いでも筋は通る。
- **試合とスクリムで type を分ける**（要件定義書 3.7）。文面を「試合が始まります」「スクリムが始まります」で出し分けるため。#7 と `runScrimReminders` は独立関数にして allSettled で並べる（片方の失敗が他方を巻き込まない）。

### Claude Code Review 反映（3件修正・実機確認済み）
- **メンバー0人時の永久skip を修正**（correctness）: 出来事(notification_event)の upsert が recipients の空チェックより前にあり、リマインド判定時にチームメンバー0人だと出来事だけ dedup_key 付きで記録され、以降メンバーが増えても skip され通知が飛ばなかった。**宛先確定を出来事作成より前**に移動（0人なら出来事を作らず見送り→後から拾える）。
- **時刻変更後の再リマインドを修正**（correctness）: dedup_key が `scrim:<id>:<type>` で開始時刻を含まず、一度リマインドしたスクリムは時刻変更しても再通知されなかった（#10 が時刻変更を通知する設計と非対称）。**dedup_key に scheduled_at を追加**（`scrim:<id>:<type>:<scheduled_at>`）。時刻変更＝別キー＝再リマインド、同時刻は同キーで二重防止。
- **無駄な二重SELECT を解消**（efficiency）: `hasEventForKey`(SELECT)→`adminUpsertNotificationEvent`(内部で同じ dedup_key を再SELECT) の順で、送信済みスクリムでも出来事の再作成SELECTが走っていた。**upsert を alreadySent チェックの後ろ**に置き、skip 時は upsert しない（Cron が数分間隔で回るたびの送信済み分のSELECTを省く）。上の修正1と同じ順序組み替えで同時解消。
- **実機確認済み**（service_role）: ①90分後スクリム→Cronで各1件→同時刻Cronはskip→**開始時刻を80分後に変更→Cronで各2件目（再リマインド）**→変更後も再送は1回。②空チーム(メンバー0)→Cronで**出来事0件（見送り）**→ひで追加→Cronで**出来事1件・通知1件（後から拾える）**。lint/typecheck/test(351緑)通過。

### 次にやること
- [ ] ⑤ Discord Bot DM（#8/#10 も DM が本命。「本日21時からスクリム」を DM で）。通知カタログ 3.7 の最後の未実装。

---

## 2026-07-06 — 通知 PR: スクリム登録通知（#10 `scrim_scheduled`）

通知カタログ 3.7 #10。チーム日程管理（スクリム/練習）の**登録・変更をチームメンバー全員へアプリ内通知**する。#3 チーム承認と同じ「1出来事→チームメンバー全員に並列生成」型。前提の日程機能（この日の別PR）に通知を1本足すだけ。マイグレーション不要（notifications 土台は既存）。

### やったこと
- **文面**（`buildScrimScheduledContent`・純粋関数）: 種別（スクリム/練習）で「スクリム」「練習」を出し分け、`changed` フラグで「追加されました」「変更されました」を出し分け。開始時刻は `fmtJstDateTime` で JST 表示。link 先はチームの日程ページ（`/events/[id]/schedule`）。テスト4件（type 文字列・スクリム/練習の出し分け・changed 分岐）。`NotificationType.ScrimScheduled` を追加。
- **宛先集約**（`notifyScrimScheduled` in notify.ts）: `findTeamForNotify`（#3 の資産・teams→team_members→registrations→user を1クエリ）を**そのまま流用**。`aggregateRecipients([memberUserIds], [actorUserId])` で**登録/編集した本人を除外**。1操作＝1出来事を都度 `insertNotificationEvent` で採番（#11 と同じ「都度知らせる」方針・1日1回集約はしない）。各宛先は `Promise.allSettled` で独立生成。ベストエフォート。
- **接続**: `createScrim`（追加）・`editScrim`（`changed: true`・更新成功時のみ）の成功後に try/catch で握って通知。登録/編集の成功を通知失敗で巻き添えにしない。
- lint / typecheck / test(348緑・+4) / build 通過。**実機確認済み**（Playwright・のりで登録/編集→service_role で通知を確認）: のりがひで同席チームでスクリム登録→**ひでに #10 が1件**（title「新しいスクリムの予定が追加されました」）・**のりには0件（本人除外）**。日時を編集→**ひでに2件目**（title「スクリムの予定が変更されました」・変更後日時）・のりは依然0件。検証データ掃除済み。

### 決めたこと（なぜ）
- **登録した本人は宛先から除外**（壁打ち確定）。#3 チーム承認は本人含む全員だが、あれは「承認された」という受動イベントで自分の操作起点ではない。#10 は「自分で登録した予定の通知が自分に来る」冗長さを避けるため本人除外にした（性質が違うので #3 と不揃いでも筋は通る）。
- **`findTeamForNotify` を流用可**（RLS 検証で確認）。登録者は**メンバー本人**が Server Action から叩くが、0011 で teams/team_members/registrations の SELECT が「同イベント参加者」に緩和済み＝メンバーは同チームの他メンバーの user_id を読める。実機で「のり（メンバー）の登録操作でひで（他メンバー）に通知が飛ぶ」ことまで確認し、宛先が本人だけになる事故がないことを確定。
- **変更も都度通知**（`changed: true`・出来事を都度採番）。予定変更は全員が知りたい情報なので、登録と同様に毎回知らせる。二重は notifications の UNIQUE(user_id, source_event_id) が最終防衛。

### 次にやること
- [ ] #8 スクリム直前リマインド（`scrim_starting_soon`・開始2時間前・⑦Cron拡張）。matches #7 と同型を scrims に足す。**二重防止は dedup_key のみ（列追加なし）を推奨**（notifications UNIQUE で物理防止・マイグレーション不要で軽い。#7 の notified_at は効率目的で、scrims は件数が小さいうちは過剰）。着手時に最終確定。
- [ ] ⑤ Discord Bot DM（#8/#10 も DM が本命。「本日21時からスクリム」を DM で）。

---

## 2026-07-06 — チーム日程管理（スクリム/練習）: 種別カード一覧＋公式戦統合

要件 3.4.3「スクリム管理」を、壁打ちで**チーム日程管理**へ拡張して実装。公式戦（🔴）・スクリム（🔵）・練習（🟢）を1つの日程一覧（カード縦並び）で共有する。長期イベントの参加チームが練習予定を全員で共有する「チーム共有カレンダー」。

### やったこと
- **0035（要適用）**: `scrims.kind`（scrim/practice）追加＋**RLS 整備**（0001 で enable のみだった）。閲覧=チームメンバー or イベント主催者／作成・編集・削除=チームメンバー（**権限ゆるく＝代表限定にしない**）。メンバー判定は security definer 関数 `is_team_member` / `is_team_event_organizer`（can_report_match と同型・team_members→registrations→user で辿る）。
- **Repository**（scrims.ts）: CRUD ＋ 日程集約（`listEventScrims`＝RLS で閲覧範囲が自動で絞られる／`listEventMatchesForSchedule`＝全公式戦を対戦カード・配信URLつきで／`findViewerTeamId`＝濃淡判定と登録先チーム決定）。teams は team_id/opponent_team_id の2FKで曖昧なため FK ヒント明示。
- **Service（純粋）**: `buildScheduleItems`＝scrims/matches を ScheduleItem に正規化・種別・濃淡（自チームが絡む公式戦=own🔴/他チーム=other控えめ・主催者/観戦者は viewerTeamId=null で全部 own）・**消化済み判定（開始+2h）**・並び（未消化昇順→消化済み降順）。テスト7件。
- **Server Actions**: createScrim/editScrim/removeScrim。**team_id は入力から取らず findViewerTeamId で自チームに固定**（他チームへの登録を封じる＝IDOR/マスアサインメント対策）。編集/削除は「対象が自チームの予定か」を確認。RLS が最終防衛。
- **UI**: `/events/[id]/schedule`（サーバー）＋ `schedule-list.tsx`（クライアント）。日程カード（種別の色・左枠線・濃淡・消化済みは下部に opacity-50）・登録/編集ダイアログ（既存 DateTimePicker 再利用）・削除確認。イベント詳細に「日程（スクリム・練習）」導線。
- lint / typecheck / test(344緑・+7) / build 通過。**実機確認済み**（0035適用後・Playwright）: スクリム登録（vs相手）・練習（DB挿入・メモ表示）・公式戦統合（🔴＋配信リンク）・日程順ソート・消化済み分離を確認。登録時に出た setState-in-render 警告（ダイアログの成功時 onClose）を **useEffect に移して修正**。検証データ掃除済み。

### 決めたこと（なぜ）
- **「スクリム機能」→「チーム日程管理」に拡張**（オーナー構想）。公式戦・スクリム・練習の3種を1画面で。他チームの公式戦も控えめに出す（「別チームと組もう」「観に行こう」の選択肢が生まれる）。
- **公式戦は表示だけ統合・データは matches のまま**（案A）。既存の対戦表/結果/順位と密結合の matches に手を入れず、日程一覧で読んで統合。
- **消化済みは開始+2h**（オーナー指摘）。スクリムは終了時刻を持たない運用（30分後ろ倒しは Discord で共有＝アプリ管理外）。開始ちょうどで消えると変なので +2h 猶予。終了時刻カラムは持たない。
- **濃淡は「自チームが絡むか」の1判定**。控えめにするのは「自チーム以外を弱める」意味なので、自チームが無い主催者/観戦者には全公式戦を通常色。
- **カレンダーUIは登録ダイアログの日付ピッカーだけ**。一覧はカード縦並び（視認性）。

### 次にやること
- [ ] 0035 適用（本番）。スクリム通知 #10（登録/変更）・#8（直前リマインド・⑦Cron拡張）は後続（この日程が土台）。
- [ ] ⑤ Discord Bot DM（個人向け・Bot 構築）。#8/#10 も Bot DM が本命（「本日21時からスクリム」を DM で）。

---

## 2026-07-06 — 通知 PR: 個人通知の拡充（応募却下 #2・チーム承認 #3）

通知カタログ 3.7 の積み残しだった個人向け通知2つ。**既存の承認/却下・チーム承認フローに通知を1本ずつ足すだけ**（外部設定ゼロ・①A 土台に乗る）。宛先が自明な直接関係者なのでフォロー集約は不要。

### やったこと
- **#2 応募却下**（`registration_rejected`）: `buildRegistrationRejectedContent`（#1 承認と対称・宛先は応募者本人1人）＋ `notifyRegistrationRejected`。`decideRegistration` を「承認時のみ通知」→「承認=#1 / 却下=#2 の両方で通知」に変更（ベストエフォート）。
- **#3 チーム承認**（`team_approved`）: `buildTeamApprovedContent`（宛先はチームメンバー全員）＋ `findTeamForNotify`（teams→team_members→registrations→user と events を1クエリで引き宛先集約）＋ `notifyTeamApproved`（aggregateRecipients で重複排除・1出来事→全メンバーに並列生成・UNIQUE で二重防止）。`approveTeam` の承認成功後にベストエフォートで呼ぶ。
- 文面ビルダのテスト2件追加。lint / typecheck / test(337緑・+2) / build 通過。**実機確認済み**（Playwright）: のりがひでの応募を却下→**ひでに #2 が届く**／self チームを承認→**メンバー（ひで・のり）全員に #3 が届く**。検証データ掃除済み。

### 決めたこと（なぜ）
- **却下も通知する**（#2）。承認だけ通知して却下を無言にすると応募者が結果を待ち続ける。文面はサーバー固定で淡々と（主催者が文言を編集する領域ではない）。
- **#3 の宛先はチームメンバー全員**（代表だけでなく）。self チームは全員が当事者なので、成立を全員に知らせる。宛先集約は aggregateRecipients を再利用（②③の資産）。
- 却下は否定的通知だが type・文面はカタログ 3.7 準拠でサーバー固定（マスアサインメント対策の一貫性）。

### 次にやること
- [ ] 通知カタログ 3.7 の残り: #8/#10 スクリム通知は**スクリム機能（要件 3.4）**が前提。⑤ Discord Bot DM（個人通知を DM で・Bot 構築が要る）。
- [ ] 個人通知の Discord DM 化（⑤）で #1〜#3 が DM でも届くようになる。

---

## 2026-07-03 — 通知 PR-⑦: Cron 定期通知（試合直前リマインド #7・本日の試合告知 #9）

時刻で発火する通知（Vercel Cron）。**#7 試合開始2時間前リマインド**（出場メンバーへアプリ内通知）と **#9「本日◯時から各試合」全体告知**（告知チャンネルへ Webhook・④のインフラ流用）。#8 スクリムは前提機能（スクリム機能）未実装のため除外。マイグレーション不要（`matches.scheduled_at`/`notified_at` は 0001 で既存）。

### やったこと
- **admin クライアント**（`src/lib/supabase/admin.ts`）: service_role で **RLS を全バイパス**する Cron 専用クライアント。ログインセッションが無い定期処理で他人の試合・メンバーを跨ぐため。サーバー専用（キーはクライアントに出さない）。
- **Cron Repository**（`src/lib/repositories/cron.ts`）: 2時間以内開始&未通知の試合取得（matches→teams→team_members→registrations→users を埋め込みで辿る）／`markMatchNotified`（notified_at を **is null 条件付き UPDATE** で立てる＝並行実行の二重送信防止）／本日試合のある webhook 付き公開イベント取得／admin 版の notification_events/notifications/deliveries insert。
- **Service（純粋）**: `buildMatchStartingSoonContent`（#7・観戦ビューへ・JST時刻）／`buildEventMatchesTodayWebhookContent`（#9・Webhook文）／`fmtJstDateTime`（共通・UTC→JST）＋テスト5件。NotificationType に #7/#9 追加。
- **オーケストレーション**（`src/lib/notifications/cron-notify.ts`）: `runMatchReminders`（#7・notified_at で枠を取ってから宛先集約→通知・aggregateRecipients で重複排除・dedup_key=`match:<id>:...`）／`runTodayMatchAnnounce`（#9・dedup_key=`event:<id>:event_matches_today:<JST日付>` で**1日1回**・Webhook 投稿結果を deliveries に記録）。各件ベストエフォート。
- **Route Handler**（`src/app/api/cron/notifications/route.ts`）: GET・**`Authorization: Bearer <CRON_SECRET>` 検証**（不一致=401・未設定=500）・#7#9 を allSettled で独立実行・結果 JSON。デフォルト非キャッシュ。
- **vercel.json**: `/api/cron/notifications` を `*/10 * * * *`（10分毎）。
- types.ts に `notification_events.dedup_key`（0031 で追加済みだが型が未反映だった）を手動追加。
- lint / typecheck / test(335緑・+5) / build 通過。**実機確認済み**（dev で CRON_SECRET 直叩き）: 401（無認証/誤SECRET）／#9 sent（**告知チャンネルに実投稿**）→2回目 skipped（1日1回集約）／#7 出場メンバー2人にアプリ内通知＋notified_at セット→2回目 matchesConsidered:0（二重防止）。検証データ掃除済み。

### 決めたこと（なぜ）
- **#7と#9両方・#8除外**（確定）。#8 スクリムは機能自体が無い。#7/#9 は Cron 基盤を1回作れば2 type 載せる追加コストが小さい。
- **Cron は service_role（RLS バイパス）＋ CRON_SECRET 保護**（確定）。Cron にログインユーザーはおらず auth.uid() が使えない。definer 関数だと通知生成ロジックを SQL に寄せ TS Service と二重になるため、service_role で既存 TS Service を使い回す。Route を CRON_SECRET で固く守るのが前提。
- **二重防止は2系統**: #7 は `matches.notified_at`（条件付き UPDATE）＋ notifications UNIQUE、#9 は `notification_events.dedup_key`（日付入り・1日1回）。通知洪水と重複を物理防止。
- **リマインドは相対発火（開始2h前）**（要件確定）。Cron を数分間隔で回し「2時間以内開始&未送信」を拾う。

### 次にやること
- [ ] **本番設定**: Vercel の環境変数に `CRON_SECRET`（Route と同値）＋ `NEXT_PUBLIC_APP_URL` を設定。`vercel.json` の Cron を有効化。
- [ ] **Vercel Hobby プランは Cron が1日1回まで**。現状 `*/10 * * * *` は Pro 前提。Hobby なら `0 0 * * *` 等に落とす（プランに応じて調整）。
- [ ] ⑤ Discord Bot DM（個人向け・Bot 構築）。#7 の宛先に DM チャネルを足せば「試合直前を DM で」が完成（⑤×⑦）。

---

## 2026-07-03 — 通知 PR-④: Discord Webhook で全体告知（イベント公開→告知チャンネル投稿）

通知の中心価値「アプリを開かなくても通知が届く」の入口。全体向け通知（3.5.2）を **Discord の告知チャンネルへ Webhook 投稿**する。⑤（Bot DM＝個人向け）の前段。スキーマは 0001 で既に用意されていた（`events.discord_webhook_url` / `notification_deliveries` / enum）ため **マイグレーション不要**（0027 の deliveries INSERT ポリシーで足りる）。

### やったこと
- **URL 配線**: `events.discord_webhook_url` をイベント作成/編集フォームに入力欄追加（Zod で任意・**Discord ホスト（discord.com/discordapp.com）の webhook 形式のみ受理**＝任意ホストへの POST を主催者入力から許さない）。マスアサインメント許可カラム（EventEditableColumns / EventEditableValues）にも追加。edit プリフィル対応。
- **Service（純粋）**: `buildEventAnnounceWebhookContent`（告知チャンネル向けの1メッセージ・**絶対URL**を含む）＋テスト。
- **app サービス**: `src/lib/notifications/discord.ts` の `postToDiscordWebhook(url, content)`（fetch・5s タイムアウト・2xx 判定・`allowed_mentions: {parse:[]}` で @everyone 誤爆防止・例外を投げず結果オブジェクトを返す）。
- **Repository**: `insertDelivery`（notification_deliveries に sent/failed/skipped を記録・全体告知は個人 notifications に紐づかないため notification_id は null 可）。
- **オーケストレーション**: `announceEventPublishedToWebhook`（URL 未設定→skipped / 投稿成功→sent / 失敗→failed。target_ref は**ホストのみ**＝トークンを保存しない）を publishEvent から**ベストエフォート**で呼ぶ（③アプリ内通知と並ぶ別レイヤー・宛先集約は通さない＝チャンネルに1投稿）。
- **絶対URL**: Discord メッセージ内リンク用に `NEXT_PUBLIC_APP_URL`（未設定は localhost:3000 フォールバック）。
- lint / typecheck / test(330緑・+1) / build 通過。**実機確認済み**（Playwright で公開・本物 Webhook URL）: skipped（URL未設定）／failed（無効URL→HTTP 404・**公開自体は成功**＝ベストエフォート）／**sent（本物URLで実投稿→告知チャンネルに実際に届いた）** の3パスを確認。検証データ掃除済み。

### 決めたこと（なぜ）
- **URL は event 単位**（確定）。公開告知はイベント単位の出来事なので自然。series 側 URL へのフォールバック（0001 コメント「未設定なら series」）は series 編集 UI ができてから（現状は event のみ）。
- **失敗時はリトライせず記録のみ**（確定）。再送は⑦Cron の仕組みで failed を拾い直す。④にリトライ/バックオフを入れると膨らむ。
- **Discord ホスト限定＋トークン非保存**（SSRF/誤爆・秘密情報漏洩の予防）。URL 形式は schema で Discord に限定、記録は host のみ。
- **投稿は app サービス層（副作用）／文面は Service（純粋）**（層構造）。⑤Bot DM も同じ discord.ts に足せる。

### 次にやること
- [ ] 本番デプロイ時に `NEXT_PUBLIC_APP_URL` を設定（未設定だと Discord のリンクが localhost になる）。
- [ ] ⑤ Discord Bot DM（個人向け・Bot 構築が要る）／⑦ Cron（試合直前・本日の試合）。日程確定・結果更新の Webhook 化も後続で。

---

## 2026-07-03 — シリーズ PR-⑥-2: シリーズ共同運営（検索招待・承認/拒否・削除・#11通知）

⑥-1 では series_members は「作成者が自分を owner・active で登録」だけだった。本 PR で **owner が他ユーザーを検索して admin 招待 → 相手が承認（invited→active）→ 運営業務ができる**までを通した（要件定義書 3.5.1 / 3.7 #11）。外部設定ゼロ・依存は⑥-1(0032)のみ。

### やったこと
- **0033（要適用）**: security definer 関数4つ ＋ series_members の RLS 拡張。
  - `search_users_for_invite`（discord_name/battle_tag 部分一致・既member除外・上限20。users は他人行が RLS で見えないため definer で跨ぐ）／`invite_series_member`（owner資格・二重招待防止を関数内で検証し admin・invited で INSERT）／`respond_to_series_invite`（本人の invited 行のみ承認=active化 / 拒否=削除。作用行数を返す）／`remove_series_member`（owner資格＋**最後の active owner 保護**＝孤立防止）。
  - RLS: INSERT に「owner による招待（admin・invited）」を追加／UPDATE「本人が自分の invited 行を承認」／DELETE「owner または本人」。
- **series Repository**: listSeriesMembers（users を `!series_members_user_id_fkey` でヒント埋め込み＝多FK曖昧回避）／findSeriesMembership／searchUsersForInvite／inviteSeriesMember／respondToSeriesInvite／removeSeriesMember。
- **通知 #11**: `NotificationType.SeriesMemberInvited` ＋ `buildSeriesMemberInvitedContent`（link=シリーズ詳細＝承認先）＋ `notifySeriesMemberInvited`（直接関係者・1人宛・出来事は招待ごとに生成。フォロー集約不要）。招待 Action からベストエフォートで呼ぶ。
- **Server Actions**: searchInviteCandidates（owner のみ候補検索）／inviteMember／respondInvite／removeMember。いずれも冒頭ログイン確認・Zod 検証・DB関数の例外をユーザー向けメッセージに丸める。role/status は入力から取らずサーバー固定（マスアサインメント対策）。
- **シリーズ詳細ページ**: owner に運営管理パネル（検索→招待／運営一覧＋削除）、被招待者本人に承認/辞退バナー、それ以外に読み取り専用の運営一覧。**「次の開催回を作成」を created_by 判定 → staff(owner/admin・active) 判定に切替**（admin もイベント運営できるべき、という⑥-1の積み残しを解消）。
- lint / typecheck / test(329緑・+2) / build 通過。**実機確認済み**（0033適用後・Playwright＋anon+ひでJWTで RLS を効かせて検証）: のりがシリーズ作成→ひで検索→招待（admin/invited・#11通知届く）→ひでが承認（admin のまま active）→運営一覧に反映。**RLS 直叩きで role=owner への自己昇格が弾かれる**／**admin は招待できない（owner資格）**／**最後の active owner は退会できない**を確認。検証データ掃除済み。

### 直したこと（実機で発見）
- **Supabase の RPC 例外は Error インスタンスではない**（`{code, message}` のプレーンオブジェクト）。当初 `e instanceof Error ? e.message : ""` で message を取りこぼし、「最後のオーナーは削除できません」等の専用メッセージが汎用エラーに落ちていた。`errorMessage(e)` ヘルパで message を確実に拾うよう修正（inviteMember / removeMember 両方）。

### 直したこと（code-review で発見・重大／0034 で修正・要適用）
- **【Critical】definer 関数の認可バイパス（権限昇格）**。0033 の4関数は actor を引数（p_inviter/p_user/p_remover）で受け取っていた。Postgres は definer 関数に EXECUTE を PUBLIC へデフォルト付与するため、認証済みユーザーが REST の `/rpc/<fn>` を直叩きし、**他人の owner UUID を actor に渡すだけで RLS をバイパスして権限昇格できた**（非 owner が「のりの UUID を p_inviter に」→自分を admin 招待、を **anon+ひでJWT で実地再現**）。最初の実機確認は Server Action 経由しか見ておらず RPC 直叩きを検証していなかったため見逃していた。
- **【Critical】DELETE RLS で最後の owner 保護をバイパス**。`series_members_delete_owner_or_self` の USING が `user_id=auth.uid()` で自己削除を無条件許可。唯一の owner が直 REST DELETE で自分を消しシリーズ孤立（以後 update=owner で永久ロック）できた。
- **0034（要適用）で修正**: (1) 4関数の actor を **`auth.uid()` に変更・引数廃止**（他人 UUID を渡す攻撃を原理的に不可能に）。(2) `search_users_for_invite` に owner 内部チェック追加＋ilike の `% _` エスケープ。(3) 削除/承認/招待は **全て definer 関数経由に強制**（DELETE/UPDATE/INSERT の RLS ポリシーを撤去）。最後 owner 保護・TOCTOU 対策（`for update`）を関数が一元管理。(4) 4関数の EXECUTE を **anon から REVOKE**（authenticated のみ）。
- 併せて軽微修正: respondInvite に try/catch 追加（他3アクションと非対称だった）／招待成功後に検索結果を「招待済み」表示にして陳腐リストの再クリックエラーを防止／notify の source_event_id 採番に関するコメント誤記（UNIQUE で集約される、は誤り）を修正。
- types.ts / Repository / Actions を新シグネチャに追従。lint / typecheck / test(329緑) / build 通過。

### 決めたこと（なぜ）
- **検索は全ユーザー部分一致**（案A・確定）。要件が「フォロー有無に依存しない汎用性（初めて組む人も招待可）」を明示。プライバシー懸念は本人承認と上限20で緩和。
- **承認 UI はシリーズ詳細に出す**（確定）。🔔通知→/series/[id]→承認/辞退。専用受信箱は作らず小さく保つ。
- **owner 最後の1人保護**（確定）。最後の active owner は削除/退会不可（シリーズ孤立防止）。admin は owner を蹴れない（削除は owner のみ）。
- **RLS UPDATE の権限昇格穴を塞いだ**（自己レビュー）。当初 WITH CHECK が `user_id=auth.uid()` のみで、被招待者が RLS 直叩きで `role='owner'` に自己昇格できた。`role='admin' and status='active'` に固定（承認は admin のまま active 化のみ）。role 変更 UI は将来別ポリシーで。

### 次にやること
- [ ] 0033 を Supabase SQL Editor で適用 → 実機確認（招待→承認→運営業務／#11通知／最後のowner保護／権限昇格が塞がれているか）。
- [ ] ④ Discord Webhook / ⑤ Bot DM（外部設定の壁打ちから）／⑦ Cron。

---

## 2026-07-02 — シリーズ PR-⑥-1: シリーズ基盤（作成/一覧/詳細・シリーズ化・フォロー・③接続・プリフィル）

通知フェーズの積み残し「シリーズ」。継続する企画（例: OSL）を独立概念として持ち、フォローすると新しい開催回の公開が届く（要件定義書 3.5.1）。壁打ちで設計を2回見直した：シリーズ先→**イベント起点（単発→好評→シリーズ化）**、プリフィルは**前回イベント設定**。

### やったこと
- **0032（適用済み）**: event_series/series_members の RLS（SELECT公開・INSERT本人・UPDATE=owner）＋ security definer 関数 `is_series_owner` / `is_series_staff` ／ **`create_series_with_owner`（シリーズ作成＋owner登録を1トランザクション。孤立シリーズ防止）**。
- **series Repository**: insertSeries（RPC）／listSeries／findSeriesById／existsSeriesById／listMySeries／listSeriesEvents／findLatestEventSettingsForSeries（プリフィル用）。
- **シリーズページ**: `/series`（一覧・公開）／`/series/[id]`（詳細＝情報＋開催回一覧＋**series フォローボタン**＝既存 FollowButton を series で再利用）。作成 Action（createSeries）。
- **イベント起点のシリーズ化**: イベント詳細に「シリーズ化する」ボタン（主催者・series 未所属のみ）＋ `seriesifyEvent` Action（イベント名でシリーズ作成→この回を第1回に紐付け）。所属済みは「シリーズを見る」導線。
- **③公開通知に series フォロワーを接続**: `notifyEventPublished` に seriesId を渡し、主催者フォロワー ∪ series フォロワーを aggregateRecipients で和集合＋重複排除（3.6.1）。
- **2回目以降のプリフィル**: シリーズ詳細（owner）に「次の開催回を作成」→ `/events/new?series=<id>`。作成ページで最新イベント設定を EventFormDefaults に詰めてプリフィル（編集可）＋ series_id を hidden 保存。**編集フォームでは series_id を触らない**（null 上書き防止のため updateEvent で除外）。
- follow-schema / FollowButton / toggleFollow を series 対応（3種: event/user/series）。
- lint / typecheck / test(327緑) / build 通過。**実機確認済み**（0032適用後・Playwright）: シリーズ化→series作成＋owner(active)＋第1回紐付け／ひでが series をフォロー→のりが新回公開→**主催者は未フォローでも series フォローだけでひでに通知**、を確認。検証データ掃除済み。

### 決めたこと（なぜ）
- **イベント起点のシリーズ化**（オーナー指摘・確定）。「最初からシリーズ化を見込むイベントは少ない。単発→好評→次回→シリーズ」が実態。空の箱を先に作る `/series/new` は主導線から外し、イベント詳細の「シリーズ化」を起点にした。
- **プリフィルは前回イベント設定**（案B・確定）。event_series に大会設定カラムを持たせる（案A）と十数項目の二重管理になるため、「Season2 は Season1 と同じ設定」という実態に合わせ最新イベントを引き継ぐ。
- **create_series_with_owner でトランザクション化**（code-review 指摘）。分割 INSERT だと members 失敗で owner 不在の孤立シリーズが残り、RLS(update=owner) で誰も編集できなくなる。
- **series フォローの revalidate 対応**（code-review 指摘）。toggleFollow の revalidate 正規表現を /events/・/series/ 両対応に（シリーズ詳細のフォローが反映されないバグを修正）。

### 次にやること
- [ ] ⑥-2: シリーズ共同運営（owner/admin・検索招待・series_members の invited→active フロー）。
- [ ] ④ Discord Webhook / ⑤ Bot DM（外部設定の壁打ちから）。

---

## 2026-07-02 — 通知: event フォロワーへの結果更新・日程更新通知（#6/#5短期・1日1回集約）

③（出来事→通知生成）の横展開。event フォロワーへ「結果が更新された（#6）」「日程が更新された（#5・短期イベント分）」を通知する。中心は**通知洪水の防止**＝イベント単位・1日1回に集約。全体向け（Discord Webhook）は④に回し、今回は個人＝event フォロワー（アプリ内）分のみ。

### やったこと
- **マイグレーション `0031_notification_events_dedup_key.sql`（新規・適用済み）**: `notification_events.dedup_key`（nullable・unique）を追加＋ `upsert_notification_event(...)` security definer 関数（dedup_key で find-or-create し id を返す。notification_events は SELECT 不可のため RLS バイパス）。
- **`notifications.upsertNotificationEvent`**（RPC 経由）＋ `types.ts` に関数型を手動追加。
- **アプリケーションサービス新設 `src/lib/notifications/notify.ts`**: `notifyEventFollowers`（event フォロワー集約＋本人除外＋1日1回 dedup＋Promise.allSettled 並列生成）。2つの Controller（reportResult / updateEvent）から共用。Service は repository 非依存の規律を保ちつつ、クロス Controller のオーケストレーションを正しい層に置く。
- **content に #5/#6 の type＋文面**（`event_schedule_confirmed` / `event_result_updated`）。テスト +3。
- **`reportResult`（#6）に差し込み**: 結果保存成功後、event フォロワーへ通知（ベストエフォート）。link 先は観戦ビュー。
- **`updateEvent`（#5 短期）に差し込み**: 公開済み＆開催日時が実際に変わったときのみ通知（redirect の前・ベストエフォート）。
- lint / typecheck / test(327緑) / build 通過。**実機確認済み**（0031適用後・Playwright＋service_role）: 日程変えず保存→通知ゼロ / 日程変更→通知1件 / 同日2回目の変更→通知増えず（dedup 効く）。検証データ掃除・イベント日程復元済み。

### 決めたこと（なぜ）
- **1イベント・1種別・1日1回に集約**（壁打ち確定）。結果は1試合ごと（総当たりで数十回）、日程も変わり得るため、毎回フォロワー全員に飛ばすと洪水。dedup_key=`event:<id>:<type>:<JST日付>` で1日1出来事を DB 物理保証し、notifications の UNIQUE(user_id, source_event_id) が同日2通目を弾く（3.6.1: DB で最終防衛）。
- **#5 日程通知はイベント形式・期間で意味が違う**（オーナー整理・確定）。短期（総当たりのみ/トナメのみ）は「主催者が日程を組んだ/変えたとき1回」。長期予選は「期間中！観戦ビューをチェック」、決勝Tは確定時——**長期系は Cron・本戦進行と絡むため後続**（本 PR は短期＝updateEvent での starts_at 変更のみ）。
- **starts_at 比較は時刻の値で行う**（code-review 指摘＝実害バグを修正）。保存形式 "...000Z" と DB 読み出し形式 "...+00:00" の文字列差で「変えてないのに毎回通知」になるのを防ぐ（`new Date(a).getTime() !== new Date(b).getTime()`）。
- **共用オーケストレーションは lib/notifications に新設**: 2 Controller から呼ぶため。Service（純粋）を汚さない。

### コードレビュー（/code-review high）で修正
- #5 の starts_at 文字列比較→時刻値比較（実害）。upsert RPC の `data as string`→null チェックで例外。

### 次にやること
- [ ] #6 結果更新の実機確認（試合結果セットアップが要る・共通基盤は #5 で確認済み）。
- [ ] ④ Discord Webhook（全体告知）／⑤ Bot DM。外部設定の壁打ちから。
- [ ] #5 長期系（予選期間中告知・決勝T日程確定）＝ Cron#9 と一緒に。

---

## 2026-07-01 — 通知 PR-③: 出来事→通知生成（フォロワー集約・重複排除／公開通知を接続）

①（通知）と②（フォロー）を繋ぐ要。要件定義書 3.6.1 の「出来事起点→宛先集約→重複排除→1人1通」を初めて実装。最初の出来事は **主催者が新イベントを公開 → 主催者(user)フォロワーへ通知**（type=`series_season_announced`・3.7 の #4）。series フォロワーは⑥で追加。

### やったこと
- **マイグレーション `0030_list_follower_ids.sql`（新規・適用済み）**: フォロワー集約用 security definer 関数。follows の RLS（0029・本人のみ SELECT）では「対象のフォロワー全員」を集められないため、RLS をバイパスして follower_id 集合を返す（0015 can_report_match と同じパターン）。
- **`follows.ts` に `listFollowerIds`**: 上記 RPC 経由でフォロワー列挙。`types.ts` に関数の型を手動追加（gen types で正式化される）。
- **`notification-fanout.ts`（新規・純粋関数）**: `aggregateRecipients`（複数フォロワー集合の和集合＋ユーザー単位重複排除＋本人除外・順序安定）。3.6.1 の核心。テスト +7。
- **`notification-content.ts` に `SeriesSeasonAnnounced` type＋文面**（サーバー固定生成）。テスト +2。
- **`publishEvent`（Controller）に `notifyEventPublished` を差し込み**: 公開成功後にベストエフォートで通知（失敗しても公開は成功）。宛先＝主催者フォロワー・本人除外。
- lint / typecheck / test(324緑) / build 通過。**実機確認済み**（0030適用後・Playwright＋service_role）: ひで→のりフォロー→のりが OSLmini 公開→**ひで宛てに series_season_announced 通知が生成**、を確認。検証データは掃除済み。

### 決めたこと（なぜ）
- **type は series_season_announced を使う**（壁打ち確定）。3.7 で旧 event_published は series_season_announced に統合済み。新 type を作ると同じ公開操作から2通飛ぶ二重通知リスク（3.6.1 が防ぐ事故）が再発するため、1 type に統一し⑥で series フォロワーを足すだけにする。
- **フォロワー集約は security definer 関数（0030）**: follows の RLS（本人のみ SELECT）を通常クライアントで跨げないため。返すのは user_id のみ（フォロー関係の詳細は出さない）。
- **宛先集約・重複排除は純粋関数（Service）に集約**: 3.6.1 の規則（和集合・ユニーク化・本人除外）をテストで固定。DB 取得（Repository）と分離。
- **ベストエフォート＋並列生成**: 通知失敗で公開を巻き添えにしない。各宛先は Promise.allSettled で独立生成（1件失敗が他を巻き込まない・多数フォロワーでも直列待ちにしない）。二重は UNIQUE(user_id, source_event_id) が最終防衛。

### コードレビュー（/code-review high）で修正
- 直列ループ→Promise.allSettled（部分配信の防止＋並列化）。`as string[]` キャスト削除（types.ts の Returns 定義で不要に）。

### 次にやること
- [ ] 他の出来事を接続（日程確定・結果更新＝event フォロワー集約）。カタログ 3.7 参照。
- [ ] ④ Discord Webhook（全体告知）／⑤ Bot DM（個人）。外部設定の壁打ちから。
- [ ] ⑥ シリーズ概念＋series フォロワーを series_season_announced に追加。

---

## 2026-07-01 — フォロー PR-②: フォロー基盤（event / user・follows RLS＋CRUD＋ボタン）

通知の土台①A 完了に続き、次フェーズ②フォロー基盤。イベント詳細でイベント／主催者をフォロー・解除できるようにした。フォロー対象3種のうち **event と user の2種**（series はシリーズ画面が未実装なので⑥に回す）。フォローしても通知が届くのは③（出来事→宛先集約）以降。

### やったこと
- **マイグレーション `0029_follows_rls.sql`（新規・適用済み）**: follows の RLS。SELECT/INSERT/DELETE=本人のみ（follower_id=auth.uid()）。二重フォローは UNIQUE(follower_id, target_type, target_id)。
- **follows Repository `src/lib/repositories/follows.ts`（新規）**: `insertFollow`（23505→alreadyFollowing）／`deleteFollow`（冪等）／`isFollowing`（head count）。
- **フォロー Server Action `src/app/events/[id]/follow-actions.ts`（新規）**: ログイン確認＋Zod（event/user・uuid）＋**対象の実在確認**（ポリモーフィックで FK 無しのため event=`findEventById`／user=`findDiscordName` で存在確認）＋follow/unfollow。follower_id は auth.uid() 固定。
- **`follow-schema.ts`（Zod）**: target は event/user のみ・uuid（マスアサインメント対策）。
- **FollowButton `follow-button.tsx`（新規・クライアント）**: 楽観的トグル・失敗で戻す・未ログインは /login へ・event/user 共用。
- **イベント詳細ページに配置**: 非主催者のみ、イベント／主催者(名前)の2ボタン。初期状態は `isFollowing` で取得。
- lint / typecheck / test(315緑) / build 通過。**実機確認済み**（Playwright＋ひで主催のテストイベント）: 非主催者にボタン表示→クリックで「フォロー中」[pressed]→DB に follows 1件、を確認。検証データは掃除済み。

### 決めたこと（なぜ）
- **対象は event / user の2種のみ**（壁打ち確定）。series はシリーズ画面（一覧・詳細）が未実装でボタンの置き場所が無いため⑥に回す。follows 基盤（RLS/CRUD）は series でも使い回せる。
- **対象の実在確認をアプリ層で**（follows.target_id はポリモーフィックで FK が無い設計）。存在しない event/user のフォローを Server Action で弾く。
- **フォロー状態取得は非主催者のみ**（主催者は自分の対象をフォローしない）。未ログインはボタンは出すが押下で /login へ。
- 既存流儀の踏襲: 楽観的トグル（A2a 既読化と同じ）・保護操作は /login?redirect=・follower_id サーバー固定。

### 実機で確認した運用メモ（バグではない）
- **0029 未適用だとフォロー INSERT が 42501**（RLS 有効・ポリシーゼロ＝全拒否）。手動適用で解消（[[migration-apply-practice]]）。通知の 0027 と同じ「適用忘れ」注意点。

### 次にやること
- [ ] ③ 出来事→通知生成（notification_events→宛先集約→重複排除 3.6.1）。ここで初めてフォロワーに通知が飛ぶ。
- [ ] ⑥ シリーズ概念（event_series/series_members）＋ series フォロー。

---

## 2026-07-01 — 通知 PR-A2b: 通知の Realtime ライブ更新（土台①A 完了）

A2a はサーバー描画のため、通知が来ても再読み込みするまで気づけなかった。自分宛て通知の INSERT を Realtime で検知し、🔔バッジと `/notifications` 一覧をリロードなしで最新化する。**このプロジェクト初の Supabase Realtime 導入**。これで土台①A（アプリ内通知）が完了。

### やったこと
- **マイグレーション `0028_notifications_realtime.sql`（新規・手動適用これから）**: `notifications` を `supabase_realtime` publication に追加（冪等：既に含まれていれば no-op）。
- **Realtime 購読コンポーネント `src/components/notifications-realtime.tsx`（新規・クライアント）**: `notifications` への自分宛て INSERT（`filter: user_id=eq.<uid>`）を購読し、検知したら `router.refresh()`。**購読前にセッションの access_token を `realtime.setAuth()` で設定**（RLS 配下テーブルの変更配信に必須・後述バグ）。未ログインは購読しない。アンマウントで `removeChannel`。
- **ヘッダー `site-header.tsx` に購読を1つ配置**: ログイン時のみマウント＝全ページで効く。
- lint / typecheck / test(315緑) / build 通過。
- **実機確認済み（0028 適用後・Playwright）**: `/notifications` を開いたまま別経路で自分宛て通知を作る→**リロードせず**一覧に追加＋🔔バッジが「未読 N 件」に増加、を確認。channel status も `SUBSCRIBED` を確認。

### 実機で見つけたバグと修正（Realtime × RLS の認証）
- **症状**: 購読は `SUBSCRIBED` になるのに、自分宛て通知を INSERT しても発火しない（`router.refresh()` が呼ばれず画面が変わらない）。
- **原因**: Realtime の `postgres_changes` は RLS を尊重するが、**購読者のアクセストークンを Realtime に渡さないと RLS 評価ができず変更が配信されない**。anon キーのブラウザクライアントは、ログインセッションの JWT をチャンネルに明示的に渡す必要がある。
- **修正**: subscribe 前に `supabase.auth.getSession()` の `access_token` を `supabase.realtime.setAuth(token)` で設定。これで自分宛て INSERT が届くようになった。自動テストでは捕まらない（実セッション＋Realtime＋RLS が絡む）ため実機確認の収穫。

### 決めたこと（なぜ）
- **検知したら `router.refresh()`**（壁打ち確定）。🔔バッジ（ヘッダー）も一覧もサーバー描画なので、クライアント状態を二重管理せず「変化を検知→サーバー再取得」で表示は常に DB 真値。既存のサーバーコンポーネント構造を壊さない最小手。
- **購読はヘッダーに1つ**（全ページ共通ヘッダーに置く）。ページごとに購読を張らず、どの画面でも新着で🔔が動く。
- **Realtime は RLS を尊重**: 0027 の SELECT=宛先本人のみ が Realtime にも効くため、各ユーザーには自分宛ての INSERT だけが届く（他人の通知は漏れない）。念のため `filter` でも user_id を絞る二重防御。

### 次にやること
- [x] 0028 を Supabase SQL Editor で手動適用。
- [x] 実機確認（開いたまま通知→リロードせず🔔・一覧が増える）完了。
- [ ] （土台①A 完了）次フェーズ: ②フォロー基盤（follows CRUD＋フォローボタン）。

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
