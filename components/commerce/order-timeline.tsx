/**
 * The customer's timeline: every visible event, oldest first, then the messages
 * from Michael. The rows reach here through RLS, so an internal note cannot appear.
 */

import { formatEastern } from "@/lib/datetime";
import type { OrderEvent, OrderMessage } from "@/lib/commerce/types";
import { RULED } from "@/components/league-blueprint/sheet";
import { RichTextView } from "./rich-text-view";

function eventTitle(event: OrderEvent): string {
  return event.kind === "note" && event.actor === "admin" ? "Michael added a note" : event.title;
}

export function OrderTimeline({
  events,
  messages,
}: {
  events: OrderEvent[];
  messages: OrderMessage[];
}) {
  return (
    <>
      <ol className={RULED}>
        {events.map((event) => (
          <li key={event.id} className="py-3">
            <p className="break-words text-sm font-semibold text-ink">{eventTitle(event)}</p>
            <p className="mt-0.5 font-mono text-[11px] text-ink-muted">{formatEastern(event.created_at)}</p>
            {event.body && (
              <p className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed text-ink-muted">
                {event.body}
              </p>
            )}
          </li>
        ))}
      </ol>
      {messages.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-bold text-ink">Messages from Michael</h3>
          <ul role="list" className={`mt-2 ${RULED}`}>
            {messages.map((message) => (
              <li key={message.id}>
                <details className="py-1">
                  <summary className="flex min-h-11 cursor-pointer flex-col justify-center text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">
                    <span className="break-words font-semibold text-ink">{message.subject}</span>
                    <span className="font-mono text-[11px] text-ink-muted">{formatEastern(message.created_at)}</span>
                  </summary>
                  <div className="pb-3 pt-2">
                    <RichTextView text={message.body_text} headingLevel={4} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
