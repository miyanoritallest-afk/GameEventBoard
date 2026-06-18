import Link from "next/link";

export default function PrototypeIndex() {
  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-sm font-medium tracking-widest text-primary/80">
          GAMEEVENTBOARD
        </p>
        <h1 className="mt-2 text-3xl font-bold">プロトタイプ（イメージ確認用）</h1>
        <p className="mt-3 text-muted-foreground">
          認証・DBには繋がっていません。ダミーデータで画面の見た目と流れだけを確認できます。
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <Link
            href="/prototype/teams"
            className="group rounded-xl border border-border bg-card p-6 transition hover:border-primary/60 hover:bg-accent/40"
          >
            <div className="text-xs font-medium text-primary/80">CORE</div>
            <h2 className="mt-1 text-lg font-semibold">チーム編成・交代シミュレーション</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              レギュラー/リザーブ、チーム平均スコア、「誰と交代すれば上限内か」を体験できます。
            </p>
            <span className="mt-4 inline-block text-sm text-primary group-hover:underline">
              開く →
            </span>
          </Link>

          <Link
            href="/prototype/apply"
            className="group rounded-xl border border-border bg-card p-6 transition hover:border-primary/60 hover:bg-accent/40"
          >
            <div className="text-xs font-medium text-primary/80">FORM</div>
            <h2 className="mt-1 text-lg font-semibold">応募フォーム（ランク申告）</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              シーズン×ロールのランク入力と高ランク到達ボーナスから、個人スコアが算出される流れ。
            </p>
            <span className="mt-4 inline-block text-sm text-primary group-hover:underline">
              開く →
            </span>
          </Link>
        </div>

        <p className="mt-10 text-xs text-muted-foreground">
          ※ これは設計イメージの答え合わせ用です。数値・挙動は簡易実装です。
        </p>
      </div>
    </div>
  );
}
