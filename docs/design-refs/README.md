# design-refs — Claude Design 案の参照置き場

デザイン刷新フェーズで Claude Design が出した各画面の **案HTML（正）** を、実装が参照できる形で保管する。

## なぜ置くか

Claude Design 案がリポジトリに無いと、実装が案から乖離しても突き合わせる基準がない
（実際にチーム編成画面でロール色の彩度・希望順の数字・D&Dアニメが案から抜け落ちた）。
案HTMLを残すことで、Claude Code が「正」を直接参照でき、乖離を構造的に減らせる。

## 形式について

Claude Design のエクスポートは standalone 形式（画像を data URI で埋め込むため 7MB 超）になる。
リポジトリを太らせないため、**画像 data URI を除いた軽量版（CSS/JSX が読める形）** に変換して置く。

- `team-formation-organizer.html` — チーム編成ページ（主催者）。案の CSS 変数・ロール色・
  希望ロールの rank バッジ・`.drag-ghost`（持ち上げゴースト）・`.drop-target`（発光）が入っている。

## 変換手順（standalone → 軽量版）

standalone HTML の `<script type="__bundler/template">` 行に、JSON エスケープされた実HTML
（React CDN + JSX + `<style>`）が入っている。これを JSON パースして書き出せば読める軽量版になる。
`__bundler/manifest`（画像 data URI）は捨ててよい。
