import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type Role = Database["public"]["Enums"]["role"];

/**
 * チーム（teams / team_members）Repository。DB アクセスを集約する（実装ガイドライン: 層構造）。
 * Supabase クエリビルダのみ（生SQL禁止＝SQLi対策）。
 * 所有権（イベント主催者か）の確認はアクション側で行い、RLS（0010）が最終防衛。
 *
 * PR-1 は organizer 振り分けのみ。self 応募（teams.status での承認）は PR-3。
 */

/** チームを1件作成する（status は DB デフォルト 'approved'＝organizer 振り分け）。 */
export async function insertTeam(params: {
  eventId: string;
  name: string;
}): Promise<{ ok: true; id: string } | { ok: false; duplicate: true }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("teams")
    .insert({ event_id: params.eventId, name: params.name })
    .select("id")
    .single();

  if (error) {
    // UNIQUE(event_id, name) 違反＝同名チーム。呼び出し側で扱えるよう返す。
    if (error.code === "23505") return { ok: false, duplicate: true };
    throw error;
  }
  return { ok: true, id: data.id };
}

/** id でチームを1件取得する（所有権確認用に event_id を返す）。無ければ null。 */
export async function findTeamById(teamId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("teams")
    .select("id, event_id, name, version")
    .eq("id", teamId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * チーム名を更新する（楽観ロック）。expectedVersion 一致時のみ更新し version を進める。
 * 競合（版ずれ・横取り）なら null。同名衝突は { duplicate: true }。
 */
export async function renameTeam(params: {
  teamId: string;
  name: string;
  expectedVersion: number;
}): Promise<
  | { ok: true }
  | { ok: false; duplicate?: true; conflict?: true }
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("teams")
    .update({ name: params.name, version: params.expectedVersion + 1 })
    .eq("id", params.teamId)
    .eq("version", params.expectedVersion)
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") return { ok: false, duplicate: true };
    throw error;
  }
  if (!data) return { ok: false, conflict: true };
  return { ok: true };
}

/** チームを削除する。team_members は FK の on delete cascade で連動削除。 */
export async function deleteTeam(teamId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("teams")
    .delete()
    .eq("id", teamId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return data; // null なら対象なし（RLS で弾かれた・既に削除済み）
}

/**
 * メンバーを割当する（registration → team）。position は DB デフォルト 'regular'。
 * UNIQUE(registration_id) により1応募1チーム。既に割当済みなら { duplicate: true }。
 * role は割当時のロール（PR-1 は応募の第1希望をデフォルトに、UI から指定可）。
 */
export async function insertTeamMember(params: {
  teamId: string;
  registrationId: string;
  role: Role;
}): Promise<{ ok: true; id: string } | { ok: false; duplicate: true }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("team_members")
    .insert({
      team_id: params.teamId,
      registration_id: params.registrationId,
      role: params.role,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { ok: false, duplicate: true };
    throw error;
  }
  return { ok: true, id: data.id };
}

/**
 * メンバーの所属チームを移動する（別チームへの D&D）。
 * UNIQUE(registration_id) があるため insert ではなく既存行の team_id を更新する。
 * 対象 registration の所属行を更新。無ければ null（未割当だった）。
 */
export async function moveTeamMember(params: {
  registrationId: string;
  toTeamId: string;
  role: Role;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("team_members")
    .update({ team_id: params.toTeamId, role: params.role })
    .eq("registration_id", params.registrationId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return data;
}

type MemberPosition = Database["public"]["Enums"]["member_position"];

/**
 * メンバーの position（regular/reserve）を更新する。出場⇄リザーブのゾーン移動。
 * 対象 registration の所属行を更新。無ければ null（未割当だった）。
 */
export async function setMemberPosition(params: {
  registrationId: string;
  position: MemberPosition;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("team_members")
    .update({ position: params.position })
    .eq("registration_id", params.registrationId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * メンバーの position / role を任意に更新する（同一チーム内のゾーン・ロール行移動）。
 * 指定された項目だけ更新。対象 registration の所属行を更新。無ければ null。
 */
export async function updateMember(params: {
  registrationId: string;
  position?: MemberPosition;
  role?: Role;
}) {
  const supabase = await createClient();
  const patch: { position?: MemberPosition; role?: Role } = {};
  if (params.position !== undefined) patch.position = params.position;
  if (params.role !== undefined) patch.role = params.role;

  const { data, error } = await supabase
    .from("team_members")
    .update(patch)
    .eq("registration_id", params.registrationId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * 交代シミュレーションの「交代する」実行。
 * レギュラー（out）を reserve に、リザーブ（in）を regular に入れ替える。
 * 2件の UPDATE を順に行い、両方成功で ok。片方でも対象行が無ければ failed を返す
 * （呼び出し側でロールバック判断。RLS 0010 が最終防衛）。
 */
export async function swapMemberPositions(params: {
  outRegistrationId: string; // 現レギュラー → reserve へ
  inRegistrationId: string; // 現リザーブ → regular へ
}): Promise<{ ok: true } | { ok: false }> {
  const out = await setMemberPosition({
    registrationId: params.outRegistrationId,
    position: "reserve",
  });
  if (!out) return { ok: false };

  const inn = await setMemberPosition({
    registrationId: params.inRegistrationId,
    position: "regular",
  });
  if (!inn) {
    // in 側が失敗したら out をロールバック（regular に戻す）。
    await setMemberPosition({
      registrationId: params.outRegistrationId,
      position: "regular",
    });
    return { ok: false };
  }
  return { ok: true };
}

/** メンバーを解除する（チームから外して未割当プールへ戻す）。registration 単位。 */
export async function deleteTeamMember(registrationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("team_members")
    .delete()
    .eq("registration_id", registrationId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * 所有権確認用に、registration とそのイベント（organizer_id）を取得する。
 * 割当系アクションで「その応募が自分のイベントのものか」をアプリ層で確認するため。
 */
export async function findRegistrationEventOwner(registrationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("registrations")
    .select("id, status, event_id, events(id, organizer_id)")
    .eq("id", registrationId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * 所有権・整合性確認用に、team_member とその所属チーム・イベント主催者を取得する。
 * position 系アクション（ゾーン移動・交代）で「自分のイベントか」「同一チームか」を
 * アプリ層で確認するために team_id / event_id / organizer_id をまとめて返す。
 * registration 単位（UNIQUE(registration_id)）。無ければ null。
 */
export async function findMemberWithEventOwner(registrationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("team_members")
    .select(
      "id, position, team_id, teams(id, event_id, events(id, organizer_id))",
    )
    .eq("registration_id", registrationId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * 編成画面用の一括取得。イベントの全チーム＋メンバー（応募者情報・スコア込み）を返す。
 * RLS（0010）で主催者のイベントのみ返る。表示順はチーム作成順。
 */
export async function listTeamsWithMembers(eventId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("teams")
    .select(
      `id, name, status, version, created_at,
       team_members(
         id, role, position, is_representative, registration_id,
         registrations(
           id, preferred_role_1, preferred_role_2, preferred_role_3,
           final_score, organizer_override_score, score_breakdown,
           users(discord_name, battle_tag)
         )
       )`,
    )
    .eq("event_id", eventId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data;
}

/**
 * 未割当プール用。approved な応募のうち、まだどのチームにも属さないものを返す。
 * team_members に存在しない registration を抽出する。
 */
export async function listUnassignedApproved(eventId: string) {
  const supabase = await createClient();

  // 既に割当済みの registration_id を集める（このイベントのチームのメンバー）。
  const { data: teams, error: teamsErr } = await supabase
    .from("teams")
    .select("id")
    .eq("event_id", eventId);
  if (teamsErr) throw teamsErr;

  const teamIds = (teams ?? []).map((t) => t.id);
  let assignedRegIds: string[] = [];
  if (teamIds.length > 0) {
    const { data: members, error: memErr } = await supabase
      .from("team_members")
      .select("registration_id")
      .in("team_id", teamIds);
    if (memErr) throw memErr;
    assignedRegIds = (members ?? []).map((m) => m.registration_id);
  }

  // approved な応募を取得し、割当済みを除外する。
  let query = supabase
    .from("registrations")
    .select(
      `id, preferred_role_1, preferred_role_2, preferred_role_3,
       final_score, organizer_override_score, score_breakdown,
       users(discord_name, battle_tag)`,
    )
    .eq("event_id", eventId)
    .eq("status", "approved")
    .order("final_score", { ascending: false, nullsFirst: false });

  if (assignedRegIds.length > 0) {
    query = query.not("id", "in", `(${assignedRegIds.join(",")})`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}
