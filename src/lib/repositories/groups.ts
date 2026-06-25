import { createClient } from "@/lib/supabase/server";

/**
 * 予選ブロック（groups / group_teams）Repository。DB アクセスを集約する（実装ガイドライン: 層構造）。
 * Supabase クエリビルダのみ（生SQL禁止＝SQLi対策）。
 * 所有権（イベント主催者か）の確認はアクション側で行い、RLS（0013）が最終防衛。
 *
 * 本戦フェーズ PR-1: 承認済みチームをブロックへ D&D 振り分け。対戦生成・結果・順位は後続。
 */

/** ブロックを1件作成する。UNIQUE(event_id, name) 違反は { duplicate: true }。 */
export async function insertGroup(params: {
  eventId: string;
  name: string;
}): Promise<{ ok: true; id: string } | { ok: false; duplicate: true }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("groups")
    .insert({ event_id: params.eventId, name: params.name })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { ok: false, duplicate: true };
    throw error;
  }
  return { ok: true, id: data.id };
}

/** id でブロックを1件取得する（所有権確認用に event_id を返す）。無ければ null。 */
export async function findGroupById(groupId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("groups")
    .select("id, event_id, name")
    .eq("id", groupId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** ブロック名を更新する。UNIQUE(event_id, name) 違反は { duplicate: true }。対象なしは null。 */
export async function renameGroup(params: {
  groupId: string;
  name: string;
}): Promise<
  { ok: true } | { ok: false; duplicate?: true; notFound?: true }
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("groups")
    .update({ name: params.name })
    .eq("id", params.groupId)
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") return { ok: false, duplicate: true };
    throw error;
  }
  if (!data) return { ok: false, notFound: true };
  return { ok: true };
}

/** ブロックを削除する。group_teams は FK の on delete cascade で連動（中身はプールへ戻る）。 */
export async function deleteGroup(groupId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("groups")
    .delete()
    .eq("id", groupId)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return data; // null なら対象なし（RLS で弾かれた・既に削除済み）
}

/**
 * チームをブロックへ割当する（移動モデル）。1チームは1ブロックのみ（同イベント内）。
 * group_teams は PK(group_id, team_id) で、別ブロックへの移動は「全ブロックから消して入れ直す」。
 * ここでは「同イベントの全ブロックから当該チームの所属を消す → 指定ブロックへ insert」を行う。
 */
export async function assignTeamToGroup(params: {
  groupId: string;
  teamId: string;
  eventId: string;
}): Promise<{ ok: true } | { ok: false }> {
  const supabase = await createClient();

  // 同イベントの全ブロック id を集め、当該チームの既存所属を消す（別ブロックからの移動に対応）。
  const { data: groups, error: gErr } = await supabase
    .from("groups")
    .select("id")
    .eq("event_id", params.eventId);
  if (gErr) throw gErr;
  const groupIds = (groups ?? []).map((g) => g.id);
  if (groupIds.length > 0) {
    const { error: delErr } = await supabase
      .from("group_teams")
      .delete()
      .eq("team_id", params.teamId)
      .in("group_id", groupIds);
    if (delErr) throw delErr;
  }

  const { error } = await supabase
    .from("group_teams")
    .insert({ group_id: params.groupId, team_id: params.teamId });
  if (error) {
    // PK 重複（同ブロックへの再投入）は実質成功扱い。
    if (error.code === "23505") return { ok: true };
    return { ok: false };
  }
  return { ok: true };
}

/**
 * チームのブロック割当を解除する（プールへ戻す）。同イベントの全ブロックから当該チームを外す。
 * group_teams は (group_id, team_id) 複合キーのため、team_id ＋ イベントのブロック範囲で削除する。
 */
export async function unassignTeamFromGroup(params: {
  teamId: string;
  eventId: string;
}): Promise<{ ok: true } | { ok: false }> {
  const supabase = await createClient();
  const { data: groups, error: gErr } = await supabase
    .from("groups")
    .select("id")
    .eq("event_id", params.eventId);
  if (gErr) throw gErr;
  const groupIds = (groups ?? []).map((g) => g.id);
  if (groupIds.length === 0) return { ok: true };

  const { error } = await supabase
    .from("group_teams")
    .delete()
    .eq("team_id", params.teamId)
    .in("group_id", groupIds);
  if (error) throw error;
  return { ok: true };
}

/**
 * ブロック分け画面用の一括取得。イベントの全ブロック＋所属チーム（名前・スコア源のメンバー）を返す。
 * RLS（0013）で主催者 or 参加者のイベントのみ返る。表示順はブロック名。
 */
export async function listGroupsWithTeams(eventId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("groups")
    .select(
      `id, name,
       group_teams(
         team_id,
         teams(
           id, name, status,
           team_members(
             position,
             registrations(final_score, organizer_override_score)
           )
         )
       )`,
    )
    .eq("event_id", eventId)
    .order("name", { ascending: true });

  if (error) throw error;
  return data;
}

/** 指定ブロックに割り当て済みのチーム id 一覧を返す（総当たり生成の入力）。 */
export async function listGroupTeamIds(groupId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("group_teams")
    .select("team_id")
    .eq("group_id", groupId);
  if (error) throw error;
  return (data ?? []).map((r) => r.team_id);
}

/**
 * 自動ブロック分け（PR-4）用。イベントの全 approved チームを、スコア源のメンバーごと返す。
 * 割当状態は問わない（既存ブロックを全削除してゼロから組み直すため）。表示順はチーム名。
 */
export async function listApprovedTeamsForDraft(eventId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("teams")
    .select(
      `id, name, status,
       team_members(
         position,
         registrations(final_score, organizer_override_score)
       )`,
    )
    .eq("event_id", eventId)
    .eq("status", "approved")
    .order("name", { ascending: true });

  if (error) throw error;
  return data;
}

/**
 * 自動ブロック分け（PR-4）の一括適用。イベントの既存ブロックを全削除し、
 * 渡されたブロック群（名前＋所属 team_id 配列）を新規作成して一括割当する。
 *
 * group_teams は groups の FK on delete cascade で連動して消えるため、
 * 既存割当も groups 削除で一掃される。所有権確認は呼び出し側＋RLS（0013）が担保。
 * 名前は呼び出し側で A,B,C... を採番済み（このイベント内で一意）。
 */
export async function replaceGroupsWithAssignments(params: {
  eventId: string;
  blocks: { name: string; teamIds: string[] }[];
}): Promise<{ ok: true } | { ok: false }> {
  const supabase = await createClient();

  // 1) 既存ブロックを全削除（group_teams は cascade で連動削除）。
  const { error: delErr } = await supabase
    .from("groups")
    .delete()
    .eq("event_id", params.eventId);
  if (delErr) throw delErr;

  if (params.blocks.length === 0) return { ok: true };

  // 2) ブロックを一括作成し、作成後の id を名前で引けるようにする。
  const { data: created, error: insErr } = await supabase
    .from("groups")
    .insert(params.blocks.map((b) => ({ event_id: params.eventId, name: b.name })))
    .select("id, name");
  if (insErr) throw insErr;

  const idByName = new Map<string, string>(
    (created ?? []).map((g) => [g.name, g.id]),
  );

  // 3) 各ブロックの所属を group_teams へ一括 insert。
  const rows = params.blocks.flatMap((b) => {
    const groupId = idByName.get(b.name);
    if (!groupId) return [];
    return b.teamIds.map((teamId) => ({ group_id: groupId, team_id: teamId }));
  });
  if (rows.length > 0) {
    const { error: gtErr } = await supabase.from("group_teams").insert(rows);
    if (gtErr) throw gtErr;
  }

  return { ok: true };
}

/**
 * 未割当プール用。approved なチームのうち、まだどのブロックにも属さないものを返す。
 * group_teams（このイベントのブロック）に存在しない team を抽出する。
 */
export async function listUnassignedApprovedTeams(eventId: string) {
  const supabase = await createClient();

  // このイベントの全ブロックの割当済み team_id を集める。
  const { data: groups, error: gErr } = await supabase
    .from("groups")
    .select("id")
    .eq("event_id", eventId);
  if (gErr) throw gErr;
  const groupIds = (groups ?? []).map((g) => g.id);

  let assignedTeamIds: string[] = [];
  if (groupIds.length > 0) {
    const { data: gt, error: gtErr } = await supabase
      .from("group_teams")
      .select("team_id")
      .in("group_id", groupIds);
    if (gtErr) throw gtErr;
    assignedTeamIds = (gt ?? []).map((r) => r.team_id);
  }

  // approved なチームを取得し、割当済みを除外する。
  let query = supabase
    .from("teams")
    .select(
      `id, name, status,
       team_members(
         position,
         registrations(final_score, organizer_override_score)
       )`,
    )
    .eq("event_id", eventId)
    .eq("status", "approved")
    .order("name", { ascending: true });

  if (assignedTeamIds.length > 0) {
    query = query.not("id", "in", `(${assignedTeamIds.join(",")})`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}
