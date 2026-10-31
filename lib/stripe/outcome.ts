import type { CheckoutSession } from "./client";

/**
 * What a Checkout Session actually means, in three words.
 *
 * Pulled out of a page and given tests because the first version of this mapping
 * got it wrong in the one direction that matters: it read Stripe's `open` status
 * as "pending" and told somebody who had abandoned Checkout that their payment
 * was settling and that there was no reason to pay again. Neither was true, and
 * no page-level test could have caught it because the logic was inline in a
 * server component.
 *
 * The three outcomes, and the line between them:
 *
 *   paid     Money arrived. `payment_status` is `paid`, or
 *            `no_payment_required` for a zero-amount session.
 *
 *   pending  The reader FINISHED Checkout and a delayed-notification payment
 *            method has not settled yet. That is `status === "complete"` with
 *            payment still outstanding, and nothing else. This is the narrow
 *            case, and it must stay narrow.
 *
 *   unknown  Everything else, including `open` (Stripe's own words: payment
 *            processing has not started) and `expired`. We do not claim a
 *            payment happened and we do not claim one did not.
 */
export type CheckoutOutcome = "paid" | "pending" | "unknown";

export function checkoutOutcome(
  session: Pick<CheckoutSession, "status" | "payment_status">,
): CheckoutOutcome {
  if (
    session.payment_status === "paid" ||
    session.payment_status === "no_payment_required"
  ) {
    return "paid";
  }
  if (session.status === "complete") return "pending";
  return "unknown";
}
