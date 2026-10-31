/**
 * The seller, the refund sentence and the order number shape.
 *
 * `REFUND_POLICY_SENTENCE` is one constant on purpose. The order page, the receipt
 * emails and the Terms all say it, and three copies of a sentence about money
 * drift apart. The Terms quote it in their own surrounding words.
 */

export const SELLER_NAME = "FF Beacon";
export const SELLER_EMAIL = "michael@ffbeacon.com";

export const REFUND_POLICY_SENTENCE =
  "All sales are final. Michael considers refund requests case by case and will usually refund an order he has not started on yet.";

export const ORDER_NUMBER_RE = /^FFB-\d{6,}$/;

/** The Storage bucket attachments live in. Private, with no client policies. */
export const ORDER_FILES_BUCKET = "order-files";

export const MAX_ATTACHMENT_BYTES = 10_485_760;

/** Matches the bucket's allowed_mime_types (migration 0349). */
export const ATTACHMENT_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/markdown",
] as const;

/**
 * "$19.95", "$5.00", "$0.00". The order surfaces print cents every time, because
 * a price list that reads "$10" beside "$19.95" looks like a typo, and the plan's
 * own copy says "$4.00 off" and "$0.00". lib/donate/amounts.ts `formatUsd` drops
 * ".00" on purpose for a donation.
 */
export function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
