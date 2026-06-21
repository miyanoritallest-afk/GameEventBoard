"use client";

import { useActionState, useState } from "react";
import { registerWithScore, type ScoredRegisterState } from "../../actions";
import { buildOverwatchRankDefinitions } from "@/lib/services/overwatch-ranks";

const ROLE_LABEL: Record<string, string> = {
  tank: "タンク",
  dps: "DPS",
  support: "サポート",
};

/** 帯ごとにグループ化したランク選択肢（optgroup 用）。 */
function rankOptionGroups() {
  const defs = buildOverwatchRankDefinitions();
  const byTier = new Map<string, { label: string; score: number }[]>();
  for (const d of defs) {
    const arr = byTier.get(d.tier) ?? [];
    arr.push({ label: d.label, score: d.score });
    byTier.set(d.tier, arr);
  }
  // 高い帯から表示（score 降順）。
  return [...byTier.entries()]
    .map(([tier, items]) => ({
      tier,
      items: items.sort((a, b) => b.score - a.score),
      maxScore: Math.max(...items.map((i) => i.score)),
    }))
    .sort((a, b) => b.maxScore - a.maxScore);
}

/** 1セルのランク選択（40段階＋未認定）。 */
function RankCell({ name }: { name: string }) {
  const groups = rankOptionGroups();
  return (
    <select
      name={name}
      defaultValue="uncertified"
      className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
    >
      <option value="uncertified">未認定</option>
      {groups.map((g) => (
        <optgroup key={g.tier} label={g.tier}>
          {g.items.map((it) => (
            <option key={it.label} value={it.score}>
              {it.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/** 1ロール分のシーズングリッド（declared_seasons 列）。 */
function RoleRow({
  role,
  seasons,
}: {
  role: string;
  seasons: number;
}) {
  return (
    <div>
      <p className="mb-1 text-sm font-medium">{ROLE_LABEL[role] ?? role}</p>
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: seasons }, (_, s) => (
          <div key={s}>
            <span className="mb-0.5 block text-xs text-muted-foreground">
              シーズン{s + 1}
            </span>
            <RankCell name={`rank_${role}_${s}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ApplyForm({
  eventId,
  roleSwapAllowed,
  declaredSeasons,
  useBonus,
}: {
  eventId: string;
  roleSwapAllowed: boolean;
  declaredSeasons: number;
  useBonus: boolean;
}) {
  const action = registerWithScore.bind(null, eventId);
  const [state, formAction, pending] = useActionState<
    ScoredRegisterState,
    FormData
  >(action, {});
  const fe = state.fieldErrors ?? {};

  // 希望ロール。role_swap=false ではこのロールのグリッドのみ表示する。
  const [preferredRole, setPreferredRole] = useState("tank");
  const gridRoles = roleSwapAllowed
    ? ["tank", "dps", "support"]
    : [preferredRole];

  return (
    <form action={formAction} className="mt-6 space-y-6">
      {state.error && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      {/* 希望ロール */}
      <div>
        <label className="mb-1 block text-sm font-medium">
          希望ロール<span className="ml-1 text-destructive">*</span>
        </label>
        <select
          name="preferredRole"
          value={preferredRole}
          onChange={(e) => setPreferredRole(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="tank">タンク</option>
          <option value="dps">DPS</option>
          <option value="support">サポート</option>
        </select>
        {fe.preferredRole && (
          <p className="mt-1 text-xs text-destructive">{fe.preferredRole}</p>
        )}
      </div>

      {/* ランクグリッド */}
      <fieldset className="rounded-xl border border-border bg-card p-4">
        <legend className="px-1 text-sm font-semibold">
          ランク申告（直近{declaredSeasons}シーズン）
        </legend>
        <p className="mt-1 mb-3 text-xs text-muted-foreground">
          {roleSwapAllowed
            ? "全ロールのランクを申告します（未認定のロールは「未認定」を選択）。"
            : "希望ロールのランクを申告します（未認定なら「未認定」を選択）。"}
        </p>
        <div className="space-y-4">
          {gridRoles.map((role) => (
            <RoleRow key={role} role={role} seasons={declaredSeasons} />
          ))}
        </div>
      </fieldset>

      {/* 到達ボーナス（イベントで有効なときのみ） */}
      {useBonus && (
        <div>
          <label className="mb-1 block text-sm font-medium">
            最高到達ランク（到達ボーナス）
          </label>
          <select
            name="peak"
            defaultValue="none"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="none">なし</option>
            <option value="master">マスター到達</option>
            <option value="gm">グランドマスター到達</option>
            <option value="champion">チャンピオン到達</option>
          </select>
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? "応募中..." : "この内容で応募する"}
      </button>
    </form>
  );
}
