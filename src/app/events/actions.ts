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
import {
  findRegistration,
  findRegistrationWithEvent,
  insertRegistration,
  decideRegistration as decideRegistrationRepo,
  setOverrideScore as setOverrideScoreRepo,
} from "@/lib/repositories/registrations";
import { canPublish, publishRejectionReason } from "@/lib/services/event-status";
import {
  canDecide,
  canRegister,
  registerRejectionReason,
} from "@/lib/services/registration-status";
import { generateEventSlug } from "@/lib/services/event-slug";
import { calcScore } from "@/lib/services/scoring";
import {
  buildGrid,
  parsePeak,
  rolesForEvent,
  type Role,
} from "@/lib/services/scored-application";
import { createDraftEventSchema, publishEventSchema } from "./schema";
import {
  scoredApplicationSchema,
  simpleApplicationSchema,
} from "./apply-schema";
import { updateBattleTag } from "@/lib/repositories/users";
import {
  insertNotificationEvent,
  insertNotification,
} from "@/lib/repositories/notifications";
import {
  NotificationType,
  buildRegistrationApprovedContent,
  buildSeriesSeasonAnnouncedContent,
  buildEventScheduleConfirmedContent,
} from "@/lib/services/notification-content";
import { listFollowerIds } from "@/lib/repositories/follows";
import { aggregateRecipients } from "@/lib/services/notification-fanout";
import { notifyEventFollowers } from "@/lib/notifications/notify";

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
    organizerDisplayName: formData.get("organizerDisplayName"),
    description: formData.get("description"),
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
    recruitDeadline: formData.get("recruitDeadline"),
    capacity: formData.get("capacity"),
    format: formData.get("format") ?? "round_robin_then_tournament",
    requireScore: formData.get("requireScore") === "on",
    uncertifiedHandling: formData.get("uncertifiedHandling") ?? "exclude",
    roleSwapAllowed: formData.get("roleSwapAllowed") === "on",
    declaredSeasons: formData.get("declaredSeasons"),
    bonusMaster: formData.get("bonusMaster"),
    bonusGm: formData.get("bonusGm"),
    bonusChampion: formData.get("bonusChampion"),
    teamScoreCap: formData.get("teamScoreCap"),
    // 順位設定（本戦-3b）。tiebreakers は D&D 順を hidden input のカンマ区切りで受ける。
    rankingEnabled: formData.get("rankingEnabled") === "on",
    pointsWin: formData.get("pointsWin"),
    pointsDraw: formData.get("pointsDraw"),
    pointsLoss: formData.get("pointsLoss"),
    tiebreakers: formData.get("tiebreakers"),
    groupBestOf: formData.get("groupBestOf"),
    tournamentThirdPlace: formData.get("tournamentThirdPlace") === "on",
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
      // 空文字＝未設定 → null（表示側で discord_name にフォールバック）。
      organizer_display_name: v.organizerDisplayName
        ? v.organizerDisplayName
        : null,
      description: v.description ? v.description : null,
      starts_at: jstLocalToUtcIso(v.startsAt),
      ends_at: jstLocalToUtcIso(v.endsAt),
      recruit_deadline: jstLocalToUtcIso(v.recruitDeadline),
      capacity: typeof v.capacity === "number" ? v.capacity : null,
      format: v.format,
      require_score: v.requireScore,
      uncertified_handling: v.uncertifiedHandling,
      role_swap_allowed: v.roleSwapAllowed,
      declared_seasons: v.declaredSeasons,
      bonus_master: v.bonusMaster,
      bonus_gm: v.bonusGm,
      bonus_champion: v.bonusChampion,
      // 空文字＝上限なし → null で保存。
      team_score_cap: typeof v.teamScoreCap === "number" ? v.teamScoreCap : null,
      ranking_enabled: v.rankingEnabled,
      points_win: v.pointsWin,
      points_draw: v.pointsDraw,
      points_loss: v.pointsLoss,
      tiebreakers: v.tiebreakers,
      group_best_of: v.groupBestOf,
      tournament_third_place: v.tournamentThirdPlace,
    },
  };
}

/** 作成・編集で共有する、DB 列名に揃えた編集可能値。 */
type EventEditableValues = {
  title: string;
  game_id: string;
  organizer_display_name: string | null;
  description: string | null;
  starts_at: string | null;
  ends_at: string | null;
  recruit_deadline: string | null;
  capacity: number | null;
  format: "round_robin" | "tournament" | "round_robin_then_tournament";
  require_score: boolean;
  uncertified_handling: "fill_by_role" | "fill_by_season" | "exclude";
  role_swap_allowed: boolean;
  declared_seasons: number;
  bonus_master: number;
  bonus_gm: number;
  bonus_champion: number;
  team_score_cap: number | null;
  ranking_enabled: boolean;
  points_win: number;
  points_draw: number;
  points_loss: number;
  tiebreakers: ("head_to_head" | "map_diff" | "potg")[];
  group_best_of: number;
  tournament_third_place: boolean;
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
 * イベント公開時の通知生成（#4 series_season_announced・フォロー集約 3.6.1）。
 * 宛先＝主催者(user)のフォロワー（本 PR では series フォロワーは未対応・⑥で追加）。
 * Controller から repository（フォロワー列挙）＋ service（集約・文面）を束ねる。
 *
 * ベストエフォート: 通知生成の失敗で公開自体は成功扱い（呼び出し側で握り潰す）。
 * 二重通知は UNIQUE(user_id, source_event_id) が最終防衛。宛先集約は aggregateRecipients
 * で重複排除し、公開した主催者本人は宛先から除く。
 */
async function notifyEventPublished(params: {
  eventId: string;
  eventTitle: string;
  organizerId: string;
  organizerName: string;
}): Promise<void> {
  // 宛先＝主催者フォロワー（重複排除＋本人除外）。宛先ゼロなら出来事も作らない。
  const followers = await listFollowerIds({
    targetType: "user",
    targetId: params.organizerId,
  });
  const recipients = aggregateRecipients([followers], [params.organizerId]);
  if (recipients.length === 0) return;

  // 出来事は「主催者(user)」に紐づく（3.6.1 の起点）。
  const { id: sourceEventId } = await insertNotificationEvent({
    type: NotificationType.SeriesSeasonAnnounced,
    sourceType: "user",
    sourceId: params.organizerId,
  });
  const content = buildSeriesSeasonAnnouncedContent({
    eventId: params.eventId,
    eventTitle: params.eventTitle,
    organizerName: params.organizerName,
  });
  // 1人1通。各人を独立に並列で作る（1件の失敗が他の宛先を巻き込まない＝部分配信を防ぐ・
  // 多数フォロワーでも直列待ちにならない）。二重は UNIQUE が弾く（insertNotification が
  // duplicate を握る）。失敗した宛先は allSettled で握り、ログのみ（ベストエフォート）。
  const results = await Promise.allSettled(
    recipients.map((userId) =>
      insertNotification({
        userId,
        sourceEventId,
        title: content.title,
        body: content.body,
        linkUrl: content.linkUrl,
      }),
    ),
  );
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    console.error(
      `[notifyEventPublished] ${failed.length}/${recipients.length} 件の通知生成に失敗`,
      (failed[0] as PromiseRejectedResult).reason,
    );
  }
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

  // 公開できたら、主催者フォロワーへ通知（ベストエフォート＝失敗しても公開は成功）。
  const organizerName =
    event.organizer_display_name ??
    (event.organizer as { discord_name: string } | null)?.discord_name ??
    "主催者";
  try {
    await notifyEventPublished({
      eventId: event.id,
      eventTitle: event.title,
      organizerId: event.organizer_id,
      organizerName,
    });
  } catch (e) {
    console.error("[publishEvent] 公開通知の生成に失敗:", e);
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

  // 公開済みイベントで開催日時が実際に変わったら、event フォロワーへ日程更新通知
  // （短期イベント想定・1日1回集約）。下書き編集・日時が同じ更新では飛ばさない。
  // ベストエフォート＝失敗しても編集は成功。redirect の前に行う（redirect は例外を投げる）。
  // 比較は**時刻の値**で行う（保存形式 "...000Z" と DB 読み出し形式 "...+00:00" の
  // 文字列差で誤判定しないため）。starts_at が新たに入った場合も「変更」とみなす。
  const newStartsAt = parsed.values.starts_at ?? null;
  const startsAtMs = (v: string | null) =>
    v === null ? null : new Date(v).getTime();
  const scheduleChanged =
    event.status !== "draft" &&
    newStartsAt !== null &&
    startsAtMs(newStartsAt) !== startsAtMs(event.starts_at);
  if (scheduleChanged) {
    try {
      await notifyEventFollowers({
        eventId: event.id,
        type: NotificationType.EventScheduleConfirmed,
        content: buildEventScheduleConfirmedContent({
          eventId: event.id,
          eventTitle: event.title,
        }),
        excludeUserId: user.id,
      });
    } catch (e) {
      console.error("[updateEvent] 日程更新通知の生成に失敗:", e);
    }
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

export type RegisterState = {
  error?: string;
};

/**
 * イベント「応募」 Server Action（Controller）。スコアなし最小応募。
 *
 * 防御（初めて「他人のイベントに自分のデータを書き込む」操作）:
 * 1. ログイン確認（認証バイパス対策）。
 * 2. 対象イベント取得。存在しない→エラー。
 * 3. 主催者本人は応募不可（自分のイベントには応募させない）。
 * 4. canRegister(status)：公開中のみ応募可。
 * 5. 重複判定（1ユーザー1応募）。応募済みなら戻り値エラー。
 * 6. 登録名＋バトルタグを検証（登録名=公開表示名・バトルタグ=応募必須）。
 * 7. insert（**user_id はセッション固定＝なりすまし防止／マスアサインメント対策**。
 *    status は Repository で 'pending' 固定）。UNIQUE は DB 層の最終防衛。
 * 8. バトルタグで users.battle_tag を更新（人単位・次回応募で自動補完される）。
 */
export async function registerForEvent(
  eventId: string,
  displayName: string,
  battleTag: string,
): Promise<RegisterState> {
  // 1. ログイン確認
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "ログインが必要です。" };
  }

  // 2. 対象イベント
  const event = await findEventById(eventId);
  if (!event) {
    return { error: "イベントが見つかりません。" };
  }

  // 3. 主催者本人は応募不可
  if (event.organizer_id === user.id) {
    return { error: "主催者は自分のイベントに応募できません。" };
  }

  // 4. 公開中のみ
  if (!canRegister(event.status)) {
    return { error: registerRejectionReason(event.status) };
  }

  // 5. 重複判定（事前チェック）
  const existing = await findRegistration(eventId, user.id);
  if (existing) {
    return { error: "このイベントにはすでに応募済みです。" };
  }

  // 6. 登録名＋バトルタグの検証（空欄・長すぎは弾く。どちらも必須）。
  const parsed = simpleApplicationSchema.safeParse({ displayName, battleTag });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "入力内容を確認してください。",
    };
  }

  // 7. 応募作成（user_id はセッション固定）。競合時は UNIQUE が最終防衛。
  const result = await insertRegistration({
    eventId,
    userId: user.id,
    displayName: parsed.data.displayName,
  });
  if (!result.ok) {
    return { error: "このイベントにはすでに応募済みです。" };
  }

  // 8. バトルタグを users に保存（人単位・次回応募で自動補完）。battle_tag のみ更新。
  await updateBattleTag({ userId: user.id, battleTag: parsed.data.battleTag });

  revalidatePath(`/events/${event.slug ?? event.id}`);
  return {};
}

export type ScoredRegisterState = {
  error?: string;
  fieldErrors?: Record<string, string>;
};

/**
 * スコアあり応募 Server Action（Controller）。/events/[id]/apply から呼ぶ。
 *
 * 防御＋算出の段取り:
 * 1. ログイン確認。
 * 2. 対象イベント取得。存在しない→エラー。
 * 3. 主催者本人は応募不可。
 * 4. canRegister(status)：公開中のみ。
 * 5. require_score=true 前提（false は即時応募ルート）。
 * 6. 重複判定。
 * 7. 離散項目（希望ロール・peak）を Zod 検証。
 * 8. ランクグリッドを formData から parse（イベント設定で形が決まる）。
 * 9. calcScore（PR-B）で算出。10. registrations にスナップショット保存
 *    （user_id / status はサーバー固定＝なりすまし・マスアサインメント対策）。
 */
export async function registerWithScore(
  eventId: string,
  _prev: ScoredRegisterState,
  formData: FormData,
): Promise<ScoredRegisterState> {
  // 1. ログイン確認
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "ログインが必要です。" };
  }

  // 2-4. 対象・所有者・公開中
  const event = await findEventById(eventId);
  if (!event) return { error: "イベントが見つかりません。" };
  if (event.organizer_id === user.id) {
    return { error: "主催者は自分のイベントに応募できません。" };
  }
  if (!canRegister(event.status)) {
    return { error: registerRejectionReason(event.status) };
  }

  // 5. スコアあり応募はスコア計算ありイベント限定（出し分けと整合）。
  if (!event.require_score) {
    return { error: "このイベントはスコア入力なしで応募できます。" };
  }

  // 6. 重複判定
  const existing = await findRegistration(eventId, user.id);
  if (existing) {
    return { error: "このイベントにはすでに応募済みです。" };
  }

  // 7. 離散項目の検証（希望ロール第1〜第3・peak）。
  const parsed = scoredApplicationSchema.safeParse({
    displayName: formData.get("displayName"),
    battleTag: formData.get("battleTag"),
    preferredRole1: formData.get("preferredRole1"),
    preferredRole2: formData.get("preferredRole2"),
    preferredRole3: formData.get("preferredRole3"),
    peak: formData.get("peak") ?? "none",
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { error: "入力内容を確認してください。", fieldErrors };
  }
  const {
    displayName,
    battleTag,
    preferredRole1,
    preferredRole2,
    preferredRole3,
    peak,
  } = parsed.data;

  // 8. ランクグリッドを parse（対象ロール × declared_seasons）。
  // フォームのセル名は rank_<role>_<seasonIndex>。値は score 文字列 or "uncertified"。
  // role_swap=false のグリッド対象は第1希望ロール。
  const roles = rolesForEvent(event.role_swap_allowed, preferredRole1 as Role);
  const cellsByRole: Record<string, (string | null)[]> = {};
  for (const role of roles) {
    const cells: (string | null)[] = [];
    for (let s = 0; s < event.declared_seasons; s++) {
      cells.push((formData.get(`rank_${role}_${s}`) as string | null) ?? null);
    }
    cellsByRole[role] = cells;
  }
  const grid = buildGrid(roles, cellsByRole);

  // 9. スコア算出（ボーナスはイベント設定の加点。peak は応募者入力）。
  const result = calcScore({
    roleSwapAllowed: event.role_swap_allowed,
    grid,
    handling: event.uncertified_handling,
    peak: parsePeak(peak),
    bonus: {
      master: event.bonus_master,
      gm: event.bonus_gm,
      champion: event.bonus_champion,
    },
  });

  // 10. スナップショット保存（user_id / status はサーバー固定）。
  // preferred_role（旧・第1希望ミラー）も埋め、一覧の後方互換を保つ。
  const inserted = await insertRegistration({
    eventId,
    userId: user.id,
    displayName,
    preferredRole: preferredRole1 as Role,
    preferredRole1: preferredRole1 as Role,
    preferredRole2: preferredRole2 as Role,
    preferredRole3: preferredRole3 as Role,
    individualScore: result.individualScore,
    finalScore: result.finalScore,
    scoreBreakdown: { ...result.breakdown, grid: cellsByRole },
  });
  if (!inserted.ok) {
    return { error: "このイベントにはすでに応募済みです。" };
  }

  // バトルタグを users に保存（人単位・次回応募で自動補完）。battle_tag のみ更新。
  await updateBattleTag({ userId: user.id, battleTag });

  revalidatePath(`/events/${event.slug ?? event.id}`);
  redirect(`/events/${event.slug ?? event.id}`);
}

export type DecideRegistrationState = {
  error?: string;
};

/**
 * 応募承認時の通知生成（#1 registration_approved）。宛先＝応募者本人。
 * Controller から repository（DB）＋ service（文面）を束ねる（Service は repository を
 * 呼ばない純粋関数の流儀を守るため、オーケストレーションは Controller 側に置く）。
 *
 * ベストエフォート: 通知生成に失敗しても承認自体は成功扱い（呼び出し側で握り潰す）。
 * 通知は「見落とし防止のブースト」であり、確実な土台＝status 更新を巻き添えにしない
 * （要件定義書 3.5.2）。二重通知は UNIQUE(user_id, source_event_id) が最終防衛。
 */
async function notifyRegistrationApproved(params: {
  eventId: string;
  eventTitle: string;
  applicantUserId: string;
}): Promise<void> {
  // 出来事（event に紐づく）を1件記録 → 宛先（応募者本人）へ通知を1件生成。
  const { id: sourceEventId } = await insertNotificationEvent({
    type: NotificationType.RegistrationApproved,
    sourceType: "event",
    sourceId: params.eventId,
  });
  const content = buildRegistrationApprovedContent({
    eventId: params.eventId,
    eventTitle: params.eventTitle,
  });
  await insertNotification({
    userId: params.applicantUserId,
    sourceEventId,
    title: content.title,
    body: content.body,
    linkUrl: content.linkUrl,
  });
}

/**
 * 応募の「承認/却下」 Server Action（Controller）。主催者のみ。
 *
 * 防御（2テーブル跨ぎの所有権確認＝応募フロー固有の IDOR）:
 * 1. ログイン確認。
 * 2. 応募＋イベントを取得。存在しない／イベント主催者でない→同一の権限なし応答（列挙防止）。
 * 3. canDecide(status)：pending のみ処理可（二重処理防止）。
 * 4. update（pending のみ更新）。null→競合（既に処理済み）。最終防衛は RLS（0006）。
 * 5. 承認時のみ、応募者本人へ通知（ベストエフォート＝失敗しても承認は成功）。
 */
export async function decideRegistration(
  registrationId: string,
  decision: "approve" | "reject",
): Promise<DecideRegistrationState> {
  // 1. ログイン確認
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "ログインが必要です。" };
  }

  // 2. 応募＋イベント取得し、主催者本人か確認（存在しない/他人は同一応答）。
  const reg = await findRegistrationWithEvent(registrationId);
  const event = reg?.events as {
    id: string;
    organizer_id: string;
    title: string;
  } | null;
  if (!reg || !event || event.organizer_id !== user.id) {
    return { error: "この応募を操作する権限がありません。" };
  }

  // 3. pending のみ承認/却下できる。
  if (!canDecide(reg.status)) {
    return { error: "この応募はすでに処理済みです。" };
  }

  // 4. 更新（pending のみ）。null は競合。
  const nextStatus = decision === "approve" ? "approved" : "rejected";
  const updated = await decideRegistrationRepo({
    registrationId,
    expectedStatus: "pending",
    nextStatus,
  });
  if (!updated) {
    return {
      error: "処理に失敗しました。画面を更新してからもう一度お試しください。",
    };
  }

  // 5. 承認時のみ、応募者本人へ通知（ベストエフォート）。
  //    通知の失敗で承認業務を巻き添えにしない（要件定義書 3.5.2）。ログのみ残す。
  if (decision === "approve") {
    try {
      await notifyRegistrationApproved({
        eventId: event.id,
        eventTitle: event.title,
        applicantUserId: reg.user_id,
      });
    } catch (e) {
      console.error("[decideRegistration] 承認通知の生成に失敗:", e);
    }
  }

  revalidatePath(`/events/${event.id}/registrations`);
  return {};
}

export type OverrideScoreState = {
  error?: string;
};

/**
 * 応募の「スコア上書き」 Server Action（Controller）。主催者のみ。
 * organizer_override_score を設定/解除する（誤入力の修正用）。
 * 算出元のランク・score_breakdown は保持し、最終スコアだけ上書きする。
 *
 * 防御（承認/却下と同じ2テーブル跨ぎ所有権確認＝IDOR）:
 * 1. ログイン確認。
 * 2. 応募＋イベント取得。存在しない／主催者でない→同一の権限なし応答。
 * 3. 上書き値の検証（null=クリア、または0以上の数値）。
 * 4. setOverrideScore。最終防衛は RLS（0006 UPDATE）。
 */
export async function overrideRegistrationScore(
  registrationId: string,
  rawScore: string,
): Promise<OverrideScoreState> {
  // 1. ログイン確認
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "ログインが必要です。" };
  }

  // 2. 所有者確認（存在しない/他人は同一応答）。
  const reg = await findRegistrationWithEvent(registrationId);
  const event = reg?.events as { id: string; organizer_id: string } | null;
  if (!reg || !event || event.organizer_id !== user.id) {
    return { error: "この応募を操作する権限がありません。" };
  }

  // 3. 上書き値の検証。空文字＝クリア（null）、それ以外は 0 以上の数値。
  const trimmed = rawScore.trim();
  let score: number | null;
  if (trimmed === "") {
    score = null;
  } else {
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0) {
      return { error: "スコアは0以上の数値で入力してください。" };
    }
    score = n;
  }

  // 4. 上書き保存。
  const updated = await setOverrideScoreRepo({ registrationId, score });
  if (!updated) {
    return {
      error: "更新に失敗しました。画面を更新してからもう一度お試しください。",
    };
  }

  revalidatePath(`/events/${event.id}/registrations`);
  return {};
}
