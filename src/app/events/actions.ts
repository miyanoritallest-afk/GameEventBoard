"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { insertEvent } from "@/lib/repositories/events";
import { createDraftEventSchema } from "./schema";

/**
 * イベント「下書き作成」 Server Action（Controller。薄く保つ）。
 * 実装ガイドラインに従う:
 * - 認証バイパス対策: 冒頭で必ずログイン確認（最後の砦）。
 * - マスアサインメント対策: Zod で許可カラムのみ受理。organizer_id / status はサーバー固定。
 * - 想定内の失敗は throw せず戻り値で返す。想定外は throw（error.tsx が受ける）。
 *
 * 下書きなのでタイトル・ゲーム以外は任意（schema 参照）。公開時の必須チェックは後続PR。
 */

export type CreateEventState = {
  error?: string;
  fieldErrors?: Record<string, string>;
};

/** datetime-local の JST ローカル時刻文字列を UTC(ISO) に変換する。空なら null。 */
function jstLocalToUtcIso(local: string | undefined | null): string | null {
  if (!local) return null;
  const iso = local.length === 16 ? `${local}:00+09:00` : `${local}+09:00`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export async function createEvent(
  _prev: CreateEventState,
  formData: FormData,
): Promise<CreateEventState> {
  // B: ログイン確認（必須）
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "ログインが必要です。" };
  }

  // 入力検証（Zod）。許可カラムのみ受理＝マスアサインメント対策。
  // null は schema 側の preprocess で正規化されるため、ここでは生値を渡す。
  const parsed = createDraftEventSchema.safeParse({
    title: formData.get("title"),
    gameId: formData.get("gameId"),
    description: formData.get("description"),
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
    recruitDeadline: formData.get("recruitDeadline"),
    capacity: formData.get("capacity"),
    roleSwapAllowed: formData.get("roleSwapAllowed") === "on",
    declaredSeasons: formData.get("declaredSeasons"),
    bonusMaster: formData.get("bonusMaster"),
    bonusGm: formData.get("bonusGm"),
    bonusChampion: formData.get("bonusChampion"),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { error: "入力内容を確認してください。", fieldErrors };
  }

  const v = parsed.data;
  const capacity = typeof v.capacity === "number" ? v.capacity : null;

  // organizer_id / status はサーバー側で固定（入力から取らない）。
  const created = await insertEvent({
    organizer_id: user.id,
    status: "draft",
    title: v.title,
    game_id: v.gameId,
    description: v.description ? v.description : null,
    starts_at: jstLocalToUtcIso(v.startsAt),
    ends_at: jstLocalToUtcIso(v.endsAt),
    recruit_deadline: jstLocalToUtcIso(v.recruitDeadline),
    capacity,
    role_swap_allowed: v.roleSwapAllowed,
    declared_seasons: v.declaredSeasons,
    bonus_master: v.bonusMaster,
    bonus_gm: v.bonusGm,
    bonus_champion: v.bonusChampion,
  });

  redirect(`/events/${created.id}`);
}
