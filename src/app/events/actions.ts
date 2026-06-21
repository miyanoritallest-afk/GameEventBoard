"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  findEventById,
  insertEvent,
  publishEvent as publishEventRepo,
  slugExists,
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
