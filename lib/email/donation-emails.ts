/**
 * The donation receipt, in the FF Beacon branded email shell.
 *
 * WHY WE SEND THIS OURSELVES RATHER THAN LETTING STRIPE DO IT
 *   Stripe's automatic receipt is a plain Stripe-branded email with a Stripe
 *   logo on it. This is the only message a donor ever gets from us, and it is
 *   the moment they are most inclined to feel good about having given. Sending
 *   it through ./layout means it looks like everything else we send, says thank
 *   you in our own voice, and can carry a link back into the product.
 *
 *   The trade is that we now own delivery. Stripe's receipt is fire-and-forget
 *   and ours is not, which is why the webhook route around this has a claim, a
 *   retry path and a status column rather than just a send call.
 *
 * ABSOLUTE RULE: STRIPE'S OWN RECEIPT MUST STAY OFF while this exists. Two
 * receipts for one donation is worse than either one alone, and the reader
 * cannot tell which is authoritative. The Dashboard toggle is named in
 * docs/donations/donations.md.
 *
 * NOTHING PERSONAL IS STORED to build this. The address and the amount are read
 * off the Stripe event in memory, used here, and dropped. See migration 0270.
 */

import {
  buildBrandedEmail,
  emailButton,
  emailHeading,
  emailParagraph,
  emailQuoteCard,
  emailSubheading,
  esc,
  EMAIL_SITE_URL,
} from "./layout";
import { sendEmail, type SendEmailResult } from "./send";
import { formatUsd } from "@/lib/donate/amounts";
import { formatEastern } from "@/lib/datetime";
import { SITE } from "@/lib/site";

export type DonationReceipt = {
  /** Where to send it. Read from the Stripe session, never from a request body. */
  to: string;
  amountCents: number;
  /** Stripe's session id, printed so a donor quoting it can be looked up. */
  reference: string;
  /**
   * When the payment completed, as an ISO string.
   *
   * The webhook passes the STRIPE EVENT's timestamp, not the Checkout Session's.
   * A session is created when the donor opens Checkout and lives for 24 hours,
   * and a delayed-notification method can settle days later, so the session's
   * own `created` would stamp a receipt with a date that predates the payment.
   */
  paidAtIso: string;
};

/**
 * Build the receipt. Split out from sending so the wording can be tested without
 * a network call, and so a change to the copy cannot quietly break delivery.
 */
export function buildDonationReceiptEmail(receipt: DonationReceipt): {
  subject: string;
  html: string;
  text: string;
} {
  const amount = formatUsd(receipt.amountCents);
  // Every timestamp a human reads is Eastern with the zone attached, per the
  // Time Display rule. A receipt that says "3:00" and means UTC is a receipt
  // that does not match the donor's card statement.
  const paidAt = formatEastern(receipt.paidAtIso);

  const subject = `Your ${amount} donation to ${SITE.name}`;

  const innerHtml = [
    emailHeading("Thank you, genuinely."),
    emailParagraph(
      `Your donation of <strong>${esc(amount)}</strong> came through. It goes ` +
        `straight against what it costs to keep ${esc(SITE.name)} running: the ` +
        `hosting bill, the database, the data feeds, the domain and the mail.`,
    ),
    emailQuoteCard([
      { label: "Amount", value: amount },
      { label: "Date", value: paidAt },
      { label: "Reference", value: receipt.reference },
    ]),
    emailParagraph(
      "This is your receipt. Keep it if you need one; there is nothing else to do. " +
        "It is a one-time payment and nothing will recur.",
    ),
    emailSubheading("What it does, and what it does not"),
    emailParagraph(
      `It does not buy a feature, because there is nothing to buy. Everything on ` +
        `${esc(SITE.name)} was already free, and it stays that way for you and for ` +
        `everyone else.`,
    ),
    emailParagraph(
      `A donation is a gift rather than a purchase, so it is final and is not ` +
        `refunded, and it is not tax deductible. That does not affect any right you ` +
        `have under your local consumer law or your card network's rules. The full ` +
        `wording is in the <a href="${EMAIL_SITE_URL}/terms">Terms of Service</a>.`,
    ),
    emailParagraph(
      `If something looks wrong, a duplicate charge or an amount you did not mean ` +
        `to send, reply to this email and we will try to put it right.`,
    ),
    emailButton("Back to FF Beacon", EMAIL_SITE_URL),
  ].join("");

  // Not hard-wrapped. A narrow mobile client wraps it again and the result reads
  // as broken lines, and the rest of lib/email does not wrap either.
  const text = [
    "Thank you, genuinely.",
    "",
    `Your donation of ${amount} came through. It goes straight against what it costs to keep ${SITE.name} running: the hosting bill, the database, the data feeds, the domain and the mail.`,
    "",
    `Amount: ${amount}`,
    `Date: ${paidAt}`,
    `Reference: ${receipt.reference}`,
    "",
    "This is your receipt. Keep it if you need one; there is nothing else to do. It is a one-time payment and nothing will recur.",
    "",
    "What it does, and what it does not",
    "",
    `It does not buy a feature, because there is nothing to buy. Everything on ${SITE.name} was already free, and it stays that way for you and for everyone else.`,
    "",
    `A donation is a gift rather than a purchase, so it is final and is not refunded, and it is not tax deductible. That does not affect any right you have under your local consumer law or your card network's rules. The full wording is in the Terms of Service: ${EMAIL_SITE_URL}/terms`,
    "",
    "If something looks wrong, a duplicate charge or an amount you did not mean to send, reply to this email and we will try to put it right.",
    "",
    `Back to FF Beacon: ${EMAIL_SITE_URL}`,
  ].join("\n");

  const { html, text: wrappedText } = buildBrandedEmail({
    title: subject,
    // The line an inbox shows beside the subject. It says the useful thing
    // rather than repeating the subject back.
    preheader: `Receipt for your ${amount} donation, and what it pays for.`,
    innerHtml,
    textBody: text,
  });

  return { subject, html, text: wrappedText };
}

/** Build and send. Never throws; the caller reads the result and records it. */
export async function sendDonationReceipt(
  receipt: DonationReceipt,
): Promise<SendEmailResult> {
  const { subject, html, text } = buildDonationReceiptEmail(receipt);
  return sendEmail({ to: receipt.to, subject, html, text });
}
