import { beforeEach, describe, expect, it, vi } from "vitest";
import { signPayloadForTest } from "@/lib/donate/webhook-signature";

const SECRET = "whsec_test_donations";

const upsert = vi.fn(async () => ({ error: null }));
const rpc = vi.fn(async () => ({ data: true, error: null }));
const update = vi.fn(() => ({ eq: async () => ({ error: null }) }));
const send = vi.hoisted(() => vi.fn(async () => ({ ok: true, id: "re_1" })));

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({ from: () => ({ upsert, update }), rpc }),
}));
vi.mock("@/lib/email/donation-emails", () => ({ sendDonationReceipt: send }));

import { POST } from "./route";

function deliver(metadata: Record<string, string> | null) {
  const payload = JSON.stringify({
    id: "evt_1",
    type: "checkout.session.completed",
    created: 1_800_000_000,
    livemode: false,
    data: {
      object: {
        id: "cs_test_1",
        payment_status: "paid",
        amount_total: 1995,
        currency: "usd",
        customer_details: { email: "reader@example.com" },
        metadata,
      },
    },
  });
  const header = signPayloadForTest(payload, SECRET, Math.floor(Date.now() / 1000));
  return POST(
    new Request("http://localhost/api/donate/webhook", {
      method: "POST",
      body: payload,
      headers: { "stripe-signature": header },
    }),
  );
}

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  upsert.mockClear();
  send.mockClear();
});

describe("the donation webhook's product guard", () => {
  it("ignores an order's session: no row, nothing sent", async () => {
    const res = await deliver({ product: "ffbeacon_order", order_id: "x" });
    expect(await res.json()).toEqual({
      received: true,
      handled: false,
      reason: "not-a-donation",
    });
    expect(upsert).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("still handles a donation", async () => {
    const res = await deliver({ product: "ffbeacon_donation", origin: "donate_page" });
    expect(await res.json()).toEqual({ received: true, handled: true });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("treats a session with no tag as a donation, because older ones predate it", async () => {
    await deliver(null);
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});
