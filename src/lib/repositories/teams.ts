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

/** 指定 registration がそのチームの所属メンバーかを返す（代表指名の事前検証用）。 */
export async function isTeamMember(params: {
  teamId: string;
  registrationId: string;
}): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("team_members")
    .select("id")
    .eq("team_id", params.teamId)
    .eq("registration_id", params.registrationId)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

/**
 * チームの代表（captain）を指名/変更する（主催者編成チームに代表を後付けする・実機FB）。
 * teams.captain_registration_id を更新（楽観ロック）し、team_members.is_representative を
 * 「指名された1人だけ true、同チームの他は false」に揃える。
 *
 * registrationId は呼び出し側で「そのチームの所属メンバーであること」を検証済みの前提。
 * 競合（版ずれ・横取り）なら conflict。
 */
export async function setTeamCaptain(params: {
  teamId: string;
  registrationId: string;
  expectedVersion: number;
}): Promise<{ ok: true } | { ok: false; conflict?: true }> {
  const supabase = await createClient();

  // 代表を立てる（楽観ロック）。条件に合致しなければ null＝競合。
  const { data, error } = await supabase
    .from("teams")
    .update({
      captain_registration_id: params.registrationId,
      version: params.expectedVersion + 1,
    })
    .eq("id", params.teamId)
    .eq("version", params.expectedVersion)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  if (!data) return { ok: false, conflict: true };

  // is_representative を同チーム内で1人だけ true に揃える。
  // まず全員 false にし、指名者だけ true に（2クエリ。RLS 0010 が主催者を担保）。
  const { error: clearErr } = await supabase
    .from("team_members")
    .update({ is_representative: false })
    .eq("team_id", params.teamId);
  if (clearErr) throw clearErr;

  const { error: setErr } = await supabase
    .from("team_members")
    .update({ is_representative: true })
    .eq("team_id", params.teamId)
    .eq("registration_id", params.registrationId);
  if (setErr) throw setErr;

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

type MemberDraft = {
  registrationId: string;
  role: Role;
  position: MemberPosition;
};

/**
 * self 応募の「確定」（PR-3b）。試算チームを teams(status='pending') ＋ team_members として
 * 一括登録する。代表（captain）は確定者本人の registration。
 *
 * Supabase JS は明示トランザクションを張れないため、teams を作ってから members を入れ、
 * members で失敗したら作った team を補償的に削除する（孤児チームを残さない）。
 * RLS（0012）が最終防衛: self 確定の資格・pending・approved メンバーを DB 層でも担保。
 *
 * 失敗の種別:
 * - duplicateName: 同名チームが既存（UNIQUE(event_id, name)）。
 * - memberConflict: メンバーの誰かが既に別チーム所属（UNIQUE(registration_id)）。
 * - denied: RLS で弾かれた（資格なし・未承認など）。
 */
export async function insertSelfTeamWithMembers(params: {
  eventId: string;
  name: string;
  captainRegistrationId: string;
  members: MemberDraft[];
}): Promise<
  | { ok: true; teamId: string }
  | { ok: false; duplicateName?: true; memberConflict?: true; denied?: true }
> {
  const supabase = await createClient();

  const { data: team, error: teamErr } = await supabase
    .from("teams")
    .insert({
      event_id: params.eventId,
      name: params.name,
      status: "pending",
      captain_registration_id: params.captainRegistrationId,
    })
    .select("id")
    .single();

  if (teamErr) {
    if (teamErr.code === "23505") return { ok: false, duplicateName: true };
    // RLS 拒否は data なし＝ここでは error（権限なし）に出る。
    return { ok: false, denied: true };
  }

  const rows = params.members.map((m) => ({
    team_id: team.id,
    registration_id: m.registrationId,
    role: m.role,
    position: m.position,
    // 代表は is_representative を立てる（captain の registration と一致するメンバー）。
    is_representative: m.registrationId === params.captainRegistrationId,
  }));

  const { error: memErr } = await supabase.from("team_members").insert(rows);

  if (memErr) {
    // 補償削除（作った team を消す）。pending かつ自分が captain なので RLS で消せる。
    await supabase.from("teams").delete().eq("id", team.id);
    if (memErr.code === "23505") return { ok: false, memberConflict: true };
    return { ok: false, denied: true };
  }

  return { ok: true, teamId: team.id };
}

/**
 * self 確定チームの取り下げ（pending のみ）。代表本人が叩く。
 * team_members は FK の on delete cascade で連動削除。RLS（0012）が pending/captain を担保。
 * 削除できたら data（id）が返る。null なら対象なし（既に承認/却下・権限なし）。
 */
export async function deleteSelfTeam(teamId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("teams")
    .delete()
    .eq("id", teamId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * 主催者によるチーム承認/却下（PR-3b）。status を pending → approved/rejected へ。
 * 楽観ロック（version 一致時のみ）。承認時の current_count 排他カウントは
 * approveEventCapacity と組み合わせて Server Action 側で行う。
 * 競合（版ずれ・既に処理済み）なら null。
 */
export async function setTeamStatus(params: {
  teamId: string;
  status: "approved" | "rejected";
  expectedVersion: number;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("teams")
    .update({ status: params.status, version: params.expectedVersion + 1 })
    .eq("id", params.teamId)
    .eq("status", "pending")
    .eq("version", params.expectedVersion)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return data; // null なら競合（既に処理済み・版ずれ）
}

/**
 * capacity（=チーム数）の排他カウント（DB設計 5章）。events の version 条件付き UPDATE。
 * 満員（current_count >= capacity）または競合（版ずれ）なら更新行なし＝null。
 * events の UPDATE は 0004 の主催者ポリシーで担保（承認は主催者が叩く）。
 */
export async function incrementEventCount(params: {
  eventId: string;
  expectedVersion: number;
}): Promise<{ ok: true } | { ok: false }> {
  const supabase = await createClient();
  // 現在値を読みつつ、capacity 未満なら +1。capacity IS NULL（無制限）は常に許可。
  const { data: ev, error: readErr } = await supabase
    .from("events")
    .select("capacity, current_count, version")
    .eq("id", params.eventId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!ev || ev.version !== params.expectedVersion) return { ok: false };
  if (ev.capacity !== null && ev.current_count >= ev.capacity) {
    return { ok: false };
  }

  const { data, error } = await supabase
    .from("events")
    .update({
      current_count: ev.current_count + 1,
      version: ev.version + 1,
    })
    .eq("id", params.eventId)
    .eq("version", params.expectedVersion)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return data ? { ok: true } : { ok: false };
}

/**
 * 指定 registration が代表（captain）であるチームの id 一覧を返す（同イベント内）。
 * 結果入力の権限（自チームが絡む試合か）を画面で出し分けるために使う。
 */
export async function listCaptainTeamIds(params: {
  eventId: string;
  registrationId: string;
}): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("teams")
    .select("id")
    .eq("event_id", params.eventId)
    .eq("captain_registration_id", params.registrationId);
  if (error) throw error;
  return (data ?? []).map((t) => t.id);
}

/** id でイベントの capacity/current_count/version を取得する（承認時の排他判定用）。 */
export async function findEventCapacity(eventId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .select("id, organizer_id, capacity, current_count, version")
    .eq("id", eventId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** 承認画面用に、status を含むチーム（id/name/status/version/event_id）を取得する。 */
export async function findTeamWithStatus(teamId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("teams")
    .select("id, event_id, name, status, version, captain_registration_id")
    .eq("id", teamId)
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
      `id, name, status, version, created_at, captain_registration_id,
       team_members(
         id, role, position, is_representative, registration_id,
         registrations(
           id, display_name, preferred_role_1, preferred_role_2, preferred_role_3,
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
      `id, display_name, preferred_role_1, preferred_role_2, preferred_role_3,
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
