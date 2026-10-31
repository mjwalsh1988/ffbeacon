import { beforeEach, describe, expect, it, vi } from "vitest";
import { signPayloadForTest } from "@/lib/donate/webhook-signature";

const SECRET = "whsec_test_orders";
const ORDER_ID = "11111111-1111-4111-8111-111111111111";

type Row = Record<string, unknown>;

/** A small in-memory stand-in for the three tables this route touches. */
const db = {
  orders: [] as Row[],
  order_events: [] as Row[],
  payment_webhook_events: [] as Row[],
};

let rpcResult = true;
const rpc = vi.fn();

function makeBuilder(table: keyof typeof db) {
  const filters: Array<[string, unknown]> = [];
  let mode: "select" | "update" = "select";
  let patch: Row = {};
  const matches = () =>
    db[table].filter((row) => filters.every(([col, value]) => row[col] === value));

  const builder = {
    select: () => builder,
    order: () => builder,
    limit: () => builder,
    eq: (col: string, value: unknown) => {
      filters.push([col, value]);
      return builder;
    },
    update: (row: Row) => {
      mode = "update";
      patch = row;
      return builder;
    },
    insert: async (row: Row) => {
      if (table === "payment_webhook_events") {
        const exists = db.payment_webhook_events.some((r) => r.event_id === row.event_id);
        if (exists) return { error: { code: "23505", message: "duplicate" } };
      }
      db[table].push({ ...row });
      return { error: null };
    },
    maybeSingle: async () => {
      const rows = matches();
      if (mode === "update") rows.forEach((r) => Object.assign(r, patch));
      return { data: rows[rows.length - 1] ?? null, error: null };
    },
    then: (resolve: (v: { data: Row[]; error: null }) => void) => {
      const rows = matches();
      if (mode === "update") rows.forEach((r) => Object.assign(r, patch));
      resolve({ data: rows, error: null });
    },
  };
  return builder;
}

const fakeAdmin = {
  from: (table: string) => {
    if (table === "commerce_settings") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        }),
      };
    }
    return makeBuilder(table as keyof typeof db);
  },
  rpc: (...args: unknown[]) => rpc(...args),
};

vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => fakeAdmin }));

const afterTasks: Array<() => unknown> = [];
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (fn: () => unknown) => afterTasks.push(fn),
}));

const followUp = vi.fn(async () => {});
const notify = vi.hoisted(() => ({
  duplicate: vi.fn(async () => {}),
  mismatch: vi.fn(async () => {}),
  opened: vi.fn(async () => {}),
  closed: vi.fn(async () => {}),
}));
const emailCustomer = vi.hoisted(() => vi.fn(async () => ({ status: "sent" })));

vi.mock("@/lib/commerce/notify", () => ({
  notifyDuplicatePayment: notify.duplicate,
  notifyAmountMismatch: notify.mismatch,
  notifyDisputeOpened: notify.opened,
  notifyDisputeClosed: notify.closed,
  notifyOrderPaid: vi.fn(async () => {}),
}));

vi.mock("@/lib/commerce/orders", async (original) => ({
  ...(await original<typeof import("@/lib/commerce/orders")>()),
  emailCustomer,
}));

import { POST } from "./route";

function baseOrder(patch: Row = {}): Row {
  return {
    id: ORDER_ID,
    order_number: "FFB-100001",
    user_id: "u1",
    amount_cents: 1995,
    refunded_cents: 0,
    refund_note: null,
    payment_method: "stripe",
    payment_status: "unpaid",
    fulfillment_status: "pending_payment",
    stripe_session_id: "cs_test_current",
    stripe_payment_intent_id: null,
    duplicate_payment_intent_id: null,
    duplicate_resolved_at: null,
    mismatch_amount_cents: null,
    livemode: null,
    ...patch,
  };
}

function session(patch: Row = {}): Row {
  return {
    id: "cs_test_current",
    amount_total: 1995,
    currency: "usd",
    payment_status: "paid",
    payment_intent: "pi_first",
    metadata: { product: "ffbeacon_order", order_id: ORDER_ID },
    ...patch,
  };
}

let eventCounter = 0;

async function deliver(type: string, object: Row, id?: string) {
  const payload = JSON.stringify({
    id: id ?? `evt_${++eventCounter}`,
    type,
    created: 1_800_000_000,
    livemode: false,
    data: { object },
  });
  const header = signPayloadForTest(payload, SECRET, Math.floor(Date.now() / 1000));
  const res = await POST(
    new Request("http://localhost/api/orders/webhook", {
      method: "POST",
      body: payload,
      headers: { "stripe-signature": header },
    }),
  );
  return { status: res.status, body: (await res.json()) as Row };
}

const order = () => db.orders[0];

beforeEach(() => {
  process.env.STRIPE_ORDERS_WEBHOOK_SECRET = SECRET;
  db.orders.length = 0;
  db.order_events.length = 0;
  db.payment_webhook_events.length = 0;
  db.orders.push(baseOrder());
  afterTasks.length = 0;
  rpcResult = true;
  rpc.mockReset();
  rpc.mockImplementation(async (name: string, args: Row) => {
    if (name !== "try_mark_order_paid") return { data: [], error: null };
    if (!rpcResult) return { data: false, error: null };
    Object.assign(order(), {
      payment_status: "paid",
      fulfillment_status: "queued",
      stripe_payment_intent_id: args.p_payment_intent_id ?? order().stripe_payment_intent_id,
    });
    rpcResult = false;
    return { data: true, error: null };
  });
  Object.values(notify).forEach((fn) => fn.mockClear());
  emailCustomer.mockClear();
  followUp.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("verification", () => {
  it("refuses an unverified request and touches nothing", async () => {
    const res = await POST(
      new Request("http://localhost/api/orders/webhook", {
        method: "POST",
        body: "{}",
        headers: { "stripe-signature": "t=1,v1=abc" },
      }),
    );
    expect(res.status).toBe(400);
    expect(db.payment_webhook_events).toHaveLength(0);
  });

  it("fails closed without the secret", async () => {
    delete process.env.STRIPE_ORDERS_WEBHOOK_SECRET;
    const res = await POST(
      new Request("http://localhost/api/orders/webhook", { method: "POST", body: "{}" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("the event ledger", () => {
  it("answers an unknown event 200 unhandled, and records nothing", async () => {
    const { status, body } = await deliver("invoice.paid", {});
    expect(status).toBe(200);
    expect(body).toEqual({ received: true, handled: false });
    expect(db.payment_webhook_events).toHaveLength(0);
  });

  it("answers a completed redelivery duplicate-event and touches nothing", async () => {
    await deliver("checkout.session.completed", session(), "evt_same");
    const eventsBefore = db.order_events.length;
    rpc.mockClear();
    const { body } = await deliver("checkout.session.completed", session(), "evt_same");
    expect(body).toMatchObject({ handled: false, reason: "duplicate-event" });
    expect(rpc).not.toHaveBeenCalled();
    expect(db.order_events).toHaveLength(eventsBefore);
  });

  it("processes a row whose earlier delivery never completed", async () => {
    db.payment_webhook_events.push({ event_id: "evt_crashed", completed_at: null });
    const { body } = await deliver("checkout.session.completed", session(), "evt_crashed");
    expect(body).toMatchObject({ handled: true });
    expect(order().payment_status).toBe("paid");
  });

  it("stamps the row last", async () => {
    await deliver("checkout.session.completed", session(), "evt_stamp");
    const row = db.payment_webhook_events.find((r) => r.event_id === "evt_stamp");
    expect(row?.completed_at).toEqual(expect.any(String));
    expect(row?.order_id).toBe(ORDER_ID);
  });
});

describe("session events", () => {
  it("ignores a session that is not an order", async () => {
    const { body } = await deliver(
      "checkout.session.completed",
      session({ metadata: { product: "ffbeacon_donation" } }),
    );
    expect(body).toMatchObject({ handled: false, reason: "not-an-order" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("ignores a metadata order id that is not a uuid", async () => {
    const { body } = await deliver(
      "checkout.session.completed",
      session({
        id: "cs_test_other",
        metadata: { product: "ffbeacon_order", order_id: "1 or 1=1" },
      }),
    );
    expect(body).toMatchObject({ handled: false, reason: "no-order" });
  });

  it("finds a retried session through the metadata", async () => {
    const { body } = await deliver(
      "checkout.session.completed",
      session({ id: "cs_test_older" }),
    );
    expect(body).toMatchObject({ handled: true });
  });

  it("marks paid once across two deliveries and queues one receipt", async () => {
    await deliver("checkout.session.completed", session());
    const { body } = await deliver("checkout.session.async_payment_succeeded", session());
    expect(body).toMatchObject({ handled: false, reason: "already-paid" });
    expect(db.order_events.filter((e) => e.kind === "paid")).toHaveLength(1);
    expect(afterTasks).toHaveLength(1);
  });

  it("records a second payment intent and tells the admin, once", async () => {
    await deliver("checkout.session.completed", session());
    afterTasks.length = 0;
    const { body } = await deliver(
      "checkout.session.completed",
      session({ payment_intent: "pi_second" }),
    );
    expect(body).toMatchObject({ handled: true, reason: "duplicate-payment" });
    expect(order().duplicate_payment_intent_id).toBe("pi_second");
    expect(db.order_events.find((e) => e.kind === "duplicate_payment")).toMatchObject({
      visible_to_customer: false,
    });
    for (const task of afterTasks) await task();
    expect(notify.duplicate).toHaveBeenCalledTimes(1);

    const again = await deliver(
      "checkout.session.completed",
      session({ payment_intent: "pi_second" }),
    );
    expect(again.body).toMatchObject({ reason: "already-paid" });
  });

  it("adopts the intent when the admin confirmed the card order by hand first", async () => {
    Object.assign(order(), { payment_status: "paid", paid_via: "manual" });
    rpcResult = false;
    const { body } = await deliver("checkout.session.completed", session());
    expect(body).toMatchObject({ reason: "already-paid" });
    expect(order().stripe_payment_intent_id).toBe("pi_first");
    expect(order().duplicate_payment_intent_id).toBeNull();
  });

  it("reports a different amount and never calls the RPC", async () => {
    const { body } = await deliver(
      "checkout.session.completed",
      session({ amount_total: 100 }),
    );
    expect(body).toMatchObject({ reason: "amount-mismatch" });
    expect(rpc).not.toHaveBeenCalledWith("try_mark_order_paid", expect.anything());
    expect(order().mismatch_amount_cents).toBe(100);
    expect(order().payment_status).toBe("unpaid");
    expect(db.order_events.find((e) => e.kind === "payment_mismatch")).toMatchObject({
      visible_to_customer: false,
    });
    for (const task of afterTasks) await task();
    expect(notify.mismatch).toHaveBeenCalledTimes(1);
  });

  it("reports a different currency the same way", async () => {
    const { body } = await deliver("checkout.session.completed", session({ currency: "eur" }));
    expect(body).toMatchObject({ reason: "amount-mismatch" });
  });

  it("records a delayed method as pending, once", async () => {
    await deliver("checkout.session.completed", session({ payment_status: "unpaid" }));
    await deliver("checkout.session.completed", session({ payment_status: "unpaid" }));
    expect(order().payment_status).toBe("unpaid");
    expect(db.order_events.filter((e) => e.kind === "payment_pending")).toHaveLength(1);
  });

  it("emails on an async failure while unpaid", async () => {
    const { body } = await deliver("checkout.session.async_payment_failed", session());
    expect(body).toMatchObject({ reason: "async-failed" });
    for (const task of afterTasks) await task();
    expect(emailCustomer).toHaveBeenCalledTimes(1);
  });

  it("marks the current session expired, and no email", async () => {
    const { body } = await deliver("checkout.session.expired", session());
    expect(body).toMatchObject({ reason: "expired" });
    expect(order().payment_status).toBe("expired");
    expect(emailCustomer).not.toHaveBeenCalled();
  });

  it("ignores the expiry of a session that has been replaced", async () => {
    const { body } = await deliver(
      "checkout.session.expired",
      session({ id: "cs_test_old" }),
    );
    expect(body).toMatchObject({ reason: "not-current" });
    expect(order().payment_status).toBe("unpaid");
  });
});

describe("charge.refunded", () => {
  beforeEach(() => {
    Object.assign(order(), {
      payment_status: "paid",
      fulfillment_status: "queued",
      stripe_payment_intent_id: "pi_first",
    });
  });

  const charge = (amount: number) => ({ payment_intent: "pi_first", amount_refunded: amount });

  it("records partial, then full, and a redelivered total writes nothing", async () => {
    await deliver("charge.refunded", charge(500));
    expect(order()).toMatchObject({ refunded_cents: 500, payment_status: "paid" });

    await deliver("charge.refunded", charge(1995));
    expect(order()).toMatchObject({
      refunded_cents: 1995,
      payment_status: "refunded",
      fulfillment_status: "cancelled",
    });

    const count = db.order_events.filter((e) => e.kind === "refunded").length;
    const { body } = await deliver("charge.refunded", charge(1995));
    expect(body).toMatchObject({ reason: "refund-already-recorded" });
    expect(db.order_events.filter((e) => e.kind === "refunded")).toHaveLength(count);
  });

  it("emails the customer the delta", async () => {
    await deliver("charge.refunded", charge(500));
    for (const task of afterTasks) await task();
    expect(emailCustomer).toHaveBeenCalledWith(
      fakeAdmin,
      expect.anything(),
      "E8",
      expect.objectContaining({ refundDeltaCents: 500, refundTotalCents: 500 }),
    );
  });

  it("settles only the duplicate when that is what was refunded", async () => {
    order().duplicate_payment_intent_id = "pi_second";
    const { body } = await deliver("charge.refunded", {
      payment_intent: "pi_second",
      amount_refunded: 1995,
    });
    expect(body).toMatchObject({ reason: "duplicate-refunded" });
    expect(order().duplicate_resolved_at).toEqual(expect.any(String));
    expect(order().refunded_cents).toBe(0);
    expect(emailCustomer).not.toHaveBeenCalled();
  });

  it("leaves an unknown payment alone", async () => {
    const { body } = await deliver("charge.refunded", {
      payment_intent: "pi_other",
      amount_refunded: 100,
    });
    expect(body).toMatchObject({ handled: false, reason: "no-order" });
  });
});

describe("chargebacks", () => {
  const dispute = (patch: Row = {}) => ({
    id: "dp_1",
    amount: 1995,
    payment_intent: "pi_first",
    reason: "fraudulent",
    evidence_details: { due_by: 1_800_100_000 },
    ...patch,
  });

  beforeEach(() => {
    Object.assign(order(), {
      payment_status: "paid",
      fulfillment_status: "queued",
      stripe_payment_intent_id: "pi_first",
    });
  });

  it("opens one and tells the admin, leaving fulfillment alone", async () => {
    await deliver("charge.dispute.created", dispute());
    expect(order()).toMatchObject({
      dispute_id: "dp_1",
      dispute_status: "open",
      fulfillment_status: "queued",
    });
    for (const task of afterTasks) await task();
    expect(notify.opened).toHaveBeenCalledTimes(1);
    expect(emailCustomer).not.toHaveBeenCalled();
  });

  it("writes only an event when funds move", async () => {
    await deliver("charge.dispute.funds_withdrawn", dispute());
    await deliver("charge.dispute.funds_reinstated", dispute());
    expect(order().dispute_status).toBeUndefined();
    expect(db.order_events.filter((e) => e.kind === "dispute_updated")).toHaveLength(2);
  });

  it("records a lost one as money gone, and tells the admin", async () => {
    await deliver("charge.dispute.closed", dispute({ status: "lost" }));
    expect(order()).toMatchObject({
      dispute_status: "lost",
      refunded_cents: 1995,
      refund_note: "Chargeback lost",
      payment_status: "refunded",
    });
    for (const task of afterTasks) await task();
    expect(notify.closed).toHaveBeenCalledTimes(1);
    expect(emailCustomer).not.toHaveBeenCalled();
  });

  it("leaves money alone on a win", async () => {
    await deliver("charge.dispute.closed", dispute({ status: "won" }));
    expect(order()).toMatchObject({ dispute_status: "won", refunded_cents: 0 });
  });

  it("stamps the duplicate when the dispute is on it", async () => {
    order().duplicate_payment_intent_id = "pi_second";
    await deliver("charge.dispute.created", dispute({ payment_intent: "pi_second" }));
    expect(order().duplicate_resolved_at).toEqual(expect.any(String));
    expect(order().dispute_status).toBeUndefined();
  });

  it("writes nothing for an unknown payment", async () => {
    const { body } = await deliver("charge.dispute.created", dispute({ payment_intent: "pi_x" }));
    expect(body).toMatchObject({ handled: false, reason: "no-order" });
    expect(db.order_events).toHaveLength(0);
  });
});
