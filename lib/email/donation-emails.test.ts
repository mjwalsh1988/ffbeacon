import { describe, expect, it } from "vitest";
import { buildDonationReceiptEmail } from "./donation-emails";

/**
 * The receipt is the only message a donor ever gets from us, so the things that
 * would embarrass us most are the things pinned here: a wrong amount, a
 * timestamp in the wrong zone, an unescaped value, or a promise the Terms
 * contradict.
 */

const RECEIPT = {
  to: "donor@example.com",
  amountCents: 2500,
  reference: "cs_test_a1b2c3d4e5f6g7h8",
  // 2:30pm UTC on 12 June, which is 10:30am Eastern the same day.
  paidAtIso: "2026-06-12T14:30:00.000Z",
};

describe("buildDonationReceiptEmail", () => {
  it("names the amount in the subject and the body", () => {
    const mail = buildDonationReceiptEmail(RECEIPT);
    expect(mail.subject).toBe("Your $25 donation to FF Beacon");
    expect(mail.html).toContain("$25");
    expect(mail.text).toContain("Amount: $25");
  });

  it("formats a part-dollar amount without losing the cents", () => {
    const mail = buildDonationReceiptEmail({ ...RECEIPT, amountCents: 1250 });
    expect(mail.subject).toBe("Your $12.50 donation to FF Beacon");
    expect(mail.text).toContain("Amount: $12.50");
  });

  /**
   * The Time Display rule: every timestamp a human reads is Eastern with the
   * zone attached. A receipt stamped in UTC does not match the donor's card
   * statement and looks like a different transaction.
   */
  it("stamps the receipt in Eastern time with the zone named", () => {
    const mail = buildDonationReceiptEmail(RECEIPT);
    expect(mail.text).toContain("Jun 12, 2026");
    expect(mail.text).toMatch(/10:30\s?AM EDT/);
    expect(mail.text).not.toContain("14:30");
  });

  it("prints the Stripe reference so a donor can be looked up from it", () => {
    const mail = buildDonationReceiptEmail(RECEIPT);
    expect(mail.text).toContain(`Reference: ${RECEIPT.reference}`);
    expect(mail.html).toContain(RECEIPT.reference);
  });

  /**
   * The Terms say a donation is a gift, final, and not tax deductible. The
   * receipt is the document a donor keeps, so it is the one place those three
   * facts most need to appear.
   */
  it("says what the Terms say: a gift, final, not tax deductible", () => {
    const mail = buildDonationReceiptEmail(RECEIPT);
    for (const phrase of ["gift rather than a purchase", "not refunded", "not tax deductible"]) {
      expect(mail.text, phrase).toContain(phrase);
      expect(mail.html, phrase).toContain(phrase);
    }
  });

  /**
   * The receipt is the shortest statement of the rules and the one a donor
   * keeps, so it must point at the full one and must not overstate what the
   * Terms actually promise. Terms calls a goodwill correction "a goodwill
   * practice rather than a right you have", so the receipt says "try to put it
   * right" and not "we will sort it out".
   */
  it("links the Terms and keeps the consumer-law carve-out", () => {
    const mail = buildDonationReceiptEmail(RECEIPT);
    expect(mail.html).toContain("/terms");
    expect(mail.text).toContain("/terms");
    expect(mail.text).toContain("local consumer law");
    expect(mail.text).toContain("try to put it right");
    expect(mail.text).not.toContain("we will sort it out");
  });

  /**
   * One h1 per message. `emailHeading` emits an h1, so a second call would give
   * a reader navigating by heading two level-ones and no structure between them.
   */
  it("has exactly one h1 and uses h2 for the second section", () => {
    const html = buildDonationReceiptEmail(RECEIPT).html;
    expect((html.match(/<h1/g) ?? []).length).toBe(1);
    expect(html).toContain("<h2");
  });

  it("says the payment is one-time, which heads off the obvious worry", () => {
    expect(buildDonationReceiptEmail(RECEIPT).text).toContain("nothing will recur");
  });

  it("does not promise anything the donation did not buy", () => {
    const mail = buildDonationReceiptEmail(RECEIPT).text.toLowerCase();
    for (const forbidden of ["subscription", "membership", "unlock", "premium", "invoice"]) {
      expect(mail, forbidden).not.toContain(forbidden);
    }
  });

  // The reference is Stripe's and the amount is ours, but the shell escapes
  // interpolated values, and a receipt is not the place to find out otherwise.
  it("escapes a hostile reference rather than emitting markup", () => {
    const mail = buildDonationReceiptEmail({
      ...RECEIPT,
      reference: '<script>alert("x")</script>',
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });

  it("returns a plain-text alternative, not an empty string", () => {
    const mail = buildDonationReceiptEmail(RECEIPT);
    expect(mail.text.length).toBeGreaterThan(200);
    expect(mail.text).not.toContain("<td");
  });
});
