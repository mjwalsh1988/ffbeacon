import type { Json } from "@/lib/database.types";

/**
 * What of a Stripe donation event we are willing to keep.
 *
 * THIS IS AN ALLOW-LIST, AND THAT IS THE WHOLE POINT. It began as a deny-list
 * that removed `customer_details`, `customer_email` and `customer`, which was
 * correct for the Checkout configuration we had on the day it was written and
 * wrong as a design. A deny-list keeps every field a third party has not yet
 * been named in it, and this one backs a written promise: /privacy says the
 * stored donation record holds no name, no email address, no billing address
 * and nothing about the card, and migration 0270 says the same.
 *
 * Two ways a deny-list breaks that promise with no code change to review:
 *
 *   1. A DASHBOARD SETTING. `shipping_details` and `custom_fields` sit beside
 *      `customer_details` on a Checkout Session. They are null today only
 *      because address collection is switched off. Turning it on starts writing
 *      donors' names and street addresses into our database.
 *   2. A STRIPE API VERSION. lib/donate/stripe.ts deliberately pins no version,
 *      so payloads follow the account default as Stripe advances it. Stripe has
 *      already moved customer fields around once (`collected_information`), and
 *      a future move would route identity straight past any list of names.
 *
 * An allow-list cannot be defeated by a field being added upstream. Anything
 * Stripe sends that is not named here falls on the floor, which is the correct
 * default for a table that exists to record an amount and a delivery status.
 *
 * Pure, no imports beyond a type, and tested, because it is a privacy boundary
 * and the previous version could not be tested at all: it was a private
 * function inside a route handler.
 */

/**
 * The session fields worth keeping. Every one is either an identifier, an
 * amount, a state, or our own metadata. None of them is a person.
 */
const ALLOWED_SESSION_FIELDS = [
  "id",
  "object",
  "mode",
  "status",
  "payment_status",
  "amount_total",
  "amount_subtotal",
  "currency",
  "payment_intent",
  "livemode",
  "created",
  "expires_at",
  // Our own metadata, set by app/api/donate/checkout/route.ts. It holds a
  // product tag and which surface the donation started from, nothing else.
  "metadata",
] as const;

/** Named in the stored object so a reader knows the shape is deliberate. */
export const REDACTION_NOTE =
  "Allow-listed projection. Donor identity is never stored; Stripe holds the full object.";

export type RedactedEvent = {
  id: string | null;
  type: string | null;
  livemode: boolean | null;
  note: string;
  allowed: string[];
  object: Record<string, unknown>;
};

/**
 * Project a Stripe event down to the parts we keep.
 *
 * `payment_intent` is flattened to its id when Stripe sends it expanded, so an
 * expanded payload cannot smuggle a nested `charges` collection (which carries
 * `billing_details`) in behind an allowed key.
 */
export function redactStripeEvent(event: unknown): Json {
  const root = (event ?? {}) as Record<string, unknown>;
  const data = (root.data ?? {}) as Record<string, unknown>;
  const object = (data.object ?? {}) as Record<string, unknown>;

  const kept: Record<string, unknown> = {};
  for (const field of ALLOWED_SESSION_FIELDS) {
    if (!(field in object)) continue;
    const value = object[field];

    if (field === "payment_intent") {
      // String, or an expanded object whose id is the only part we want.
      if (typeof value === "string") {
        kept[field] = value;
      } else if (value && typeof value === "object") {
        const id = (value as { id?: unknown }).id;
        kept[field] = typeof id === "string" ? id : null;
      }
      continue;
    }

    if (field === "metadata") {
      // Ours, but copied key by key rather than trusted wholesale: it is a
      // free-form map on the Stripe object and anything could have been written
      // into it. Only string values, and only a sane number of them.
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const meta: Record<string, string> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 20)) {
          if (typeof v === "string") meta[k] = v.slice(0, 200);
        }
        kept[field] = meta;
      }
      continue;
    }

    // Primitives only. Anything structured that is not handled above is dropped
    // rather than stored, because a nested object is where identity hides.
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      kept[field] = value;
    }
  }

  const redacted: RedactedEvent = {
    id: typeof root.id === "string" ? root.id : null,
    type: typeof root.type === "string" ? root.type : null,
    livemode: typeof root.livemode === "boolean" ? root.livemode : null,
    note: REDACTION_NOTE,
    allowed: [...ALLOWED_SESSION_FIELDS],
    object: kept,
  };

  return redacted as unknown as Json;
}
