/**
 * Every email about an order, E1 to E13 to the customer and A1 to A7 to the admin.
 *
 * Each `buildX` is pure and returns { subject, html, text }, so the wording is
 * tested without a network call. `renderOrderEmail` is the dispatcher: an order and
 * a template name go in, which is also how the Resend button rebuilds a failed
 * send from what the event recorded.
 *
 * ABSOLUTE RULE: nothing here sets `replyTo`. A customer message takes the default
 * in lib/email/send.ts, michael@ffbeacon.com. Admin notices are sent by
 * lib/commerce/notify.ts, the one sender allowed to set it, so a reply reaches the
 * customer. lib/email/reply-to-guard.test.ts holds that line.
 *
 * Every timestamp is Eastern with its zone, every subject carries the order number,
 * and the preheader says the useful thing rather than repeating the subject.
 */

import {
  buildBrandedEmail,
  emailButton,
  emailHeading,
  emailParagraph,
  emailQuoteCard,
  emailStepList,
  emailSubheading,
  esc,
  EMAIL_SITE_URL,
} from "./layout";
import { formatEastern, formatEasternDate } from "@/lib/datetime";
import {
  REFUND_POLICY_SENTENCE,
  SELLER_EMAIL,
  SELLER_NAME,
  formatMoney,
} from "@/lib/commerce/constants";
import { PAY_HANDLE_DISPLAY, manualPayUrl } from "@/lib/commerce/pay-links";
import { blocksToText, parseRichText, type Block } from "@/lib/commerce/rich-text";
import type { Order, PaymentMethod } from "@/lib/commerce/types";

export type BuiltEmail = { subject: string; html: string; text: string };

export type OrderEmailTemplate =
  | "E1"
  | "E2"
  | "E3"
  | "E4"
  | "E5"
  | "E6"
  | "E7"
  | "E8"
  | "E9"
  | "E10"
  | "E11"
  | "E12"
  | "E13";

/** What a template needs beyond the order. Stored on the event, so plain values only. */
export type OrderEmailExtra = {
  note?: string;
  toStatus?: string;
  firstSection?: string;
  failure?: "not-found" | "card";
  refundDeltaCents?: number;
  refundTotalCents?: number;
  refundedAtIso?: string;
  subject?: string;
  body?: string;
};

const DELIVERY_CLIP = 1200;

function orderUrl(orderId: string): string {
  return `${EMAIL_SITE_URL}/my-beacon/orders/${orderId}`;
}

function methodWord(method: PaymentMethod): string {
  switch (method) {
    case "stripe":
      return "Card via Stripe";
    case "paypal":
      return "PayPal";
    case "venmo":
      return "Venmo";
    case "complimentary":
      return "No payment needed";
  }
}

function manualWord(method: PaymentMethod): "PayPal" | "Venmo" {
  return method === "venmo" ? "Venmo" : "PayPal";
}

function teamLine(order: Order): string {
  return `${order.context.teamName} in ${order.context.leagueName}`;
}

/** Blocks to table-safe HTML. Every string goes through `esc`; nothing passes through. */
export function blocksToEmailHtml(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.kind) {
        case "heading":
          return emailSubheading(b.text);
        case "paragraph":
          return emailParagraph(esc(b.text));
        case "link":
          return emailParagraph(`<a href="${esc(b.href)}">${esc(b.href)}</a>`);
        case "bullets":
        case "numbered": {
          const tag = b.kind === "bullets" ? "ul" : "ol";
          const items = b.items
            .map(
              (item) =>
                `<li style="margin:6px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#454C5A;">${esc(item)}</li>`,
            )
            .join("");
          return `<${tag} style="margin:14px 0 0;padding-left:22px;">${items}</${tag}>`;
        }
      }
    })
    .join("");
}

function wrap(
  subject: string,
  preheader: string,
  innerHtml: string,
  textBody: string,
): BuiltEmail {
  const { html, text } = buildBrandedEmail({ title: subject, preheader, innerHtml, textBody });
  return { subject, html, text };
}

function button(order: Order, label = "Open your order"): { html: string; text: string } {
  const url = orderUrl(order.id);
  return { html: emailButton(label, url), text: `${label}: ${url}` };
}

/** The amount rows of a receipt, with the code lines when one applied. */
function amountRows(order: Order): Array<{ label: string; value: string }> {
  const rows = [{ label: "Amount", value: formatMoney(order.amount_cents) }];
  if (order.coupon_code && order.discount_cents > 0) {
    rows.push({
      label: "Code",
      value: `${order.coupon_code}: ${formatMoney(order.discount_cents)} off`,
    });
    rows.push({ label: "List price", value: formatMoney(order.list_price_cents) });
  }
  return rows;
}

function buildReceipt(order: Order, kind: "E1" | "E3"): BuiltEmail {
  const free = order.amount_cents === 0;
  const name = order.product_snapshot.name;
  const subject =
    kind === "E3"
      ? `Order ${order.order_number}: payment confirmed`
      : free
        ? `Order ${order.order_number}: your ${name} is on its way`
        : `Order ${order.order_number}: your ${name} is paid for`;

  const rows = [
    { label: "Order", value: order.order_number },
    { label: "Review", value: name },
    { label: "Team", value: teamLine(order) },
    ...amountRows(order),
    { label: "Paid", value: formatEastern(order.paid_at) },
    { label: "Payment", value: methodWord(order.payment_method) },
    { label: "Sold by", value: `${SELLER_NAME}, ${SELLER_EMAIL}` },
  ];
  const days = order.product_snapshot.turnaround_days;
  const promise = `Michael writes every review himself, against your Team Blueprint and your league's own numbers. Expect it in your My Beacon portal within ${days} ${days === 1 ? "day" : "days"}, and an email the moment it lands.`;
  const refund = free
    ? null
    : `${REFUND_POLICY_SENTENCE} Reply to this email and quote the order number.`;
  const cta = button(order);

  const innerHtml = [
    emailHeading("Thank you. Michael has your order."),
    emailQuoteCard(rows),
    emailParagraph(esc(promise)),
    emailParagraph("Keep this email as your receipt."),
    refund ? emailParagraph(esc(refund)) : "",
    cta.html,
  ].join("");

  const text = [
    "Thank you. Michael has your order.",
    "",
    ...rows.map((r) => `${r.label}: ${r.value}`),
    "",
    promise,
    "",
    "Keep this email as your receipt.",
    ...(refund ? ["", refund] : []),
    "",
    cta.text,
  ].join("\n");

  return wrap(subject, `Your receipt for order ${order.order_number}, and when to expect the review.`, innerHtml, text);
}

function paySteps(order: Order): {
  word: "PayPal" | "Venmo";
  html: string;
  lines: string[];
} {
  const word = manualWord(order.payment_method);
  const method = order.payment_method === "venmo" ? "venmo" : "paypal";
  const url = manualPayUrl(method, order.amount_cents, order.order_number);
  const amount = formatMoney(order.amount_cents);
  const html = emailStepList([
    {
      title: `Open ${word}`,
      body: `Pay ${esc(PAY_HANDLE_DISPLAY)} on ${esc(word)}.`,
      linkLabel: `Open ${word}`,
      href: url,
    },
    {
      title: "Send the exact amount",
      body: `Send ${esc(amount)} with ${esc(order.order_number)} in the note.`,
      linkLabel: "Open your order",
      href: orderUrl(order.id),
    },
    {
      title: "Tell us you sent it",
      body: "Come back to your order and press I sent the payment.",
      linkLabel: "Open your order",
      href: orderUrl(order.id),
    },
  ]);
  const lines = [
    `1. Open ${word}: ${url}`,
    `2. Send ${amount} with ${order.order_number} in the note`,
    `3. Come back and press "I sent the payment": ${orderUrl(order.id)}`,
  ];
  return { word, html, lines };
}

function buildAwaitingManual(order: Order): BuiltEmail {
  const steps = paySteps(order);
  const subject = `Order ${order.order_number}: how to finish paying with ${steps.word}`;
  const rows = [
    { label: "Order", value: order.order_number },
    { label: "Amount", value: formatMoney(order.amount_cents) },
    { label: "Pay to", value: `${PAY_HANDLE_DISPLAY} on ${steps.word}` },
    { label: "Put in the note", value: order.order_number },
  ];
  // The hold is the order's own expiry, which the admin can set, not a fixed week.
  const held = order.expires_at
    ? `The order is held until ${formatEasternDate(order.expires_at)}.`
    : "The order is held for a limited time.";
  const closing = `Michael confirms these by hand, usually within a day. ${held}`;
  const cta = button(order);
  const innerHtml = [
    emailHeading("One step left."),
    emailQuoteCard(rows),
    steps.html,
    emailParagraph(esc(closing)),
    cta.html,
  ].join("");
  const text = [
    "One step left.",
    "",
    ...rows.map((r) => `${r.label}: ${r.value}`),
    "",
    ...steps.lines,
    "",
    closing,
    "",
    cta.text,
  ].join("\n");
  return wrap(subject, `Send ${formatMoney(order.amount_cents)} with ${order.order_number} in the note.`, innerHtml, text);
}

function buildStatusUpdate(order: Order, extra: OrderEmailExtra): BuiltEmail {
  const subject =
    extra.toStatus === "in_progress"
      ? `Order ${order.order_number}: Michael has started your review`
      : `Order ${order.order_number}: an update on your review`;
  const note = extra.note ?? "";
  const cta = button(order);
  const innerHtml = [
    emailHeading("An update on your review."),
    emailQuoteCard([{ label: "From Michael", value: note }]),
    cta.html,
  ].join("");
  return wrap(subject, note.slice(0, 120), innerHtml, [note, "", cta.text].join("\n"));
}

function buildDelivered(order: Order, extra: OrderEmailExtra): BuiltEmail {
  const name = order.product_snapshot.name;
  const subject = `Your ${name} is ready, ${order.order_number}`;
  const intro = `Michael has finished your ${name} for ${teamLine(order)}. Here is how it opens:`;
  const raw = extra.firstSection ?? "";
  const clipped = raw.length > DELIVERY_CLIP;
  const blocks = parseRichText(clipped ? raw.slice(0, DELIVERY_CLIP) : raw);
  const premium = order.product_snapshot.tier_rank >= 2;
  const followUp =
    "You have one follow-up question included. Reply to this email within 7 days and Michael will answer it.";
  const cta = button(order, "Read the full review");

  const innerHtml = [
    emailHeading("Your review is ready."),
    emailParagraph(esc(intro)),
    blocksToEmailHtml(blocks),
    clipped ? emailParagraph("Read the rest in your portal.") : "",
    cta.html,
    premium ? emailParagraph(esc(followUp)) : "",
  ].join("");

  const text = [
    "Your review is ready.",
    "",
    intro,
    "",
    blocksToText(blocks),
    ...(clipped ? ["", "Read the rest in your portal."] : []),
    "",
    cta.text,
    ...(premium ? ["", followUp] : []),
  ].join("\n");

  return wrap(subject, `Your ${name} is in your My Beacon portal.`, innerHtml, text);
}

function buildPaymentReminder(order: Order): BuiltEmail {
  const steps = paySteps(order);
  const subject = `Order ${order.order_number} is waiting for your ${steps.word} payment`;
  const closing = `If you have changed your mind, there is nothing to do: the order closes on its own on ${formatEasternDate(order.expires_at)}.`;
  const cta = button(order);
  const innerHtml = [
    emailHeading(`Your order is waiting for your ${steps.word} payment.`),
    steps.html,
    emailParagraph(esc(closing)),
    cta.html,
  ].join("");
  const text = [...steps.lines, "", closing, "", cta.text].join("\n");
  return wrap(subject, `Send ${formatMoney(order.amount_cents)} and the review goes in the queue.`, innerHtml, text);
}

function buildPaymentProblem(order: Order, extra: OrderEmailExtra): BuiltEmail {
  const card = extra.failure === "card";
  const subject = card
    ? `Order ${order.order_number}: the card payment did not go through`
    : `Order ${order.order_number}: we could not find your payment`;
  const heading = card ? "The card payment did not go through." : "We could not find your payment.";
  const cta = button(order);
  const manual = order.payment_method === "paypal" || order.payment_method === "venmo";
  const steps = manual ? paySteps(order) : null;
  const again = card ? "You can try again from your order." : null;

  const innerHtml = [
    emailHeading(heading),
    extra.note ? emailQuoteCard([{ label: "From Michael", value: extra.note }]) : "",
    steps?.html ?? "",
    again ? emailParagraph(esc(again)) : "",
    cta.html,
  ].join("");
  const text = [
    heading,
    ...(extra.note ? ["", extra.note] : []),
    ...(steps ? ["", ...steps.lines] : []),
    ...(again ? ["", again] : []),
    "",
    cta.text,
  ].join("\n");
  return wrap(subject, "Here is how to finish paying.", innerHtml, text);
}

function buildRefunded(order: Order, extra: OrderEmailExtra): BuiltEmail {
  const delta = extra.refundDeltaCents ?? 0;
  const total = extra.refundTotalCents ?? delta;
  const partial = total < order.amount_cents;
  const subject = partial
    ? `Order ${order.order_number}: a partial refund`
    : `Order ${order.order_number} has been refunded`;
  const rows = [
    { label: "Order", value: order.order_number },
    { label: "Amount refunded", value: formatMoney(delta) },
    ...(total !== delta ? [{ label: "Total refunded", value: formatMoney(total) }] : []),
    { label: "Refunded on", value: formatEastern(extra.refundedAtIso ?? order.refunded_at) },
    { label: "Back to", value: methodWord(order.payment_method) },
  ];
  const timing =
    order.payment_method === "stripe"
      ? "Refunds take 5 to 10 business days to show on a card statement."
      : null;
  const cta = button(order);
  const innerHtml = [
    emailHeading(partial ? "A partial refund is on its way." : "Your refund is on its way."),
    emailQuoteCard(rows),
    timing ? emailParagraph(esc(timing)) : "",
    cta.html,
  ].join("");
  const text = [
    ...rows.map((r) => `${r.label}: ${r.value}`),
    ...(timing ? ["", timing] : []),
    "",
    cta.text,
  ].join("\n");
  return wrap(subject, `${formatMoney(delta)} back to the way you paid.`, innerHtml, text);
}

function buildCancelled(order: Order, extra: OrderEmailExtra): BuiltEmail {
  const subject = `Order ${order.order_number} was canceled`;
  const note = extra.note ?? "";
  const cta = button(order);
  const innerHtml = [
    emailHeading("Your order was canceled."),
    note ? emailQuoteCard([{ label: "From Michael", value: note }]) : "",
    cta.html,
  ].join("");
  return wrap(subject, "Nothing further will happen on this order.", innerHtml, [note, "", cta.text].join("\n"));
}

function buildExpired(order: Order): BuiltEmail {
  const subject = `Order ${order.order_number} has closed`;
  const body =
    "We did not see a payment, so this order closed on its own. Nothing was charged. If you still want the review, start a new order from your Blueprint any time.";
  const cta = button(order);
  const innerHtml = [emailHeading("This order has closed."), emailParagraph(esc(body)), cta.html].join("");
  return wrap(subject, "Nothing was charged.", innerHtml, [body, "", cta.text].join("\n"));
}

function buildFreeForm(order: Order, extra: OrderEmailExtra): BuiltEmail {
  const subject = (extra.subject ?? `Order ${order.order_number}`).slice(0, 160);
  const blocks = parseRichText(extra.body ?? "");
  const cta = button(order);
  const innerHtml = [emailHeading(subject), blocksToEmailHtml(blocks), cta.html].join("");
  return wrap(subject, `About order ${order.order_number}.`, innerHtml, [blocksToText(blocks), "", cta.text].join("\n"));
}

function buildDeliveryUpdated(order: Order, extra: OrderEmailExtra): BuiltEmail {
  const subject = `Order ${order.order_number}: Michael updated your review`;
  const cta = button(order, "Read the full review");
  const line = "Michael has made a change to your review. The latest version is in your portal.";
  const innerHtml = [
    emailHeading("Your review has been updated."),
    emailParagraph(esc(line)),
    extra.note ? emailQuoteCard([{ label: "From Michael", value: extra.note }]) : "",
    cta.html,
  ].join("");
  return wrap(subject, line, innerHtml, [line, ...(extra.note ? ["", extra.note] : []), "", cta.text].join("\n"));
}

function buildComplimentary(order: Order, extra: OrderEmailExtra): BuiltEmail {
  const name = order.product_snapshot.name;
  const subject = `Order ${order.order_number}: Michael has set up a ${name} for you`;
  const rows = [
    { label: "Order", value: order.order_number },
    { label: "Review", value: name },
    { label: "Team", value: teamLine(order) },
    { label: "Amount", value: "$0.00, complimentary" },
    { label: "Due by", value: formatEasternDate(order.due_at) },
  ];
  const closing = "If there is anything you want answered, add it on the order page before Michael starts.";
  const cta = button(order);
  const innerHtml = [
    emailHeading("A review, on the house."),
    emailQuoteCard(rows),
    extra.note ? emailParagraph(esc(extra.note)) : "",
    emailParagraph(esc(closing)),
    cta.html,
  ].join("");
  const text = [
    "A review, on the house.",
    "",
    ...rows.map((r) => `${r.label}: ${r.value}`),
    ...(extra.note ? ["", extra.note] : []),
    "",
    closing,
    "",
    cta.text,
  ].join("\n");
  return wrap(subject, `A ${name} for ${order.context.teamName}, with no payment needed.`, innerHtml, text);
}

/** The dispatcher. An order and a template name in, a finished email out. */
export function renderOrderEmail(
  template: OrderEmailTemplate,
  order: Order,
  extra: OrderEmailExtra = {},
): BuiltEmail {
  switch (template) {
    case "E1":
      return buildReceipt(order, "E1");
    case "E2":
      return buildAwaitingManual(order);
    case "E3":
      return buildReceipt(order, "E3");
    case "E4":
      return buildStatusUpdate(order, extra);
    case "E5":
      return buildDelivered(order, extra);
    case "E6":
      return buildPaymentReminder(order);
    case "E7":
      return buildPaymentProblem(order, extra);
    case "E8":
      return buildRefunded(order, extra);
    case "E9":
      return buildCancelled(order, extra);
    case "E10":
      return buildExpired(order);
    case "E11":
      return buildFreeForm(order, extra);
    case "E12":
      return buildDeliveryUpdated(order, extra);
    case "E13":
      return buildComplimentary(order, extra);
  }
}

/* -------------------------------------------------------------------------- */
/* Admin notices                                                               */
/* -------------------------------------------------------------------------- */

function adminUrl(orderId: string): string {
  return `${EMAIL_SITE_URL}/admin/orders/${orderId}`;
}

function adminNotice(subject: string, lines: string[], orderId: string): BuiltEmail {
  const url = adminUrl(orderId);
  const innerHtml = [
    emailHeading(subject),
    ...lines.map((line) => emailParagraph(esc(line))),
    emailButton("Open the order", url),
  ].join("");
  return wrap(subject, lines[0] ?? subject, innerHtml, [...lines, "", `Open the order: ${url}`].join("\n"));
}

/** A1. */
export function buildAdminOrderPlaced(order: Order): BuiltEmail {
  return adminNotice(
    `[Orders] ${order.order_number} placed, awaiting ${manualWord(order.payment_method)}`,
    [
      `${order.product_snapshot.name}, ${teamLine(order)}.`,
      `Amount expected: ${formatMoney(order.amount_cents)}.`,
    ],
    order.id,
  );
}

/** A2. */
export function buildAdminOrderPaid(
  order: Order,
  customer: { displayName: string; email: string | null },
  openChargebacksElsewhere: number,
): BuiltEmail {
  const coupon =
    order.coupon_code && order.discount_cents > 0
      ? ` Code ${order.coupon_code}: ${formatMoney(order.discount_cents)} off.`
      : "";
  return adminNotice(
    `[Orders] ${order.order_number} paid: ${order.product_snapshot.name}, ${teamLine(order)}`,
    [
      `Customer: ${customer.displayName}, ${customer.email ?? "no address on the account"}.`,
      `Amount: ${formatMoney(order.amount_cents)}.${coupon}`,
      `Due by ${formatEastern(order.due_at)}.`,
      `Questions: ${order.intake.questions || "None given."}`,
      ...(openChargebacksElsewhere > 0
        ? [
            `${openChargebacksElsewhere} open chargeback${openChargebacksElsewhere === 1 ? "" : "s"} on another order.`,
          ]
        : []),
    ],
    order.id,
  );
}

/** A3. */
export function buildAdminPaymentReported(order: Order): BuiltEmail {
  return adminNotice(
    `[Orders] ${order.order_number}: customer says ${manualWord(order.payment_method)} was sent`,
    [
      `Reference: ${order.external_payment_reference || "None given."}`,
      `Amount expected: ${formatMoney(order.amount_cents)}.`,
    ],
    order.id,
  );
}

/** The short note when a customer adds questions to a complimentary order. */
export function buildAdminQuestionsAdded(order: Order): BuiltEmail {
  return adminNotice(
    `[Orders] ${order.order_number}: the customer added their questions`,
    [
      `Questions: ${order.intake.questions || "None given."}`,
      `Off the table: ${order.intake.offLimits || "None given."}`,
    ],
    order.id,
  );
}

/** A4. */
export function buildAdminDuplicatePayment(
  order: Order,
  args: { firstUrl: string; secondUrl: string; amountCents: number },
): BuiltEmail {
  return adminNotice(
    `[Orders] ${order.order_number}: a second payment arrived`,
    [
      `First payment: ${args.firstUrl}`,
      `Second payment: ${args.secondUrl}`,
      `Amount: ${formatMoney(args.amountCents)}.`,
      "Refund the second one in Stripe, then press Mark duplicate refunded on the order.",
    ],
    order.id,
  );
}

/** A5. */
export function buildAdminAmountMismatch(
  order: Order,
  args: { reportedCents: number; currency: string | null; paymentUrl: string | null; sessionId: string },
): BuiltEmail {
  return adminNotice(
    `[Orders] ${order.order_number}: Stripe reported ${formatMoney(args.reportedCents)} for an order of ${formatMoney(order.amount_cents)}`,
    [
      `Expected ${formatMoney(order.amount_cents)} USD; Stripe reported ${formatMoney(args.reportedCents)} ${(args.currency ?? "unknown").toUpperCase()}.`,
      `Session: ${args.sessionId}`,
      ...(args.paymentUrl ? [`Payment: ${args.paymentUrl}`] : []),
      "The order was NOT marked paid. Decide on the order page.",
    ],
    order.id,
  );
}

/** A6. */
export function buildAdminDisputeOpened(
  order: Order,
  args: { amountCents: number; reason: string | null; dueByIso: string | null; disputeUrl: string | null; fulfillment: string },
): BuiltEmail {
  const due = args.dueByIso ? `, evidence due ${formatEastern(args.dueByIso)}` : "";
  return adminNotice(
    `[Orders] ${order.order_number}: chargeback opened${due}`,
    [
      `Amount: ${formatMoney(args.amountCents)}.`,
      `Reason code: ${args.reason ?? "not given"}.`,
      ...(args.disputeUrl ? [`In Stripe: ${args.disputeUrl}`] : []),
      `Fulfillment: ${args.fulfillment}.`,
      "Do not deliver until this is resolved unless you choose to.",
    ],
    order.id,
  );
}

/** A7. */
export function buildAdminDisputeClosed(
  order: Order,
  args: { outcome: "won" | "lost" | "closed"; recorded: string },
): BuiltEmail {
  return adminNotice(
    `[Orders] ${order.order_number}: chargeback ${args.outcome}`,
    [`Outcome: ${args.outcome}.`, args.recorded],
    order.id,
  );
}
