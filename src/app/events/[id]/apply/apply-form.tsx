"use client";

import { useActionState, useState } from "react";
import { registerWithScore, type ScoredRegisterState } from "../../actions";
import { buildOverwatchRankDefinitions } from "@/lib/services/overwatch-ranks";
import { deriveThirdRole, type Role } from "@/lib/services/scored-application";
import { FormCard, FormField } from "@/components/matchpoint/form-card";

const ROLE_LABEL: Record<string, string> = {
  tank: "タンク",
  dps: "DPS",
  support: "サポート",
};

/** ロール識別色トークン（globals.css の --mp-tank/dps/support）。 */
const ROLE_COLOR: Record<string, string> = {
  tank: "var(--mp-tank)",
  dps: "var(--mp-dps)",
  support: "var(--mp-support)",
};

/** ロールの英字タグ（見出し右の小ラベル）。 */
const ROLE_TAG: Record<string, string> = {
  tank: "Tank",
  dps: "Damage",
  support: "Support",
};

/** シーズン列の見出し（新しい順）。範囲外は「Nつ前」でフォールバック。 */
const SEASON_LABELS = ["最新シーズン", "1つ前", "2つ前", "3つ前", "4つ前", "5つ前"];
function seasonLabel(index: number): string {
  return SEASON_LABELS[index] ?? `${index}つ前`;
}

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

/** 1セルのランク選択（45段階＋未認定）。 */
function RankCell({ name }: { name: string }) {
  const groups = rankOptionGroups();
  return (
    <select name={name} defaultValue="uncertified">
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

/** 1ロール分のランク申告カード（ロール色見出し＋シーズン列グリッド）。 */
function RankRole({ role, seasons }: { role: string; seasons: number }) {
  return (
    <div className="rounded-xl border border-border bg-[color:var(--mp-surface-2)] p-4">
      <div className="mb-[14px] flex items-center gap-[9px]">
        <span
          aria-hidden
          className="size-[11px] flex-none rounded-full"
          style={{
            background: ROLE_COLOR[role],
            boxShadow: `0 0 10px color-mix(in oklab, ${ROLE_COLOR[role]} 55%, transparent)`,
          }}
        />
        <span className="text-[13.5px] font-bold text-foreground">
          {ROLE_LABEL[role] ?? role}
        </span>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.1em] text-[color:var(--mp-fg-subtle)]">
          {ROLE_TAG[role] ?? role}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: seasons }, (_, s) => (
          <label key={s} className="block">
            <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-[color:var(--mp-fg-muted)]">
              {seasonLabel(s)}
              <span className="font-mono text-[10px] text-[color:var(--mp-fg-subtle)]">
                S-{s}
              </span>
            </span>
            <RankCell name={`rank_${role}_${s}`} />
          </label>
        ))}
      </div>
    </div>
  );
}

export function ApplyForm({
  eventId,
  defaultDisplayName,
  defaultBattleTag,
  roleSwapAllowed,
  declaredSeasons,
  useBonus,
}: {
  eventId: string;
  defaultDisplayName: string;
  defaultBattleTag: string;
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

  // 希望ロール（第1・第2）。第3は自動決定。
  const [role1, setRole1] = useState<Role>("tank");
  const [role2, setRole2] = useState<Role>("dps");
  const role3 = deriveThirdRole(role1, role2);
  const role2Conflict = role1 === role2;

  // role_swap=false では第1希望ロールのグリッドのみ表示する。
  const gridRoles = roleSwapAllowed ? ["tank", "dps", "support"] : [role1];
  const ROLE_OPTIONS: Role[] = ["tank", "dps", "support"];

  return (
    <form action={formAction} className="mp-form mt-8 flex flex-col gap-5">
      {state.error && (
        <p className="rounded-xl border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {state.error}
        </p>
      )}

      {/* ══════ 01 プロフィール（登録名＋バトルタグ） ══════ */}
      <FormCard n="01" title="プロフィール">
        <FormField
          label="登録名"
          required
          opt="参加者として表示される名前"
          error={fe.displayName}
          hint="対戦表やチーム編成に表示されます。既定は Discord 名です。必要なら書き換えてください。"
        >
          <input
            type="text"
            name="displayName"
            defaultValue={defaultDisplayName}
            maxLength={32}
          />
        </FormField>

        <FormField
          label="バトルタグ"
          required
          error={fe.battleTag}
          hint="ゲーム内で対戦相手と合流するために使います。マイページに保存され、次回以降は自動で入力されます。"
        >
          <input
            type="text"
            name="battleTag"
            defaultValue={defaultBattleTag}
            maxLength={32}
            placeholder="例: Player#12345"
          />
        </FormField>
      </FormCard>

      {/* ══════ 02 希望ロール（第1・第2を選択、第3は自動） ══════ */}
      <FormCard n="02" title="希望ロール" sub="第3希望は自動">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="第1希望" required>
            <select
              name="preferredRole1"
              value={role1}
              onChange={(e) => setRole1(e.target.value as Role)}
              className={role2Conflict ? "mp-invalid" : undefined}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="第2希望" required>
            <select
              name="preferredRole2"
              value={role2}
              onChange={(e) => setRole2(e.target.value as Role)}
              className={role2Conflict ? "mp-invalid" : undefined}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        {role2Conflict && (
          <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-destructive">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v5M12 16h.01" />
            </svg>
            第1希望と第2希望は別のロールを選んでください。
          </p>
        )}
        {/* サーバー側の希望ロール検証エラー（第1〜第3をまとめて代表表示）。 */}
        {fe.preferredRole1 && (
          <p className="mt-2 text-[11.5px] text-destructive">
            {fe.preferredRole1}
          </p>
        )}

        {/* 第3希望（自動決定・readOnly 表示）。値は hidden で送信。 */}
        <div className="mt-[18px]">
          <label className="mb-[7px] block text-[13px] font-semibold text-[color:var(--mp-fg-muted)]">
            第3希望
            <span className="ml-1.5 text-[11.5px] font-normal text-[color:var(--mp-fg-subtle)]">
              残りのロールを自動で設定
            </span>
          </label>
          <div className="flex w-full items-center gap-2.5 rounded-md border border-dashed border-[color:var(--mp-border-strong)] bg-[color:var(--mp-surface-2)] px-3 py-[9px] text-[13.5px] text-foreground">
            <span aria-hidden className="flex flex-none text-[color:var(--mp-fg-subtle)]">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.9}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
            </span>
            <span
              aria-hidden
              className="size-[9px] flex-none rounded-full"
              style={
                role3
                  ? {
                      background: ROLE_COLOR[role3],
                      boxShadow: `0 0 8px color-mix(in oklab, ${ROLE_COLOR[role3]} 60%, transparent)`,
                    }
                  : { background: "var(--mp-fg-subtle)" }
              }
            />
            <span>{role3 ? ROLE_LABEL[role3] : "—"}</span>
            <span className="ml-auto rounded-full border border-border bg-[color:var(--mp-surface-3)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--mp-fg-subtle)]">
              自動 ・ 編集不可
            </span>
          </div>
          <p className="mt-[7px] text-[11.5px] leading-relaxed text-[color:var(--mp-fg-muted)]">
            第1・第2で選ばなかったロールが確定します。
          </p>
        </div>
        {/* 第3希望は hidden で送信（自動決定値）。 */}
        <input type="hidden" name="preferredRole3" value={role3 ?? ""} />
      </FormCard>

      {/* ══════ 03 ランク申告（＋到達ボーナス） ══════ */}
      <FormCard
        n="03"
        title="ランク申告"
        sub={`直近${declaredSeasons}シーズン`}
      >
        <p className="-mt-1 mb-4 text-[11.5px] leading-relaxed text-[color:var(--mp-fg-muted)]">
          {roleSwapAllowed
            ? "全ロールのランクを申告します（未認定のロールは「未認定」を選択）。"
            : "希望ロールのランクを申告します（未認定なら「未認定」を選択）。"}
        </p>

        <div className="flex flex-col gap-[14px]">
          {gridRoles.map((role) => (
            <RankRole key={role} role={role} seasons={declaredSeasons} />
          ))}
        </div>

        <p className="mt-[14px] text-[11.5px] leading-relaxed text-[color:var(--mp-fg-muted)]">
          最新シーズンから順に、各シーズンの最高ランクを選んでください。プレイしていないシーズンは「未認定」のままで構いません。
        </p>

        {/* 到達ボーナス（イベントで有効なときのみ・カード末尾に同居）。 */}
        {useBonus && (
          <div className="mt-[18px] border-t border-border pt-[18px]">
            <div className="max-w-[280px]">
              <FormField label="最高到達ランク" opt="到達ボーナス・任意">
                <select name="peak" defaultValue="none">
                  <option value="none">なし</option>
                  <option value="master">マスター到達</option>
                  <option value="gm">グランドマスター到達</option>
                  <option value="champion">チャンピオン到達</option>
                </select>
                <p className="mt-[7px] text-[11.5px] leading-relaxed text-[color:var(--mp-fg-muted)]">
                  これまでの最高到達ランクに応じてスコアに加点されます。
                </p>
              </FormField>
            </div>
          </div>
        )}
      </FormCard>

      <div className="mt-1">
        <button
          type="submit"
          disabled={pending || role2Conflict}
          className="w-full rounded-lg bg-primary px-4 py-3.5 text-sm font-bold text-primary-foreground shadow-[0_0_0_1px_rgba(255,106,43,0.35),0_8px_22px_rgba(255,106,43,0.22)] transition hover:bg-[color:var(--mp-brand-hover)] active:translate-y-px disabled:cursor-not-allowed disabled:bg-[color:var(--mp-surface-3)] disabled:text-[color:var(--mp-fg-subtle)] disabled:shadow-[0_0_0_1px_var(--mp-border)]"
        >
          {pending ? "応募中..." : "この内容で応募する"}
        </button>
        <p
          className={`mt-3 text-center text-[11.5px] ${
            role2Conflict
              ? "text-destructive"
              : "text-[color:var(--mp-fg-subtle)]"
          }`}
        >
          {role2Conflict
            ? "希望ロールの重複を解消すると応募できます。"
            : "応募すると主催者の承認待ちになります。"}
        </p>
      </div>
    </form>
  );
}

