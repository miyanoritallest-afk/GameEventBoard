"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  insertScrim,
  updateScrim,
  deleteScrim,
  findScrimById,
  findViewerTeamId,
} from "@/lib/repositories/scrims";
import { jstLocalToUtcIso } from "@/lib/datetime-local";
import { scrimSchema } from "./schema";

/**
 * チーム日程（スクリム/練習）の Server Actions（Controller。薄く保つ）。
 * 操作系＝保護: 冒頭でログイン確認。team_id は入力から取らず「閲覧者がこのイベントで所属する
 * チーム」に固定する（他チームへの登録を封じる＝IDOR/マスアサインメント対策）。最終防衛は
 * RLS（0035・書き込みはメンバーのみ）。kind='practice' の相手は捨てる（練習は相手なし）。
 */

export type ScrimState = { error?: string; success?: boolean };

/** FormData を Zod で検証し、共通の値（UTC 日時・相手・メモ）に整える。 */
function parseScrim(formData: FormData) {
  const parsed = scrimSchema.safeParse({
    kind: formData.get("kind"),
    scheduledAt: formData.get("scheduledAt"),
    opponentName: formData.get("opponentName") ?? "",
    memo: formData.get("memo") ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false as const,
      error: parsed.error.issues[0]?.message ?? "入力内容を確認してください。",
    };
  }
  const scheduledAtUtc = jstLocalToUtcIso(parsed.data.scheduledAt);
  if (!scheduledAtUtc) {
    return { ok: false as const, error: "日時の形式が正しくありません。" };
  }
  // 練習は相手を持たない。相手は空文字なら null。
  const opponentName =
    parsed.data.kind === "practice" || parsed.data.opponentName === ""
      ? null
      : parsed.data.opponentName;
  const memo = parsed.data.memo === "" ? null : parsed.data.memo;
  return {
    ok: true as const,
    kind: parsed.data.kind,
    scheduledAtUtc,
    opponentName,
    memo,
  };
}

/**
 * スクリム/練習を新規登録する。team_id は閲覧者の自チームに固定。
 */
export async function createScrim(
  eventId: string,
  _prev: ScrimState,
  formData: FormData,
): Promise<ScrimState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "ログインが必要です。" };

  // 登録先チーム＝閲覧者がこのイベントで所属するチーム（無ければ登録不可）。
  const teamId = await findViewerTeamId({ eventId, userId: user.id });
  if (!teamId) {
    return { error: "このイベントで所属するチームがありません。" };
  }

  const v = parseScrim(formData);
  if (!v.ok) return { error: v.error };

  await insertScrim({
    teamId,
    createdBy: user.id,
    kind: v.kind,
    scheduledAt: v.scheduledAtUtc,
    opponentName: v.opponentName,
    memo: v.memo,
  });

  revalidatePath(`/events/${eventId}/schedule`);
  return { success: true };
}

/**
 * スクリム/練習を編集する。対象が「閲覧者の自チームの予定」であることを確認（IDOR）。
 */
export async function editScrim(
  eventId: string,
  scrimId: string,
  _prev: ScrimState,
  formData: FormData,
): Promise<ScrimState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "ログインが必要です。" };

  const scrim = await findScrimById(scrimId);
  const teamId = await findViewerTeamId({ eventId, userId: user.id });
  // 対象が存在し、閲覧者の自チームの予定であること（他人/他チームは同一応答で列挙防止）。
  if (!scrim || !teamId || scrim.team_id !== teamId) {
    return { error: "この予定を編集する権限がありません。" };
  }

  const v = parseScrim(formData);
  if (!v.ok) return { error: v.error };

  const updated = await updateScrim({
    id: scrimId,
    kind: v.kind,
    scheduledAt: v.scheduledAtUtc,
    opponentName: v.opponentName,
    memo: v.memo,
  });
  if (updated === 0) {
    return { error: "更新に失敗しました。画面を更新してお試しください。" };
  }

  revalidatePath(`/events/${eventId}/schedule`);
  return { success: true };
}

/**
 * スクリム/練習を削除する。対象が「閲覧者の自チームの予定」であることを確認（IDOR）。
 */
export async function removeScrim(
  eventId: string,
  scrimId: string,
): Promise<ScrimState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "ログインが必要です。" };

  const scrim = await findScrimById(scrimId);
  const teamId = await findViewerTeamId({ eventId, userId: user.id });
  if (!scrim || !teamId || scrim.team_id !== teamId) {
    return { error: "この予定を削除する権限がありません。" };
  }

  const deleted = await deleteScrim(scrimId);
  if (deleted === 0) {
    return { error: "削除に失敗しました。画面を更新してお試しください。" };
  }

  revalidatePath(`/events/${eventId}/schedule`);
  return { success: true };
}
