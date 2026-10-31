import "server-only";
import { randomUUID } from "node:crypto";
import { stripeRequest, type CheckoutSession, type StripeResult } from "@/lib/stripe/client";

/**
 * The donation half of Stripe. Everything generic (the request, the key check,
 * reading a session back) moved to lib/stripe/client.ts when orders needed it
 * too, and is re-exported here so the donation import sites did not change.
 */

export {
  isCheckoutSessionId,
  retrieveCheckoutSession,
  stripeConfigured,
} from "@/lib/stripe/client";
export type { CheckoutSession, StripeResult } from "@/lib/stripe/client";

/**
 * Open a one-time donation.
 *
 * `submit_type: "donate"` is the only cosmetic argument here and it earns its
 * place: it makes Stripe's own button read "Donate" rather than "Pay", so the
 * last screen agrees with the first one about what is happening.
 */
export async function createDonationCheckout(params: {
  amountCents: number;
  successUrl: string;
  cancelUrl: string;
  /** Prefilled for a signed-in reader so they do not retype it. Optional. */
  customerEmail?: string | null;
  /** Which surface the donation started from. Shows up in the Stripe dashboard. */
  origin: string;
}): Promise<StripeResult<CheckoutSession>> {
  return stripeRequest<CheckoutSession>("/checkout/sessions", {
    method: "POST",
    idempotencyKey: randomUUID(),
    body: {
      mode: "payment",
      submit_type: "donate",
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      // Deliberately no payment_method_types. See the header note.
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: params.amountCents,
            product_data: {
              name: "FF Beacon donation",
              description: "Keeps the tools free and the site accessible.",
            },
          },
        },
      ],
      payment_intent_data: {
        description: "FF Beacon donation",
        // Mirrored, not moved. Session metadata does NOT propagate to the
        // PaymentIntent or the charge, so without this copy the Dashboard's
        // Payments list (which is where a donation is actually reconciled)
        // shows no origin at all and only the Checkout Session object carries
        // it. Both are set so either view answers the question.
        metadata: { product: "ffbeacon_donation", origin: params.origin },
      },
      ...(params.customerEmail ? { customer_email: params.customerEmail } : {}),
      metadata: { product: "ffbeacon_donation", origin: params.origin },
    },
  });
}
