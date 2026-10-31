import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  encodeForm,
  expireCheckoutSession,
  isCheckoutSessionId,
  retrieveCheckoutSession,
  stripeConfigured,
} from "./client";

const OK_SESSION = {
  id: "cs_test_a1b2c3d4e5f6g7h8",
  url: "https://checkout.stripe.com/c/pay/cs_test_a1b2c3d4e5f6g7h8",
  amount_total: 2500,
  currency: "usd",
  status: "open",
  payment_status: "unpaid",
  expires_at: 1790000000,
};

describe("encodeForm", () => {
  it("flattens nested objects and arrays into Stripe's bracketed form", () => {
    const pairs = encodeForm({
      mode: "payment",
      line_items: [{ quantity: 1, price_data: { unit_amount: 995 } }],
      skipped: undefined,
      nothing: null,
    });
    const body = new URLSearchParams(pairs.join("&"));
    expect(body.get("mode")).toBe("payment");
    expect(body.get("line_items[0][quantity]")).toBe("1");
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("995");
    expect(body.has("skipped")).toBe(false);
    expect(body.has("nothing")).toBe(false);
  });
});

describe("session calls", () => {
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reads a session back without a body", async () => {
    await retrieveCheckoutSession("cs_test_a1b2c3d4e5f6g7h8");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions/cs_test_a1b2c3d4e5f6g7h8");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("expires a session with a POST to its own expire path", async () => {
    const result = await expireCheckoutSession("cs_test_a1b2c3d4e5f6g7h8");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.stripe.com/v1/checkout/sessions/cs_test_a1b2c3d4e5f6g7h8/expire",
    );
    expect(init.method).toBe("POST");
    expect(result.ok).toBe(true);
  });

  /**
   * The answer that decides whether a customer has already paid. It must reach
   * the caller as something distinct, so the caller retrieves the session rather
   * than treating it as a failure and giving up.
   */
  it("reports a 400 on expire as already-closed", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "not open" } }), { status: 400 }),
    );
    const result = await expireCheckoutSession("cs_test_a1b2c3d4e5f6g7h8");
    expect(result).toEqual({ ok: false, reason: "error", detail: "already-closed" });
  });

  it("does not mistake any other failure for a closed session", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    const result = await expireCheckoutSession("cs_test_a1b2c3d4e5f6g7h8");
    expect(result).toEqual({ ok: false, reason: "error", detail: "stripe 500" });
  });

  it("turns a network failure into a result rather than a throw", async () => {
    fetchMock.mockRejectedValueOnce(new Error("socket hang up"));
    const result = await retrieveCheckoutSession("cs_test_a1b2c3d4e5f6g7h8");
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
   * The literal value found in a real .env.local: a brand hex color pasted
   * onto the wrong line. Without the shape check this "configures" Stripe and
   * every payment dies on a 401 that looks like an outage.
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
