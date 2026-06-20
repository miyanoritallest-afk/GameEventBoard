@AGENTS.md

# GameEventBoard — Claude Code Instructions

## Git ルール

- **main ブランチへの直接プッシュ禁止**
- 作業は必ず **feature ブランチ**を切って、**PR を通してマージ**すること
- ブランチ命名: `feature/xxx`（例: `feature/auth-discord-login`）
- **1機能 / 1フェーズ = 1PR** で進める（レビューしやすい単位に分ける）
- **コミットメッセージ・PR・devlog は日本語**で統一する

## 実装ルール（必ず守る）

実装の詳細な規律は [docs/実装ガイドライン.md](docs/実装ガイドライン.md) を**正**とする。コードを書く前に必ず参照すること。要点：

- **セキュリティ（全機能で必須）**
  - SQLi: Supabase クエリビルダのみ使用。生SQL文字列の組み立て禁止
  - IDOR: アプリ層チェック ＋ DB層 RLS で最終防衛（RLS本体は 0002 マイグレーション）
  - XSS: React 自動エスケープに任せる。`dangerouslySetInnerHTML` は原則禁止
  - 認証バイパス: 操作系の Server Action は冒頭で必ずログイン確認
  - マスアサインメント: Zod で許可カラムのみ受理。`organizer_id`/`status` 等はサーバー側で固定（入力から取らない）
  - 秘密鍵（Service Role 等）をクライアントに出さない
- **入力検証**: guard 層は作らない。Zod スキーマで検証（`app/<機能>/schema.ts`）。想定内の失敗は戻り値で返し、想定外の例外は `error.tsx` に委ねる
- **認可**: 閲覧系は公開・操作系は保護。保護ページは A(リダイレクト)＋B(Server Action で弾く) の2段
- **層構造**: Controller(薄い) → Service(純粋ロジック) → Repository(Supabase)。複雑ロジックは Service に切り出す
- **日時**: JST入力 → UTC保存(`timestamptz`) → JST表示
- **データ検証ライブラリ**: Zod を使用

## ドキュメント

- 設計ドキュメントは `docs/` に集約（要件定義書 / DB設計書 / ER図 / 実装ガイドライン / devlog）
- **実装で変更が生じたら関連 doc を必ず更新する**（スキーマ変更→DB設計書/ER図、設計判断→アーキテクチャ設計書/実装ガイドライン）。「実装 ＋ devlog ＋ 関連 doc 更新」を1セットで扱う
- 区切りのよい作業のたびに `docs/devlog.md` の先頭へ日付付きエントリを追記する
  （やったこと / 決めたこと（なぜ） / 次にやること）

## 技術スタック

- Next.js (App Router) + TypeScript / Tailwind v4 + shadcn/ui / Supabase / Vercel
- **Next.js 16系は破壊的変更あり**。コードを書く前に `node_modules/next/dist/docs/` の該当ガイドを確認する（AGENTS.md 参照）。
