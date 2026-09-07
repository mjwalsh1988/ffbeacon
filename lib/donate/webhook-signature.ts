import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifying that a webhook really came from Stripe.
 *
 * THIS IS THE WHOLE SECURITY MODEL OF THE RECEIPT SYSTEM. The endpoint it
 * guards is a public, unauthenticated POST that causes us to send an email to an
 * address named in the request body. Without a verified signature, anyone who
 * finds the URL can make FF Beacon email anybody a receipt for a donation that
 * never happened, from our verified sending domain, at whatever amount they
 * choose. That is a spam relay wearing our brand, and it is one missing check
 * away at all times.
 *
 * Written by hand rather than pulled from the Stripe SDK for the same reason the
 * rest of lib/donate is: this codebase calls Stripe over REST and carries no SDK.
 * The scheme is small and fully specified, so implementing it is a dozen lines,
 * but every one of those lines is load bearing:
 *
 *   Stripe-Signature: t=1699999999,v1=<hex hmac>,v1=<hex hmac>
 *
 *   signed payload = "<t>.<raw request body>"
 *   expected       = HMAC-SHA256(signed payload, whsec_...)
 *
 * Four things this gets right that a naive version gets wrong:
 *
 *   1. THE BODY MUST BE THE RAW BYTES. Parsing the JSON and re-serialising it
 *      changes key order and whitespace, and the signature then never matches.
 *      The route reads `await req.text()` and hands the string straight here.
 *   2. THE COMPARISON IS TIMING SAFE. A byte-by-byte early-exit compare leaks
 *      the expected signature to a patient attacker.
 *   3. THE TIMESTAMP IS CHECKED. Without a tolerance, a single captured request
 *      can be replayed forever. Stripe's own default is five minutes.
 *   4. THERE CAN BE MORE THAN ONE v1. During a signing-secret rotation Stripe
 *      sends a signature for each active secret, so every one is tried.
 *
 * Pure and dependency-free apart from node:crypto, so it is tested directly.
 */

/** How far out of date a signature may be, matching Stripe's own default. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "no-secret" | "malformed" | "stale" | "mismatch" };

type Parsed = { timestamp: number; signatures: string[] };

/** Pull `t` and every `v1` out of the header, or null when it is not that shape. */
function parseHeader(header: string): Parsed | null {
  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") {
      // Seconds since the epoch. Anything else is not Stripe's header.
      if (!/^\d{1,15}$/.test(value)) return null;
      timestamp = Number(value);
    } else if (key === "v1") {
      // Hex only, and exactly 64 characters, so a junk value can never reach
      // timingSafeEqual with a length that happens to match. Stripe sends
      // lowercase; accepting uppercase costs nothing and removes a way for this
      // to break if that ever changes.
      if (/^[a-fA-F0-9]{64}$/.test(value)) signatures.push(value);
    }
  }

  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

/**
 * Verify one Stripe webhook request.
 *
 * `nowSeconds` is injected so the replay window can be tested without waiting
 * five minutes, and so the function stays pure.
 */
export function verifyStripeSignature(params: {
  /** The exact bytes of the request body, unparsed. */
  rawBody: string;
  /** The `stripe-signature` request header. */
  header: string | null;
  /** The endpoint's signing secret, `whsec_...`. */
  secret: string | undefined | null;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): VerifyResult {
  const secret = params.secret?.trim();
  // FAILS CLOSED. No secret means every request is unverifiable, and an
  // unverifiable request must never be treated as Stripe's.
  if (!secret) return { ok: false, reason: "no-secret" };
  if (!params.header) return { ok: false, reason: "malformed" };

  const parsed = parseHeader(params.header);
  if (!parsed) return { ok: false, reason: "malformed" };

  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = params.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
  // Absolute difference, so a timestamp far in the FUTURE is rejected too. A
  // one-sided check lets an attacker who can set a future timestamp mint a
  // request that stays valid indefinitely.
  if (Math.abs(now - parsed.timestamp) > tolerance) {
    return { ok: false, reason: "stale" };
  }

  const expected = createHmac("sha256", secret)
    .update(`${parsed.timestamp}.${params.rawBody}`, "utf8")
    .digest();

  for (const candidate of parsed.signatures) {
    const given = Buffer.from(candidate, "hex");
    if (given.length === expected.length && timingSafeEqual(given, expected)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: "mismatch" };
}

/**
 * Build a signature header the way Stripe would.
 *
 * Exported because the tests need to produce a genuine one, and a test that
 * hand-rolls its own copy of the signing rule is a test that passes when both
 * copies are wrong together.
 */
export function signPayloadForTest(
  rawBody: string,
  secret: string,
  timestamp: number,
): string {
  const sig = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
  return `t=${timestamp},v1=${sig}`;
}
