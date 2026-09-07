/**
 * What a donation is allowed to be, in one place.
 *
 * Shared by the client picker, the API route that opens Stripe Checkout, and
 * the PayPal and Venmo link builders. Written as pure functions with no imports
 * so the browser bundle and the server run the SAME rules: a floor the client
 * enforces and the server does not is not a floor, and a ceiling the server
 * enforces and the client does not is a form that fails after the reader has
 * already committed to a number.
 *
 * MONEY IS HELD IN CENTS EVERYWHERE PAST THE INPUT. A dollar amount typed by a
 * person is a decimal string, and decimal arithmetic in binary floating point
 * is how a $10.10 donation becomes 1009 cents. `parseDonationAmount` is the one
 * conversion, it rounds once, and nothing downstream sees a fractional cent.
 */

/** The one-tap amounts, in whole dollars, in the order they are drawn. */
export const PRESET_AMOUNTS_USD = [5, 10, 25, 50, 100] as const;

/**
 * The amount selected when the form opens.
 *
 * Lives here rather than as a literal in the component so it cannot drift out of
 * the preset list. A default that names an amount no longer in PRESET_AMOUNTS_USD
 * leaves the radiogroup with nothing checked while the submit button still reads
 * "Donate $10", which a screen reader announces as a group with no selection
 * under a button naming a figure.
 */
export const DEFAULT_AMOUNT_USD: (typeof PRESET_AMOUNTS_USD)[number] = 10;

/** Floor. Stripe's own minimum charge is $0.50; a dollar is the product floor. */
export const MIN_AMOUNT_CENTS = 100;

/**
 * Ceiling. Not a limit on generosity: an amount this large through a donation
 * form is far more often a typo (or a card tester probing) than an intention,
 * and the message says to get in touch rather than refusing outright.
 */
export const MAX_AMOUNT_CENTS = 1_000_000;

export const MIN_AMOUNT_LABEL = "$1";
export const MAX_AMOUNT_LABEL = "$10,000";

export type AmountResult =
  | { ok: true; cents: number }
  | { ok: false; error: string };

/**
 * Turn whatever a person typed into cents, or say why it cannot be one.
 *
 * Accepts a number (the presets) or a string (the "Other" box). Strips the
 * things people actually type: a leading dollar sign, thousands separators,
 * surrounding whitespace. Rejects everything else rather than guessing, because
 * a form that silently reinterprets "12,50" as $1250 charges a card for a
 * hundred times what its owner meant.
 */
export function parseDonationAmount(input: unknown): AmountResult {
  let raw: string;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return { ok: false, error: "Enter an amount to donate." };
    raw = String(input);
  } else if (typeof input === "string") {
    // Only the dollar sign and surrounding space are removed before validation.
    // Commas are NOT stripped here. See below.
    raw = input.trim().replace(/^\$/, "").trim();
  } else {
    return { ok: false, error: "Enter an amount to donate." };
  }

  if (raw.length === 0) return { ok: false, error: "Enter an amount to donate." };

  /**
   * THE GROUPING IS VALIDATED BEFORE ANY COMMA IS REMOVED, and this is the whole
   * reason the function is strict.
   *
   * Stripping commas first and validating the remainder accepts "12,50", which
   * is how most of the world writes twelve dollars fifty, and turns it into
   * 1250. That is a hundred times what its owner meant, on a form whose entire
   * job is to move money. "0,50" became fifty dollars and ",,25" became
   * twenty-five.
   *
   * So a comma is allowed only where a thousands separator genuinely goes:
   * one to three digits, then groups of exactly three. "1,000" passes, "12,50"
   * does not, and an amount with no comma at all takes the first branch.
   */
  const PLAIN = /^\d+(\.\d{1,2})?$/;
  const GROUPED = /^\d{1,3}(,\d{3})+(\.\d{1,2})?$/;
  if (!PLAIN.test(raw) && !GROUPED.test(raw)) {
    return {
      ok: false,
      error: "Enter a dollar amount, like 25 or 12.50.",
    };
  }
  raw = raw.replace(/,/g, "");

  const dollars = Number(raw);
  if (!Number.isFinite(dollars)) {
    return { ok: false, error: "Enter a dollar amount, like 25 or 12.50." };
  }

  const cents = Math.round(dollars * 100);
  if (cents < MIN_AMOUNT_CENTS) {
    return { ok: false, error: `The smallest donation we can take is ${MIN_AMOUNT_LABEL}.` };
  }
  if (cents > MAX_AMOUNT_CENTS) {
    return {
      ok: false,
      error: `${MAX_AMOUNT_LABEL} is the most this form can take. For anything larger, get in touch first.`,
    };
  }
  return { ok: true, cents };
}

/** "$25" for whole dollars, "$12.50" otherwise. Used in labels and receipts. */
export function formatUsd(cents: number): string {
  const dollars = cents / 100;
  const whole = cents % 100 === 0;
  return `$${dollars.toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/** The plain decimal string PayPal and Venmo want in a URL: "25" or "12.50". */
export function centsToDecimalString(cents: number): string {
  return (cents / 100).toFixed(2).replace(/\.00$/, "");
}
