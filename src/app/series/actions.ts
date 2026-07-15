"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  insertSeries,
  findSeriesById,
  findSeriesMembership,
  searchUsersForInvite,
  inviteSeriesMember,
  respondToSeriesInvite,
  removeSeriesMember,
} from "@/lib/repositories/series";
import { findEventById, linkEventToSeries } from "@/lib/repositories/events";
import { findDiscordName } from "@/lib/repositories/users";
import { notifySeriesMemberInvited } from "@/lib/notifications/notify";
import {
  createSeriesSchema,
  searchInviteSchema,
  inviteMemberSchema,
  respondInviteSchema,
  removeMemberSchema,
} from "./schema";

/**
 * 例外から DB関数のメッセージ文字列を安全に取り出す。
 * Supabase(Postgrest/RPC) の例外は Error インスタンスではなく `{code, message, ...}` の
 * プレーンオブジェクトのため、`e instanceof Error` だけだと message を取りこぼす
 * （raise exception のメッセージで分岐したいので message を確実に拾う）。
 */
function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message ?? "");
  }
  return "";
}

export type CreateSeriesState = {
  error?: string;
  fieldErrors?: Record<string, string>;
};

/**
 * シリーズ「作成」 Server Action（Controller。薄く保つ）。
 * 1. ログイン確認（操作系は冒頭で必ず認証）。
 * 2. Zod で検証（name 必須・description 任意）。
 * 3. 作成（created_by=auth.uid() 固定・作成者を owner・active で登録）。最終防衛は RLS（0032）。
 * 作成後は詳細ページへ。
 */
export async function createSeries(
  _prev: CreateSeriesState,
  formData: FormData,
): Promise<CreateSeriesState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "ログインが必要です。" };
  }

  const parsed = createSeriesSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { error: "入力内容を確認してください。", fieldErrors };
  }

  // 作成者（owner）は DB 関数が auth.uid() から取る（0037）。ここでは渡さない。
  const { id } = await insertSeries({
    name: parsed.data.name,
    description: parsed.data.description ?? null,
  });

  revalidatePath("/series");
  redirect(`/series/${id}`);
}

export type SeriesifyState = { error?: string };

/**
 * 既存イベントの「シリーズ化」 Server Action（Controller。薄く保つ）。
 * 「単発→好評→シリーズ化」の起点。イベント名でシリーズを作り、この回を第1回として紐付ける。
 * 1. ログイン確認。
 * 2. イベント取得＋主催者本人か確認（存在しない/他人は同一応答で列挙防止）。
 * 3. 既に series 所属なら弾く（二重シリーズ化防止）。
 * 4. シリーズ作成（作成者=owner）→ イベントを series_id で紐付け（series_id null の行のみ）。
 * 最終防衛は RLS（0032 event_series/series_members・0004 events_update_own）。
 */
export async function seriesifyEvent(
  eventId: string,
): Promise<SeriesifyState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "ログインが必要です。" };
  }

  const event = await findEventById(eventId);
  if (!event || event.organizer_id !== user.id) {
    return { error: "このイベントをシリーズ化する権限がありません。" };
  }
  if (event.series_id !== null) {
    return { error: "このイベントは既にシリーズに属しています。" };
  }

  // シリーズ名はイベント名を初期値にする（後からシリーズ編集で変更可＝⑥-2）。
  // 作成者（owner）は DB 関数が auth.uid() から取る（0037）。ここでは渡さない。
  const { id: seriesId } = await insertSeries({
    name: event.title,
    description: null,
  });

  const linked = await linkEventToSeries({
    eventId: event.id,
    organizerId: user.id,
    seriesId,
  });
  if (!linked) {
    // ここに来るのは競合（並行で series_id が入った等）。シリーズは作成済みだが紐付け失敗。
    return { error: "シリーズ化に失敗しました。画面を更新してお試しください。" };
  }

  revalidatePath(`/events/${event.id}`);
  redirect(`/series/${seriesId}`);
}

// ============================================================================
// ⑥-2 シリーズ共同運営（検索招待・承認/拒否・削除）
// いずれも操作系: 冒頭でログイン確認。認可（owner か・本人か）は DB関数（0033）＋RLS が
// 最終防衛。Server Action 側でも Zod 検証と（招待は）owner 事前確認で早期に弾く。
// ============================================================================

export type SearchInviteState = {
  error?: string;
  results?: {
    id: string;
    discord_name: string;
    battle_tag: string | null;
    discord_avatar_url: string | null;
  }[];
};

/**
 * 招待候補のユーザー検索（owner 用）。discord_name / battle_tag 部分一致・既member除外・上限20。
 * 1. ログイン確認。2. Zod 検証。3. owner 確認（他人が候補を引けないように）。4. 検索。
 */
export async function searchInviteCandidates(
  _prev: SearchInviteState,
  formData: FormData,
): Promise<SearchInviteState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "ログインが必要です。" };

  const parsed = searchInviteSchema.safeParse({
    seriesId: formData.get("seriesId"),
    query: formData.get("query"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "入力を確認してください。" };
  }

  // owner のみ候補検索できる（招待は owner 権限のため、非 owner に候補を見せない）。
  const membership = await findSeriesMembership({
    seriesId: parsed.data.seriesId,
    userId: user.id,
  });
  if (membership?.role !== "owner" || membership.status !== "active") {
    return { error: "運営メンバーを招待する権限がありません。" };
  }

  const results = await searchUsersForInvite({
    seriesId: parsed.data.seriesId,
    query: parsed.data.query,
  });
  return { results };
}

export type InviteMemberState = { error?: string; success?: boolean };

/**
 * owner が運営メンバーを招待する（admin・invited）。
 * 1. ログイン確認。2. Zod 検証。3. 招待（原子性・owner資格・二重招待防止は DB関数）。
 * 4. 招待相手へ通知（ベストエフォート）。role/status は入力から取らずサーバー固定。
 */
export async function inviteMember(
  _prev: InviteMemberState,
  formData: FormData,
): Promise<InviteMemberState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "ログインが必要です。" };

  const parsed = inviteMemberSchema.safeParse({
    seriesId: formData.get("seriesId"),
    userId: formData.get("userId"),
  });
  if (!parsed.success) {
    return { error: "入力内容を確認してください。" };
  }

  try {
    await inviteSeriesMember({
      seriesId: parsed.data.seriesId,
      userId: parsed.data.userId,
    });
  } catch (e) {
    // DB関数の例外（非owner・二重招待）はユーザー向けメッセージに丸める。
    const msg = errorMessage(e);
    if (msg.includes("already a member")) {
      return { error: "このユーザーは既に運営メンバーです。" };
    }
    if (msg.includes("not an active owner")) {
      return { error: "運営メンバーを招待する権限がありません。" };
    }
    console.error("[inviteMember] 招待に失敗:", e);
    return { error: "招待に失敗しました。時間をおいてお試しください。" };
  }

  // 招待相手へ通知（ベストエフォート＝失敗しても招待は成功）。
  try {
    const series = await findSeriesById(parsed.data.seriesId);
    const inviterName = (await findDiscordName(user.id)) ?? "運営";
    if (series) {
      await notifySeriesMemberInvited({
        seriesId: series.id,
        seriesName: series.name,
        inviteeUserId: parsed.data.userId,
        inviterName,
      });
    }
  } catch (e) {
    console.error("[inviteMember] 招待通知の生成に失敗:", e);
  }

  revalidatePath(`/series/${parsed.data.seriesId}`);
  return { success: true };
}

export type RespondInviteState = { error?: string; success?: boolean };

/**
 * 招待への応答（承認/拒否）。本人の invited 行にのみ作用（DB関数＋RLS）。
 * 1. ログイン確認。2. Zod 検証。3. 応答（承認=active化 / 拒否=削除）。
 */
export async function respondInvite(
  _prev: RespondInviteState,
  formData: FormData,
): Promise<RespondInviteState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "ログインが必要です。" };

  const parsed = respondInviteSchema.safeParse({
    seriesId: formData.get("seriesId"),
    accept: formData.get("accept") === "true",
  });
  if (!parsed.success) {
    return { error: "入力内容を確認してください。" };
  }

  let affected: number;
  try {
    affected = await respondToSeriesInvite({
      seriesId: parsed.data.seriesId,
      accept: parsed.data.accept,
    });
  } catch (e) {
    // 他3アクションと揃えて DB/RPC エラーを握る（未処理例外で transition を落とさない）。
    console.error("[respondInvite] 応答に失敗:", e);
    return { error: "応答に失敗しました。時間をおいてお試しください。" };
  }
  if (affected === 0) {
    return { error: "招待が見つかりません。既に処理済みの可能性があります。" };
  }

  revalidatePath(`/series/${parsed.data.seriesId}`);
  return { success: true };
}

export type RemoveMemberState = { error?: string; success?: boolean };

/**
 * owner が運営メンバーを削除する（招待取消・運営削除）。最後の owner 保護は DB関数（0033）。
 * 1. ログイン確認。2. Zod 検証。3. 削除（owner資格・最後のowner保護は DB関数）。
 */
export async function removeMember(
  _prev: RemoveMemberState,
  formData: FormData,
): Promise<RemoveMemberState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "ログインが必要です。" };

  const parsed = removeMemberSchema.safeParse({
    seriesId: formData.get("seriesId"),
    userId: formData.get("userId"),
  });
  if (!parsed.success) {
    return { error: "入力内容を確認してください。" };
  }

  try {
    const affected = await removeSeriesMember({
      seriesId: parsed.data.seriesId,
      userId: parsed.data.userId,
    });
    if (affected === 0) {
      return { error: "対象の運営メンバーが見つかりません。" };
    }
  } catch (e) {
    const msg = errorMessage(e);
    if (msg.includes("last active owner")) {
      return { error: "最後のオーナーは削除できません。" };
    }
    if (msg.includes("not an active owner")) {
      return { error: "運営メンバーを削除する権限がありません。" };
    }
    console.error("[removeMember] 削除に失敗:", e);
    return { error: "削除に失敗しました。時間をおいてお試しください。" };
  }

  revalidatePath(`/series/${parsed.data.seriesId}`);
  return { success: true };
}
