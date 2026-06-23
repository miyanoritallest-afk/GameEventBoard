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
  description?: string;
  startsAt?: string; // "YYYY-MM-DDTHH:mm"（JST ローカル）
  endsAt?: string;
  recruitDeadline?: string;
  capacity?: string;
  requireScore?: boolean;
  uncertifiedHandling?: "fill_by_role" | "fill_by_season" | "exclude";
  roleSwapAllowed?: boolean;
  declaredSeasons?: number;
  bonusMaster?: number;
  bonusGm?: number;
  bonusChampion?: number;
  rankingEnabled?: boolean;
  pointsWin?: number;
  pointsDraw?: number;
  pointsLoss?: number;
  /** タイブレーク優先順位（使う基準を優先順に。先頭ほど優先）。 */
  tiebreakers?: TiebreakerKey[];
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
 */
export function EventForm({
  games,
  action,
  defaultValues = {},
  submitLabel,
  pendingLabel,
}: {
  games: GameOption[];
  action: EventFormAction;
  defaultValues?: EventFormDefaults;
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
  // 親トグル: 順位機能を使うか（OFF なら勝点・タイブレークを隠す）。
  const [rankingEnabled, setRankingEnabled] = useState(d.rankingEnabled ?? false);

  return (
    <form action={formAction} className="mt-6 space-y-6">
      {state.error && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      {/* 基本情報 */}
      <Field label="タイトル" required error={fe.title}>
        <input
          name="title"
          type="text"
          maxLength={80}
          defaultValue={d.title ?? ""}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </Field>

      <Field label="ゲーム" required error={fe.gameId}>
        <select
          name="gameId"
          defaultValue={d.gameId ?? games[0]?.id ?? ""}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="説明（任意）" error={fe.description}>
        <textarea
          name="description"
          rows={4}
          maxLength={2000}
          defaultValue={d.description ?? ""}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </Field>

      {/* 開催期間 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="開催開始（JST）" required error={fe.startsAt}>
          <DateTimePicker name="startsAt" defaultValue={d.startsAt ?? ""} />
        </Field>
        <Field label="開催終了（JST）" required error={fe.endsAt}>
          <DateTimePicker name="endsAt" defaultValue={d.endsAt ?? ""} />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="募集締切（任意・JST）" error={fe.recruitDeadline}>
          <DateTimePicker
            name="recruitDeadline"
            defaultValue={d.recruitDeadline ?? ""}
          />
        </Field>
        <Field label="定員（チーム数・任意）" error={fe.capacity}>
          <input
            name="capacity"
            type="number"
            min={1}
            defaultValue={d.capacity ?? ""}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </Field>
      </div>

      {/* スコアリング設定 */}
      <fieldset className="rounded-xl border border-border bg-card p-4">
        <legend className="px-1 text-sm font-semibold">スコアリング設定</legend>

        {/* 親トグル: 個人スコアを計算するか。OFF なら配下を隠す（スコアなしイベント）。 */}
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            name="requireScore"
            type="checkbox"
            checked={requireScore}
            onChange={(e) => setRequireScore(e.target.checked)}
            className="size-4"
          />
          個人スコアを計算する（ランク申告から算出）
        </label>

        {requireScore && (
          <div className="mt-4 space-y-4 border-l-2 border-border pl-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                name="roleSwapAllowed"
                type="checkbox"
                defaultChecked={d.roleSwapAllowed ?? false}
                className="size-4"
              />
              ロールスワップを許可する（全ロールのランクを参照）
            </label>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="申告シーズン数" error={fe.declaredSeasons}>
                <input
                  name="declaredSeasons"
                  type="number"
                  min={1}
                  max={10}
                  defaultValue={d.declaredSeasons ?? 3}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </Field>
              <Field
                label="未認定ロールの扱い"
                error={fe.uncertifiedHandling}
              >
                <select
                  name="uncertifiedHandling"
                  defaultValue={d.uncertifiedHandling ?? "exclude"}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  {UNCERTIFIED_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {/* 孫トグル: 到達ボーナスを使うか。ON のときだけ加点欄を表示。 */}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={useBonus}
                onChange={(e) => setUseBonus(e.target.checked)}
                className="size-4"
              />
              到達ボーナスを使う（最高到達ランクで加点）
            </label>

            {useBonus && (
              <div className="grid grid-cols-3 gap-4">
                <Field label="ボーナス: マスター" error={fe.bonusMaster}>
                  <input
                    name="bonusMaster"
                    type="number"
                    min={0}
                    max={10}
                    step="0.5"
                    defaultValue={d.bonusMaster ?? 0}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  />
                </Field>
                <Field label="ボーナス: GM" error={fe.bonusGm}>
                  <input
                    name="bonusGm"
                    type="number"
                    min={0}
                    max={10}
                    step="0.5"
                    defaultValue={d.bonusGm ?? 0}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  />
                </Field>
                <Field label="ボーナス: チャンピオン" error={fe.bonusChampion}>
                  <input
                    name="bonusChampion"
                    type="number"
                    min={0}
                    max={10}
                    step="0.5"
                    defaultValue={d.bonusChampion ?? 0}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  />
                </Field>
              </div>
            )}
          </div>
        )}
      </fieldset>

      {/* 順位設定（本戦-3b） */}
      <fieldset className="rounded-xl border border-border bg-card p-4">
        <legend className="px-1 text-sm font-semibold">順位設定</legend>

        {/* 親トグル: 順位機能を使うか。OFF なら配下を隠す（順位を争わないイベント）。 */}
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            name="rankingEnabled"
            type="checkbox"
            checked={rankingEnabled}
            onChange={(e) => setRankingEnabled(e.target.checked)}
            className="size-4"
          />
          順位を集計する（勝点・タイブレークで順位を決める）
        </label>

        {rankingEnabled && (
          <div className="mt-4 space-y-4 border-l-2 border-border pl-4">
            <div className="grid grid-cols-3 gap-4">
              <Field label="勝ち点" error={fe.pointsWin}>
                <input
                  name="pointsWin"
                  type="number"
                  min={0}
                  max={99}
                  defaultValue={d.pointsWin ?? 3}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </Field>
              <Field label="引分点" error={fe.pointsDraw}>
                <input
                  name="pointsDraw"
                  type="number"
                  min={0}
                  max={99}
                  defaultValue={d.pointsDraw ?? 1}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </Field>
              <Field label="負け点" error={fe.pointsLoss}>
                <input
                  name="pointsLoss"
                  type="number"
                  min={0}
                  max={99}
                  defaultValue={d.pointsLoss ?? 0}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </Field>
            </div>

            <div>
              <p className="mb-1 text-sm font-medium">同着のタイブレーク</p>
              <p className="mb-2 text-xs text-muted-foreground">
                勝点が同じチームの順位を決める基準。「使う」側の上から順に優先されます。
              </p>
              <TiebreakerPicker
                name="tiebreakers"
                defaultValue={d.tiebreakers ?? []}
                error={fe.tiebreakers}
              />
            </div>
          </div>
        )}
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? pendingLabel : submitLabel}
      </button>
    </form>
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
    <DndContext
      id="tiebreaker-dnd"
      sensors={sensors}
      onDragEnd={handleDragEnd}
    >
      <input type="hidden" name={name} value={used.join(",")} />
      <div className="grid grid-cols-2 gap-3">
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
      <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>
      <div
        ref={setNodeRef}
        className={`min-h-[5rem] space-y-2 rounded-md border p-2 ${
          isOver ? "border-primary bg-primary/5" : "border-dashed border-border"
        }`}
      >
        {items.length === 0 ? (
          <p className="px-1 py-3 text-center text-xs text-muted-foreground">
            ここにドラッグ
          </p>
        ) : (
          items.map((key, i) => (
            <TiebreakerCard
              key={key}
              itemKey={key}
              label={`${ordered ? `${i + 1}. ` : ""}${TIEBREAKER_LABEL[key]}`}
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
  dropId,
}: {
  itemKey: TiebreakerKey;
  label: string;
  dropId?: string;
}) {
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } =
    useDraggable({ id: itemKey });
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
      className={`cursor-grab rounded-md border border-border bg-muted/40 px-3 py-2 text-sm ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      {label}
    </div>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
