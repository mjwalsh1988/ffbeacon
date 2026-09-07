import { describe, expect, it } from "vitest";
import { donationOutcome } from "./outcome";

/**
 * The regression this file exists for: `status: "open"` was read as "pending",
 * so a reader who abandoned Checkout and later reopened the link was told their
 * payment was settling and that there was no reason to pay again. Both false.
 */
describe("donationOutcome", () => {
  it("calls a paid session paid", () => {
    expect(donationOutcome({ status: "complete", payment_status: "paid" })).toBe("paid");
  });

  it("treats a zero-amount session as paid", () => {
    expect(
      donationOutcome({ status: "complete", payment_status: "no_payment_required" }),
    ).toBe("paid");
  });

  it("calls a finished-but-unsettled session pending, which is the only pending", () => {
    expect(donationOutcome({ status: "complete", payment_status: "unpaid" })).toBe(
      "pending",
    );
  });

  it("never calls an abandoned or expired session pending", () => {
    expect(donationOutcome({ status: "open", payment_status: "unpaid" })).toBe("unknown");
    expect(donationOutcome({ status: "expired", payment_status: "unpaid" })).toBe(
      "unknown",
    );
  });

  it("says unknown when Stripe told us nothing usable", () => {
    expect(donationOutcome({ status: null, payment_status: null })).toBe("unknown");
  });

  // A paid session that somehow reports an odd status is still paid: the money
  // is the fact, the status is the description.
  it("lets payment_status win over a surprising status", () => {
    expect(donationOutcome({ status: "open", payment_status: "paid" })).toBe("paid");
  });
});
