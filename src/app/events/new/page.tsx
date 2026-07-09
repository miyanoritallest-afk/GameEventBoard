import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listGames } from "@/lib/repositories/games";
import { findDiscordName } from "@/lib/repositories/users";
import {
  findSeriesById,
  findLatestEventSettingsForSeries,
} from "@/lib/repositories/series";
import { EventForm, type EventFormDefaults } from "../event-form";
import { createEvent } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewEventPage({
  searchParams,
}: {
  searchParams: Promise<{ series?: string }>;
}) {
  // A: 未ログインなら /login へ誘導（?redirect で元ページに戻す）。
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?redirect=${encodeURIComponent("/events/new")}`);
  }

  const { series: seriesParam } = await searchParams;

  const [games, discordName] = await Promise.all([
    listGames(),
    findDiscordName(user.id),
  ]);

  // シリーズの新しい開催回として作る場合、そのシリーズの最新イベント設定をプリフィルする
  // （Season2 は Season1 と同じルール、という実運用。編集可＝確定ではない）。
  // 存在しない series はプリフィルなし（seriesId も渡さない）。
  let seriesId: string | undefined;
  let defaults: EventFormDefaults = {};
  if (seriesParam) {
    const series = await findSeriesById(seriesParam);
    if (series) {
      seriesId = series.id;
      const s = await findLatestEventSettingsForSeries(series.id);
      if (s) {
        defaults = {
          gameId: s.game_id,
          requireScore: s.require_score,
          roleSwapAllowed: s.role_swap_allowed,
          declaredSeasons: s.declared_seasons,
          uncertifiedHandling: s.uncertified_handling,
          bonusMaster: s.bonus_master,
          bonusGm: s.bonus_gm,
          bonusChampion: s.bonus_champion,
          teamScoreCap: s.team_score_cap ?? undefined,
          format: s.format,
          groupBestOf: s.group_best_of ?? undefined,
          tournamentThirdPlace: s.tournament_third_place,
          rankingEnabled: s.ranking_enabled,
        };
      }
    }
  }

  return (
    <div className="theme-matchpoint min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[720px] px-6 py-10">
        {/* パンくず */}
        <nav className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <Link href="/events" className="hover:text-foreground">
            イベント一覧
          </Link>
          <span className="text-[color:var(--mp-fg-subtle)]">/</span>
          <Link href="/events/mine" className="hover:text-foreground">
            自分のイベント
          </Link>
          <span className="text-[color:var(--mp-fg-subtle)]">/</span>
          <span className="text-foreground">新規作成</span>
        </nav>

        {/* ヒーロー */}
        <p className="mt-6 flex items-center gap-[9px] font-mono text-[11px] uppercase tracking-[0.2em] text-[color:var(--mp-accent)] before:h-0.5 before:w-[22px] before:bg-[color:var(--mp-accent)] before:content-['']">
          主催者ツール
        </p>
        <h1 className="mt-2.5 text-3xl font-extrabold tracking-tight text-foreground">
          イベントを作成
        </h1>
        <p className="mt-3 max-w-[600px] text-sm text-muted-foreground">
          {seriesId ? (
            "シリーズの新しい開催回を作成します。前回の設定を引き継いでいます（編集できます）。公開は保存後に行えます。"
          ) : (
            <>
              <span className="font-semibold text-[color:var(--mp-warning)]">
                下書き
              </span>
              として保存されます。応募者のスコア申告ルールや順位付けの方式も、ここでまとめて設定します。公開は保存後に行えます。
            </>
          )}
        </p>

        <EventForm
          games={games}
          action={createEvent}
          defaultValues={defaults}
          discordName={discordName ?? ""}
          seriesId={seriesId}
          submitLabel="この内容で作成する（下書き）"
          pendingLabel="作成中..."
        />
      </div>
    </div>
  );
}
