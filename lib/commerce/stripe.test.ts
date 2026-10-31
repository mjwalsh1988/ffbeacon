import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSessionBody,
  closeOpenSession,
  isStripeHost,
  sessionExpiresAt,
  startStripeCheckout,
  stripeDashboardUrl,
} from "./stripe";
import { DEFAULT_COMMERCE_SETTINGS } from "./default-settings";
import type { Order } from "./types";

const SESSION_ID = "cs_test_a1b2c3d4e5f6g7h8";

const ORDER = {
  id: "11111111-1111-4111-8111-111111111111",
  order_number: "FFB-100001",
  amount_cents: 1595,
  stripe_session_id: SESSION_ID,
  stripe_session_attempts: 1,
  payment_status: "unpaid",
  product_snapshot: { slug: "team-review-premium", name: "Premium Review" },
  context: { teamName: "Night Owls", leagueName: "The League", season: "2026" },
} as unknown as Order;

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("stripe orders", () => {
  const realKey = process.env.STRIPE_SECRET_KEY;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = "sk_test_abc123";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.STRIPE_SECRET_KEY = realKey;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("closeOpenSession", () => {
    it("has nothing to do with no session, or once expired", async () => {
      expect(await closeOpenSession({ ...ORDER, stripe_session_id: null })).toBe("proceed");
      expect(await closeOpenSession({ ...ORDER, payment_status: "paid" })).toBe("proceed");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("proceeds on a 200", async () => {
      fetchMock.mockResolvedValueOnce(respond(200, { id: SESSION_ID, status: "expired" }));
      expect(await closeOpenSession(ORDER)).toBe("proceed");
    });

    it("proceeds when already closed and retrieved as expired", async () => {
      fetchMock.mockResolvedValueOnce(respond(400, {}));
      fetchMock.mockResolvedValueOnce(respond(200, { id: SESSION_ID, status: "expired" }));
      expect(await closeOpenSession(ORDER)).toBe("proceed");
    });

    it("says paid when already closed and retrieved as complete and paid", async () => {
      fetchMock.mockResolvedValueOnce(respond(400, {}));
      fetchMock.mockResolvedValueOnce(
        respond(200, { id: SESSION_ID, status: "complete", payment_status: "paid" }),
      );
      expect(await closeOpenSession(ORDER)).toBe("paid");
    });

    it("says pending for a delayed method, even on an order we called expired", async () => {
      fetchMock.mockResolvedValueOnce(respond(400, {}));
      fetchMock.mockResolvedValueOnce(
        respond(200, { id: SESSION_ID, status: "complete", payment_status: "unpaid" }),
      );
      expect(await closeOpenSession({ ...ORDER, payment_status: "expired" })).toBe("pending");
    });

    it("fails when a 400 was not really a closed session", async () => {
      fetchMock.mockResolvedValueOnce(respond(400, {}));
      fetchMock.mockResolvedValueOnce(respond(200, { id: SESSION_ID, status: "open" }));
      expect(await closeOpenSession(ORDER)).toBe("failed");
    });

    it("aborts on any other error", async () => {
      fetchMock.mockResolvedValueOnce(respond(500, {}));
      expect(await closeOpenSession(ORDER)).toBe("failed");
    });
  });

  describe("startStripeCheckout", () => {
    function fakeAdmin() {
      const updates: Array<Record<string, unknown>> = [];
      const inserted: unknown[] = [];
      const admin = {
        from: (table: string) =>
          table === "order_events"
            ? {
                insert: async (row: unknown) => {
                  inserted.push(row);
                  return { error: null };
                },
              }
            : {
                update: (row: Record<string, unknown>) => {
                  updates.push(row);
                  const chain = {
                    eq: () => chain,
                    in: () => chain,
                    select: () => chain,
                    maybeSingle: async () => ({ data: { id: "o" }, error: null }),
                  };
                  return chain;
                },
              },
      };
      return { admin: admin as never, updates, inserted };
    }

    it("creates no session when the old one was paid", async () => {
      fetchMock.mockResolvedValueOnce(respond(400, {}));
      fetchMock.mockResolvedValueOnce(
        respond(200, { id: SESSION_ID, status: "complete", payment_status: "paid" }),
      );
      const fake = fakeAdmin();
      const result = await startStripeCheckout(fake.admin, ORDER, null, DEFAULT_COMMERCE_SETTINGS);
      expect(result).toEqual({ kind: "already-paid" });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fake.updates).toHaveLength(0);
    });

    it("expires first, keys on attempts plus one, and stores the new session", async () => {
      fetchMock.mockResolvedValueOnce(respond(200, { id: SESSION_ID, status: "expired" }));
      fetchMock.mockResolvedValueOnce(
        respond(200, {
          id: "cs_test_new1234567890",
          url: "https://checkout.stripe.com/c/pay/x",
          expires_at: 1_800_000_000,
        }),
      );
      const fake = fakeAdmin();
      const result = await startStripeCheckout(fake.admin, ORDER, "a@example.com", DEFAULT_COMMERCE_SETTINGS);

      expect(result).toEqual({ kind: "redirect", url: "https://checkout.stripe.com/c/pay/x" });
      expect(String(fetchMock.mock.calls[0][0])).toContain("/expire");
      const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe(
        `order:${ORDER.id}:2`,
      );
      expect(fake.updates[0]).toMatchObject({
        stripe_session_id: "cs_test_new1234567890",
        stripe_session_attempts: 2,
        payment_status: "unpaid",
        stripe_session_expires_at: new Date(1_800_000_000_000).toISOString(),
        expires_at: new Date(1_800_000_300_000).toISOString(),
      });
      // A retry adds nothing to the timeline.
      expect(fake.inserted).toHaveLength(0);
    });

    it("refuses a URL that is not Stripe's", async () => {
      fetchMock.mockResolvedValueOnce(respond(200, { status: "expired" }));
      fetchMock.mockResolvedValueOnce(
        respond(200, { id: "cs_test_new1234567890", url: "https://evil.example/pay" }),
      );
      const fake = fakeAdmin();
      expect(
        await startStripeCheckout(fake.admin, ORDER, null, DEFAULT_COMMERCE_SETTINGS),
      ).toEqual({ kind: "failed" });
      expect(fake.updates).toHaveLength(0);
    });
  });
});

describe("sessionExpiresAt", () => {
  it("is minutes from now, inside Stripe's bounds", () => {
    const now = 1_000_000_000_000;
    expect(sessionExpiresAt(60, now)).toBe(1_000_000_000 + 3600);
    expect(sessionExpiresAt(5, now)).toBe(1_000_000_000 + 30 * 60);
    expect(sessionExpiresAt(5000, now)).toBe(1_000_000_000 + 1440 * 60);
  });
});

describe("buildSessionBody", () => {
  const body = buildSessionBody(ORDER, "a@example.com", 1_800_000_000);

  it("tags the session and the payment intent as an order", () => {
    const expected = {
      product: "ffbeacon_order",
      order_id: ORDER.id,
      order_number: "FFB-100001",
      product_slug: "team-review-premium",
    };
    expect(body.metadata).toEqual(expected);
    expect((body.payment_intent_data as { metadata: unknown }).metadata).toEqual(expected);
  });

  it("never pins payment methods and never takes a price from anywhere but the order", () => {
    expect(body).not.toHaveProperty("payment_method_types");
    expect(body).not.toHaveProperty("submit_type");
    const item = (body.line_items as Array<{ price_data: { unit_amount: number } }>)[0];
    expect(item.price_data.unit_amount).toBe(1595);
  });

  it("omits the email when there is none", () => {
    expect(buildSessionBody(ORDER, null, 1)).not.toHaveProperty("customer_email");
  });
});

describe("isStripeHost", () => {
  it("takes Stripe's hosts and nothing else", () => {
    expect(isStripeHost("https://checkout.stripe.com/c/pay/x")).toBe(true);
    expect(isStripeHost("https://stripe.com.evil.example/")).toBe(false);
    expect(isStripeHost("not a url")).toBe(false);
  });
});

describe("stripeDashboardUrl", () => {
  it("uses the test path only for a test payment", () => {
    expect(stripeDashboardUrl("pi_1", true)).toBe("https://dashboard.stripe.com/payments/pi_1");
    expect(stripeDashboardUrl("pi_1", null)).toBe("https://dashboard.stripe.com/payments/pi_1");
    expect(stripeDashboardUrl("pi_1", false)).toBe(
      "https://dashboard.stripe.com/test/payments/pi_1",
    );
  });
});
