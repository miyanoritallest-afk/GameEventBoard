"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { insertSeries } from "@/lib/repositories/series";
import { findEventById, linkEventToSeries } from "@/lib/repositories/events";
import { createSeriesSchema } from "./schema";

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

  const { id } = await insertSeries({
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    createdBy: user.id,
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
  const { id: seriesId } = await insertSeries({
    name: event.title,
    description: null,
    createdBy: user.id,
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
