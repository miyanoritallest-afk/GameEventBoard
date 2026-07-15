"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * 観戦ビューの Realtime 購読（クライアント）。観戦ビュー（サーバー描画）に1つ置く。
 * 対象イベントの試合の変更を検知したら router.refresh() でサーバーを再取得し、
 * 「次の試合」「予選順位」「試合結果」「決勝トーナメント」をライブ更新する
 * （表示は常に DB 真値＝差分の手組みはしない。通知の Realtime と同じ流儀）。
 *
 * 購読する変更（0036 で publication 追加）:
 *  - matches: scheduled_at / stream_url 等の変更（「次の試合」の日時・配信に追従）。event_id で絞る。
 *  - match_results: 結果の確定/修正/取消（順位・結果に追従）。match_results には event_id が
 *    無く postgres_changes の filter は単一カラム等値のみのため、フィルタなしで購読し、
 *    このイベントの match_id 集合に含まれる変更だけで refresh する（無駄 refresh の間引き）。
 *
 * 認証: Realtime の postgres_changes は RLS を尊重する。matches/match_results の SELECT は
 * 0023 で公開イベントを anon にも開放済みなので、匿名観戦者にも公開イベントの変更が届く。
 * RLS 配下テーブルの購読には購読者トークンを Realtime へ渡す必要があるため、subscribe 前に
 * setAuth する（ログイン時はそのセッション、匿名時は anon キーの JWT）。[[realtime-rls-setauth]]
 */
export function WatchRealtime({
  eventId,
  matchIds,
}: {
  eventId: string;
  matchIds: string[];
}) {
  const router = useRouter();
  // 依存配列を安定させるため、match_id 集合は文字列キーにして比較する
  // （配列参照は毎レンダー変わるが、中身が同じなら再購読しない）。
  const matchIdsKey = matchIds.join(",");

  useEffect(() => {
    const supabase = createClient();
    const idSet = new Set(matchIdsKey ? matchIdsKey.split(",") : []);
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let disposed = false;

    (async () => {
      // 購読者トークンを Realtime に渡す（RLS 配下テーブルの配信に必須）。
      // ログイン時はそのセッション、匿名時は anon キー（環境変数）を渡す。
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token =
        session?.access_token ??
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
        undefined;
      if (token) await supabase.realtime.setAuth(token);
      if (disposed) return;

      channel = supabase
        .channel(`watch:${eventId}`)
        // 試合日時・配信の変更（「次の試合」用）。event_id でこのイベントに絞る。
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "matches",
            filter: `event_id=eq.${eventId}`,
          },
          () => router.refresh(),
        )
        // 結果の確定/修正/取消（順位・結果用）。event_id で絞れないので受信後に間引く。
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "match_results" },
          (payload) => {
            const row = (payload.new ?? payload.old) as {
              match_id?: string;
            } | null;
            // このイベントの試合の結果だけで再取得（他イベントの結果は無視）。
            if (row?.match_id && idSet.has(row.match_id)) router.refresh();
          },
        )
        .subscribe();
    })();

    return () => {
      disposed = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [eventId, matchIdsKey, router]);

  return null;
}
