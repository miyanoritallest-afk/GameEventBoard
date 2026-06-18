import Link from "next/link";
import { GROUP_A_STANDINGS, MATCHES, type ScheduledMatch } from "../data";

const STATUS_STYLE: Record<ScheduledMatch["status"], string> = {
  予定: "border-border bg-muted/30 text-muted-foreground",
  配信あり: "border-chart-1/50 bg-chart-1/15 text-chart-1",
  終了: "border-muted-foreground/30 bg-muted/30 text-muted-foreground",
};

export default function SchedulePrototype() {
  // 日付ごとにグルーピング（表示用）
  const byDate = MATCHES.reduce<Record<string, ScheduledMatch[]>>((acc, m) => {
    (acc[m.date] ??= []).push(m);
    return acc;
  }, {});

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <Link href="/prototype" className="text-sm text-muted-foreground hover:underline">
          ← プロトタイプ一覧
        </Link>

        <h1 className="mt-4 text-2xl font-bold">OSL Season3 — 試合スケジュール</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          予選グループ → 決勝トーナメント。配信予定・結果もここで確認。
        </p>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
          {/* スケジュール */}
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground">スケジュール</h2>
            <div className="mt-3 space-y-6">
              {Object.entries(byDate).map(([date, matches]) => (
                <div key={date}>
                  <div className="text-sm font-semibold text-primary/80">{date}</div>
                  <ul className="mt-2 space-y-2">
                    {matches.map((m) => (
                      <li
                        key={m.id}
                        className="rounded-xl border border-border bg-card p-3"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">
                            {m.time} ・ {m.phase}
                          </span>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLE[m.status]}`}
                          >
                            {m.status === "配信あり" && m.streamer
                              ? `🔴 ${m.streamer}`
                              : m.status}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center justify-center gap-3 text-sm">
                          <span className="flex-1 text-right font-medium">{m.teamA}</span>
                          {m.status === "終了" ? (
                            <span className="rounded-md bg-muted/60 px-2 py-0.5 font-bold tabular-nums">
                              {m.scoreA} - {m.scoreB}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">vs</span>
                          )}
                          <span className="flex-1 text-left font-medium">{m.teamB}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          {/* 順位表 */}
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground">
              順位表（グループA）
            </h2>
            <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium">#</th>
                    <th className="px-3 py-2 text-left font-medium">チーム</th>
                    <th className="px-2 py-2 text-center font-medium">勝</th>
                    <th className="px-2 py-2 text-center font-medium">負</th>
                    <th className="px-2 py-2 text-center font-medium">点</th>
                  </tr>
                </thead>
                <tbody>
                  {GROUP_A_STANDINGS.map((s) => (
                    <tr
                      key={s.rank}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                            s.rank <= 2
                              ? "bg-primary/20 text-primary"
                              : "bg-muted/50 text-muted-foreground"
                          }`}
                        >
                          {s.rank}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-medium">{s.team}</td>
                      <td className="px-2 py-2 text-center tabular-nums">{s.wins}</td>
                      <td className="px-2 py-2 text-center tabular-nums">{s.losses}</td>
                      <td className="px-2 py-2 text-center font-semibold tabular-nums">
                        {s.points}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              ※ 上位2チーム（青）が決勝トーナメント進出。結果入力で自動更新されるイメージ。
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
