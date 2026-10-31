import { describe, expect, it } from "vitest";
import {
  blocksToEmailHtml,
  buildAdminAmountMismatch,
  buildAdminDisputeClosed,
  buildAdminDisputeOpened,
  buildAdminDuplicatePayment,
  buildAdminOrderPaid,
  buildAdminOrderPlaced,
  buildAdminPaymentReported,
  renderOrderEmail,
  type OrderEmailTemplate,
} from "./order-emails";
import { REFUND_POLICY_SENTENCE } from "@/lib/commerce/constants";
import { parseRichText } from "@/lib/commerce/rich-text";
import type { Order } from "@/lib/commerce/types";

const ORDER = {
  id: "11111111-1111-4111-8111-111111111111",
  order_number: "FFB-100001",
  user_id: "u1",
  payment_method: "stripe",
  origin: "customer",
  amount_cents: 1995,
  list_price_cents: 1995,
  discount_cents: 0,
  coupon_code: null,
  paid_at: "2026-07-01T16:30:00Z",
  due_at: "2026-07-06T16:30:00Z",
  expires_at: "2026-07-08T16:30:00Z",
  refunded_at: "2026-07-02T16:30:00Z",
  external_payment_reference: "txn 42",
  product_snapshot: { name: "Premium Review", turnaround_days: 5, tier_rank: 2 },
  context: { teamName: "Night Owls", leagueName: "The League" },
  intake: { questions: "Should I sell?", offLimits: "" },
} as unknown as Order;

const manual = (method: "paypal" | "venmo") => ({ ...ORDER, payment_method: method }) as Order;

describe("customer emails", () => {
  it("carries the order number in every subject and ends with the order link", () => {
    const templates: OrderEmailTemplate[] = [
      "E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8", "E9", "E10", "E12", "E13",
    ];
    for (const template of templates) {
      const email = renderOrderEmail(template, manual("venmo"), { note: "A note" });
      expect(email.subject, template).toContain("FFB-100001");
      expect(email.html, template).toContain(`/my-beacon/orders/${ORDER.id}`);
      expect(email.text, template).toContain(`/my-beacon/orders/${ORDER.id}`);
    }
  });

  it("writes the plan's subjects", () => {
    const cases: Array<[OrderEmailTemplate, Order, object, string]> = [
      ["E1", ORDER, {}, "Order FFB-100001: your Premium Review is paid for"],
      ["E2", manual("paypal"), {}, "Order FFB-100001: how to finish paying with PayPal"],
      ["E2", manual("venmo"), {}, "Order FFB-100001: how to finish paying with Venmo"],
      ["E3", manual("venmo"), {}, "Order FFB-100001: payment confirmed"],
      ["E4", ORDER, { toStatus: "in_progress", note: "n" }, "Order FFB-100001: Michael has started your review"],
      ["E4", ORDER, { toStatus: "queued", note: "n" }, "Order FFB-100001: an update on your review"],
      ["E5", ORDER, {}, "Your Premium Review is ready, FFB-100001"],
      ["E6", manual("paypal"), {}, "Order FFB-100001 is waiting for your PayPal payment"],
      ["E7", ORDER, { failure: "not-found" }, "Order FFB-100001: we could not find your payment"],
      ["E7", ORDER, { failure: "card" }, "Order FFB-100001: the card payment did not go through"],
      ["E8", ORDER, { refundDeltaCents: 1995, refundTotalCents: 1995 }, "Order FFB-100001 has been refunded"],
      ["E8", ORDER, { refundDeltaCents: 500, refundTotalCents: 500 }, "Order FFB-100001: a partial refund"],
      ["E9", ORDER, {}, "Order FFB-100001 was canceled"],
      ["E10", ORDER, {}, "Order FFB-100001 has closed"],
      ["E12", ORDER, {}, "Order FFB-100001: Michael updated your review"],
      ["E13", ORDER, {}, "Order FFB-100001: Michael has set up a Premium Review for you"],
    ];
    for (const [template, order, extra, subject] of cases) {
      expect(renderOrderEmail(template, order, extra).subject).toBe(subject);
    }
  });

  it("uses the typed subject on a free-form message", () => {
    const email = renderOrderEmail("E11", ORDER, { subject: "A question", body: "Hello" });
    expect(email.subject).toBe("A question");
    expect(email.text).toContain("Hello");
  });

  it("prints Eastern time with the zone", () => {
    const email = renderOrderEmail("E1", ORDER);
    expect(email.text).toContain("Jul 1, 2026, 12:30 PM EDT");
  });

  it("names the seller and the refund sentence on a paid receipt, E1 and E3", () => {
    for (const email of [renderOrderEmail("E1", ORDER), renderOrderEmail("E3", manual("venmo"))]) {
      expect(email.text).toContain("FF Beacon, michael@ffbeacon.com");
      expect(email.text).toContain(REFUND_POLICY_SENTENCE);
      expect(email.text).toContain("Keep this email as your receipt.");
    }
  });

  it("drops the refund sentence on a zero total and changes the subject", () => {
    const free = {
      ...ORDER,
      amount_cents: 0,
      discount_cents: 1995,
      coupon_code: "FREEREVIEW",
      payment_method: "complimentary",
    } as Order;
    const email = renderOrderEmail("E1", free);
    expect(email.subject).toBe("Order FFB-100001: your Premium Review is on its way");
    expect(email.text).not.toContain(REFUND_POLICY_SENTENCE);
    expect(email.text).toContain("Amount: $0.00");
    expect(email.text).toContain("FREEREVIEW: $19.95 off");
    expect(email.text).toContain("No payment needed");
  });

  it("prints the code lines on a discounted receipt", () => {
    const coupon = {
      ...ORDER,
      amount_cents: 1596,
      discount_cents: 399,
      coupon_code: "SAVE20",
    } as Order;
    const email = renderOrderEmail("E1", coupon);
    expect(email.text).toContain("SAVE20: $3.99 off");
    expect(email.text).toContain("List price: $19.95");
  });

  it("clips the delivery email at 1200 characters and says so", () => {
    const long = "x".repeat(1500);
    const clipped = renderOrderEmail("E5", ORDER, { firstSection: long });
    expect(clipped.text).toContain("Read the rest in your portal.");
    expect(clipped.text).not.toContain("x".repeat(1201));
    const short = renderOrderEmail("E5", ORDER, { firstSection: "Short and sweet." });
    expect(short.text).not.toContain("Read the rest in your portal.");
  });

  it("offers the follow-up on Premium only", () => {
    expect(renderOrderEmail("E5", ORDER).text).toContain("one follow-up question");
    const basic = {
      ...ORDER,
      product_snapshot: { ...ORDER.product_snapshot, tier_rank: 1 },
    } as Order;
    expect(renderOrderEmail("E5", basic).text).not.toContain("one follow-up question");
  });

  it("gives E13 its heading, the note and the Due by line", () => {
    const email = renderOrderEmail("E13", ORDER, { note: "On me, for the bug report." });
    expect(email.text).toContain("A review, on the house.");
    expect(email.text).toContain("$0.00, complimentary");
    expect(email.text).toContain("On me, for the bug report.");
    expect(email.text).toContain("Due by: Jul 6, 2026");
  });

  it("puts the amount, handle and order number in the manual pay steps", () => {
    const email = renderOrderEmail("E2", manual("venmo"));
    expect(email.text).toContain("Pay to: @mjwalsh1988 on Venmo");
    expect(email.text).toContain("Send $19.95 with FFB-100001 in the note");
    // The hold reads from the order's own expiry, which the admin can change.
    expect(email.text).toMatch(/The order is held until [A-Z][a-z]{2} \d{1,2}, \d{4}\./);
    expect(email.text).not.toContain("7 days");
  });

  it("escapes what a person typed", () => {
    const email = renderOrderEmail("E11", ORDER, {
      subject: "Hi",
      body: "<script>alert(1)</script>",
    });
    expect(email.html).not.toContain("<script>alert");
    expect(email.html).toContain("&lt;script&gt;");
  });
});

describe("blocksToEmailHtml", () => {
  it("renders each block kind", () => {
    const html = blocksToEmailHtml(parseRichText("## Head\n\nPara\n\n- one\n\n1. two\n\nhttps://a.example/x"));
    expect(html).toContain("<h2");
    expect(html).toContain("<ul");
    expect(html).toContain("<ol");
    expect(html).toContain('href="https://a.example/x"');
  });
});

describe("admin notices", () => {
  it("writes the plan's subjects", () => {
    expect(buildAdminOrderPlaced(manual("venmo")).subject).toBe(
      "[Orders] FFB-100001 placed, awaiting Venmo",
    );
    expect(
      buildAdminOrderPaid(ORDER, { displayName: "Ace", email: "a@example.com" }, 0).subject,
    ).toBe("[Orders] FFB-100001 paid: Premium Review, Night Owls in The League");
    expect(buildAdminPaymentReported(manual("venmo")).subject).toBe(
      "[Orders] FFB-100001: customer says Venmo was sent",
    );
    expect(
      buildAdminDuplicatePayment(ORDER, { firstUrl: "u1", secondUrl: "u2", amountCents: 1995 })
        .subject,
    ).toBe("[Orders] FFB-100001: a second payment arrived");
    expect(
      buildAdminAmountMismatch(ORDER, {
        reportedCents: 100,
        currency: "usd",
        paymentUrl: null,
        sessionId: "cs_1",
      }).subject,
    ).toBe("[Orders] FFB-100001: Stripe reported $1.00 for an order of $19.95");
    expect(
      buildAdminDisputeOpened(ORDER, {
        amountCents: 1995,
        reason: "fraudulent",
        dueByIso: "2026-07-20T16:30:00Z",
        disputeUrl: null,
        fulfillment: "queued",
      }).subject,
    ).toBe("[Orders] FFB-100001: chargeback opened, evidence due Jul 20, 2026, 12:30 PM EDT");
    expect(buildAdminDisputeClosed(ORDER, { outcome: "lost", recorded: "r" }).subject).toBe(
      "[Orders] FFB-100001: chargeback lost",
    );
  });

  it("names the other open chargeback on A2 only when true", () => {
    const customer = { displayName: "Ace", email: "a@example.com" };
    expect(buildAdminOrderPaid(ORDER, customer, 1).text).toContain(
      "1 open chargeback on another order.",
    );
    expect(buildAdminOrderPaid(ORDER, customer, 0).text).not.toContain("chargeback");
  });

  it("says the order was not marked paid on A5", () => {
    expect(
      buildAdminAmountMismatch(ORDER, {
        reportedCents: 100,
        currency: "eur",
        paymentUrl: "https://dashboard.stripe.com/payments/pi_1",
        sessionId: "cs_1",
      }).text,
    ).toContain("The order was NOT marked paid.");
  });
});
