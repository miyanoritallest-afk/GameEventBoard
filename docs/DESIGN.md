# DESIGN.md — Matchpoint デザインシステム

> Claude Design 用のデザインシステム正典。GitHub 連携時に自動で読み込まれる。
> ルール: 現状の主張は `file:line` を引用。色は hex 表記。**未確定/推測トークンは「TBD」「(推測)」と明示**。
> 状態: 刷新フェーズ初期。**色・タイポ体系はこれから確立する**（イベント詳細ページで先行確立→他画面へ展開）。
> 詳しい背景は [デザイン現状メモ](./デザイン現状メモ.md)。

---

## 1. Visual Theme & Atmosphere

- **プロダクト**: Matchpoint — Overwatch コミュニティ向けの大会運営ツール（イベント募集・チーム編成・対戦表・順位・通知）。日本語 UI。
- **目指す atmosphere**: ダーク基調・クール・e スポーツ調。FPS コミュニティに刺さる「本気の大会運営」感。ただし**可読性・情報密度を最優先**（装飾過多にしない）。
- **現状のギャップ**: 見た目が「AI 生成っぽい」没個性。原因は無彩色パレット＋ダーク未実装（下記 2）。
- **Do**: 落ち着いたダーク面に、要所だけアクセント色で「進行・状態」を伝える。**Don't**: ネオン過多・グラデ乱用・可読性を犠牲にした装飾。

## 2. Color Palette & Roles

**⚠️ 現状 = 全て無彩色（これが刷新対象）。具体の hex は Claude Design に提案を求める（TBD）。**

- **現状（`src/app/globals.css:51-118`）**: light/dark とも `oklch(L 0 0)`（彩度 0 ＝グレースケール）。shadcn デフォルトのまま。ブランド色・アクセント色なし。`--chart-1..5` も無彩色。
- **ダーク定義はあるが未適用（`src/app/layout.tsx:28-31`）**: `.dark` の色は定義済みだが `<html>` に `.dark` クラスが無く**実質ライトモード**。ヘッダーのみ `className="dark"`（`src/components/site-header.tsx:24`）で局所ダーク＝不整合。

**目標の役割設計（hex は TBD・Claude Design が提案）:**
- `background` / `surface` / `surface-raised`: ダークの階層（例: 深い背景→カード→浮いたカード）。TBD
- `accent`（ブランド）: OW らしい主役色。TBD（例として OW オレンジ系が候補だが未確定）。
- `foreground` / `muted-foreground`: 本文/補助テキストのコントラスト。TBD
- **状態色**（運営で意味を持つ）: `success`(参加確定/承認) / `warning`(締切間近) / `live`(進行中/本日) / `destructive`(却下/削除)。**色だけに依存せずラベル/絵文字併用**（既存方針）。TBD
- `chart-1..5`（順位表・対戦表の識別）: 判別しやすい系列色。TBD

## 3. Typography Rules

- **フォント（`src/app/layout.tsx:6-14`）**: 本文 = **Geist**、等幅 = **Geist Mono**（`next/font/google`）。
- **見出しフォント未分化（`src/app/globals.css:12`）**: `--font-heading` が `--font-sans`（Geist）と同一。見出し専用フォント/ウェイトの体系なし。
- **現状**: 見出しは各画面で `text-lg font-bold tracking-tight` 等を手書き（例: `site-header.tsx:27`）。タイポスケール未整備。
- **目標（TBD）**: 見出し h1/h2/h3 のスケールとウェイト、本文/キャプション、数値表示（スコア・順位は等幅で桁揃え）を体系化。日本語グリフの行間に配慮。

## 4. Component Stylings

**shadcn 導入済みは 4 つのみ**（`src/components/ui/`: `button` / `calendar` / `popover` / `alert-dialog`）。他は生 Tailwind 手書きで画面ごとに不揃い。以下は最低限決めたい対象。

- **Button**: primary（応募・公開などの主行動）/ secondary / ghost。現状 `bg-primary text-primary-foreground`（`site-header.tsx:74`）＝無彩色で弱い。角丸 `rounded-lg` を使用中。
- **Card**: イベント一覧・日程カード。種別を絵文字で表現（🔴公式戦 / 🔵スクリム / 🟢練習）。エレベーション/境界の体系 TBD。
- **Badge（状態ラベル）**: 「公開中」「参加確定」「承認済み」等。現状は生 span。状態色（§2）と対応づける。
- **Input/Form**: イベント作成フォームは密度が高い（日時ピッカー・スコアリング・本戦設定）。自作 `datetime-picker`（JST 入力）あり。
- **Nav（ヘッダー）**: `site-header.tsx`。ロゴ + ナビ + 🔔通知（未読赤バッジ）+ ユーザー名 + ログアウト。

## 5. Layout Principles

- **コンテナ幅**: `max-w-6xl mx-auto px-6`（`site-header.tsx:25`）が基準幅。ページ本文も概ねこの幅。
- **余白**: 間隔トークン無し。各画面で `gap-4` 等を都度指定。→ 4/8px 系のリズムを体系化したい（TBD）。
- **情報密度**: チーム編成・対戦表は密度最大。装飾より一覧性・整列を優先。

## 6. Depth & Elevation

- **角丸（`src/app/globals.css:42-48, 75`）**: `--radius: 0.625rem` を基準に `--radius-sm..4xl` を派生（この体系は良い・流用）。
- **エレベーション**: 影/境界の段階設計は未整備（現状ほぼフラット・境界線頼り）。ダーク基調では**面の明度差**で階層を作るのが定石（TBD で設計）。

## 7. Do's and Don'ts

- **Do**: ダーク面 + 要所アクセントで状態・進行を伝える／状態は色 + ラベル/絵文字の二重表現／密度の高い画面は整列と余白で可読性を担保／既存の `--radius` 体系を活かす。
- **Don't**: 無彩色のまま放置（AI っぽさの主因）／ネオン過多・グラデ乱用／色だけで状態を区別（アクセシビリティ）／shadcn デフォルトの見た目に依存。

## 8. Responsive Behavior

- **現状**: `max-w-6xl` + flex/grid のデスクトップ主体。モバイル最適化の体系は未整備（TBD）。
- **目標**: 密度の高いテーブル/編成画面のモバイル挙動（横スクロール or 段組み変換）を定義。ヘッダーナビの折り畳み。

## 9. Agent Prompt Guide

Claude Design への依頼時の前提:
- **技術**: Next.js 16 (App Router) + TypeScript + Tailwind v4（`@theme inline`/oklch 変数）+ shadcn/ui。
- **実装は別途 Claude Code が本プロジェクトの作法で行う**。Design の生成物はプロトタイプ＝そのままコピペしない前提。
- **最初の対象 = イベント詳細ページ**（状態バッジ・日時メタ・応募/フォローボタン・本戦導線が揃う「アプリの顔」）。ここで §2-6 の体系を確立し、一覧・チーム編成・対戦表へ展開。
- **守ること**: 日本語主体（グリフ/行間）・情報密度と可読性の優先・状態は色 + ラベルの二重表現。
- **求めるアウトプット**: ブランド/アクセント/状態色の hex 提案 + タイポスケール + 余白リズム + カード/ボタン/バッジの具体スタイル。
