/**
 * datetime-local 互換の文字列（"YYYY-MM-DDTHH:mm"）と、日付・時刻パーツの相互変換。
 *
 * 重要: フォームに送る値の形式は従来の <input type="datetime-local"> と完全に同じ
 * （"2026-08-01T20:00"）。これにより Server Action 側の jstLocalToUtcIso と
 * Zod スキーマを一切変更せずに済む（カスタムピッカーは「入力UI」だけを差し替える）。
 *
 * ここで扱う Date は「画面に表示しているローカル（=JST 想定）の年月日時分」を
 * そのまま持つ素の Date として扱う（タイムゾーン変換はしない。UTC 変換は Server Action の責務）。
 */

/** 2桁ゼロ埋め。 */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Date を "YYYY-MM-DDTHH:mm" に整形する。 */
export function dateToLocalInput(date: Date): string {
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    `T${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  );
}

/**
 * "YYYY-MM-DDTHH:mm"（秒付きも許容）を Date に戻す。空・不正なら null。
 * new Date(string) のタイムゾーン解釈ブレを避けるため、数値を取り出して構築する。
 */
export function localInputToDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const date = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 表示用に "YYYY/MM/DD HH:mm"（JST 想定のローカル値そのまま）へ整形する。 */
export function formatLocalInputForDisplay(
  value: string | null | undefined,
): string {
  const date = localInputToDate(value);
  if (!date) return "";
  return (
    `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  );
}

/** 15分刻みの分の選択肢（"00","15","30","45"）。 */
export const MINUTE_STEPS = ["00", "15", "30", "45"] as const;

/** 0-23 の時の選択肢（"00"〜"23"）。 */
export const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => pad2(i));
