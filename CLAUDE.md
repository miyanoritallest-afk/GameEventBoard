@AGENTS.md

# GameEventBoard — Claude Code Instructions

## Git ルール

- **main ブランチへの直接プッシュ禁止**
- 作業は必ず **feature ブランチ**を切って、**PR を通してマージ**すること
- ブランチ命名: `feature/xxx`（例: `feature/auth-discord-login`）
- **1機能 / 1フェーズ = 1PR** で進める（レビューしやすい単位に分ける）
- **コミットメッセージ・PR・devlog は日本語**で統一する

## ドキュメント

- 設計ドキュメントは `docs/` に集約（要件定義書 / DB設計書 / ER図 / devlog）
- 区切りのよい作業のたびに `docs/devlog.md` の先頭へ日付付きエントリを追記する
  （やったこと / 決めたこと（なぜ） / 次にやること）

## 技術スタック

- Next.js (App Router) + TypeScript / Tailwind v4 + shadcn/ui / Supabase / Vercel
- **Next.js 16系は破壊的変更あり**。コードを書く前に `node_modules/next/dist/docs/` の該当ガイドを確認する（AGENTS.md 参照）。
