import { describe, expect, it } from "vitest";
import {
  attentionFilter,
  attentionHint,
  attentionReasons,
  needsAttention,
  revenueOver,
  revenueWeeks,
  turnaroundDays,
  type AttentionFields,
  type RevenueRow,
} from "./figures";

const NOW = new Date("2026-11-04T17:00:00Z");
const LONG_AGO = "2026-10-01T00:00:00Z";
const JUST_NOW = "2026-11-04T16:45:00Z";
const FUTURE = "2026-11-08T00:00:00Z";

const BASE: AttentionFields = {
  payment_status: "paid",
  customer_reported_paid_at: null,
  due_at: FUTURE,
  fulfillment_status: "queued",
  dispute_status: null,
  duplicate_payment_intent_id: null,
  duplicate_resolved_at: null,
  mismatch_amount_cents: null,
  receipt_email_status: "sent",
  paid_at: LONG_AGO,
};

/** A small evaluator for exactly the PostgREST grammar attentionFilter emits. */
function splitTop(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === "(") depth++;
    if (!quoted && ch === ")") depth--;
    if (!quoted && ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

function evalTerm(term: string, row: AttentionFields): boolean {
  if (term.startsWith("and(")) return splitTop(term.slice(4, -1)).every((t) => evalTerm(t, row));
  if (term.startsWith("or(")) return splitTop(term.slice(3, -1)).some((t) => evalTerm(t, row));
  const [column, ...rest] = term.split(".");
  const value = row[column as keyof AttentionFields];
  const op = rest.join(".");
  if (op === "not.is.null") return value != null;
  if (op === "is.null") return value == null;
  if (op.startsWith("eq.")) return value === op.slice(3);
  // Postgres: a comparison with null is not true, so neq never matches a null.
  if (op.startsWith("neq.")) return value != null && value !== op.slice(4);
  if (op.startsWith("in.(")) return op.slice(4, -1).split(",").includes(String(value));
  if (op.startsWith('lt."')) {
    return value != null && new Date(String(value)) < new Date(op.slice(4, -1));
  }
  throw new Error(`unknown term ${term}`);
}

const evalFilter = (filter: string, row: AttentionFields) =>
  splitTop(filter).some((t) => evalTerm(t, row));

const ROWS: Array<[string, Partial<AttentionFields>]> = [
  ["a quiet paid order", {}],
  ["reported manual payment", { payment_status: "awaiting_confirmation", customer_reported_paid_at: JUST_NOW, paid_at: null, receipt_email_status: null, due_at: null, fulfillment_status: "pending_payment" }],
  ["unreported manual payment", { payment_status: "awaiting_confirmation", paid_at: null, receipt_email_status: null, due_at: null, fulfillment_status: "pending_payment" }],
  ["overdue in the queue", { due_at: LONG_AGO }],
  ["overdue in progress", { due_at: LONG_AGO, fulfillment_status: "in_progress" }],
  ["past due but delivered", { due_at: LONG_AGO, fulfillment_status: "delivered" }],
  ["open chargeback", { dispute_status: "open" }],
  ["chargeback won", { dispute_status: "won" }],
  ["unresolved duplicate", { duplicate_payment_intent_id: "pi_2" }],
  ["resolved duplicate", { duplicate_payment_intent_id: "pi_2", duplicate_resolved_at: JUST_NOW }],
  ["amount mismatch", { payment_status: "unpaid", mismatch_amount_cents: 500, paid_at: null, receipt_email_status: null }],
  ["receipt failed long ago", { receipt_email_status: "failed" }],
  ["receipt skipped long ago", { receipt_email_status: "skipped" }],
  ["receipt never attempted long ago", { receipt_email_status: null }],
  ["receipt pending inside the hour", { receipt_email_status: "pending", paid_at: JUST_NOW }],
  ["cancelled", { payment_status: "cancelled", fulfillment_status: "cancelled", receipt_email_status: null }],
];

describe("needsAttention and attentionFilter", () => {
  it.each(ROWS)("agree on %s", (_, patch) => {
    const row = { ...BASE, ...patch };
    expect(evalFilter(attentionFilter(NOW), row)).toBe(needsAttention(row, NOW));
  });

  it("flag what they should", () => {
    const flagged = ROWS.filter(([, patch]) => needsAttention({ ...BASE, ...patch }, NOW)).map(
      ([name]) => name,
    );
    expect(flagged).toEqual([
      "reported manual payment",
      "overdue in the queue",
      "overdue in progress",
      "open chargeback",
      "unresolved duplicate",
      "amount mismatch",
      "receipt failed long ago",
      "receipt skipped long ago",
      "receipt never attempted long ago",
    ]);
  });

  it("names every reason an order has", () => {
    expect(
      attentionReasons({ ...BASE, due_at: LONG_AGO, dispute_status: "open" }, NOW),
    ).toEqual(["overdue", "chargeback"]);
  });
});

describe("attentionHint", () => {
  it("counts by reason with a plural", () => {
    expect(
      attentionHint(
        [
          { ...BASE, due_at: LONG_AGO },
          { ...BASE, due_at: LONG_AGO, dispute_status: "open" },
        ],
        NOW,
      ),
    ).toBe("2 overdue, 1 chargeback");
  });

  it("is null with nothing waiting", () => {
    expect(attentionHint([BASE], NOW)).toBeNull();
  });
});

function revenue(patch: Partial<RevenueRow>): RevenueRow {
  return {
    amount_cents: 1000,
    refunded_cents: 0,
    paid_at: "2026-11-02T15:00:00Z",
    livemode: true,
    payment_status: "paid",
    ...patch,
  };
}

describe("revenue", () => {
  it("excludes test mode and counts manual orders, and takes refunds off", () => {
    const rows = [
      revenue({}),
      revenue({ livemode: false }),
      revenue({ livemode: null }),
      revenue({ refunded_cents: 400, payment_status: "paid" }),
      revenue({ amount_cents: 0 }),
      revenue({ refunded_cents: 1000, payment_status: "refunded" }),
      revenue({ payment_status: "cancelled" }),
    ];
    expect(revenueOver(rows, NOW, 30)).toBe(1000 + 1000 + 600);
  });

  it("leaves out what is older than the window", () => {
    expect(revenueOver([revenue({ paid_at: "2026-09-01T00:00:00Z" })], NOW, 30)).toBe(0);
  });

  it("buckets twelve weeks ending Sunday, oldest first", () => {
    const weeks = revenueWeeks([revenue({})], NOW);
    expect(weeks).toHaveLength(12);
    expect(weeks[11].weekStart).toBe("2026-11-02");
    expect(weeks[11].orders).toBe(1);
    expect(weeks[11].revenueCents).toBe(1000);
    expect(weeks[10].orders).toBe(0);
    expect(weeks[0].weekStart).toBe("2026-08-17");
  });

  it("puts a late Sunday night Eastern in that Sunday's week, across the DST change", () => {
    // Sunday Nov 1 2026, 11:30 PM EST: already Monday in UTC, and the clocks
    // went back that morning.
    const lateSunday = "2026-11-02T04:30:00Z";
    // Monday Nov 2, 12:30 AM EST.
    const earlyMonday = "2026-11-02T05:30:00Z";
    const weeks = revenueWeeks(
      [revenue({ paid_at: lateSunday }), revenue({ paid_at: earlyMonday })],
      NOW,
    );
    expect(weeks[10].weekStart).toBe("2026-10-26");
    expect(weeks[10].orders).toBe(1);
    expect(weeks[11].orders).toBe(1);
  });

  it("records refunds in the week the payment landed", () => {
    const weeks = revenueWeeks([revenue({ refunded_cents: 300 })], NOW);
    expect(weeks[11].refundedCents).toBe(300);
    expect(weeks[11].revenueCents).toBe(700);
  });
});

describe("turnaroundDays", () => {
  it("is null with none delivered", () => {
    expect(turnaroundDays([])).toBeNull();
    expect(turnaroundDays([{ paid_at: LONG_AGO, delivered_at: null }])).toBeNull();
  });

  it("is the mean in days to one decimal", () => {
    expect(
      turnaroundDays([
        { paid_at: "2026-11-01T00:00:00Z", delivered_at: "2026-11-03T00:00:00Z" },
        { paid_at: "2026-11-01T00:00:00Z", delivered_at: "2026-11-04T12:00:00Z" },
      ]),
    ).toBe(2.8);
  });
});
