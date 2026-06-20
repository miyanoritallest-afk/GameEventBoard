import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 使い捨ての UI 実験（prototype ルート）は静的解析の対象外。
    // 本番コードの品質ゲートに、ラフな試作のメモ化警告等を混ぜない。
    "src/app/prototype/**",
  ]),
]);

export default eslintConfig;
