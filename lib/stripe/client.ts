import "server-only";

/**
 * Stripe, over its REST API with fetch and no SDK.
 *
 * The generic half of what began as lib/donate/stripe.ts: the request, the key
 * and form encoding, and the Checkout Session calls that are not about any one
 * product. Donations (lib/donate/stripe.ts) and orders (lib/commerce/stripe.ts)
 * sit on top of it.
 *
 * Shaped like lib/email/send.ts: the key lives in the environment, the module
 * no-ops loudly rather than throwing when it is absent, and every failure comes
 * back as a structured result so a payment provider having a bad minute cannot
 * take a page down with it.
 *
 * WHY HOSTED CHECKOUT AND NOT AN EMBEDDED PAYMENT FORM
 *   Apple Pay and Google Pay are the part that is easy to get subtly wrong. On
 *   checkout.stripe.com they work out of the box: the domain is Stripe's own and
 *   is already registered with Apple, so there is no domain-verification file to
 *   host and nothing to re-register when a deploy preview gets its own hostname.
 *   Embedding the Payment Element would put that registration on us AND would
 *   require loosening this site's `Permissions-Policy: payment=()` header, which
 *   is currently doing real work.
 *
 *   The redirect also means no card number, no wallet token, and no payment
 *   iframe ever touches this origin. There is nothing here for a cross-site
 *   script on our own page to steal.
 *
 * WHY NO SESSION HERE SENDS `payment_method_types`
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
 * was written after finding `STRIPE_SECRET_KEY=#22D3EE` (a hex color, pasted
 * into the wrong line) sitting in a real environment file. A key that merely
 * exists sends the request, gets a 401, and surfaces to the reader as "we could
 * not open the payment page", which points at Stripe being down when the
 * problem is one line of configuration.
 *
 * Refusing it here turns that into the "not set up" state instead, which is
 * honest, still offers PayPal and Venmo, and puts the real reason in the server
 * log where somebody can act on it.
 *
 * `sk_` is a standard secret key, `rk_` a restricted one. Both are valid here.
 */
export function secretKey(): string | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]/.test(key)) {
    console.error(
      "[stripe] STRIPE_SECRET_KEY is set but is not a Stripe secret key " +
        "(expected it to start with sk_test_, sk_live_, rk_test_ or rk_live_). " +
        "Card payments are disabled until it is corrected.",
    );
    return null;
  }
  return key;
}

/**
 * Stripe reads its own API version from the account unless a request pins one.
 * `STRIPE_API_VERSION` pins it when set, and is deliberately not defaulted to a
 * literal in this file: a version string typed here that the account has never
 * seen is a hard 400 on every payment, and the fields this codebase reads have
 * been stable on Checkout Sessions since it launched.
 */
export function versionHeader(): Record<string, string> {
  const v = process.env.STRIPE_API_VERSION;
  return v && v.trim() ? { "Stripe-Version": v.trim() } : {};
}

/**
 * Flatten a nested object into Stripe's bracketed form encoding, which is the
 * only body format the API takes. `{ line_items: [{ quantity: 1 }] }` becomes
 * `line_items[0][quantity]=1`.
 */
export function encodeForm(input: Record<string, unknown>, prefix = ""): string[] {
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

export async function stripeRequest<T>(
  path: string,
  init: {
    method: "GET" | "POST";
    body?: Record<string, unknown>;
    idempotencyKey?: string;
  },
): Promise<StripeResult<T>> {
  const key = secretKey();
  if (!key) {
    console.warn("[stripe] STRIPE_SECRET_KEY is not set; card payments are unavailable.");
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
      console.error("[stripe] Stripe responded", res.status, text.slice(0, 500));
      return { ok: false, reason: "error", detail: `stripe ${res.status}` };
    }
    return { ok: true, data: JSON.parse(text) as T };
  } catch (err) {
    console.error("[stripe] Stripe request failed", err);
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
  /** Unix seconds. Stripe's own end of the session's life. */
  expires_at: number | null;
  /** Read by the order reconcile path; the id Stripe gave the payment. */
  payment_intent?: string | { id?: string } | null;
  /** False for a test-mode session. */
  livemode?: boolean;
  /**
   * Read ONLY by the receipt replay script, which has a session id and needs an
   * address to send to. Nothing stores it: the donation ledger deliberately
   * holds no donor identity, so the address is fetched from Stripe at the moment
   * it is used and dropped again. See migration 0270.
   */
  customer_details?: { email?: string | null } | null;
};

/**
 * Read one session back.
 *
 * The session id is the only thing the browser carries out of Checkout, so a
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

/**
 * Close a session so it can no longer be paid.
 *
 * Stripe answers 200 for an open session and 400 for one that is already
 * expired or complete. That 400 comes back as `detail: "already-closed"`, and it
 * does not say which of the two it was, which matters enormously: one means
 * nothing happened and the other means the customer has paid. The caller must
 * retrieve the session and read its status (lib/commerce/stripe.ts
 * closeOpenSession).
 */
export async function expireCheckoutSession(
  sessionId: string,
): Promise<StripeResult<CheckoutSession>> {
  const result = await stripeRequest<CheckoutSession>(
    `/checkout/sessions/${encodeURIComponent(sessionId)}/expire`,
    { method: "POST" },
  );
  if (!result.ok && result.reason === "error" && result.detail === "stripe 400") {
    return { ok: false, reason: "error", detail: "already-closed" };
  }
  return result;
}

/** Stripe's own id shape. Checked before a lookup so junk never leaves our server. */
export function isCheckoutSessionId(value: unknown): value is string {
  return typeof value === "string" && /^cs_[A-Za-z0-9_]{10,255}$/.test(value);
}

/** Whether card payments can run at all right now. */
export function stripeConfigured(): boolean {
  return secretKey() !== null;
}
