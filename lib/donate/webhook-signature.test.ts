import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { signPayloadForTest, verifyStripeSignature } from "./webhook-signature";

/**
 * This is the security boundary of the whole receipt system, so it is tested as
 * an attacker would probe it rather than only on the happy path. The endpoint it
 * guards emails an address named in the request body, so a verification hole is
 * a spam relay operating from our verified sending domain.
 */

const SECRET = "whsec_test_0123456789abcdef";
const BODY = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
const NOW = 1_700_000_000;

function header(ts: number = NOW, body: string = BODY, secret: string = SECRET) {
  return signPayloadForTest(body, secret, ts);
}

describe("verifyStripeSignature", () => {
  it("accepts a signature Stripe would have produced", () => {
    expect(
      verifyStripeSignature({
        rawBody: BODY,
        header: header(),
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toEqual({ ok: true });
  });

  /**
   * FAILS CLOSED. An unset secret must never be read as "verification passed",
   * which is the single worst way this file could be wrong: it would turn a
   * missing environment variable into an open email relay.
   */
  it("refuses everything when no signing secret is configured", () => {
    for (const secret of [undefined, null, "", "   "]) {
      expect(
        verifyStripeSignature({
          rawBody: BODY,
          header: header(),
          secret,
          nowSeconds: NOW,
        }),
      ).toEqual({ ok: false, reason: "no-secret" });
    }
  });

  it("refuses a signature made with a different secret", () => {
    expect(
      verifyStripeSignature({
        rawBody: BODY,
        header: header(NOW, BODY, "whsec_someone_elses_secret"),
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toEqual({ ok: false, reason: "mismatch" });
  });

  // The reason the raw body must never be re-serialised before it gets here.
  it("refuses when the body has changed by even one byte", () => {
    const tampered = BODY.replace("evt_1", "evt_2");
    expect(
      verifyStripeSignature({
        rawBody: tampered,
        header: header(),
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toEqual({ ok: false, reason: "mismatch" });
  });

  it("refuses a replay of a captured request", () => {
    expect(
      verifyStripeSignature({
        rawBody: BODY,
        header: header(NOW),
        secret: SECRET,
        nowSeconds: NOW + 301,
      }),
    ).toEqual({ ok: false, reason: "stale" });
  });

  // A one-sided age check lets a timestamp set far in the future stay valid
  // indefinitely, which is a replay window that never closes.
  it("refuses a timestamp from the future as well as one from the past", () => {
    expect(
      verifyStripeSignature({
        rawBody: BODY,
        header: header(NOW + 3600),
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toEqual({ ok: false, reason: "stale" });
  });

  it("accepts anything inside the tolerance window", () => {
    for (const skew of [-299, -1, 0, 1, 299]) {
      expect(
        verifyStripeSignature({
          rawBody: BODY,
          header: header(NOW + skew),
          secret: SECRET,
          nowSeconds: NOW,
        }).ok,
        `skew ${skew}`,
      ).toBe(true);
    }
  });

  /**
   * Stripe sends one v1 per active secret during a signing-secret rotation.
   * Checking only the first would break every webhook for the length of the
   * rotation, which is exactly when nobody is watching.
   */
  it("accepts when any one of several signatures matches", () => {
    const good = createHmac("sha256", SECRET).update(`${NOW}.${BODY}`).digest("hex");
    const decoy = "a".repeat(64);
    expect(
      verifyStripeSignature({
        rawBody: BODY,
        header: `t=${NOW},v1=${decoy},v1=${good}`,
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toEqual({ ok: true });
  });

  it("refuses a header that is not the shape Stripe sends", () => {
    for (const bad of [
      null,
      "",
      "garbage",
      "v1=abc",
      `t=${NOW}`,
      `t=notanumber,v1=${"a".repeat(64)}`,
      `t=${NOW},v1=nothex`,
      `t=${NOW},v1=${"a".repeat(63)}`,
      `t=${NOW},v0=${"a".repeat(64)}`,
    ]) {
      const result = verifyStripeSignature({
        rawBody: BODY,
        header: bad,
        secret: SECRET,
        nowSeconds: NOW,
      });
      expect(result.ok, JSON.stringify(bad)).toBe(false);
    }
  });

  // A short or long hex string reaching timingSafeEqual throws rather than
  // returning false, which would turn a malformed header into a 500.
  it("never throws on a wrong-length signature", () => {
    expect(() =>
      verifyStripeSignature({
        rawBody: BODY,
        header: `t=${NOW},v1=${"ab"}`,
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).not.toThrow();
  });

  it("ignores unknown scheme fields Stripe may add later", () => {
    const good = createHmac("sha256", SECRET).update(`${NOW}.${BODY}`).digest("hex");
    expect(
      verifyStripeSignature({
        rawBody: BODY,
        header: `t=${NOW},v0=${"f".repeat(64)},v1=${good},extra=whatever`,
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toEqual({ ok: true });
  });
});
