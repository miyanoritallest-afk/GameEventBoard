"use client";

import { useActionState, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { DateTimePicker } from "@/components/datetime-picker";
import { FormCard, FormField } from "@/components/matchpoint/form-card";
import { scoreToRankAbbrev } from "@/lib/services/overwatch-ranks";
import {
  hasGroupStage,
  hasTournamentStage,
  type EventFormat,
} from "@/lib/services/event-format";

type GameOption = { id: string; name: string };

/** 未認定補完方式の選択肢（表示ラベル付き）。 */
const UNCERTIFIED_OPTIONS = [
  { value: "exclude", label: "計算に含めない（除外）" },
  { value: "fill_by_season", label: "同ロールの他シーズン平均で補完" },
  { value: "fill_by_role", label: "同シーズンの他ロール平均で補完" },
] as const;

/** 作成・編集で共有するフォーム状態（Server Action の戻り値）。 */
export type EventFormState = {
  error?: string;
  fieldErrors?: Record<string, string>;
};

/** フォームの初期値。編集時は保存済みイベントから埋める。作成時は未指定。 */
export type EventFormDefaults = {
  title?: string;
  gameId?: string;
  /** 主催者の登録名（イベント詳細の「主催」に出す）。未設定なら fallback を初期表示。 */
  organizerDisplayName?: string;
  description?: string;
  startsAt?: string; // "YYYY-MM-DDTHH:mm"（JST ローカル）
  endsAt?: string;
  recruitDeadline?: string;
  capacity?: string;
  /** イベント形式（総当たりのみ / トーナメントのみ / 総当たり→決勝T）。既定は両方。 */
  format?: "round_robin" | "tournament" | "round_robin_then_tournament";
  requireScore?: boolean;
  uncertifiedHandling?: "fill_by_role" | "fill_by_season" | "exclude";
  roleSwapAllowed?: boolean;
  declaredSeasons?: number;
  bonusMaster?: number;
  bonusGm?: number;
  bonusChampion?: number;
  /** チームスコア上限（メンバー final_score 平均の上限）。null/未設定＝上限なし。 */
  teamScoreCap?: number;
  /** Discord 全体告知の投稿先 Webhook URL（④）。未設定＝投稿しない。 */
  discordWebhookUrl?: string;
  rankingEnabled?: boolean;
  pointsWin?: number;
  pointsDraw?: number;
  pointsLoss?: number;
  /** タイブレーク優先順位（使う基準を優先順に。先頭ほど優先）。 */
  tiebreakers?: TiebreakerKey[];
  /** 予選BO（総当たり1試合のマップ数。生成時に全試合へ一括セット）。 */
  groupBestOf?: number;
  /** 決勝トーナメントで3位決定戦を行うか（本戦-5c）。 */
  tournamentThirdPlace?: boolean;
};

/** タイブレーク基準（優先順位を D&D で並べ替え）。 */
export type TiebreakerKey = "head_to_head" | "map_diff" | "potg";

const TIEBREAKER_LABEL: Record<TiebreakerKey, string> = {
  head_to_head: "直接対決",
  map_diff: "得失マップ差",
  potg: "POTG取得数",
};

const ALL_TIEBREAKERS: TiebreakerKey[] = ["head_to_head", "map_diff", "potg"];

type EventFormAction = (
  prev: EventFormState,
  formData: FormData,
) => Promise<EventFormState>;

/**
 * イベント作成/編集の共通フォーム。
 * - action: 作成 or 編集の Server Action（同じ State 形）。
 * - defaultValues: 編集時の初期値（作成時は空）。
 * - submitLabel / pendingLabel: ボタン表記。
 *
 * 日時は DateTimePicker（datetime-local 互換の hidden 値）を使う。
 *
 * デザイン: 刷新済み（.theme-matchpoint）に合わせ、各設定群を番号付きカードに分割。
 * 入力要素の見た目は globals.css の `.mp-form` スコープで整える（ルートに付与）。
 */
export function EventForm({
  games,
  action,
  defaultValues = {},
  discordName = "",
  seriesId,
  submitLabel,
  pendingLabel,
}: {
  games: GameOption[];
  action: EventFormAction;
  defaultValues?: EventFormDefaults;
  /** 登録名欄の初期値フォールバック（認証時の Discord 名）。作成時に既定で入れる。 */
  discordName?: string;
  /** シリーズの新しい開催回を作るとき、紐付けるシリーズ id（hidden で送る）。 */
  seriesId?: string;
  submitLabel: string;
  pendingLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const fe = state.fieldErrors ?? {};
  const d = defaultValues;

  // 階層導線の表示制御。
  // 親: 個人スコアを計算するか（OFF なら配下を隠す＝スコアなしイベント）。
  const [requireScore, setRequireScore] = useState(d.requireScore ?? true);
  // 子: 到達ボーナスを使うか（既定値が1つでも >0 なら ON とみなす）。
  const [useBonus, setUseBonus] = useState(
    (d.bonusMaster ?? 0) > 0 ||
      (d.bonusGm ?? 0) > 0 ||
      (d.bonusChampion ?? 0) > 0,
  );
  // 子: チームスコアに上限を設けるか（cap が設定済みなら ON＝復元）。既定は上限なし。
  const [useScoreCap, setUseScoreCap] = useState(d.teamScoreCap != null);
  // ランク換算ガイド（例 "23 (D3)"）の表示用に入力値を state で持つ。
  const [scoreCap, setScoreCap] = useState<number | "">(d.teamScoreCap ?? "");
  // 親トグル: 順位機能を使うか（OFF なら勝点・タイブレークを隠す）。
  const [rankingEnabled, setRankingEnabled] = useState(
    d.rankingEnabled ?? false,
  );
  // イベント形式。形式に応じて本戦設定（総当たりBO・3位決定戦）を出し分ける（PR-2）。
  const [format, setFormat] = useState<EventFormat>(
    d.format ?? "round_robin_then_tournament",
  );
  const showGroupConfig = hasGroupStage(format); // 総当たりBO は予選を持つ形式のみ
  const showTournamentConfig = hasTournamentStage(format); // 3位決定戦は決勝Tを持つ形式のみ

  return (
    <form action={formAction} className="mp-form mt-8 flex flex-col gap-5">
      {/* シリーズの新しい開催回として作成するとき、紐付け先を hidden で送る。 */}
      {seriesId && <input type="hidden" name="series_id" value={seriesId} />}
      {state.error && (
        <p className="rounded-xl border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {state.error}
        </p>
      )}

      {/* ══════ 01 基本情報 ══════ */}
      <FormCard n="01" title="基本情報">
        {/* 登録名（主催者としての公開表示名。既定は Discord 名） */}
        <FormField
          label="登録名"
          opt="主催者として表示される名前"
          error={fe.organizerDisplayName}
          hint="イベント詳細の「主催」に表示されます。既定は Discord 名です。"
        >
          <input
            name="organizerDisplayName"
            type="text"
            maxLength={32}
            defaultValue={d.organizerDisplayName ?? discordName}
          />
        </FormField>

        <FormField label="タイトル" required error={fe.title}>
          <input
            name="title"
            type="text"
            maxLength={80}
            defaultValue={d.title ?? ""}
            placeholder="第1回 Matchpoint Open"
          />
        </FormField>

        <FormField label="ゲーム" required error={fe.gameId}>
          <select name="gameId" defaultValue={d.gameId ?? games[0]?.id ?? ""}>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="説明" opt="任意" error={fe.description}>
          <textarea
            name="description"
            rows={4}
            maxLength={2000}
            defaultValue={d.description ?? ""}
            placeholder="大会の概要・参加条件・合流方法などを記載します。"
          />
        </FormField>

        {/* 開催期間 */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="開催開始" opt="JST" required error={fe.startsAt}>
            <DateTimePicker name="startsAt" defaultValue={d.startsAt ?? ""} />
          </FormField>
          <FormField label="開催終了" opt="JST" required error={fe.endsAt}>
            <DateTimePicker name="endsAt" defaultValue={d.endsAt ?? ""} />
          </FormField>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="募集締切" opt="任意・JST" error={fe.recruitDeadline}>
            <DateTimePicker
              name="recruitDeadline"
              defaultValue={d.recruitDeadline ?? ""}
            />
          </FormField>
          <FormField label="定員" opt="チーム数・任意" error={fe.capacity}>
            <input
              name="capacity"
              type="number"
              min={1}
              defaultValue={d.capacity ?? ""}
              placeholder="16"
            />
          </FormField>
        </div>
      </FormCard>

      {/* ══════ 02 スコアリング設定 ══════ */}
      <FormCard n="02" title="スコアリング設定">
        {/* 親トグル: 個人スコアを計算するか。OFF なら配下を隠す（スコアなしイベント）。 */}
        <Toggle
          name="requireScore"
          checked={requireScore}
          onChange={setRequireScore}
          title="個人スコアを計算する"
          desc="ランク申告から各メンバーのスコアを算出します。"
        />

        {requireScore && (
          <Nest>
            <Toggle
              name="roleSwapAllowed"
              defaultChecked={d.roleSwapAllowed ?? false}
              title="ロールスワップを許可する"
              desc="全ロールのランクを参照して算出します。"
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="申告シーズン数" error={fe.declaredSeasons}>
                <input
                  name="declaredSeasons"
                  type="number"
                  min={1}
                  max={10}
                  defaultValue={d.declaredSeasons ?? 3}
                />
              </FormField>
              <FormField label="未認定ロールの扱い" error={fe.uncertifiedHandling}>
                <select
                  name="uncertifiedHandling"
                  defaultValue={d.uncertifiedHandling ?? "exclude"}
                >
                  {UNCERTIFIED_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>

            {/* 孫トグル: 到達ボーナスを使うか。ON のときだけ加点欄を表示。 */}
            <Toggle
              checked={useBonus}
              onChange={setUseBonus}
              title="到達ボーナスを使う"
              desc="最高到達ランクに応じて加点します。"
            />

            {useBonus && (
              <div className="grid grid-cols-3 gap-4">
                <FormField label="マスター" error={fe.bonusMaster}>
                  <input
                    name="bonusMaster"
                    type="number"
                    min={0}
                    max={10}
                    step="0.5"
                    defaultValue={d.bonusMaster ?? 0}
                  />
                </FormField>
                <FormField label="GM" error={fe.bonusGm}>
                  <input
                    name="bonusGm"
                    type="number"
                    min={0}
                    max={10}
                    step="0.5"
                    defaultValue={d.bonusGm ?? 0}
                  />
                </FormField>
                <FormField label="チャンピオン" error={fe.bonusChampion}>
                  <input
                    name="bonusChampion"
                    type="number"
                    min={0}
                    max={10}
                    step="0.5"
                    defaultValue={d.bonusChampion ?? 0}
                  />
                </FormField>
              </div>
            )}

            {/* 孫トグル: チームスコア上限を設けるか（B-1）。OFF＝上限なし。 */}
            <Toggle
              checked={useScoreCap}
              onChange={setUseScoreCap}
              title="チームスコアに上限を設ける"
              desc="出場メンバーの平均スコアの上限です。"
            />

            {/* OFF のときは空文字を送って null 保存（上限なし）にする。 */}
            {!useScoreCap && (
              <input type="hidden" name="teamScoreCap" value="" />
            )}

            {useScoreCap ? (
              <FormField label="チームスコア上限" error={fe.teamScoreCap}>
                <input
                  name="teamScoreCap"
                  type="number"
                  min={1}
                  max={40}
                  value={scoreCap}
                  onChange={(e) =>
                    setScoreCap(
                      e.target.value === "" ? "" : Number(e.target.value),
                    )
                  }
                />
                <p className="mt-[7px] text-[11.5px] leading-relaxed text-[color:var(--mp-fg-muted)]">
                  {scoreCap === ""
                    ? "1〜40 で入力（チームの出場メンバー平均スコアの上限）。"
                    : `ランク換算の目安: ${scoreCap} (${scoreToRankAbbrev(
                        scoreCap,
                      )})`}
                </p>
              </FormField>
            ) : (
              <p className="text-[11.5px] leading-relaxed text-[color:var(--mp-fg-muted)]">
                ※ 上限なし（チーム編成時にスコアの上限チェックを行いません）。
              </p>
            )}
          </Nest>
        )}
      </FormCard>

      {/* ══════ 03 本戦設定（予選BO・本戦-3d） ══════ */}
      <FormCard n="03" title="本戦設定">
        {/* イベント形式（2026-06-30 壁打ち）。総当たり/トーナメント/両方を選ぶ。 */}
        <FormField label="イベント形式" error={fe.format}>
          <select
            name="format"
            value={format}
            onChange={(e) => setFormat(e.target.value as EventFormat)}
          >
            <option value="round_robin_then_tournament">
              総当たり → 決勝トーナメント
            </option>
            <option value="round_robin">総当たりのみ</option>
            <option value="tournament">トーナメントのみ</option>
          </select>
          <p className="mt-[7px] text-[11.5px] leading-relaxed text-[color:var(--mp-fg-muted)]">
            大会の進め方を選びます。「総当たり →
            決勝トーナメント」は予選で順位を決めてから上位チームでトーナメント、「総当たりのみ」はリーグ戦で完結、「トーナメントのみ」は予選なしで一発勝負です。
          </p>
        </FormField>

        {/* 総当たりBO は予選（総当たり）を持つ形式でのみ。トーナメントのみでは出さない。 */}
        {showGroupConfig && (
          <div>
            <FormField label="BO" opt="1試合のマップ数" error={fe.groupBestOf}>
              <input
                name="groupBestOf"
                type="number"
                min={1}
                max={7}
                defaultValue={d.groupBestOf ?? 3}
              />
              <p className="mt-[7px] text-[11.5px] leading-relaxed text-[color:var(--mp-fg-muted)]">
                総当たりの1試合で最大何マップ戦うか（BO3＝2マップ先取・最大3マップ）。対戦表を生成すると全試合に反映されます。偶数は引分けあり。
              </p>
            </FormField>
          </div>
        )}

        {/* 3位決定戦の有無（本戦-5c）。決勝Tを持つ形式でのみ出す（総当たりのみでは不要）。 */}
        {showTournamentConfig && (
          <div>
            <Toggle
              name="tournamentThirdPlace"
              defaultChecked={d.tournamentThirdPlace ?? false}
              title={
                hasGroupStage(format)
                  ? "決勝トーナメントで3位決定戦を行う"
                  : "トーナメントで3位決定戦を行う"
              }
              desc="準決勝で敗れた2チームが3位を懸けて対戦します（4チーム以上のトーナメントで有効）。"
            />
          </div>
        )}
      </FormCard>

      {/* ══════ 04 順位設定（本戦-3b） ══════ */}
      <FormCard n="04" title="順位設定">
        {/* 親トグル: 順位機能を使うか。OFF なら配下を隠す（順位を争わないイベント）。 */}
        <Toggle
          name="rankingEnabled"
          checked={rankingEnabled}
          onChange={setRankingEnabled}
          title="順位を集計する"
          desc="勝点・タイブレークで順位を決めます。"
        />

        {rankingEnabled && (
          <Nest>
            <div className="grid grid-cols-3 gap-4">
              <FormField label="勝ち点" error={fe.pointsWin}>
                <input
                  name="pointsWin"
                  type="number"
                  min={0}
                  max={99}
                  defaultValue={d.pointsWin ?? 3}
                />
              </FormField>
              <FormField label="引分点" error={fe.pointsDraw}>
                <input
                  name="pointsDraw"
                  type="number"
                  min={0}
                  max={99}
                  defaultValue={d.pointsDraw ?? 1}
                />
              </FormField>
              <FormField label="負け点" error={fe.pointsLoss}>
                <input
                  name="pointsLoss"
                  type="number"
                  min={0}
                  max={99}
                  defaultValue={d.pointsLoss ?? 0}
                />
              </FormField>
            </div>

            <div>
              <p className="mb-1 text-[13px] font-semibold text-foreground">
                同着のタイブレーク
              </p>
              <p className="mb-3 text-[11.5px] leading-relaxed text-[color:var(--mp-fg-muted)]">
                勝点が同じチームの順位を決める基準。「使う」側の上から順に優先されます。
              </p>
              <TiebreakerPicker
                name="tiebreakers"
                defaultValue={d.tiebreakers ?? []}
                error={fe.tiebreakers}
              />
            </div>
          </Nest>
        )}
      </FormCard>

      {/* ══════ 05 Discord 連携（④ 全体告知） ══════ */}
      {/* イベントのルールとは無関係の +α 機能なので最下部に置く。 */}
      <FormCard n="05" title="Discord 連携" sub="任意・+α">
        <FormField
          label="告知チャンネルの Webhook URL"
          opt="任意"
          error={fe.discordWebhookUrl}
          hint="設定すると、このイベントを公開したとき Discord の告知チャンネルへ自動で投稿します。チャンネルの「連携サービス → ウェブフック」で発行した URL を貼り付けてください。空欄なら投稿しません。"
        >
          <input
            name="discordWebhookUrl"
            type="url"
            defaultValue={d.discordWebhookUrl ?? ""}
            placeholder="https://discord.com/api/webhooks/..."
          />
        </FormField>
      </FormCard>

      <div className="mt-1">
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-primary px-4 py-3.5 text-sm font-bold text-primary-foreground shadow-[0_0_0_1px_rgba(255,106,43,0.35),0_8px_22px_rgba(255,106,43,0.22)] transition hover:bg-[color:var(--mp-brand-hover)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? pendingLabel : submitLabel}
        </button>
      </div>
    </form>
  );
}

/** 親→子→孫のトグル配下（左ボーダー＋インデント）。 */
function Nest({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 flex flex-col gap-4 border-l-2 border-[color:var(--mp-border-strong)] pl-[18px]">
      {children}
    </div>
  );
}

/**
 * カスタムのチェックボックス行（タイトル＋説明）。
 * - checked/onChange を渡せば制御コンポーネント（表示出し分けに使う親トグル）。
 * - 渡さなければ defaultChecked の非制御（送信値のみ必要なトグル）。
 * name を渡したものだけがフォーム送信される（現行の name 付与を踏襲）。
 */
function Toggle({
  name,
  title,
  desc,
  checked,
  onChange,
  defaultChecked,
}: {
  name?: string;
  title: string;
  desc: string;
  checked?: boolean;
  onChange?: (next: boolean) => void;
  defaultChecked?: boolean;
}) {
  const controlled = checked !== undefined;
  return (
    <label className="flex cursor-pointer select-none items-start gap-[11px]">
      <input
        type="checkbox"
        name={name}
        {...(controlled
          ? { checked, onChange: (e) => onChange?.(e.target.checked) }
          : { defaultChecked })}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className="mt-px flex size-5 flex-none items-center justify-center rounded-md border border-[color:var(--mp-border-strong)] bg-[color:var(--mp-surface-3)] transition peer-checked:border-[color:var(--mp-brand)] peer-checked:bg-[color:var(--mp-brand)] peer-focus-visible:shadow-[0_0_0_3px_rgba(255,106,43,0.22)] peer-checked:[&>svg]:scale-100 peer-checked:[&>svg]:opacity-100"
      >
        <svg
          viewBox="0 0 24 24"
          className="size-[13px] scale-50 stroke-[color:var(--mp-on-brand)] opacity-0 transition"
          style={{
            strokeWidth: 3.4,
            fill: "none",
            strokeLinecap: "round",
            strokeLinejoin: "round",
          }}
        >
          <polyline points="4 12 10 18 20 6" />
        </svg>
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-[13.5px] font-semibold text-foreground">
          {title}
        </span>
        <span className="text-[11.5px] text-[color:var(--mp-fg-muted)]">
          {desc}
        </span>
      </span>
    </label>
  );
}

/**
 * タイブレーク優先順位の入力（「使う / 使わない」2エリアの D&D）。
 * 使うエリア内の上から順が優先順位。送信は hidden input にカンマ区切り（DB の tiebreakers[] と対応）。
 */
function TiebreakerPicker({
  name,
  defaultValue,
  error,
}: {
  name: string;
  defaultValue: TiebreakerKey[];
  error?: string;
}) {
  // 使う（順序保持）と使わない（残り）に分ける。
  const [used, setUsed] = useState<TiebreakerKey[]>(defaultValue);
  const unused = ALL_TIEBREAKERS.filter((k) => !used.includes(k));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over) return;
    const key = active.id as TiebreakerKey;
    const dest = String(over.id); // "used:<key>" / "used-zone" / "unused-zone"

    if (dest === "unused-zone") {
      setUsed((cur) => cur.filter((k) => k !== key));
      return;
    }
    // used ゾーン、または used 内の特定アイテムへドロップ＝使うに入れて並べ替え。
    setUsed((cur) => {
      const without = cur.filter((k) => k !== key);
      if (dest === "used-zone") return [...without, key];
      // "used:<targetKey>" の前に挿入。
      const targetKey = dest.startsWith("used:")
        ? (dest.slice("used:".length) as TiebreakerKey)
        : null;
      if (!targetKey || targetKey === key) return [...without, key];
      const idx = without.indexOf(targetKey);
      if (idx < 0) return [...without, key];
      return [...without.slice(0, idx), key, ...without.slice(idx)];
    });
  }

  return (
    <DndContext id="tiebreaker-dnd" sensors={sensors} onDragEnd={handleDragEnd}>
      <input type="hidden" name={name} value={used.join(",")} />
      <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2">
        <TiebreakerZone
          zoneId="used-zone"
          title="使う（上ほど優先）"
          items={used}
          ordered
        />
        <TiebreakerZone
          zoneId="unused-zone"
          title="使わない"
          items={unused}
        />
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </DndContext>
  );
}

/** タイブレークの1ゾーン（使う / 使わない）。droppable。 */
function TiebreakerZone({
  zoneId,
  title,
  items,
  ordered = false,
}: {
  zoneId: string;
  title: string;
  items: TiebreakerKey[];
  ordered?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: zoneId });
  return (
    <div>
      <p className="mb-[7px] text-[11.5px] font-semibold text-[color:var(--mp-fg-muted)]">
        {title}
      </p>
      <div
        ref={setNodeRef}
        className={`flex min-h-[6rem] flex-col gap-[9px] rounded-lg border-[1.5px] p-[10px] transition ${
          isOver
            ? "border-solid border-[color:var(--mp-brand)] bg-[color:var(--mp-brand)]/[0.06]"
            : "border-dashed border-[color:var(--mp-border-strong)]"
        }`}
      >
        {items.length === 0 ? (
          <p className="m-auto px-1 py-3 text-center text-[11.5px] text-[color:var(--mp-fg-subtle)]">
            ここにドラッグ
          </p>
        ) : (
          items.map((key, i) => (
            <TiebreakerCard
              key={key}
              itemKey={key}
              label={TIEBREAKER_LABEL[key]}
              rank={ordered ? i + 1 : undefined}
              dropId={ordered ? `used:${key}` : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}

/** タイブレーク基準カード（draggable）。使う側は並べ替え用に droppable も兼ねる。 */
function TiebreakerCard({
  itemKey,
  label,
  rank,
  dropId,
}: {
  itemKey: TiebreakerKey;
  label: string;
  rank?: number;
  dropId?: string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({ id: itemKey });
  const { setNodeRef: setDropRef } = useDroppable({
    id: dropId ?? `nodrop:${itemKey}`,
    disabled: !dropId,
  });

  return (
    <div
      ref={(el) => {
        setDragRef(el);
        if (dropId) setDropRef(el);
      }}
      {...listeners}
      {...attributes}
      className={`flex cursor-grab items-center gap-[9px] rounded-md border border-border bg-[color:var(--mp-surface-2)] px-[11px] py-[9px] text-[13px] text-foreground shadow-[var(--mp-e1)] transition hover:border-[color:var(--mp-border-strong)] active:cursor-grabbing ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <span aria-hidden className="flex flex-none text-[color:var(--mp-fg-subtle)]">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="9" cy="6" r="1.6" />
          <circle cx="15" cy="6" r="1.6" />
          <circle cx="9" cy="12" r="1.6" />
          <circle cx="15" cy="12" r="1.6" />
          <circle cx="9" cy="18" r="1.6" />
          <circle cx="15" cy="18" r="1.6" />
        </svg>
      </span>
      {rank !== undefined && (
        <span className="flex-none font-mono text-[11px] font-semibold text-[color:var(--mp-brand)]">
          {rank}.
        </span>
      )}
      <span>{label}</span>
    </div>
  );
}

