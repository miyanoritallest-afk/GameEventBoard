import { describe, it, expect } from "vitest";
import { updateStreamSchema } from "../schema";

/**
 * 配信URL（stream_url）のスキーム制限テスト。
 * 配信URLは観戦ページ（匿名閲覧可）で <a href> として描画されるため、
 * javascript: 等の危険スキームを保存させないことを入力層で担保する（ストアドXSS対策）。
 */
describe("updateStreamSchema — 配信URLのスキーム制限", () => {
  const base = { matchId: "11111111-1111-4111-8111-111111111111" };

  it("http/https の URL は許可", () => {
    for (const url of [
      "https://twitch.tv/foo",
      "http://example.com/live",
      "https://youtube.com/watch?v=abc",
    ]) {
      const r = updateStreamSchema.safeParse({ ...base, streamUrl: url });
      expect(r.success).toBe(true);
    }
  });

  it("空文字（未設定・クリア）は許可", () => {
    const r = updateStreamSchema.safeParse({ ...base, streamUrl: "" });
    expect(r.success).toBe(true);
  });

  it("streamUrl 省略時は空文字にフォールバックし許可", () => {
    const r = updateStreamSchema.safeParse({ ...base });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.streamUrl).toBe("");
  });

  it("javascript: スキームは拒否（XSS 防止の要）", () => {
    const r = updateStreamSchema.safeParse({
      ...base,
      streamUrl: "javascript:alert(document.cookie)",
    });
    expect(r.success).toBe(false);
  });

  it("data:/vbscript:/file: 等の危険・非対応スキームも拒否", () => {
    for (const url of [
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
    ]) {
      const r = updateStreamSchema.safeParse({ ...base, streamUrl: url });
      expect(r.success).toBe(false);
    }
  });

  it("URL として解釈できない文字列は拒否", () => {
    const r = updateStreamSchema.safeParse({
      ...base,
      streamUrl: "not a url",
    });
    expect(r.success).toBe(false);
  });
});
