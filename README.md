# GameEventBoard

ゲーマー（主にFPS / Overwatch 2）コミュニティ向けの **イベント管理＋予約プラットフォーム**。
設計ドキュメントは [`docs/`](./docs) を参照（要件定義書 / DB設計書 / ER図 / devlog）。

## 技術スタック
- **Next.js (App Router) + TypeScript**（フロント/API一体のフルスタック）
- **Tailwind CSS v4 + shadcn/ui**
- **Supabase (PostgreSQL / Auth(Discord OAuth) / Realtime)**
- **Vercel**（ホスティング）

> AWS経験者向けメモ: 本構成は Docker 不要。Vercel が git push でビルド&デプロイを肩代わりし、
> Supabase が DB をマネージドで提供する。ローカルでも `npm run dev` がクラウド Supabase に直接つなぐ。
> （ローカルDBを分離したくなったら Supabase CLI 経由で任意に Docker を導入できる。）

## セットアップ

### 1. 依存インストール
```bash
npm install
```

### 2. Supabase プロジェクトを用意
1. https://supabase.com でプロジェクトを作成（無料枠でよい）。
2. ダッシュボード > Project Settings > API から URL・anon キー・service_role キーを取得。
3. SQL Editor で [`supabase/migrations/`](./supabase/migrations) 配下の `.sql` を **`0001` から番号順にすべて実行**する（スキーマ・RLS ポリシー・security definer 関数・Realtime 有効化まで含む。番号は依存順なので順序を守る）。
4. Authentication > Providers で **Discord** を有効化（OAuth クライアントIDとシークレットを設定）。リダイレクト URL に `<APP_URL>/auth/callback` を登録する。

### 3. 環境変数
`.env.local.example` を `.env.local` にコピーして値を埋める。
```bash
cp .env.local.example .env.local
```

### 4. 開発サーバー
```bash
npm run dev
```
http://localhost:3000 を開く。

## ディレクトリ構成（抜粋）
```
docs/                         設計ドキュメント（要件定義/DB設計/ER図/devlog）
src/app/                      Next.js App Router
src/components/ui/            shadcn/ui コンポーネント
src/lib/supabase/client.ts    ブラウザ用 Supabase クライアント
src/lib/supabase/server.ts    サーバー用 Supabase クライアント
src/lib/utils.ts              ユーティリティ（cn 等）
supabase/migrations/          DB マイグレーション SQL
```

## デプロイ（Vercel）
Vercel にリポジトリを接続し、環境変数（`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`）を設定すれば自動デプロイされる。
