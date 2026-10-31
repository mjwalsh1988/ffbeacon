/**
 * The order versions of the PayPal and Venmo links.
 *
 * Neither link verifies anything. Both are plain outbound links to a personal
 * handle, so the order number travels in the payment note, the customer presses
 * "I sent it", and the admin confirms by hand. paypal.me has no note parameter at
 * all, which is why the pay panel tells the reader to type it there themselves.
 */

import { centsToDecimalString } from "@/lib/donate/amounts";
import { PAY_HANDLE, PAY_HANDLE_DISPLAY } from "@/lib/donate/links";

export { PAY_HANDLE_DISPLAY };

/** What the recipient sees on the transaction: "FF Beacon order FFB-100001". */
export function orderNote(orderNumber: string): string {
  return `FF Beacon order ${orderNumber}`;
}

export function paypalOrderUrl(cents: number): string {
  return `https://www.paypal.com/paypalme/${PAY_HANDLE}/${centsToDecimalString(cents)}USD`;
}

export function venmoOrderUrl(cents: number, orderNumber: string): string {
  const params = new URLSearchParams({
    txn: "pay",
    audience: "private",
    recipients: PAY_HANDLE,
    amount: centsToDecimalString(cents),
    note: orderNote(orderNumber),
  });
  return `https://venmo.com/?${params.toString()}`;
}

export function manualPayUrl(
  method: "paypal" | "venmo",
  cents: number,
  orderNumber: string,
): string {
  return method === "paypal" ? paypalOrderUrl(cents) : venmoOrderUrl(cents, orderNumber);
}
