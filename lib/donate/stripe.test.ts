import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDonationCheckout,
  isCheckoutSessionId,
  retrieveCheckoutSession,
  stripeConfigured,
} from "./stripe";

/**
 * What Stripe would actually receive.
 *
 * The live API cannot be called from a test, so the next best thing is to pin
 * the exact bytes we would send it. This suite exists because the encoding is
 * the part of a Stripe integration that goes wrong silently: a nested object
 * flattened the wrong way produces a 400 that reads like a parameter problem,
 * and `payment_method_types` creeping back in would remove Apple Pay and Google
 * Pay from every session without any error at all.
 */

const OK_SESSION = {
  id: "cs_test_a1b2c3d4e5f6g7h8",
  url: "https://checkout.stripe.com/c/pay/cs_test_a1b2c3d4e5f6g7h8",
  amount_total: 2500,
  currency: "usd",
  status: "open",
  payment_status: "unpaid",
};

/** Parse the form body we sent back into a map, the way Stripe's parser would. */
function sentBody(mock: ReturnType<typeof vi.fn>): URLSearchParams {
  const [, init] = mock.mock.calls[0] as [string, RequestInit];
  return new URLSearchParams(String(init.body));
}

function sentHeaders(mock: ReturnType<typeof vi.fn>): Record<string, string> {
  const [, init] = mock.mock.calls[0] as [string, RequestInit];
  return init.headers as Record<string, string>;
}

describe("stripe donation client", () => {
  const realKey = process.env.STRIPE_SECRET_KEY;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = "sk_test_abc123";
    fetchMock = vi.fn(async () => new Response(JSON.stringify(OK_SESSION), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.STRIPE_SECRET_KEY = realKey;
    delete process.env.STRIPE_API_VERSION;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts a donation session with the parameters Stripe expects", async () => {
    const result = await createDonationCheckout({
      amountCents: 2500,
      successUrl: "https://ffbeacon.com/donate/thanks?session_id={CHECKOUT_SESSION_ID}",
      cancelUrl: "https://ffbeacon.com/rankings",
      customerEmail: "reader@example.com",
      origin: "header_modal",
    });

    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(init.method).toBe("POST");

    const body = sentBody(fetchMock);
    expect(body.get("mode")).toBe("payment");
    expect(body.get("submit_type")).toBe("donate");
    expect(body.get("line_items[0][quantity]")).toBe("1");
    expect(body.get("line_items[0][price_data][currency]")).toBe("usd");
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("2500");
    expect(body.get("line_items[0][price_data][product_data][name]")).toBe(
      "FF Beacon donation",
    );
    expect(body.get("customer_email")).toBe("reader@example.com");
    expect(body.get("metadata[product]")).toBe("ffbeacon_donation");
    expect(body.get("metadata[origin]")).toBe("header_modal");
    expect(body.get("payment_intent_data[description]")).toBe("FF Beacon donation");
    // Session metadata does not propagate to the PaymentIntent, so it is mirrored.
    // Without this the Dashboard's Payments list, which is where a donation is
    // actually reconciled, shows no origin at all.
    expect(body.get("payment_intent_data[metadata][origin]")).toBe("header_modal");
  });

  // The template is a literal Stripe substitutes on redirect. Percent-encoding
  // the braces on the wire is correct and expected; mangling them is not.
  it("keeps the session id placeholder intact through form encoding", async () => {
    await createDonationCheckout({
      amountCents: 500,
      successUrl: "https://ffbeacon.com/donate/thanks?session_id={CHECKOUT_SESSION_ID}",
      cancelUrl: "https://ffbeacon.com/",
      origin: "donate_page",
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).toContain("%7BCHECKOUT_SESSION_ID%7D");
    expect(sentBody(fetchMock).get("success_url")).toBe(
      "https://ffbeacon.com/donate/thanks?session_id={CHECKOUT_SESSION_ID}",
    );
  });

  /**
   * The wallet guard. Sending payment_method_types pins the session to that
   * list and silently drops Apple Pay, Google Pay and Link, which is the entire
   * reason this feature exists. Nothing about it errors, so only a test catches
   * a well-meaning future edit.
   */
  it("never sends payment_method_types, so wallets stay switched on", async () => {
    await createDonationCheckout({
      amountCents: 1000,
      successUrl: "https://ffbeacon.com/donate/thanks",
      cancelUrl: "https://ffbeacon.com/",
      origin: "donate_page",
    });
    for (const key of sentBody(fetchMock).keys()) {
      expect(key.startsWith("payment_method_types")).toBe(false);
    }
  });

  it("omits customer_email entirely when nobody is signed in", async () => {
    await createDonationCheckout({
      amountCents: 1000,
      successUrl: "https://ffbeacon.com/donate/thanks",
      cancelUrl: "https://ffbeacon.com/",
      customerEmail: null,
      origin: "donate_page",
    });
    expect(sentBody(fetchMock).has("customer_email")).toBe(false);
  });

  it("authenticates and makes the create call safe to retry", async () => {
    await createDonationCheckout({
      amountCents: 1000,
      successUrl: "https://ffbeacon.com/donate/thanks",
      cancelUrl: "https://ffbeacon.com/",
      origin: "donate_page",
    });
    const headers = sentHeaders(fetchMock);
    expect(headers.Authorization).toBe("Bearer sk_test_abc123");
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
    // Unpinned unless the environment asks for a version.
    expect(headers["Stripe-Version"]).toBeUndefined();
  });

  it("pins the API version only when one is configured", async () => {
    process.env.STRIPE_API_VERSION = "2025-03-31.basil";
    await createDonationCheckout({
      amountCents: 1000,
      successUrl: "https://ffbeacon.com/donate/thanks",
      cancelUrl: "https://ffbeacon.com/",
      origin: "donate_page",
    });
    expect(sentHeaders(fetchMock)["Stripe-Version"]).toBe("2025-03-31.basil");
  });

  it("reads a session back without a body", async () => {
    await retrieveCheckoutSession("cs_test_a1b2c3d4e5f6g7h8");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.stripe.com/v1/checkout/sessions/cs_test_a1b2c3d4e5f6g7h8",
    );
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("turns a Stripe error into a result rather than a throw", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "No such customer" } }), {
        status: 400,
      }),
    );
    const result = await createDonationCheckout({
      amountCents: 1000,
      successUrl: "https://ffbeacon.com/donate/thanks",
      cancelUrl: "https://ffbeacon.com/",
      origin: "donate_page",
    });
    expect(result).toEqual({ ok: false, reason: "error", detail: "stripe 400" });
  });

  it("turns a network failure into a result rather than a throw", async () => {
    fetchMock.mockRejectedValueOnce(new Error("socket hang up"));
    const result = await createDonationCheckout({
      amountCents: 1000,
      successUrl: "https://ffbeacon.com/donate/thanks",
      cancelUrl: "https://ffbeacon.com/",
      origin: "donate_page",
    });
    expect(result).toEqual({ ok: false, reason: "error", detail: "request failed" });
  });
});

describe("key configuration", () => {
  const realKey = process.env.STRIPE_SECRET_KEY;
  afterEach(() => {
    process.env.STRIPE_SECRET_KEY = realKey;
    vi.restoreAllMocks();
  });

  it("accepts real secret and restricted keys, in both modes", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const key of ["sk_test_abc123", "sk_live_abc123", "rk_test_abc", "rk_live_abc"]) {
      process.env.STRIPE_SECRET_KEY = key;
      expect(stripeConfigured(), key).toBe(true);
    }
  });

  /**
   * The literal value found in a real .env.local: a brand hex colour pasted
   * onto the wrong line. Without the shape check this "configures" Stripe and
   * every donation dies on a 401 that looks like an outage.
   */
  it("refuses a value that is not a Stripe key at all", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const junk of ["#22D3EE", "pk_test_abc123", "changeme", "sk_", " "]) {
      process.env.STRIPE_SECRET_KEY = junk;
      expect(stripeConfigured(), junk).toBe(false);
    }
    expect(errorSpy).toHaveBeenCalled();
  });

  it("is unconfigured when the variable is absent", () => {
    delete process.env.STRIPE_SECRET_KEY;
    expect(stripeConfigured()).toBe(false);
  });
});

describe("isCheckoutSessionId", () => {
  it("accepts Stripe's own id shape", () => {
    expect(isCheckoutSessionId("cs_test_a1b2c3d4e5f6g7h8")).toBe(true);
    expect(isCheckoutSessionId("cs_live_a1b2c3d4e5f6g7h8")).toBe(true);
  });

  it("refuses anything else before it can reach a URL", () => {
    for (const bad of [
      "",
      "cs_",
      "pi_1234567890",
      "cs_test_a1b2/../../secrets",
      "cs_test_<script>",
      `cs_test_${"a".repeat(300)}`,
      null,
      undefined,
      42,
    ]) {
      expect(isCheckoutSessionId(bad), String(bad)).toBe(false);
    }
  });
});
