import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyStripeSignature } from "@/lib/donate/webhook-signature";
import { sendDonationReceipt } from "@/lib/email/donation-emails";
import { redactStripeEvent } from "@/lib/donate/redact";

/**
 * POST /api/donate/webhook
 *
 * Stripe tells us a donation completed, and we send the donor our own branded
 * receipt through Resend. This exists so the receipt does not depend on the
 * donor keeping the thank-you page open: they can close the tab the instant
 * they pay and the email still arrives, because Stripe calls us rather than the
 * browser doing it.
 *
 * THE SIGNATURE IS THE ONLY THING STANDING BETWEEN THIS AND A SPAM RELAY.
 * The endpoint is public and unauthenticated by necessity, and its whole job is
 * to email an address named in the request body. Unverified, anybody who finds
 * the URL can make our verified sending domain deliver a fake donation receipt,
 * for any amount, to anyone. Verification runs FIRST, before the body is parsed,
 * before the database is touched, and it fails closed when the signing secret is
 * absent. See lib/donate/webhook-signature.ts.
 *
 * EXACTLY-ONCE DELIVERY. Stripe retries until it gets a 2xx and may deliver the
 * same event more than once by design, so "send an email on every event" means
 * "send the donor four receipts". Two things prevent that: a unique row per
 * Checkout Session, and `try_claim_donation_receipt`, which hands the send to
 * exactly one caller (migration 0270). A duplicate delivery claims nothing and
 * returns 200 immediately.
 *
 * WHICH EVENTS. `checkout.session.completed` fires when Checkout finishes, which
 * for a card is also when it is paid. A delayed-notification method finishes
 * unpaid and settles later, which arrives as
 * `checkout.session.async_payment_succeeded`. Both are handled, and the receipt
 * is sent only when the session is actually PAID, because a receipt for money
 * that has not arrived is not a receipt.
 *
 * WHAT A NON-2xx MEANS HERE. Stripe retries EVERY non-2xx identically, with
 * backoff, for up to three days in live mode, and then gives up for good. It
 * does not distinguish a 400 from a 500, and it counts a 3xx as a failure too.
 *
 * So the codes here are chosen for their meaning to whoever reads the Event
 * deliveries tab, not to steer Stripe: 400 says this request was never valid,
 * 500 says try us again, 200 says we are finished with this event whether or not
 * an email went out. The one place the choice genuinely changes behaviour is
 * that anything answered 200 is never retried, which is why a receipt that might
 * still be recoverable is answered 500 instead.
 */

// The signature is computed over the RAW request body, so this must run on
// Node with the body read as text. Parsing and re-serialising the JSON changes
// byte order and the signature can never match again.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only these two say a donation reached its conclusion. */
const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
]);

/** Shape of the slice of the Stripe event this route reads. */
type StripeEvent = {
  id?: string;
  type?: string;
  /** When STRIPE emitted this event, which for a payment event is when it happened. */
  created?: number;
  /** False for a test-mode event. Recorded so a test receipt is never mistaken for a real one. */
  livemode?: boolean;
  data?: {
    object?: {
      id?: string;
      object?: string;
      mode?: string;
      payment_status?: string;
      amount_total?: number;
      currency?: string;
      payment_intent?: string | { id?: string } | null;
      customer_details?: { email?: string | null } | null;
      customer_email?: string | null;
      metadata?: Record<string, string> | null;
      created?: number;
    };
  };
};

/** The payment intent id, which Stripe sends as a string or an expanded object. */
function paymentIntentId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

export async function POST(req: Request) {
  // 1. RAW BODY FIRST, and never req.json(). See the runtime note above.
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ received: false }, { status: 400 });
  }

  // 2. VERIFY BEFORE ANYTHING ELSE. Nothing below this line may run on a
  //    request we have not proved came from Stripe.
  const verified = verifyStripeSignature({
    rawBody,
    header: req.headers.get("stripe-signature"),
    secret: process.env.STRIPE_WEBHOOK_SECRET,
  });
  if (!verified.ok) {
    if (verified.reason === "no-secret") {
      console.error(
        "[donate] STRIPE_WEBHOOK_SECRET is not set, so donation receipts cannot be " +
          "sent. Every webhook will be refused until it is configured.",
      );
    } else {
      console.warn("[donate] rejected an unverified webhook:", verified.reason);
    }
    // 400 rather than 500. Stripe retries either one the same way, so the choice
    // is for whoever reads the deliveries log: this request was never valid, and
    // no retry of it will be either.
    return NextResponse.json({ received: false }, { status: 400 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return NextResponse.json({ received: false }, { status: 400 });
  }

  // 3. Anything we do not handle is acknowledged and dropped. The 200 is what
  //    stops Stripe retrying, for three days, an event we were never going to
  //    act on.
  if (!event.type || !HANDLED_EVENTS.has(event.type)) {
    return NextResponse.json({ received: true, handled: false });
  }

  const session = event.data?.object;
  const sessionId = session?.id;
  if (!sessionId || typeof sessionId !== "string") {
    console.warn("[donate] webhook event carried no session id");
    return NextResponse.json({ received: true, handled: false });
  }

  // 4. PAID, or nothing. `checkout.session.completed` fires for a
  //    delayed-notification method before the money exists; that session comes
  //    back later as async_payment_succeeded.
  if (session?.payment_status !== "paid" && session?.payment_status !== "no_payment_required") {
    return NextResponse.json({ received: true, handled: false, reason: "not-paid" });
  }

  const amountCents =
    typeof session.amount_total === "number" ? session.amount_total : 0;
  const currency =
    typeof session.currency === "string" ? session.currency.toLowerCase() : "usd";
  // `customer_details.email` first: that is the address the donor confirmed on
  // Stripe's own form, and they may have edited the one we prefilled.
  const rawEmail =
    (typeof session.customer_details?.email === "string"
      ? session.customer_details.email
      : null) ??
    (typeof session.customer_email === "string" ? session.customer_email : null);

  // Shape-checked before it reaches a mail provider. Stripe validates it too and
  // the JSON body rules out classic header injection, so this is the third layer
  // rather than the first, and it costs nothing.
  const email =
    rawEmail &&
    rawEmail.length <= 254 &&
    /^[^\s@,<>;"]+@[^\s@,<>;"]+\.[^\s@,<>;"]+$/.test(rawEmail)
      ? rawEmail
      : null;
  if (rawEmail && !email) {
    console.warn("[donate] session", sessionId, "carried an unusable email address");
  }

  const admin = createAdminClient();

  // 5. Record the donation before attempting anything. `ignoreDuplicates` makes
  //    a repeat delivery a no-op rather than an error, and the row is what the
  //    claim below operates on.
  const { error: insertError } = await admin
    .from("donation_receipts")
    .upsert(
      {
        stripe_session_id: sessionId,
        stripe_payment_intent_id: paymentIntentId(session.payment_intent),
        amount_total_cents: amountCents,
        currency,
        livemode: event.livemode ?? null,
        surface: session.metadata?.origin ?? null,
        status: email ? "pending" : "skipped",
        last_error: email ? null : "no email address on the session",
        metadata: redactStripeEvent(event),
      },
      { onConflict: "stripe_session_id", ignoreDuplicates: true },
    );

  if (insertError) {
    console.error("[donate] could not record the donation", insertError.message);
    // 500 so Stripe brings it back. Without a row there is no idempotency, and
    // sending the email anyway would risk duplicates on the retry.
    return NextResponse.json({ received: false }, { status: 500 });
  }

  if (!email) {
    // Checkout collects an email in payment mode, so this should not happen. If
    // it does, the donation is still recorded and the row says why no receipt
    // went out, rather than the event being retried forever.
    console.warn("[donate] session", sessionId, "had no email; no receipt sent");
    return NextResponse.json({ received: true, handled: false, reason: "no-email" });
  }

  // 6. Claim the send. Exactly one caller wins; a concurrent retry gets false
  //    and sends nothing.
  const { data: claimed, error: claimError } = await admin.rpc(
    "try_claim_donation_receipt",
    { p_session_id: sessionId },
  );
  if (claimError) {
    console.error("[donate] receipt claim failed", claimError.message);
    return NextResponse.json({ received: false }, { status: 500 });
  }
  if (!claimed) {
    // FALSE MEANS TWO DIFFERENT THINGS AND THEY NEED DIFFERENT ANSWERS.
    //
    // Either the receipt is genuinely done (sent, or skipped because there was
    // no address), in which case this is a duplicate delivery and 200 is right.
    // Or another delivery holds the claim right now, which also covers the case
    // that matters: an invocation that died between claiming and recording,
    // leaving the row stuck in 'sending'. Answering 200 to that tells Stripe the
    // event is handled and it stops retrying, and the receipt is lost silently
    // and permanently.
    //
    // So the row is read and the two are told apart. A still-in-flight claim
    // gets a 500, Stripe retries after its backoff, and by then the claim is
    // past `p_stale_seconds` and reclaimable.
    const { data: row } = await admin
      .from("donation_receipts")
      .select("status, receipt_sent_at")
      .eq("stripe_session_id", sessionId)
      .maybeSingle();

    const finished =
      row?.receipt_sent_at != null || row?.status === "sent" || row?.status === "skipped";

    if (finished) {
      return NextResponse.json({ received: true, handled: false, reason: "already-sent" });
    }
    console.warn("[donate] receipt for", sessionId, "is mid-flight; asking Stripe to retry");
    return NextResponse.json({ received: false, reason: "in-flight" }, { status: 500 });
  }

  // 7. Send, then record the outcome either way.
  // THE EVENT'S TIMESTAMP, NOT THE SESSION'S. `session.created` is when the
  // donor opened Checkout, and a session lives for 24 hours, so a donor who
  // opened the modal and paid six hours later would get a receipt dated six
  // hours early. For a delayed-notification method the gap can be days, and
  // that is exactly the donor who reconciles a receipt against a bank
  // statement. The event's own `created` is when Stripe observed the payment.
  const paidAtIso =
    typeof event.created === "number"
      ? new Date(event.created * 1000).toISOString()
      : new Date().toISOString();

  const result = await sendDonationReceipt({
    to: email,
    amountCents,
    reference: sessionId,
    paidAtIso,
  });

  if (result.ok) {
    const { error: markError } = await admin
      .from("donation_receipts")
      .update({
        status: "sent",
        receipt_sent_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("stripe_session_id", sessionId);
    if (markError) {
      // The email HAS gone out. Saying so is the only thing left to do: a 500
      // here would have Stripe redeliver and the stale-claim window would then
      // send the donor a second copy of a receipt they already have.
      console.error(
        "[donate] receipt sent but the row could not be marked for session",
        sessionId,
        markError.message,
      );
    }
    return NextResponse.json({ received: true, handled: true });
  }

  // Resend is not configured. That is a deployment state rather than a fault in
  // this request, and retrying it will not fix it, so the row records the reason
  // and Stripe is told we are done. Without this the event would be retried for
  // days against an inbox that was never going to be reachable.
  // DEFERRED, NOT SKIPPED. Resend being unconfigured is a deployment state that
  // somebody fixes within the hour, and 'skipped' is terminal: the claim refuses
  // it forever, so the donation would keep its money, keep its promise of a
  // receipt on /donate/thanks, and never send one. 'deferred' stays claimable,
  // and `npm run donate:receipts` drains it once the key is in place. Only a
  // session with no usable address is genuinely terminal.
  const deferred = "skipped" in result && result.skipped === true;
  const { error: markError } = await admin
    .from("donation_receipts")
    .update({
      status: deferred ? "deferred" : "failed",
      last_error: deferred
        ? "RESEND_API_KEY is not configured"
        : "error" in result
          ? result.error
          : "send failed",
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_session_id", sessionId);
  if (markError) {
    console.error("[donate] could not record the send failure", markError.message);
  }

  if (deferred) {
    // 200 rather than 500: retrying for three days against an inbox that was
    // never going to be reachable helps nobody, and the replay script is the
    // recovery path.
    return NextResponse.json({ received: true, handled: false, reason: "email-disabled" });
  }

  // A real delivery failure. 500 brings Stripe back, and the row is now 'failed',
  // which the claim treats as reclaimable.
  console.error("[donate] receipt send failed for session", sessionId);
  return NextResponse.json({ received: false }, { status: 500 });
}
