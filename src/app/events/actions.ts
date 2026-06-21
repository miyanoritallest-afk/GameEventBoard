"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  deleteDraftEvent as deleteDraftEventRepo,
  findEventById,
  insertEvent,
  publishEvent as publishEventRepo,
  slugExists,
  updateEvent as updateEventRepo,
} from "@/lib/repositories/events";
import { canPublish, publishRejectionReason } from "@/lib/services/event-status";
import { generateEventSlug } from "@/lib/services/event-slug";
import { createDraftEventSchema, publishEventSchema } from "./schema";

/**
 * イベント「下書き作成」 Server Action（Controller。薄く保つ）。
 * 実装ガイドラインに従う:
 * - 認証バイパス対策: 冒頭で必ずログイン確認（最後の砦）。
 * - マスアサインメント対策: Zod で許可カラムのみ受理。organizer_id / status はサーバー固定。
 * - 想定内の失敗は throw せず戻り値で返す。想定外は throw（error.tsx が受ける）。
 *
 * 下書きなのでタイトル・ゲーム以外は任意（schema 参照）。公開時の必須チェックは publishEvent。
 */

export type CreateEventState = {
  error?: string;
  fieldErrors?: Record<string, string>;
};

export type PublishEventState = {
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

/**
 * フォーム入力を Zod 検証し、DB 列名にマップする（作成・編集で共有）。
 * 許可カラムのみ受理＝マスアサインメント対策。organizer_id / status / slug は含めない。
 * 失敗時は fieldErrors を含む State を返す。
 */
function parseEventFormData(
  formData: FormData,
):
  | { ok: true; values: EventEditableValues }
  | { ok: false; state: { error: string; fieldErrors: Record<string, string> } } {
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
    return {
      ok: false,
      state: { error: "入力内容を確認してください。", fieldErrors },
    };
  }

  const v = parsed.data;
  return {
    ok: true,
    values: {
      title: v.title,
      game_id: v.gameId,
      description: v.description ? v.description : null,
      starts_at: jstLocalToUtcIso(v.startsAt),
      ends_at: jstLocalToUtcIso(v.endsAt),
      recruit_deadline: jstLocalToUtcIso(v.recruitDeadline),
      capacity: typeof v.capacity === "number" ? v.capacity : null,
      role_swap_allowed: v.roleSwapAllowed,
      declared_seasons: v.declaredSeasons,
      bonus_master: v.bonusMaster,
      bonus_gm: v.bonusGm,
      bonus_champion: v.bonusChampion,
    },
  };
}

/** 作成・編集で共有する、DB 列名に揃えた編集可能値。 */
type EventEditableValues = {
  title: string;
  game_id: string;
  description: string | null;
  starts_at: string | null;
  ends_at: string | null;
  recruit_deadline: string | null;
  capacity: number | null;
  role_swap_allowed: boolean;
  declared_seasons: number;
  bonus_master: number;
  bonus_gm: number;
  bonus_champion: number;
};

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

  const parsed = parseEventFormData(formData);
  if (!parsed.ok) return parsed.state;

  // organizer_id / status はサーバー側で固定（入力から取らない）。
  const created = await insertEvent({
    organizer_id: user.id,
    status: "draft",
    ...parsed.values,
  });

  redirect(`/events/${created.id}`);
}

/**
 * 重複しない slug を採番する。生成 → 既存チェック → 衝突ならリトライ。
 * slug は ID ベース（タイトル非依存）なので衝突はまれ。数回で必ず空きが見つかる想定。
 * それでも見つからなければ想定外として throw（error.tsx が受ける）。
 */
async function allocateUniqueSlug(maxAttempts = 5): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = generateEventSlug();
    if (!(await slugExists(candidate))) return candidate;
  }
  throw new Error("slug の採番に失敗しました（重複が解消できませんでした）。");
}

/**
 * イベント「公開」 Server Action（Controller。薄く保つ）。
 * 下書き(draft)を published に上げる1遷移のみを扱う。
 *
 * 防御の段取り（操作系＝保護。IDOR の本丸なので所有者確認を必ず行う）:
 * 1. ログイン確認（認証バイパス対策）。
 * 2. 対象イベントを取得し、organizer_id === user.id を確認（アプリ層 IDOR 対策）。
 *    存在しない/他人の行は同じ「権限なし」応答にして列挙を防ぐ。
 * 3. canPublish(status) で状態遷移を検証（二重公開・終了後公開を防ぐ）。
 * 4. publishEventSchema で公開時の必須項目（日程・締切）を検証（定員は任意）。
 * 5. 公開URL用に slug を採番（重複しない ID ベース slug）。
 * 6. publishEvent で楽観ロック付き更新（version 競合は戻り値で通知）。slug も保存。
 *    最終防衛は DB の RLS（events_update_own / 0004）。
 */
export async function publishEvent(
  eventId: string,
): Promise<PublishEventState> {
  // 1. ログイン確認（必須）
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "ログインが必要です。" };
  }

  // 2. 対象を取得し所有者確認。存在しない/他人の行は同一応答（情報漏洩を避ける）。
  const event = await findEventById(eventId);
  if (!event || event.organizer_id !== user.id) {
    return { error: "このイベントを公開する権限がありません。" };
  }

  // 3. 状態遷移の検証（下書きのときだけ公開できる）。
  if (!canPublish(event.status)) {
    return { error: publishRejectionReason(event.status) };
  }

  // 4. 公開時の必須項目チェック（保存済みの値を検証）。
  const parsed = publishEventSchema.safeParse({
    title: event.title,
    game_id: event.game_id,
    starts_at: event.starts_at,
    ends_at: event.ends_at,
    recruit_deadline: event.recruit_deadline,
    capacity: event.capacity,
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { error: "公開には未設定の項目があります。", fieldErrors };
  }

  // 5. 公開URL用の slug を採番（既に採番済みなら再利用。再公開でURLを変えない）。
  const slug = event.slug ?? (await allocateUniqueSlug());

  // 6. 楽観ロック付きで公開。条件に合致しなければ null（競合・横取り）。
  const updated = await publishEventRepo({
    id: event.id,
    organizerId: user.id,
    expectedVersion: event.version,
    slug,
  });
  if (!updated) {
    return {
      error: "公開に失敗しました。画面を更新してからもう一度お試しください。",
    };
  }

  revalidatePath(`/events/${event.id}`);
  return {};
}

export type EditEventState = {
  error?: string;
  fieldErrors?: Record<string, string>;
};

/**
 * イベント「編集」 Server Action（Controller）。
 *
 * 防御:
 * 1. ログイン確認（認証バイパス対策）。
 * 2. 対象取得＋所有者確認（IDOR。存在しない/他人は同一の権限なし応答）。
 * 3. Zod 検証（許可カラムのみ＝マスアサインメント対策）。
 * 4. 楽観ロック付き更新（version 競合は戻り値）。slug は不変（Repository が触らない）。
 *
 * 公開後も編集可。定員の下限制約・日程変更通知は前提機能（応募/通知）実装時に追加する。
 */
export async function updateEvent(
  eventId: string,
  _prev: EditEventState,
  formData: FormData,
): Promise<EditEventState> {
  // 1. ログイン確認
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "ログインが必要です。" };
  }

  // 2. 所有者確認（存在しない/他人は同一応答で列挙防止）。
  const event = await findEventById(eventId);
  if (!event || event.organizer_id !== user.id) {
    return { error: "このイベントを編集する権限がありません。" };
  }

  // 3. 入力検証（許可カラムのみ）。
  const parsed = parseEventFormData(formData);
  if (!parsed.ok) return parsed.state;

  // 4. 楽観ロック付き更新。slug は Repository 側で触らない（URL固定）。
  const updated = await updateEventRepo({
    id: event.id,
    organizerId: user.id,
    expectedVersion: event.version,
    values: parsed.values,
  });
  if (!updated) {
    return {
      error: "更新に失敗しました。画面を更新してからもう一度お試しください。",
    };
  }

  revalidatePath(`/events/${event.id}`);
  redirect(`/events/${event.slug ?? event.id}`);
}

export type DeleteEventState = {
  error?: string;
};

/**
 * イベント「下書き削除」 Server Action（Controller）。
 * 本人の下書きのみ削除可（Repository が organizer_id＋status='draft' で絞る）。
 * 公開済みは削除不可。削除後は自分のイベント一覧へ。
 */
export async function deleteDraftEvent(
  eventId: string,
): Promise<DeleteEventState> {
  // 1. ログイン確認
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "ログインが必要です。" };
  }

  // 2. 削除（本人の下書きのみ）。0 件なら権限なし/公開済み。
  const deleted = await deleteDraftEventRepo({
    id: eventId,
    organizerId: user.id,
  });
  if (deleted === 0) {
    return { error: "このイベントは削除できません（下書き・主催者のみ削除可）。" };
  }

  revalidatePath("/events/mine");
  redirect("/events/mine");
}
