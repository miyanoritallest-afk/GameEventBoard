/**
 * イベント slug の生成ロジック（Service 層・純粋関数）。
 *
 * 方針（設計判断）:
 * - タイトル非依存の ID ベース slug（例 "event-a1b2c3"）。
 *   日本語タイトル・重複・タイトル変更時のリンク切れを構造的に回避するため。
 * - 衝突時のリトライは呼び出し側（Action）が担当。本ファイルは「1つ作る」ことに専念。
 *
 * 文字種は数字と小文字英字から、紛らわしい文字（0/o/1/l/i）を除いた 31 種。
 * URL でそのまま使え、読み上げ・手入力時の取り違えも減らす。
 */

const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"; // 0,1,o,l,i を除外
const RANDOM_LENGTH = 6;

/** テスト用に乱数源を差し替えられるようにする（既定は Math.random）。 */
export type RandomFn = () => number;

/** ランダムな英数字部分（既定6桁）を作る。 */
export function generateSlugSuffix(
  length: number = RANDOM_LENGTH,
  random: RandomFn = Math.random,
): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[Math.floor(random() * ALPHABET.length)];
  }
  return out;
}

/** イベント slug を1つ生成する（"event-" + ランダム英数字）。 */
export function generateEventSlug(random: RandomFn = Math.random): string {
  return `event-${generateSlugSuffix(RANDOM_LENGTH, random)}`;
}

/** slug が想定形式かを判定する（バリデーション・テスト補助用）。 */
export function isValidEventSlug(slug: string): boolean {
  return new RegExp(`^event-[${ALPHABET}]{${RANDOM_LENGTH}}$`).test(slug);
}
