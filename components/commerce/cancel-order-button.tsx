"use client";

/**
 * A customer cancelling an order they have not paid for. A decision rather than a
 * detail view, so the house dialog sits centered on desktop.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelOwnOrderAction } from "@/app/actions/commerce";
import { SlideUpDialog } from "@/components/slide-up-dialog";

export function CancelOrderButton({
  orderId,
  orderNumber,
}: {
  orderId: string;
  orderNumber: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const confirm = () => {
    setError("");
    startTransition(async () => {
      const result = await cancelOwnOrderAction(orderId);
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(result.message);
        router.refresh();
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center text-xs font-semibold text-ink-muted underline underline-offset-2 transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        Cancel this order
      </button>
      <SlideUpDialog
        open={open}
        onClose={() => setOpen(false)}
        label={`Cancel order ${orderNumber}?`}
        labelledBy="cancel-order-title"
        desktopPlacement="center"
      >
        <div className="px-5 pb-2 pt-1 sm:px-6">
          <h2 id="cancel-order-title" className="text-lg font-bold text-ink">
            Cancel order {orderNumber}?
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            Nothing has been charged. You can start a new order any time.
          </p>
          {error && (
            <p role="alert" className="mt-3 text-sm font-medium text-signal-danger">
              {error}
            </p>
          )}
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={confirm}
              disabled={pending}
              className="inline-flex min-h-11 items-center justify-center rounded-card border border-signal-danger/50 bg-signal-danger/10 px-4 text-sm font-semibold text-ink transition-colors hover:bg-signal-danger/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60"
            >
              {pending ? "Canceling..." : "Cancel the order"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex min-h-11 items-center justify-center rounded-card border border-line bg-base px-4 text-sm font-semibold text-ink transition-colors hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Keep it
            </button>
          </div>
        </div>
      </SlideUpDialog>
    </>
  );
}
