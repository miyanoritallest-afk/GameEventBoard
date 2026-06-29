# GameEventBoard DB設計書

最終更新: 2026-06-18
ステータス: ドラフト（要件定義書ベース）
DBMS: PostgreSQL（Supabase）

関連: [要件定義書](./要件定義書.md)

---

## 0. 設計方針
- Supabase（PostgreSQL）前提。認証は Supabase Auth（Discord OAuth のみ）。
- ランク体系・タグ等の「変わりうる定義」はマスタテーブルに外出しし、多タイトル対応・運用調整をコード改修なしで可能にする。
- 個人スコアは「応募時点のスナップショット」を `registrations` に保存する（後のランク変動で過去記録が変わらないように）。
- 排他制御の本体はDB（条件付きUPDATE＋楽観ロック＋CHECK制約）。
- 命名: テーブルは複数形スネークケース、PKは `id`（uuid想定）、外部キーは `<対象単数>_id`、日時は `created_at` / `updated_at`。

---

## 1. テーブル一覧（全体像）

| 分類 | テーブル | 役割 |
|------|---------|------|
| ユーザー | `users` | プロフィール（Discord情報・Battle Tag） |
| ユーザー | `user_season_ranks` | シーズン×ロールのランク履歴（最大9） |
| ユーザー | `user_peak_achievement` | 高ランク到達経験（人単位ボーナス用） |
| マスタ | `games` | ゲームタイトル（OW2等） |
| マスタ | `rank_definitions` | ランク↔スコア対応表（タイトル別） |
| マスタ | `tags` | カテゴリ・タグ（初心者限定等。開発者が事前定義） |
| シリーズ | `event_series` | 継続する企画（OSL等）。開催回(events)の親 |
| シリーズ | `series_members` | シリーズの共同運営（owner/admin・承認状態） |
| シリーズ | `series_invites` | （将来）招待リンク用。当面は検索招待のみで未使用可 |
| イベント | `events` | イベント本体（=開催回。定員・日程・応募フロー設定・スコアリング設定・series_id・version） |
| イベント | `event_tags` | イベント↔タグ（多対多） |
| イベント | `event_form_fields` | 募集フォームのカスタム質問定義（フォームビルダー） |
| 応募 | `registrations` | 参加応募（承認状態・マッチング希望・個人スコアのスナップショット） |
| 応募 | `registration_answers` | カスタム質問への回答 |
| チーム | `teams` | チーム（所属イベント・応募ステータス・代表・version） |
| チーム | `team_members` | チーム所属（担当ロール・レギュラー/リザーブ・代表） |
| 進行 | `groups` | 予選グループ（A〜D等） |
| 進行 | `group_teams` | グループ↔チーム所属 |
| 進行 | `matches` | 試合（対戦カード・日時・リプレイコード・配信URL） |
| 進行 | `match_lineups` | （Phase2任意）試合ごとの出場メンバー記録。交代履歴 |
| 進行 | `match_results` | 試合結果（スコア・勝敗） |
| 進行 | `standings` | 順位表（グループ内/全体） |
| 練習 | `scrims` | スクリム（練習試合）。チーム単位でカレンダー管理 |
| SNS | `follows` | フォロー関係（series/event/user） |
| SNS | `notification_events` | 通知の発生源（出来事）。1出来事1行 |
| SNS | `notifications` | 各ユーザーへの実配信（出来事から重複排除して生成） |
| SNS | `notification_deliveries` | 各 notification の外部配信状況（Discord DM/Webhook）記録 |

---

## 2. ENUM / 区分値
```
role            : tank | dps | support
member_position : regular | reserve
reg_status      : pending | approved | rejected | withdrawn
event_status    : draft | published | recruiting | closed | ongoing | finished
match_phase     : group | tournament
peak_tier       : none | master | gm | champion
follow_target   : series | event | user            # フォロー対象（3種）
entry_type      : individual | team | mixed        # 参加表明の単位
team_formation  : self | organizer | none          # チームの作られ方
team_status     : pending | approved | rejected     # チーム応募の状態
field_type      : text | textarea | select | url | number   # フォームビルダー入力型
series_role     : owner | admin                     # シリーズ運営の権限
member_state    : invited | active                  # シリーズ運営の承認状態
delivery_channel: discord_dm | discord_webhook       # 外部通知の配信チャネル
delivery_status : pending | sent | failed | skipped  # 外部配信の状態（skipped=DM拒否等で送れない）
```

---

## 3. テーブル定義

### 3.1 users（プロフィール）
Supabase Auth の `auth.users` と1対1で対応（`id` = auth uid）。

| 列 | 型 | 制約 | 説明 |
|----|----|------|------|
| id | uuid | PK（=auth.uid） | Supabase Authのユーザー |
| discord_id | text | UNIQUE NOT NULL | Discord OAuth取得 |
| discord_name | text | NOT NULL | 表示名 |
| discord_avatar_url | text | | アイコン |
| battle_tag | text | NOT NULL | ゲーム内ID（必須・初回登録） |
| is_admin | boolean | DEFAULT false | サイト管理者か |
| discord_dm_opt_in | boolean | NOT NULL DEFAULT true | Discord DM通知を受け取るか（3.5.2） |
| created_at | timestamptz | DEFAULT now() | |
| updated_at | timestamptz | DEFAULT now() | |

> battle_tag は「初回ログイン後に必須登録」。登録前はプロフィール未完了として応募不可（アプリ側で制御）。

### 3.2 user_season_ranks（シーズン×ロールのランク履歴）
本人申告。1ユーザーにつき「Nシーズン × 3ロール」分の行を持つ。

| 列 | 型 | 制約 | 説明 |
|----|----|------|------|
| id | uuid | PK | |
| user_id | uuid | FK→users, NOT NULL | |
| game_id | uuid | FK→games, NOT NULL | どのタイトルか |
| season_label | text | NOT NULL | 例: "2024-S3"。相対でなく絶対表記 |
| season_order | int | NOT NULL | 新しいほど大。直近N件抽出用 |
| role | role | NOT NULL | tank/dps/support |
| rank_definition_id | uuid | FK→rank_definitions, NOT NULL | 申告ランク |
| created_at | timestamptz | DEFAULT now() | |

制約: UNIQUE(user_id, game_id, season_label, role)

### 3.3 user_peak_achievement（高ランク到達経験・人単位）
| 列 | 型 | 制約 | 説明 |
|----|----|------|------|
| user_id | uuid | PK, FK→users | |
| game_id | uuid | PK, FK→games | タイトル別に保持 |
| peak_tier | peak_tier | NOT NULL DEFAULT 'none' | none/master/gm/champion |
| updated_at | timestamptz | DEFAULT now() | |

> 人単位（最高到達ランクを1つ）。加点の点数はイベント設定側に持つ。

### 3.4 games（ゲームタイトル・マスタ）
| 列 | 型 | 制約 | 説明 |
|----|----|------|------|
| id | uuid | PK | |
| name | text | UNIQUE NOT NULL | 例: "Overwatch 2" |
| roles | role[] | NOT NULL | 対応ロール（OW2は tank/dps/support） |
| team_size | int | NOT NULL | 例: 5 |
| created_at | timestamptz | DEFAULT now() | |

### 3.5 rank_definitions（ランク↔スコア対応表・マスタ）
| 列 | 型 | 制約 | 説明 |
|----|----|------|------|
| id | uuid | PK | |
| game_id | uuid | FK→games, NOT NULL | |
| tier | text | NOT NULL | 例: "ブロンズ", "チャンピオン" |
| division | int | | 例: 5〜1。タイトルにより無しもあり |
| label | text | NOT NULL | 例: "ブロンズ5" |
| score | numeric | NOT NULL | 例: 1, 2, …, 40 |
| sort_order | int | NOT NULL | 表示・選択順 |

制約: UNIQUE(game_id, label)
> OW2は40段階。スコアはnumericで小数も許容（将来の重み調整用）。

### 3.6 tags（タグ・マスタ／開発者が事前定義）
| 列 | 型 | 制約 | 説明 |
|----|----|------|------|
| id | uuid | PK | |
| name | text | UNIQUE NOT NULL | 例: "初心者限定", "ランクフリー" |
| category | text | | 任意のグルーピング |
| created_at | timestamptz | DEFAULT now() | |

### 3.6.1 event_series（シリーズ＝継続する企画）
開催回(events)の親。「OSL」のような継続企画を表し、フォロー・共同運営の単位（要件 3.5.1）。
| 列 | 型 | 制約 | 説明 |
|----|----|------|------|
| id | uuid | PK | |
| name | text | NOT NULL | 例: "OSL（社会人OW部リーグ）" |
| description | text | | |
| logo_url | text | | シリーズロゴ |
| discord_webhook_url | text | | 全体告知の投稿先（Discordチャンネル。3.5.2） |
| created_by | uuid | FK→users, NOT NULL | 作成者（初期owner） |
| created_at | timestamptz | DEFAULT now() | |

### 3.6.2 series_members（シリーズの共同運営）
owner/admin の2段階権限。検索招待 → 本人承認のフローを status で表現（要件 3.5.1）。
| 列 | 型 | 制約 | 説明 |
|----|----|------|------|
| id | uuid | PK | |
| series_id | uuid | FK→event_series, NOT NULL | |
| user_id | uuid | FK→users, NOT NULL | 運営メンバー |
| role | series_role | NOT NULL DEFAULT 'admin' | owner=全権限 / admin=運営業務 |
| status | member_state | NOT NULL DEFAULT 'invited' | invited=承認待ち / active=承認済み |
| invited_by | uuid | FK→users | 招待した人 |
| invited_at | timestamptz | DEFAULT now() | |
| joined_at | timestamptz | | 承認した日時 |

制約: UNIQUE(series_id, user_id)
> 各シリーズに role='owner' AND status='active' が最低1人。owner のみ運営の追加削除・シリーズ削除が可能。

### 3.6.3 series_invites（招待リンク・将来用）
当面は検索招待のみで運用。招待リンク方式を採用する際に使用。
| 列 | 型 | 制約 | 説明 |
|----|----|------|------|
| id | uuid | PK | |
| series_id | uuid | FK→event_series, NOT NULL | |
| token | text | UNIQUE NOT NULL | 招待URL用 |
| role | series_role | NOT NULL DEFAULT 'admin' | 付与する権限 |
| expires_at | timestamptz | | 有効期限（流出対策） |
| max_uses | int | | 使用回数上限 |
| used_count | int | NOT NULL DEFAULT 0 | |
| created_by | uuid | FK→users | |
| created_at | timestamptz | DEFAULT now() | |

### 3.7 events（イベント本体＝開催回）
| 列 | 型 | 制約 | 説明 |
|----|----|------|------|
| id | uuid | PK | |
| series_id | uuid | FK→event_series | 所属シリーズ（単発はnull） |
| game_id | uuid | FK→games, NOT NULL | |
| organizer_id | uuid | FK→users, NOT NULL | 主催者（series未使用時の運営主体） |
| organizer_display_name | text | | 主催者の登録名（イベント詳細「主催」に表示）。nullなら organizer.discord_name にフォールバック。0024で追加 |
| title | text | NOT NULL | |
| description | text | | |
| slug | text | UNIQUE | 公開URL用 |
| status | event_status | NOT NULL DEFAULT 'draft' | |
| capacity | int | | **定員＝チーム数**（参加できる/成立させるチーム枠） |
| current_count | int | NOT NULL DEFAULT 0 | 現在の成立チーム数（排他制御対象） |
| starts_at | timestamptz | | 開催日時 |
| recruit_deadline | timestamptz | | 募集締切 |
| **— 応募フロー設定 —** | | | (3.4.0) |
| entry_type | entry_type | NOT NULL DEFAULT 'individual' | 参加表明の単位 |
| team_formation | team_formation | NOT NULL DEFAULT 'organizer' | チームの作られ方 |
| allow_matching_choice | boolean | NOT NULL DEFAULT false | mixed時、応募者がマッチング希望を選べるか |
| **— 募集フォーム設定（構造化項目トグル） —** | | | (3.4.2) |
| require_score | boolean | NOT NULL DEFAULT true | 個人スコア（ランク申告）を求めるか |
| require_role | boolean | NOT NULL DEFAULT true | 希望ロールを求めるか |
| require_battle_tag | boolean | NOT NULL DEFAULT true | Battle Tagを使うか |
| **— スコアリング設定 —** | | | (3.1.1) |
| role_swap_allowed | boolean | NOT NULL DEFAULT true | ロールスワップ可否 |
| declared_seasons | int | NOT NULL DEFAULT 3 | 申告シーズン数（モーダル行数） |
| bonus_master | numeric | NOT NULL DEFAULT 0 | master到達加点 |
| bonus_gm | numeric | NOT NULL DEFAULT 0 | gm到達加点 |
| bonus_champion | numeric | NOT NULL DEFAULT 0 | champion到達加点 |
| uncertified_handling | uncertified_handling | NOT NULL DEFAULT 'exclude' | 未認定セルの補完方式（fill_by_role/fill_by_season/exclude）。0007で追加 |
| **— チーム構成・上限設定 —** | | | (3.1.2) |
| reserve_slots | int | NOT NULL DEFAULT 0 | リザーブ上限（OSL=2、なし=0）。チーム最大人数 = games.team_size + reserve_slots |
| team_score_cap | numeric | | チームスコア上限。**出場メンバーの final_score 平均**で判定（旧 team_avg_cap） |
| **— 本戦設定 —** | | | |
| group_best_of | int | NOT NULL DEFAULT 3 | 予選デフォルトBO（1試合のマップ数）。総当たり生成時に全試合の matches.best_of へ一括セット。CHECK 1〜15。0018で追加 |
| **— 順位設定（本戦・3.4.1） —** | | | 0016で追加 |
| ranking_enabled | boolean | NOT NULL DEFAULT false | 順位を集計するか（親トグル）。falseなら順位を出さない |
| points_win | int | NOT NULL DEFAULT 3 | 勝ち点（CHECK 0〜99） |
| points_draw | int | NOT NULL DEFAULT 1 | 引分点（CHECK 0〜99） |
| points_loss | int | NOT NULL DEFAULT 0 | 負け点（CHECK 0〜99） |
| tiebreakers | text[] | NOT NULL DEFAULT '{}' | 同着の優先順位（先頭ほど優先）。値は head_to_head/map_diff/potg（CHECK で許可値のみ）。集計・表示はPR-3c |
| **— 決勝トーナメント設定（本戦・3.4.1） —** | | | 0019で追加 |
| tournament_advance_count | int | NOT NULL DEFAULT 0 | 各ブロック上位N（決勝T進出数）。0=未使用。ブロック数×Nで進出総数、進出数以上の最小2の累乗をブラケットサイズにし不足枠はBYE。CHECK 0〜99。生成・表示はPR-5a |
| tournament_third_place | boolean | NOT NULL DEFAULT false | 3位決定戦を行うか。true かつ準決勝が2試合（4チーム以上）のとき、決勝と同じ最終roundに bracket_position=1 で生成（準決勝2敗者）。0020で追加・PR-5c |
| **— Discord連携（全体告知 3.5.2） —** | | | |
| discord_webhook_url | text | | 告知チャンネル。未設定なら series 側を使う |
| auto_announce | boolean | NOT NULL DEFAULT true | 公開/更新時に告知チャンネルへ自動投稿するか |
| **— 排他制御 —** | | | |
| version | int | NOT NULL DEFAULT 0 | 楽観的ロック |
| created_at | timestamptz | DEFAULT now() | |
| updated_at | timestamptz | DEFAULT now() | |

CHECK: current_count >= 0 / (capacity IS NULL OR current_count <= capacity)

### 3.8 event_tags（イベント↔タグ 多対多）
| 列 | 型 | 制約 |
|----|----|------|
| event_id | uuid | PK, FK→events |
| tag_id | uuid | PK, FK→tags |

### 3.8.1 event_form_fields（募集フォームのカスタム質問・フォームビルダー）
構造化項目（ランク/ロール等）とは分離した、表示用の自由項目定義（3.4.2）。
| 列 | 型 | 制約 | 説明 |
|----|----|------|------|
| id | uuid | PK | |
| event_id | uuid | FK→events, NOT NULL | |
| label | text | NOT NULL | 質問文（例: 意気込み） |
| field_type | field_type | NOT NULL | text/textarea/select/url/number |
| options | jsonb | | select時の選択肢 |
| is_required | boolean | NOT NULL DEFAULT false | 必須か |
| sort_order | int | NOT NULL DEFAULT 0 | 表示順 |
| created_at | timestamptz | DEFAULT now() | |

### 3.9 registrations（参加応募）
| 列 | 型 | 制約 | 説明 |
|----|----|------|------|
| id | uuid | PK | |
| event_id | uuid | FK→events, NOT NULL | |
| user_id | uuid | FK→users, NOT NULL | |
| display_name | text | | 応募者の登録名（このイベントでの公開表示名・応募時点のスナップショット）。nullなら user.discord_name にフォールバック。0024で追加 |
| preferred_role | role | | 希望ロール（require_role時） |
| assigned_role | role | | そのイベントで担当するロール（確定後） |
| wants_matching | boolean | | mixed時: 運営あっせん希望か(true)/自分でチーム(false) |
| status | reg_status | NOT NULL DEFAULT 'pending' | 承認状態（pending=参加表明のみ） |
| **— スコアのスナップショット —** | | | (3.1.1) |
| preferred_role_1/2/3 | role | | 希望ロール第1〜第3（第3はフォームで自動決定）。0008で追加。チーム編成の参照用 |
| individual_score | numeric | | ①個人スコア（シーズン×ロールから算出した基礎値。小数第1位に丸めて保存） |
| final_score | numeric | | ②個人ファイナルスコア = individual_score + 到達ボーナス。**チームスコア計算に使う値** |
| score_breakdown | jsonb | | 算出根拠（参照した9個・ボーナス内訳） |
| organizer_override_score | numeric | | 運営による上書きスコア（任意。あれば final_score に優先） |
| created_at | timestamptz | DEFAULT now() | |
| updated_at | timestamptz | DEFAULT now() | |

制約: UNIQUE(event_id, user_id)
> 振り分け・平均計算には organizer_override_score があればそれを、なければ individual_score を使う。

### 3.9.1 registration_answers（カスタム質問への回答）
| 列 | 型 | 制約 | 説明 |
|----|----|------|------|
| id | uuid | PK | |
| registration_id | uuid | FK→registrations, NOT NULL | |
| field_id | uuid | FK→event_form_fields, NOT NULL | |
| value | text | | 回答（型に関わらずtextで保持し、表示時に解釈） |

制約: UNIQUE(registration_id, field_id)

### 3.10 teams（チーム）
| 列 | 型 | 制約 | 説明 |
|----|----|------|------|
| id | uuid | PK | |
| event_id | uuid | FK→events, NOT NULL | |
| name | text | NOT NULL | チーム名 |
| status | team_status | NOT NULL DEFAULT 'approved' | チーム応募(self)時の承認状態。organizer振り分けは即approved |
| captain_registration_id | uuid | FK→registrations | チーム代表者（self応募時の代表） |
| version | int | NOT NULL DEFAULT 0 | 楽観的ロック（チーム枠の排他制御） |
| created_at | timestamptz | DEFAULT now() | |

制約: UNIQUE(event_id, name)
> チーム平均スコアは team_members から集計（保存列にせず算出。必要なら集計ビュー）。
> self応募（チーム単位）の場合は teams が応募の主体となり status で承認管理。organizer振り分けの場合は運営が作成し即approved。

### 3.11 team_members（チーム所属）
| 列 | 型 | 制約 | 説明 |
|----|----|------|------|
| id | uuid | PK | |
| team_id | uuid | FK→teams, NOT NULL | |
| registration_id | uuid | FK→registrations, NOT NULL | 応募（＝スコア源） |
| role | role | NOT NULL | チーム内の担当ロール |
| position | member_position | NOT NULL DEFAULT 'regular' | regular/reserve |
| is_representative | boolean | NOT NULL DEFAULT false | チーム代表者 |
| created_at | timestamptz | DEFAULT now() | |

制約: UNIQUE(registration_id)（1応募は1チームのみ）

### 3.12 groups（予選グループ）
| 列 | 型 | 制約 | 説明 |
|----|----|------|------|
| id | uuid | PK | |
| event_id | uuid | FK→events, NOT NULL | |
| name | text | NOT NULL | 例: "グループA" |

制約: UNIQUE(event_id, name)

### 3.13 group_teams（グループ↔チーム）
| 列 | 型 | 制約 |
|----|----|------|
| group_id | uuid | PK, FK→groups |
| team_id | uuid | PK, FK→teams |

### 3.14 matches（試合）
| 列 | 型 | 制約 | 説明 |
|----|----|------|------|
| id | uuid | PK | |
| event_id | uuid | FK→events, NOT NULL | |
| phase | match_phase | NOT NULL | group / tournament |
| best_of | int | NOT NULL DEFAULT 3 | この試合のBO（最大マップ数）。奇数=過半数先取で引分なし、偶数=引分あり。予選は生成時に events.group_best_of を一括セット。**決勝Tは引分を構造的に出さないため生成時に奇数へ補正（toOddBestOf・本戦-5b）**。スコア入力上限に連動。CHECK 1〜15。0018で追加 |
| group_id | uuid | FK→groups | 予選時のグループ |
| round | int | | トーナメントのラウンド（1=1回戦…最大ラウンド=決勝）。本戦-5aで使用 |
| bracket_position | int | | トーナメント表上の位置（同一ラウンド内の0始まり）。本戦-5aで使用 |
| team_a_id | uuid | FK→teams | 対戦カード |
| team_b_id | uuid | FK→teams | |
| scheduled_at | timestamptz | | 試合日時 |
| replay_code | text | | OWリプレイコード |
| stream_url | text | | Twitch/YouTube等の配信URL |
| streamer_name | text | | 配信者名 |
| notified_at | timestamptz | | スケジュール通知済みフラグ（Cron用） |
| created_at | timestamptz | DEFAULT now() | |

### 3.15 match_results（試合結果）
| 列 | 型 | 制約 | 説明 |
|----|----|------|------|
| match_id | uuid | PK, FK→matches | 1試合1結果 |
| team_a_score | int | NOT NULL | 取マップ数。アプリ層で BO 整合を**厳格検証**（奇数BO=過半数先取で即終了・引分なし／偶数BO=全マップ消化・合計=best_of・引分あり）。例 BO5→3-0/3-1/3-2、BO4→4-0/3-1/2-2 |
| team_b_score | int | NOT NULL | 取マップ数 |
| potg_a | int | NOT NULL DEFAULT 0 | team_a の POTG 取得数（0016/0017・タイブレーク用。CHECK 0〜99）。POTG使用イベントは「POTG合計＝総マップ数」をアプリ層で検証 |
| potg_b | int | NOT NULL DEFAULT 0 | team_b の POTG 取得数 |
| replay_codes | text[] | NOT NULL DEFAULT '{}' | マップ別リプレイコード（OW独自・1マップ1コード）。行われたマップ数（=両者スコア合計）分。任意入力（空可）。0021で追加・フェーズA |
| winner_team_id | uuid | FK→teams | 引分null可。スコアからサーバーが算出して固定 |
| reported_by | uuid | FK→users | 入力者（主催者 or 対戦両チーム代表） |
| created_at | timestamptz | DEFAULT now() | |
| updated_at | timestamptz | DEFAULT now() | |

### 3.15.1 match_lineups（試合ごとの出場メンバー・Phase2任意）
「試合ごとに出場者が変わる」運用への対応（3.1.2）。Phase1ではチーム編成時のレギュラー/リザーブ（team_members.position）で判定し、試合単位の交代記録が必要になったら本テーブルを使う。
| 列 | 型 | 制約 | 説明 |
|----|----|------|------|
| id | uuid | PK | |
| match_id | uuid | FK→matches, NOT NULL | |
| team_id | uuid | FK→teams, NOT NULL | |
| team_member_id | uuid | FK→team_members, NOT NULL | その試合で出場したメンバー |
| created_at | timestamptz | DEFAULT now() | |

制約: UNIQUE(match_id, team_member_id)
> その試合のチームスコアは、この出場メンバーの final_score 平均で算出（4.2の出場者をlineupに置き換え）。

### 3.16 standings（順位表）
試合結果から集計。**実装状況（本戦-3c）: standings テーブルは使わず、集計表示（Service `lib/services/standings.ts` の純粋関数）で算出**。
集計方針: ブロック単位・結果のある試合のみ。①勝点（カスタム points_win/draw/loss）→ ② events.tiebreakers の順で多段ソート（head_to_head=同着ミニリーグ勝点 / map_diff・potg=全試合合計）。全タイブレークで決まらなければ同順位。確定順位の保存が必要になったら本テーブルを使う。
| 列 | 型 | 制約 | 説明 |
|----|----|------|------|
| id | uuid | PK | |
| event_id | uuid | FK→events, NOT NULL | |
| group_id | uuid | FK→groups | 全体順位ならnull |
| team_id | uuid | FK→teams, NOT NULL | |
| wins | int | DEFAULT 0 | |
| losses | int | DEFAULT 0 | |
| draws | int | DEFAULT 0 | |
| points | int | DEFAULT 0 | 勝点 |
| rank | int | | 順位 |
| updated_at | timestamptz | DEFAULT now() | |

制約: UNIQUE(event_id, group_id, team_id)

### 3.16.1 scrims（スクリム＝練習試合・Phase3 #7）
本戦(matches)とは別概念。チーム単位の練習試合をカレンダー管理し、対象チームへ個人通知（要件 3.4.3）。
| 列 | 型 | 制約 | 説明 |
|----|----|------|------|
| id | uuid | PK | |
| team_id | uuid | FK→teams, NOT NULL | スクリムを行う自チーム |
| created_by | uuid | FK→users, NOT NULL | 登録者 |
| scheduled_at | timestamptz | NOT NULL | 練習試合の日時 |
| opponent_name | text | | 相手チーム名（外部チームは自由入力） |
| opponent_team_id | uuid | FK→teams | 相手が本アプリ内チームの場合 |
| memo | text | | メモ |
| stream_url | text | | 配信URL（任意） |
| created_at | timestamptz | DEFAULT now() | |
> 勝敗は順位に影響しない（standings とは無関係）。スクリム登録/変更時に対象チームのメンバーへ個人向け通知（アプリ内＋Discord DM）。

### 3.17 follows（フォロー）
| 列 | 型 | 制約 | 説明 |
|----|----|------|------|
| id | uuid | PK | |
| follower_id | uuid | FK→users, NOT NULL | フォローする人 |
| target_type | follow_target | NOT NULL | series / event / user |
| target_id | uuid | NOT NULL | 対象（event_series / events / users のid） |
| created_at | timestamptz | DEFAULT now() | |

制約: UNIQUE(follower_id, target_type, target_id)
> target_id はポリモーフィック参照（target_type で指す先が変わる）。RDBのFK制約は単一テーブルにしか張れないため、参照整合性はアプリ層で担保する。
> イベント応募者は当該 event を自動フォロー扱いにする想定（更新通知のため）。

### 3.18 notification_events（通知の発生源＝出来事）
「何が起きたか」を1出来事1行で記録。ここから宛先を集約・重複排除して notifications を生成（要件 3.6.1）。
| 列 | 型 | 制約 | 説明 |
|----|----|------|------|
| id | uuid | PK | |
| type | text | NOT NULL | series_new_event / event_published / match_soon / result_updated 等 |
| source_type | follow_target | NOT NULL | 出来事の主体種別（series/event/user） |
| source_id | uuid | NOT NULL | 主体のid |
| payload | jsonb | | 通知本文生成用の付随情報 |
| created_at | timestamptz | DEFAULT now() | |

### 3.19 notifications（各ユーザーへの実配信）
notification_events 1件から、フォロワーを集約・ユニーク化して各人1件生成。
| 列 | 型 | 制約 | 説明 |
|----|----|------|------|
| id | uuid | PK | |
| user_id | uuid | FK→users, NOT NULL | 宛先 |
| source_event_id | uuid | FK→notification_events, NOT NULL | 由来の出来事 |
| title | text | NOT NULL | |
| body | text | | |
| link_url | text | | 遷移先 |
| is_read | boolean | NOT NULL DEFAULT false | |
| created_at | timestamptz | DEFAULT now() | |

制約: **UNIQUE(user_id, source_event_id)** ← 同一出来事から同一ユーザーへの二重通知をDBで物理的に防ぐ（重複排除の最終防衛）。

### 3.20 notification_deliveries（外部配信の状況・3.5.2）
アプリ内通知(notifications)を Discord DM / Webhook に配信した結果を記録。二段構えの「外部配信」レイヤー。
| 列 | 型 | 制約 | 説明 |
|----|----|------|------|
| id | uuid | PK | |
| notification_id | uuid | FK→notifications | 個人向け配信の場合（DM）。全体告知(Webhook)は null 可 |
| channel | delivery_channel | NOT NULL | discord_dm / discord_webhook |
| status | delivery_status | NOT NULL DEFAULT 'pending' | pending/sent/failed/skipped(DM拒否等) |
| target_ref | text | | DM=Discord ID / Webhook=URL等 |
| error | text | | 失敗理由 |
| sent_at | timestamptz | | |
| created_at | timestamptz | DEFAULT now() | |
> アプリ内通知は必ず残る（notifications）。DMが skipped/failed でも記録に残り、取りこぼしを把握できる。実装はアプリ内通知の直後（要件 3.5.2）。

---

## 4. スコア算出ロジック（擬似）

### 4.1 個人スコア → 個人ファイナルスコア（応募時に算出・スナップショット）

> **⚠️ 2026-06-21 更新**: 本 4.1 の単純平均モデルは、壁打ちで OSL 実運用に基づき**新仕様**へ更新した。
> ランクは「事前登録」でなく**応募時入力**、未認定セルの**補完3方式（主催者選択）**、role_swap 分岐、
> ボーナスのオプション有効化を含む。**正は [スコアリング設計.md](./スコアリング設計.md)**。以下は旧モデル（参考）。

```
# ↓ 旧モデル（参考。現行の正は スコアリング設計.md）
function calcScores(registration, event):
    ranks = user_season_ranks(user, game)
            直近 event.declared_seasons シーズンを抽出
    if event.role_swap_allowed:
        base = avg( 抽出した全ロール×全シーズンのスコア )   # 最大9個 ＝ ①individual_score
    else:
        base = avg( assigned_role の 抽出シーズン分のスコア ) # ＝ ①individual_score
    peak = user_peak_achievement(user, game).peak_tier
    bonus = { master: event.bonus_master, gm: event.bonus_gm,
              champion: event.bonus_champion }[peak] or 0
    individual_score = base
    final_score      = base + bonus                          # ＝ ②個人ファイナルスコア
    return (individual_score, final_score)
# registrations に individual_score と final_score をスナップショット保存
# score_breakdown(jsonb) に参照値・ボーナス内訳を記録
```

**新仕様の要点（詳細は スコアリング設計.md）**:
- ランクは応募時入力（user_season_ranks に永続しない。declared_seasons × ロールの2次元グリッド）。
- 未認定セルの補完は主催者選択の3方式: `fill_by_role`（横軸）/ `fill_by_season`（縦軸）/ `exclude`（除外）。
- role_swap=false は担当ロール1つのスコアをそのまま使用（個人ファイナルスコア不要）。
- ボーナスはイベントのオプションで有効化したときのみ加算。

### 4.2 チームスコア（保存せず算出。出場メンバーのみ）
```
function teamScore(team):
    出場メンバー = team_members(team) で position='regular' の registration
    scores = [ reg.organizer_override_score ?? reg.final_score for 出場メンバー ]
    return avg(scores)              # ③チームスコア = 出場者の final_score 平均
# リザーブ(position='reserve')は平均に含めない（出場者のみで判定）
# team_score_cap との比較で上限超過を判定
```

### 4.3 交代シミュレーション（編成画面の中核機能・3.1.2）
「リザーブBを出すなら、レギュラーの誰と交代すれば team_score_cap 以内か」を全パターン提示。
**リザーブはロール無概念（確定）**なので、候補は同ロール限定ではなく**全レギュラー総当たり**で出す（3.1.2）。
実装は `lib/services/team-score.ts` の `swapCandidates`（regular 全員と総当たり）。
```
function swapCandidates(team, reserve, event):
    候補 = []
    for regular in team の position='regular':
        仮編成 = (現レギュラー - regular + reserve)
        平均 = avg(仮編成の final_score)
        候補.push({ out: regular, in: reserve, team_score: 平均,
                    ok: 平均 <= event.team_score_cap })
    return 候補   # ok=true の組合せを「交代可能」として提示
```
> OSL運営が手作業（誰と入れ替えれば上限内か総当たり）で消耗していた計算を自動化する。final_score が分かっていれば全パターン即時算出可能。

---

## 5. 排他制御（同時申込）方針
- 申込は単一トランザクションで条件付きUPDATE:
```sql
UPDATE events
SET current_count = current_count + 1, version = version + 1
WHERE id = :event_id
  AND version = :read_version
  AND (capacity IS NULL OR current_count < capacity);
-- 更新行数 0 → 「満員 or 競合」としてアプリ側で弾く
```
- 最終防衛として CHECK(current_count <= capacity) と registrations の UNIQUE(event_id,user_id)。

### 5.1 current_count（成立チーム数）の増減経路（A-3で整合）
`current_count` は **approved（成立）チーム数**を表す。増減する経路は以下のみ：
- **+1**: `createTeam`（主催者編成＝即 approved 成立）／`approveTeam`（self の pending→approved 承認）。
  ともに上記の version 条件付き UPDATE で排他し、満員なら弾く。
- **−1**: approved チームの `deleteTeam`（成立を取り消す）。承認/作成の後続処理が失敗した場合の補償でも −1。
- **触らない**: self の `submitSelfTeam`（pending 作成）／`rejectTeam`／`cancelSelfTeam`（pending の取り下げ）。
  pending は枠を食わず、承認時にカウントするため（先着順で承認・残りは却下）。
- ※ 以前は createTeam がカウント漏れで定員超過のチームを作れた（フィードバック③）。修正済み。

---

## 5.1 通知の生成（重複排除）方針
1出来事＝notification_events 1行。そこから宛先を集約・ユニーク化して notifications を生成（要件 3.6.1）。
```
on 出来事発生(type, source_type, source_id, payload):
    ev = insert notification_events(...)
    宛先 = ∪ {
        follows(target_type='series', target_id=該当シリーズ)  # シリーズ起点
        follows(target_type='user',   target_id=主催者)        # 主催者起点
        follows(target_type='event',  target_id=該当event)     # 開催回起点(更新時)
    } の follower_id を DISTINCT
    宛先から発生者本人を除外（自分の操作で自分に通知しない）
    for user in 宛先:
        insert notifications(user_id=user, source_event_id=ev.id, ...)
        # UNIQUE(user_id, source_event_id) により二重INSERTは弾かれる（冪等）
```
> アプリ層でDISTINCTしつつ、DBの UNIQUE で最終防衛。再実行しても二重通知にならない（冪等）。

---

## 6. RLS（Row Level Security）方針メモ
Supabase前提で各テーブルにRLSを設定する（詳細は実装時）。
- users: 本人のみ更新可、参照は公開情報のみ。
  - 実装状況: SELECT は「ログインユーザーは参照可」を 0009 で設定（応募者一覧の表示用）。UPDATE は「本人のみ（id = auth.uid()）」を 0025 で設定（マイページのバトルタグ登録/編集）。列レベルの制限（battle_tag のみ）はアプリ層（Repository updateBattleTag）で担保＝マスアサインメント対策の二層目。
- event_series / series_members: series_members(active) のみ更新可。owner のみ運営追加削除・シリーズ削除。参照は公開。
- events: 該当シリーズの運営（series_members active）または organizer のみ更新可、published は全員参照可。
  - 実装状況: SELECT は「公開済み（status≠draft）は全員 / 下書きは organizer 本人のみ」を 0005 で設定。INSERT/UPDATE/DELETE は organizer 本人を 0004 で設定（series 運営による更新は未実装・後続）。
- registrations: 本人＋該当イベントの運営が参照/更新。
  - 実装状況: 0006 で設定。SELECT=応募者本人 or イベント主催者（events への EXISTS サブクエリ）、INSERT=本人のみ（user_id=auth.uid()）、UPDATE=イベント主催者のみ（承認/却下）。DELETE は未定義（取り下げは後続）。本コードベース初の EXISTS サブクエリ RLS。
- teams / team_members: イベント主催者が参照/編集（チーム編成）。
  - 実装状況: 0010 で設定（チーム編成 PR-1）。teams は SELECT/INSERT/UPDATE/DELETE すべて「対象イベントの主催者のみ」（events への EXISTS）。team_members は teams を経由して events.organizer_id を確認する2段の EXISTS。PR-1 は organizer 振り分けのみで、SELECT も主催者限定（参加チーム一覧の一般公開は本戦機能で緩和）。self 応募（応募者がチームを作る）のポリシーは PR-3 で追加。
  - 0011（self応募 PR-3a）で SELECT を緩和: registrations / teams / team_members とも「本人/主催者＋**同イベントの参加者（応募者）**」が閲覧可。判定は `is_event_participant(event_id, uid)`（security definer 関数。RLS 内の自己参照による再帰評価を避けるため）。公開範囲は壁打ちで「算出根拠含め全公開・全イベント」と確定（OSL は Google フォーム提出物を全共有していた運用に倣う）。
  - 0012（self応募 PR-3b）で teams / team_members に **self 応募者向けの INSERT/DELETE** を追加（主催者の 0010 と並存）。許可条件は「`team_formation='self'` のイベントの approved 応募者が、自分を代表（captain）とする `status='pending'` チームを作り、approved な同イベント応募をメンバーに追加する」こと。判定は security definer 関数 `can_self_captain` / `is_approved_registration` / `is_own_pending_self_team` に切り出し（再帰評価回避）。承認後（approved）の改変・current_count の改竄は不可（events 列は self の書き込みで触らない）。承認時の current_count 排他は主催者の `events` UPDATE（0004）で行う。
- groups / group_teams: イベント主催者が編集（予選ブロック分け）、参加者は閲覧。
  - 実装状況: 0013 で設定（本戦フェーズ PR-1）。groups は SELECT=「主催者 or 同イベント参加者」、INSERT/UPDATE/DELETE=主催者のみ（events への EXISTS）。group_teams は groups を経由して events.organizer_id を確認する2段の EXISTS（SELECT は参加者にも開放、書き込みは主催者のみ）。閲覧開放の判定は 0011 の `is_event_participant` を再利用。振り分け対象は approved チームのみ（アプリ層で確認）。
- matches: イベント主催者が編集（対戦カード）、参加者は閲覧。
  - 実装状況: 0014 で設定（本戦フェーズ PR-2）。SELECT=「主催者 or 同イベント参加者」、INSERT/UPDATE/DELETE=主催者のみ（events への EXISTS）。閲覧開放の判定は 0011 の `is_event_participant` を再利用。phase に依らずイベント単位で許可（tournament も同じ所有権判定）。本戦-2 は phase='group' の総当たり生成・追加・削除のみ扱う。重複カードはアプリ層で防止（DB制約なし）。
- match_results: 参照は参加者まで公開、入力は主催者＋対戦両チーム代表。
  - 実装状況: 0015 で設定（本戦フェーズ PR-3a）。SELECT=「主催者 or 同イベント参加者」（matches 経由で event 判定）。INSERT/UPDATE/DELETE=「主催者 or 対戦両チームの代表（captain）」。代表判定は match_results→matches→teams→registrations の多段になるため security definer 関数 `can_report_match(match_id, uid)` に切り出し（再帰評価回避）。winner_team_id / reported_by はアプリ層がスコアと auth.uid() から固定（マスアサインメント対策）。
- 結果/順位: 参照は公開、更新は運営。
- follows / notifications: 本人のみ。
- is_admin は全権限のエスケープハッチ。

---

## 7. 未決事項
- [x] capacity の単位 → **チーム数**で確定（3.7）
- [ ] standings をビューにするかテーブル実体にするか（リアルタイム更新との兼ね合い）
- [ ] season_label の入力方法（自由入力 or マスタ化）
- [ ] notifications と Discord通知の送り分け詳細
- [x] トーナメント表の bracket 構造（round/bracket_position で足りる）→ **本戦-5aで確定**。シングルエリミは round（1始まり）＋bracket_position（ラウンド内0始まり）＋nullable team_a/b（未確定・BYE）で表現可。生成は Service `bracket.ts`（標準シード・BYE・2の累乗）。3位決定戦・敗者ブラケットは後続で round 体系を拡張する想定
- [x] capacity（チーム数）の排他制御 = **主催者の承認（self チームの pending→approved）時に current_count を +1**（PR-3b で確定・実装）。pending は枠を確保しない。却下・取り下げはカウント不変。individual応募の参加表明自体は定員カウント対象外（チーム成立時にカウント）。排他は events の version 条件付きUPDATE（5章）。organizer 振り分けチームのカウント連動は本戦運用で再検討（現状 organizer 作成チームは即approvedだが current_count は未連動）。
