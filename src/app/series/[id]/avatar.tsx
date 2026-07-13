// 頭文字アバター（server/client 両対応の純粋コンポーネント）。
// discord_avatar_url は使わず、名前の頭文字＋名前から決定的に選ぶグラデーションで描く
// （外部画像に依存しない・プライバシー安全）。シリーズ詳細のメンバー行・オーナー表示で使う。

/** 名前の先頭2文字（# 以降は落とす）を大文字で。 */
function initials(name: string): string {
  return name.replace(/#.*$/, "").slice(0, 2).toUpperCase() || "?";
}

/** 名前から決定的に選ぶ背景グラデーション（識別しやすくするだけ・意味は無い）。 */
const GRADIENTS = [
  "linear-gradient(135deg,#FF6A2B,#B23D12)",
  "linear-gradient(135deg,#22D3EE,#0E7490)",
  "linear-gradient(135deg,#A78BFA,#6D28D9)",
  "linear-gradient(135deg,#34D399,#047857)",
  "linear-gradient(135deg,#F5B93D,#B45309)",
  "linear-gradient(135deg,#5865F2,#3B45B5)",
];
export function avatarGradient(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}

/** 頭文字アバター。size はピクセル。 */
export function Avatar({ name, size = 38 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="flex flex-none items-center justify-center rounded-full border border-[color:var(--mp-border-strong)] font-heading font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.36),
        background: avatarGradient(name),
      }}
    >
      {initials(name)}
    </span>
  );
}
