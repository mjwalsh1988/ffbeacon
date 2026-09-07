import "server-only";
import { randomUUID } from "node:crypto";

/**
 * Stripe, over its REST API with fetch and no SDK.
 *
 * Shaped like lib/email/send.ts: the key lives in the environment, the module
 * no-ops loudly rather than throwing when it is absent, and every failure comes
 * back as a structured result so a payment provider having a bad minute cannot
 * take a page down with it.
 *
 * WHY HOSTED CHECKOUT AND NOT AN EMBEDDED PAYMENT FORM
 *   Apple Pay and Google Pay are the whole point of this feature, and they are
 *   the part that is easy to get subtly wrong. On checkout.stripe.com they work
 *   out of the box: the domain is Stripe's own and is already registered with
 *   Apple, so there is no domain-verification file to host and nothing to
 *   re-register when a deploy preview gets its own hostname. Embedding the
 *   Payment Element would put that registration on us AND would require
 *   loosening this site's `Permissions-Policy: payment=()` header, which is
 *   currently doing real work.
 *
 *   The redirect also means no card number, no wallet token, and no payment
 *   iframe ever touches this origin. There is nothing here for a cross-site
 *   script on our own page to steal.
 *
 * WHY THERE IS NO `payment_method_types`
 *   Omitting it is what turns automatic payment methods ON: Stripe then serves
 *   whatever the account has enabled in the Dashboard and whatever the reader's
 *   browser can actually do, which is how one session shows Apple Pay on an
 *   iPhone, Google Pay on Android, and a card field everywhere else. Passing an
 *   explicit list would freeze that at whatever was typed here today and
 *   silently drop every wallet.
 */

const STRIPE_API = "https://api.stripe.com/v1";

/** Ten seconds. A payment provider that has not answered by then is not going to. */
const TIMEOUT_MS = 10_000;

export type StripeResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "unconfigured" }
  | { ok: false; reason: "error"; detail: string };

/**
 * The secret key, or null when there is not a usable one.
 *
 * THE SHAPE IS CHECKED, not just the presence, and that is not pedantry: this
 * was written after finding `STRIPE_SECRET_KEY=#22D3EE` (a hex colour, pasted
 * into the wrong line) sitting in a real environment file. A key that merely
 * exists sends the request, gets a 401, and surfaces to the reader as "we could
 * not open the payment page", which points at Stripe being down when the
 * problem is one line of configuration.
 *
 * Refusing it here turns that into the "card donations are not set up" state
 * instead, which is honest, still offers PayPal and Venmo, and puts the real
 * reason in the server log where somebody can act on it.
 *
 * `sk_` is a standard secret key, `rk_` a restricted one. Both are valid here.
 */
function secretKey(): string | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]/.test(key)) {
    console.error(
      "[donate] STRIPE_SECRET_KEY is set but is not a Stripe secret key " +
        "(expected it to start with sk_test_, sk_live_, rk_test_ or rk_live_). " +
        "Card donations are disabled until it is corrected.",
    );
    return null;
  }
  return key;
}

/**
 * Stripe reads its own API version from the account unless a request pins one.
 * `STRIPE_API_VERSION` pins it when set, and is deliberately not defaulted to a
 * literal in this file: a version string typed here that the account has never
 * seen is a hard 400 on every donation, and the four fields this module reads
 * (id, url, amount_total, payment_status) have been stable on Checkout Sessions
 * since it launched.
 */
function versionHeader(): Record<string, string> {
  const v = process.env.STRIPE_API_VERSION;
  return v && v.trim() ? { "Stripe-Version": v.trim() } : {};
}

/**
 * Flatten a nested object into Stripe's bracketed form encoding, which is the
 * only body format the API takes. `{ line_items: [{ quantity: 1 }] }` becomes
 * `line_items[0][quantity]=1`.
 */
function encodeForm(input: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    const path = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item !== null && typeof item === "object") {
          out.push(...encodeForm(item as Record<string, unknown>, `${path}[${i}]`));
        } else {
          out.push(
            `${encodeURIComponent(`${path}[${i}]`)}=${encodeURIComponent(String(item))}`,
          );
        }
      });
    } else if (typeof value === "object") {
      out.push(...encodeForm(value as Record<string, unknown>, path));
    } else {
      out.push(`${encodeURIComponent(path)}=${encodeURIComponent(String(value))}`);
    }
  }
  return out;
}

async function stripeRequest<T>(
  path: string,
  init: {
    method: "GET" | "POST";
    body?: Record<string, unknown>;
    idempotencyKey?: string;
  },
): Promise<StripeResult<T>> {
  const key = secretKey();
  if (!key) {
    console.warn("[donate] STRIPE_SECRET_KEY is not set; card donations are unavailable.");
    return { ok: false, reason: "unconfigured" };
  }

  try {
    const res = await fetch(`${STRIPE_API}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
        ...versionHeader(),
        // Creating a Checkout Session moves no money, but a network-layer retry
        // that produced two sessions would leave an orphan in the dashboard for
        // every flaky connection, so the call is made safe to retry.
        ...(init.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey } : {}),
      },
      body: init.body ? encodeForm(init.body).join("&") : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });

    const text = await res.text();
    if (!res.ok) {
      // Stripe's message can name the account, the key mode, or the exact
      // parameter that was wrong. Logged for us, never returned to the browser.
      console.error("[donate] Stripe responded", res.status, text.slice(0, 500));
      return { ok: false, reason: "error", detail: `stripe ${res.status}` };
    }
    return { ok: true, data: JSON.parse(text) as T };
  } catch (err) {
    console.error("[donate] Stripe request failed", err);
    return { ok: false, reason: "error", detail: "request failed" };
  }
}

export type CheckoutSession = {
  id: string;
  url: string | null;
  amount_total: number | null;
  currency: string | null;
  status: "open" | "complete" | "expired" | null;
  payment_status: "paid" | "unpaid" | "no_payment_required" | null;
  /**
   * Read ONLY by the receipt replay script, which has a session id and needs an
   * address to send to. Nothing stores it: the donation ledger deliberately
   * holds no donor identity, so the address is fetched from Stripe at the moment
   * it is used and dropped again. See migration 0270.
   */
  customer_details?: { email?: string | null } | null;
};

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

/**
 * Read one session back, for the thank-you page.
 *
 * The session id is the only thing the browser carries out of Checkout, so the
 * page CANNOT take the browser's word for what was paid: it asks Stripe. The id
 * is unguessable, and nothing personal is read out of the response.
 */
export async function retrieveCheckoutSession(
  sessionId: string,
): Promise<StripeResult<CheckoutSession>> {
  return stripeRequest<CheckoutSession>(
    `/checkout/sessions/${encodeURIComponent(sessionId)}`,
    { method: "GET" },
  );
}

/** Stripe's own id shape. Checked before a lookup so junk never leaves our server. */
export function isCheckoutSessionId(value: unknown): value is string {
  return typeof value === "string" && /^cs_[A-Za-z0-9_]{10,255}$/.test(value);
}

/** Whether card donations can run at all right now. */
export function stripeConfigured(): boolean {
  return secretKey() !== null;
}
