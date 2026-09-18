"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics";

/**
 * Reports a confirmed donation to Google Analytics. Renders nothing.
 *
 * Mounted by /donate/thanks ONLY when Stripe itself said the session is paid,
 * so the page's own server-side check is the gate and this never takes the
 * URL's word for anything. A payment that is still settling when the reader
 * lands here is not reported later: the webhook that confirms it runs on the
 * server, where there is no GA tag. Known gap, small in practice, since cards
 * and wallets settle before the redirect.
 *
 * A receipt page is a page people reload and reopen. The session id is
 * remembered in localStorage so a reload or a second tab does not count the
 * same donation twice. The id stays in the browser: it is never sent to GA,
 * and GA's URL redaction strips it from the page address as well.
 */
export function DonationCompleteTracker({
  sessionId,
  amountUsd,
}: {
  sessionId: string;
  amountUsd: number;
}) {
  useEffect(() => {
    const key = `ff_donation_reported:${sessionId}`;
    try {
      if (window.localStorage.getItem(key)) return;
      window.localStorage.setItem(key, "1");
    } catch {
      // Storage blocked. Reporting once per view is still better than never.
    }
    trackEvent("donation_complete", { value: amountUsd, currency: "USD" });
  }, [sessionId, amountUsd]);

  return null;
}
