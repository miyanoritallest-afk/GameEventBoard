import { createAdminClient } from "@/lib/supabase/admin";
import {
  runMatchReminders,
  runScrimReminders,
  runTodayMatchAnnounce,
} from "@/lib/notifications/cron-notify";

/**
 * ⑦ 定期通知の Cron エンドポイント（Route Handler）。
 * Vercel Cron（vercel.json の schedule）が数分間隔で GET する。実行内容:
 *   #7 試合開始2時間前リマインド（出場メンバーへアプリ内通知）
 *   #8 スクリム開始2時間前リマインド（チームメンバーへアプリ内通知）
 *   #9 「本日◯時から各試合」の全体告知（告知チャンネルへ Webhook・1日1回）
 *
 * 保護（必須）: Authorization: Bearer <CRON_SECRET> を検証する。CRON_SECRET は環境変数。
 * Vercel Cron はこのヘッダーを自動付与する。誰でも叩けると通知を乱発できるため、
 * 一致しなければ 401。SECRET 未設定なら 500（設定ミスを黙って通さない）。
 *
 * admin（service_role・RLS バイパス）で他人の試合・メンバーを跨いで集約する。処理は
 * ベストエフォート（各件の失敗は握ってログ）。Route Handler はデフォルト非キャッシュ。
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 },
    );
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date();

  // #7 / #8 / #9 は独立。1つが落ちても他は動かす（allSettled）。
  const [reminders, scrimReminders, announce] = await Promise.allSettled([
    runMatchReminders(admin, now),
    runScrimReminders(admin, now),
    runTodayMatchAnnounce(admin, now),
  ]);

  return Response.json({
    ranAt: now.toISOString(),
    matchReminders:
      reminders.status === "fulfilled"
        ? reminders.value
        : { error: String(reminders.reason) },
    scrimReminders:
      scrimReminders.status === "fulfilled"
        ? scrimReminders.value
        : { error: String(scrimReminders.reason) },
    todayAnnounce:
      announce.status === "fulfilled"
        ? announce.value
        : { error: String(announce.reason) },
  });
}
