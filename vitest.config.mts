import { defineConfig } from "vitest/config";

/**
 * Vitest 設定。
 * - resolve.tsconfigPaths: tsconfig.json の paths（@/* → src/*）をネイティブ解決する
 *   （Vitest 4 以降の推奨。vite-tsconfig-paths プラグインは不要）。
 * - environment "node": 本リポのテスト対象は純粋ロジック（Zod スキーマ・日時変換）と
 *   Supabase をモックした Server Action。React コンポーネントは描画しないため jsdom は不要。
 *   （公式ガイド: Vitest は async Server Component を未サポート。描画系は E2E に委ねる方針。）
 * - include: テストは対象コードと同階層の __tests__ に置く（コロケーション）。
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
