"use client";

/**
 * Moving an order along. The select offers only what `transitions.ts` allows from
 * here. Emailing the customer requires a note, and the button says so by being
 * disabled until one is typed.
 */

import { useState } from "react";
import { setFulfillmentStatusAction } from "@/app/admin/orders/actions";
import { fulfillmentMovesFrom, FULFILLMENT_LABEL } from "@/lib/commerce/transitions";
import type { FulfillmentStatus } from "@/lib/commerce/types";
import { ActionStatus, ADMIN_FIELD, ADMIN_LABEL, ADMIN_PRIMARY, useOrderAction } from "./order-action";

export function OrderWorkflowPanel({
  orderId,
  status: current,
  paid,
}: {
  orderId: string;
  status: FulfillmentStatus;
  paid: boolean;
}) {
  // Delivery goes through Publish, and an unpaid order is cancelled from Payment.
  const moves =
    current === "pending_payment"
      ? []
      : fulfillmentMovesFrom(current).filter((s) => s !== "delivered" && (paid || s === "cancelled"));
  const [target, setTarget] = useState<FulfillmentStatus | "">(moves[0] ?? "");
  const [note, setNote] = useState("");
  const [notify, setNotify] = useState(false);
  const { run, pending, status, failed } = useOrderAction();

  if (moves.length === 0) {
    return <p className="text-sm text-ink-muted">No status change is available here. Use the Payment panel, or Publish below.</p>;
  }
  const value = moves.includes(target as FulfillmentStatus) ? target : moves[0];

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        run(() => setFulfillmentStatusAction(orderId, value, note, notify), () => {
          setNote("");
          setNotify(false);
        });
      }}
      className="space-y-3"
    >
      <div>
        <label htmlFor="workflow-status" className={ADMIN_LABEL}>
          Change status to
        </label>
        <select
          id="workflow-status"
          value={value}
          onChange={(event) => setTarget(event.target.value as FulfillmentStatus)}
          className={`${ADMIN_FIELD} min-h-11`}
        >
          {moves.map((s) => (
            <option key={s} value={s}>
              {FULFILLMENT_LABEL[s].word}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="workflow-note" className={ADMIN_LABEL}>
          Note
        </label>
        <textarea
          id="workflow-note"
          rows={3}
          maxLength={1000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className={ADMIN_FIELD}
        />
      </div>
      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
        <input
          type="checkbox"
          checked={notify}
          onChange={(event) => setNotify(event.target.checked)}
          className="h-5 w-5 shrink-0 rounded border-line bg-base accent-brand-cyan"
        />
        Email the customer about this change
      </label>
      {notify && note.trim() === "" && (
        <p id="workflow-note-needed" className="text-xs text-ink-muted">
          Type a note to email the customer.
        </p>
      )}
      <button
        type="submit"
        disabled={pending || (notify && note.trim() === "")}
        aria-describedby={notify && note.trim() === "" ? "workflow-note-needed" : undefined}
        className={`${ADMIN_PRIMARY} w-full sm:w-auto`}
      >
        {pending ? "Updating..." : "Update status"}
      </button>
      <ActionStatus status={status} failed={failed} />
    </form>
  );
}
