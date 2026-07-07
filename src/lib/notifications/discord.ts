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

/**
 * Discord Bot API のベース。DM 送信は「常駐 Bot（ゲートウェイ接続）」ではなく
 * REST を都度叩く方式で行う（受信・コマンド応答は今回スコープ外なので常駐は不要）。
 * 送信には Bot トークンが要るが、常駐は要らない、という切り分け。
 */
const DISCORD_API_BASE = "https://discord.com/api/v10";

/** DM POST のタイムアウト（ms）。Cron の裏で走るのでほどほどに短く（Webhook と同値）。 */
const DM_TIMEOUT_MS = 5000;

/** DM 送信結果。skipped は「送る条件を満たさず送らなかった」（トークン未設定・opt-out 等）。 */
export type DmSendResult =
  | { ok: true }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped?: false; error: string };

/**
 * Discord のユーザー（discord_id = snowflake）へ Bot として DM を送る。
 * 2段階: (1) POST /users/@me/channels で相手との DM チャンネルを開く（既存なら再利用され
 * る）→ (2) POST /channels/{id}/messages で本文を送る。
 *
 * ベストエフォート前提: 例外は投げず結果オブジェクトで返す。呼び出し側（Cron）の業務＝
 * アプリ内通知の生成を DM 失敗で巻き添えにしない。DM が届かなくてもアプリ内通知は残る。
 *
 * 送信の前提: Bot と相手が同じ Discord サーバーに居ること。未所属・相手の DM 拒否設定などは
 * Discord が非2xx（typ. 403）を返すので failed として記録する（握って続行）。
 * botToken が空なら送信条件未達＝skipped（トークン未設定でもビルド・他処理は通す方針）。
 *
 * allowed_mentions は none 固定（本文にメンション文字列が混じっても飛ばさない・Webhook と同様）。
 */
export async function sendDiscordDM(
  botToken: string | undefined,
  discordId: string,
  content: string,
): Promise<DmSendResult> {
  if (!botToken) {
    return { ok: false, skipped: true, reason: "bot token 未設定" };
  }

  const authHeaders = {
    authorization: `Bot ${botToken}`,
    "content-type": "application/json",
  };
  // 各 fetch に個別のタイムアウトを与える（2段を1つのタイマーで縛ると、開くのが遅いと
  // 送信の猶予が食われ、開けたのに送信だけ timeout になる。段ごとに DM_TIMEOUT_MS を確保）。
  try {
    // (1) DM チャンネルを開く（相手 = recipient_id）。
    const openRes = await fetchWithTimeout(`${DISCORD_API_BASE}/users/@me/channels`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ recipient_id: discordId }),
    });
    if (!openRes.ok) {
      return { ok: false, error: `open DM: HTTP ${openRes.status}` };
    }
    const channel = (await openRes.json()) as { id?: string };
    if (!channel.id) {
      return { ok: false, error: "open DM: no channel id" };
    }

    // (2) 本文を送る。
    const sendRes = await fetchWithTimeout(
      `${DISCORD_API_BASE}/channels/${channel.id}/messages`,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          content,
          allowed_mentions: { parse: [] },
        }),
      },
    );
    if (sendRes.ok) return { ok: true };
    return { ok: false, error: `send DM: HTTP ${sendRes.status}` };
  } catch (e) {
    const reason =
      e instanceof Error && e.name === "AbortError"
        ? "timeout"
        : e instanceof Error
          ? e.message
          : "unknown error";
    return { ok: false, error: reason };
  }
}

/** DM_TIMEOUT_MS で abort する fetch。各リクエストごとに個別のタイマーを持たせる。 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DM_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
