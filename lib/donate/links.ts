/**
 * The two donation routes that need no server: PayPal and Venmo.
 *
 * Both are plain outbound links carrying the amount the reader chose, so the
 * number they picked on our page is the number already filled in when they
 * land. Neither touches our database, neither needs a session, and neither
 * depends on Stripe being reachable. That is deliberate: if the card path is
 * rate limited, misconfigured or down, there is still a way to give.
 *
 * THE HANDLE IS A CONSTANT, NOT A SETTING. It identifies one person's real
 * accounts. Reading it from the environment would mean a missing variable
 * silently pointing the buttons at nobody, and a wrong one pointing them at
 * somebody else.
 */

import { centsToDecimalString } from "./amounts";

/** The PayPal.me and Venmo handle. Same word on both services. */
export const PAY_HANDLE = "mjwalsh1988";

/** Shown as text beside the buttons so the destination is checkable by eye. */
export const PAY_HANDLE_DISPLAY = `@${PAY_HANDLE}`;

/** What the recipient sees on the transaction. */
const NOTE = "FF Beacon donation";

/**
 * paypal.me takes the amount and the currency in the path. The currency code is
 * appended because paypal.me without one bills in the RECIPIENT's currency,
 * which is right here but is right by accident.
 */
export function paypalUrl(cents: number): string {
  return `https://www.paypal.com/paypalme/${PAY_HANDLE}/${centsToDecimalString(cents)}USD`;
}

/**
 * Venmo's web pay link. On a phone this hands off to the app with the amount
 * and the note already filled; on a desktop browser it opens the same payment
 * on venmo.com. `audience=private` keeps the payment off the public feed, which
 * is the courteous default for a donation.
 */
export function venmoUrl(cents: number): string {
  const params = new URLSearchParams({
    txn: "pay",
    audience: "private",
    recipients: PAY_HANDLE,
    amount: centsToDecimalString(cents),
    note: NOTE,
  });
  return `https://venmo.com/?${params.toString()}`;
}
