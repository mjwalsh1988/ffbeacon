/**
 * Whether the store is open, and how a reader may pay. Pure.
 *
 * Every offer and the checkout read this one answer, so a surface can never offer
 * something the action would refuse. A one-person service needs a door it can
 * close.
 */

import type { CommerceSettings } from "./default-settings";
import type { PaymentMethod } from "./types";

export type OfferAvailability = {
  open: boolean;
  reason: "closed" | "fully_booked" | null;
  methods: PaymentMethod[];
};

export function offerAvailability(
  settings: CommerceSettings,
  openCount: number,
  stripeOk: boolean,
): OfferAvailability {
  const methods: PaymentMethod[] = [];
  if (settings.payments.stripe && stripeOk) methods.push("stripe");
  if (settings.payments.paypal) methods.push("paypal");
  if (settings.payments.venmo) methods.push("venmo");

  if (!settings.storefront.enabled) return { open: false, reason: "closed", methods };
  if (settings.storefront.fullyBooked || openCount >= settings.storefront.maxOpenOrders) {
    return { open: false, reason: "fully_booked", methods };
  }
  return { open: true, reason: null, methods };
}
