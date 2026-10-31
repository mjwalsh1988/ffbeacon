"use client";

/**
 * The shared shape of an admin control on the order page: run an action in a
 * transition, refresh, and say what happened. Every panel uses it, so a failure
 * always reads the same way.
 *
 * What a screen reader hears: "Working on it." the moment a button is pressed (the
 * button's own text changing while it is disabled is not read), then the result.
 * After a success focus goes to the page's h1 (id order-heading) so the reader is
 * not left on a control the refresh re-rendered; after a failure the alert itself
 * takes focus. The two live regions are persistent and separate, because some
 * readers only announce an alert inserted into an element that already had the
 * role.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/app/admin/orders/actions";

export const ADMIN_BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-card border border-line bg-base px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-60";

export const ADMIN_PRIMARY =
  "inline-flex min-h-11 items-center justify-center rounded-card bg-beacon px-4 py-2 text-sm font-bold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-60";

export const ADMIN_DANGER =
  "inline-flex min-h-11 items-center justify-center rounded-card border border-signal-danger/50 bg-signal-danger/10 px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-signal-danger/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-60";

export const ADMIN_FIELD =
  "mt-1 w-full rounded-card border border-line bg-base px-3 py-2.5 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

export const ADMIN_LABEL = "block text-xs font-semibold text-ink-subtle";

/** The h1 of the admin order page. A success lands focus here when it exists. */
export const ORDER_HEADING_ID = "order-heading";

export function useOrderAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);

  const run = (work: () => Promise<ActionResult>, onDone?: () => void) => {
    setFailed(false);
    setStatus("Working on it.");
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        setStatus(result.message ?? "Done.");
        onDone?.();
        router.refresh();
        requestAnimationFrame(() => {
          document.getElementById(ORDER_HEADING_ID)?.focus();
        });
      } else {
        setFailed(true);
        setStatus(result.error);
      }
    });
  };

  return { run, pending, status, failed };
}

export function ActionStatus({ status, failed }: { status: string; failed: boolean }) {
  const alertRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (failed && status) alertRef.current?.focus();
  }, [failed, status]);
  return (
    <>
      <p role="status" className="min-h-5 text-sm text-ink-muted">
        {failed ? "" : status}
      </p>
      <p
        ref={alertRef}
        role="alert"
        tabIndex={-1}
        className={`text-sm font-medium text-signal-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
          failed && status ? "" : "sr-only"
        }`}
      >
        {failed ? status : ""}
      </p>
    </>
  );
}
