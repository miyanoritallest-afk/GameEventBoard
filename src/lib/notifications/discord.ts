/**
 * Discord Webhook 投稿（④ 全体告知）のアプリケーションサービス。
 * 副作用（fetch）を持つため Service（純粋関数）ではなくこの層に置く（notify.ts と同層）。
 *
 * Webhook URL は「その告知チャンネルへ投稿する権限を持つトークン」を含む。サーバー側でのみ
 * 扱い、クライアントには出さない（Server Action / この層から POST する）。URL の形式検証は
 * 主催者入力時に schema（optionalDiscordWebhookUrl）で Discord ホストに限定済み。
 *
 * ベストエフォート前提: 投稿の成否は結果オブジェクトで返し、例外は投げない
 * （呼び出し側の業務＝イベント公開を配信失敗で巻き添えにしない）。
 */

/** 投稿結果。ok=true なら送信成功、false なら理由付きで失敗。 */
export type WebhookPostResult =
  | { ok: true }
  | { ok: false; error: string };

/** POST のタイムアウト（ms）。公開処理の裏で走るのでほどほどに短く。 */
const WEBHOOK_TIMEOUT_MS = 5000;

/**
 * Discord Webhook にメッセージ（content 文字列）を POST する。
 * - 2xx を成功とみなす（Discord は 204 No Content を返す）。
 * - 非2xx・ネットワークエラー・タイムアウトは失敗（error に短い理由）。
 * - allowed_mentions を none にして @everyone 等の意図しないメンションを無効化する。
 */
export async function postToDiscordWebhook(
  webhookUrl: string,
  content: string,
): Promise<WebhookPostResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content,
        // 誤爆防止: 本文に @everyone 等が混じってもメンションを飛ばさない。
        allowed_mentions: { parse: [] },
      }),
      signal: controller.signal,
    });
    if (res.ok) return { ok: true };
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (e) {
    const reason =
      e instanceof Error && e.name === "AbortError"
        ? "timeout"
        : e instanceof Error
          ? e.message
          : "unknown error";
    return { ok: false, error: reason };
  } finally {
    clearTimeout(timer);
  }
}
