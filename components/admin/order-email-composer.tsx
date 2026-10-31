"use client";

/**
 * A free-form email to the customer. It goes out with the default Reply-To, is kept
 * in `order_messages` and shows on the customer's order, so nothing said about an
 * order lives only in an inbox.
 */

import { useState } from "react";
import { sendOrderEmailAction } from "@/app/admin/orders/actions";
import { RichTextView } from "@/components/commerce/rich-text-view";
import { ActionStatus, ADMIN_FIELD, ADMIN_LABEL, ADMIN_PRIMARY, useOrderAction } from "./order-action";

export function OrderEmailComposer({ orderId }: { orderId: string }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const { run, pending, status, failed } = useOrderAction();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        run(() => sendOrderEmailAction(orderId, subject, body), () => {
          setSubject("");
          setBody("");
        });
      }}
      className="space-y-3"
    >
      <div>
        <label htmlFor="email-subject" className={ADMIN_LABEL}>
          Subject
        </label>
        <input
          id="email-subject"
          type="text"
          maxLength={160}
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          className={`${ADMIN_FIELD} min-h-11`}
        />
      </div>
      <div>
        <label htmlFor="email-body" className={ADMIN_LABEL}>
          Message
        </label>
        <p id="email-body-hint" className="mt-0.5 text-[11px] text-ink-subtle">
          Blank line for a paragraph, ## for a heading, - for a bullet
        </p>
        <textarea
          id="email-body"
          rows={6}
          maxLength={8000}
          value={body}
          aria-describedby="email-body-hint"
          onChange={(event) => setBody(event.target.value)}
          className={ADMIN_FIELD}
        />
      </div>
      {body.trim() !== "" && (
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">
            Preview
          </summary>
          <div className="mt-1 rounded-card border border-line bg-base/30 p-4">
            <RichTextView text={body} headingLevel={3} />
          </div>
        </details>
      )}
      <button
        type="submit"
        disabled={pending || subject.trim() === "" || body.trim() === ""}
        className={`${ADMIN_PRIMARY} w-full sm:w-auto`}
      >
        {pending ? "Sending..." : "Send email"}
      </button>
      <ActionStatus status={status} failed={failed} />
    </form>
  );
}
