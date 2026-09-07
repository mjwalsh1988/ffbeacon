import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/http-origin";
import { claimRateLimitSlot } from "@/lib/rate-limit-claim";
import { parseDonationAmount } from "@/lib/donate/amounts";
import { safeReturnPath } from "@/lib/donate/return-path";
import { createDonationCheckout, stripeConfigured } from "@/lib/donate/stripe";
import { SITE } from "@/lib/site";

/**
 * POST /api/donate/checkout
 *
 * Opens a Stripe Checkout Session for a donation and hands back the URL to send
 * the browser to. It creates no charge, writes nothing to our database, and
 * stores no card data: everything about the payment happens on Stripe's own
 * domain, which is what makes Apple Pay and Google Pay work here without this
 * site ever touching a wallet token.
 *
 * The defenses, in the order they run and for the reason each is in that place:
 *
 *   1. Same-origin. A cross-site page cannot forge an Origin header, so this is
 *      the cheap first filter on a state-changing POST, matching the guide
 *      submission route.
 *   2. Configuration. If there is no Stripe key there is nothing to open, and
 *      saying so plainly is better than a rate-limit slot spent on a request
 *      that was never going to work.
 *   3. Shape and amount. Free, and it means garbage input never costs a reader
 *      their budget and never reaches Stripe.
 *   4. The rate limit, claimed LAST, immediately before the only expensive call.
 *      Validating first is the same ordering Trade Ideas uses and for the same
 *      reason: a stale or malformed request must not burn a real donor's slot.
 *
 * WHY THE LIMITER FAILS CLOSED HERE
 *   `claimRateLimitSlot` returns false when it cannot evaluate the limit at all,
 *   which means a database wobble turns card donations off. That is the right
 *   trade for THIS endpoint, unlike the lineups free-agent panel: an unbounded
 *   session-creation endpoint is exactly what a card tester wants, and the modal
 *   still shows PayPal and Venmo, neither of which touches our server. Nobody
 *   who wants to give is left without a way to.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Per actor (auth user, else hashed client IP). Generous for a person, dull for a script. */
const RATE_MAX = 8;
const RATE_WINDOW_SECONDS = 60;

/**
 * Where the donation started. Recorded on the Stripe session, never trusted for
 * anything.
 *
 * Named SURFACES rather than origins because "origin" already means an HTTP
 * origin twice in this file (the CSRF check, and the Stripe host allowlist), and
 * a security-sensitive file should not use one word for two things.
 */
const KNOWN_SURFACES = new Set(["header_modal", "donate_page"]);

/**
 * The site origin with any trailing slash removed.
 *
 * `NEXT_PUBLIC_SITE_URL` is deploy configuration and nothing validates its
 * shape, so a trailing slash produces `https://ffbeacon.com//donate/thanks`.
 * Stripe accepts that and the router may not, and a protocol-relative-looking
 * double slash is the last thing this endpoint should be generating given how
 * carefully safeReturnPath avoids producing one.
 */
const SITE_ORIGIN = SITE.url.replace(/\/+$/, "");

export async function POST(req: Request) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: "Request blocked." }, { status: 403 });
  }

  if (!stripeConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Card donations are not set up right now. PayPal and Venmo still work, and they reach the same place.",
      },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  const raw = (body ?? {}) as Record<string, unknown>;

  const amount = parseDonationAmount(raw.amount);
  if (!amount.ok) {
    return NextResponse.json({ ok: false, error: amount.error }, { status: 400 });
  }

  const surface =
    typeof raw.surface === "string" && KNOWN_SURFACES.has(raw.surface)
      ? raw.surface
      : "unknown";

  // Both redirect targets are built from our OWN configured site URL, never from
  // the request's Host header, so a forged host cannot point Stripe's redirect
  // at somebody else's domain. Only the path of the cancel target comes from the
  // browser, and safeReturnPath re-resolves it against that same origin.
  const returnPath = safeReturnPath(raw.returnPath, SITE_ORIGIN);
  const successUrl = `${SITE_ORIGIN}/donate/thanks?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${SITE_ORIGIN}${returnPath}`;

  if (
    !(await claimRateLimitSlot({
      bucket: "donate-checkout",
      max: RATE_MAX,
      windowSeconds: RATE_WINDOW_SECONDS,
    }))
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "That is a lot of checkouts in one minute. Give it a moment and try again, or use PayPal or Venmo.",
      },
      { status: 429 },
    );
  }

  // AFTER the claim, deliberately. This is a network round trip to Supabase
  // Auth, so running it first left an unmetered call in front of the limit and
  // contradicted this file's own rule that the claim comes immediately before
  // the expensive work. Nothing above needs the result; only the Stripe call
  // below does.
  //
  // A signed-in reader gets their email prefilled on Stripe's form. It is read
  // from the session on the server, because an email supplied in the body would
  // let anyone put anyone else's address on a receipt.
  let customerEmail: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    customerEmail = user?.email ?? null;
  } catch {
    // Not being able to read a session is not a reason to refuse a donation.
    // Stripe collects the address itself when we send nothing.
  }

  const session = await createDonationCheckout({
    amountCents: amount.cents,
    successUrl,
    cancelUrl,
    customerEmail,
    origin: surface,
  });

  if (!session.ok || !session.data.url) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "We could not open the payment page. Try again in a moment, or use PayPal or Venmo instead.",
      },
      { status: 502 },
    );
  }

  // Belt and braces on the one URL we ask a browser to follow. The value came
  // from our own authenticated call to Stripe, so this can only fire if Stripe
  // itself changes hosts, and a redirect is not the place to find that out.
  let host: string;
  try {
    host = new URL(session.data.url).host;
  } catch {
    host = "";
  }
  // IF STRIPE CUSTOM DOMAINS IS EVER ENABLED on the account, Checkout serves
  // from a subdomain of ffbeacon.com instead and every donation starts failing
  // here with a log line that reads like a Stripe outage. Add that host to this
  // check at the same time as enabling the feature, not afterwards.
  if (host !== "checkout.stripe.com" && !host.endsWith(".stripe.com")) {
    console.error("[donate] refusing to redirect to unexpected host", host);
    return NextResponse.json(
      { ok: false, error: "We could not open the payment page. Please try again." },
      { status: 502 },
    );
  }

  return NextResponse.json(
    { ok: true, url: session.data.url },
    { headers: { "Cache-Control": "no-store" } },
  );
}
