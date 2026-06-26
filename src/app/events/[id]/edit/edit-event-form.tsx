"use client";

import { EventForm, type EventFormDefaults } from "../../event-form";
import { updateEvent } from "../../actions";

type GameOption = { id: string; name: string };

/**
 * 編集フォーム（クライアント）。共通 EventForm に、eventId を束ねた updateEvent と
 * 保存済み値（defaultValues）を渡す。updateEvent は (eventId, prev, formData) なので
 * bind で eventId を固定し、useActionState 互換の (prev, formData) にする。
 */
export function EditEventForm({
  eventId,
  games,
  defaultValues,
  discordName,
}: {
  eventId: string;
  games: GameOption[];
  defaultValues: EventFormDefaults;
  discordName: string;
}) {
  const action = updateEvent.bind(null, eventId);
  return (
    <EventForm
      games={games}
      action={action}
      defaultValues={defaultValues}
      discordName={discordName}
      submitLabel="変更を保存する"
      pendingLabel="保存中..."
    />
  );
}
