"use client";

/**
 * Every event on an order, newest first, with an Internal chip on the ones the
 * customer never sees and a Resend beside any email that failed.
 */

import { resendEventEmailAction } from "@/app/admin/orders/actions";
import { formatEastern } from "@/lib/datetime";
import type { OrderEvent, OrderMessage } from "@/lib/commerce/types";
import { RULED } from "@/components/league-blueprint/sheet";
import { StatusChip } from "@/components/commerce/status-chip";
import { ActionStatus, ADMIN_BUTTON, useOrderAction } from "./order-action";

/** The raw tokens as words, so a reader hears "by the system" rather than "system". */
const ACTOR_WORDS: Record<string, string> = {
  system: "by the system",
  admin: "by Michael",
  customer: "by the customer",
};

const STATUS_WORDS: Record<string, string> = {
  sent: "sent",
  failed: "not sent",
  skipped: "not sent, email is not configured",
};

export function OrderTimelineAdmin({
  events,
  messages,
}: {
  events: OrderEvent[];
  messages: OrderMessage[];
}) {
  const { run, pending, status, failed } = useOrderAction();
  const rows = [...events].sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <>
      <ol role="list" className={RULED}>
        {rows.map((event) => {
          const data = event.data as { status?: string } | null;
          const emailFailed =
            event.kind === "email_sent" && data?.status != null && data.status !== "sent";
          return (
            <li key={event.id} className="py-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="min-w-0 break-words text-sm font-semibold text-ink">{event.title}</span>
                {!event.visible_to_customer && <StatusChip chip={{ word: "Internal", tone: "muted" }} />}
                {emailFailed && <StatusChip chip={{ word: `Email ${data?.status}`, tone: "danger" }} />}
              </div>
              <p className="mt-0.5 font-mono text-[11px] text-ink-muted">
                {formatEastern(event.created_at)}, {ACTOR_WORDS[event.actor] ?? event.actor}
              </p>
              {event.body && (
                <p className="mt-1 whitespace-pre-line break-words text-sm text-ink-muted">{event.body}</p>
              )}
              {emailFailed && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => resendEventEmailAction(event.id))}
                  className={`${ADMIN_BUTTON} mt-2`}
                >
                  Resend
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {messages.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-bold text-ink">Messages</h3>
          <ul role="list" className={`mt-1 ${RULED}`}>
            {messages.map((message) => (
              <li key={message.id} className="py-2">
                <p className="break-words text-sm font-semibold text-ink">{message.subject}</p>
                <p className="font-mono text-[11px] text-ink-muted">
                  {formatEastern(message.created_at)}, {STATUS_WORDS[message.status] ?? message.status}
                </p>
                <p className="mt-1 whitespace-pre-line break-words text-sm text-ink-muted">{message.body_text}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ActionStatus status={status} failed={failed} />
    </>
  );
}
