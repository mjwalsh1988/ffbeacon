"use client";

/**
 * Notes only the admin reads. They are `order_events` rows with
 * `visible_to_customer = false`, and the owner's select policy filters on that, so
 * a note reaches a customer through neither the page nor the API. There is no edit
 * and no delete: a note is a dated record, and a correction is another note.
 */

import { useState } from "react";
import { addInternalNoteAction } from "@/app/admin/orders/actions";
import { formatEastern } from "@/lib/datetime";
import { RULED } from "@/components/league-blueprint/sheet";
import { ActionStatus, ADMIN_BUTTON, ADMIN_FIELD, ADMIN_LABEL, useOrderAction } from "./order-action";

export function InternalNotesPanel({
  orderId,
  notes,
}: {
  orderId: string;
  notes: Array<{ id: string; created_at: string; body: string | null; title: string }>;
}) {
  const [body, setBody] = useState("");
  const { run, pending, status, failed } = useOrderAction();
  return (
    <>
      {notes.length > 0 && (
        <ul role="list" className={`mb-4 ${RULED}`}>
          {notes.map((note) => (
            <li key={note.id} className="py-2">
              <p className="font-mono text-[11px] text-ink-muted">{formatEastern(note.created_at)}</p>
              <p className="mt-0.5 whitespace-pre-line break-words text-sm text-ink">{note.body ?? note.title}</p>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          run(() => addInternalNoteAction(orderId, body), () => setBody(""));
        }}
        className="space-y-2"
      >
        <div>
          <label htmlFor="internal-note" className={ADMIN_LABEL}>
            Add an internal note (never shown to the customer)
          </label>
          <textarea
            id="internal-note"
            rows={3}
            maxLength={5000}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            className={ADMIN_FIELD}
          />
        </div>
        <button type="submit" disabled={pending || body.trim() === ""} className={ADMIN_BUTTON}>
          {pending ? "Saving..." : "Save note"}
        </button>
        <ActionStatus status={status} failed={failed} />
      </form>
    </>
  );
}
