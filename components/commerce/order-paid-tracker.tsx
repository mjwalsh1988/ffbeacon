"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics";

/**
 * Counts a paid order once. The guard is the order's own paid_at, kept in
 * localStorage, so re-reading a delivered review next month is not a second
 * conversion; a session key would have counted every new browser session.
 * Paints nothing.
 */
export function OrderPaidTracker({
  orderId,
  paidAt,
  tier,
  method,
  value,
}: {
  orderId: string;
  paidAt: string;
  tier: string;
  method: "stripe" | "paypal" | "venmo" | "complimentary";
  value: number;
}) {
  useEffect(() => {
    const key = `order-paid-${orderId}`;
    try {
      if (window.localStorage.getItem(key) === paidAt) return;
      window.localStorage.setItem(key, paidAt);
    } catch {
      return;
    }
    trackEvent("review_order_paid", { tier, method, value, currency: "USD" });
  }, [orderId, paidAt, tier, method, value]);
  return null;
}
