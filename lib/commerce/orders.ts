/**
 * The order ledger: reads, the insert, the one path to paid, and the one refund
 * arithmetic.
 *
 * ONE PATH TO PAID. Webhook, reconcile, manual confirm and both complimentary
 * paths all go through `markPaidIfWon`, which is the `try_mark_order_paid` RPC plus
 * the `paid` event, so they cannot disagree about what paid means. The RPC is true
 * for exactly one caller, and only that caller sends the receipt.
 *
 * THE RECEIPT HAS A STATUS. `sendReceipt` is the only sender of E1, E3 and E13 and
 * owns `receipt_email_status`. "Sent in the background" is never the only record.
 *
 * ONE REFUND ARITHMETIC. `refundDecision` is shared by the Stripe event, the
 * admin's button and a lost chargeback. `refunded_cents` only grows and never
 * passes `amount_cents`, which is what makes the button and the webhook idempotent
 * with each other.
 *
 * Lists select the columns they draw and never `context`, which can hold a whole
 * stored Blueprint view of about 40 KB per row.
 *
 * Logs name order ids and numbers, never an address.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { sendEmail } from "@/lib/email/send";
import { renderOrderEmail, type OrderEmailExtra, type OrderEmailTemplate } from "@/lib/email/order-emails";
import { ORDER_NUMBER_RE, formatMoney } from "./constants";
import type { CommerceSettings } from "./default-settings";
import {
  ATTENTION_COLUMNS,
  attentionFilter,
  attentionHint,
  revenueOver,
  revenueWeeks,
  turnaroundDays,
  type AttentionFields,
  type RevenueRow,
  type WeekBucket,
} from "./figures";
import { lookupCustomers, searchCustomers } from "./customers";
import { notifyOrderPaid } from "./notify";
import type {
  DisputeStatus,
  EventActor,
  EventKind,
  FulfillmentStatus,
  Order,
  OrderDeliverable,
  OrderEvent,
  OrderMessage,
  PaidVia,
  PaymentMethod,
  PaymentStatus,
  Product,
  ProductSnapshot,
  TeamReviewContext,
  TeamReviewIntake,
} from "./types";

type Client = SupabaseClient<Database>;

const DAY_MS = 24 * 60 * 60 * 1000;

export const ORDER_PAGE_SIZE = 25;
export const CUSTOMER_ORDER_PAGE_SIZE = 20;

/** The columns a list row draws. `context` stays out; see the header. */
const OWNER_LIST_COLUMNS =
  "id, order_number, user_id, amount_cents, refunded_cents, payment_method, payment_status, fulfillment_status, livemode, due_at, delivered_at, created_at, product_name:product_snapshot->>name, team_name:context->>teamName, league_name:context->>leagueName";

const LIST_COLUMNS =
  "id, order_number, user_id, amount_cents, refunded_cents, payment_method, payment_status, fulfillment_status, dispute_status, livemode, due_at, delivered_at, created_at, product_name:product_snapshot->>name, team_name:context->>teamName, league_name:context->>leagueName";

export type OrderListRow = {
  id: string;
  order_number: string;
  user_id: string | null;
  amount_cents: number;
  refunded_cents: number;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  fulfillment_status: FulfillmentStatus;
  dispute_status?: DisputeStatus | null;
  livemode: boolean | null;
  due_at: string | null;
  delivered_at: string | null;
  created_at: string;
  product_name: string | null;
  team_name: string | null;
  league_name: string | null;
};

export type OrderPage = { rows: OrderListRow[]; total: number; pageSize: number };

function pageRange(page: number, size: number): [number, number] {
  const p = Math.max(1, Math.floor(page) || 1);
  return [(p - 1) * size, p * size - 1];
}

/* -------------------------------------------------------------------------- */
/* Pricing                                                                     */
/* -------------------------------------------------------------------------- */

export type PriceCheck =
  | { ok: true; amountCents: number; complimentary: boolean }
  | { ok: false };

/**
 * The server's total against the one the form displayed. A difference refuses the
 * order, and so does a form that disagrees with the server about whether payment
 * is needed at all, which only happens when the page is stale.
 */
export function checkPrice(args: {
  listPriceCents: number;
  discountCents: number;
  expectedCents: number;
  paymentMethod: "stripe" | "paypal" | "venmo" | "none";
}): PriceCheck {
  const amountCents = Math.max(0, args.listPriceCents - args.discountCents);
  if (amountCents !== args.expectedCents) return { ok: false };
  if (amountCents === 0 && args.paymentMethod !== "none") return { ok: false };
  if (amountCents > 0 && args.paymentMethod === "none") return { ok: false };
  return { ok: true, amountCents, complimentary: amountCents === 0 };
}

/* -------------------------------------------------------------------------- */
/* Events                                                                      */
/* -------------------------------------------------------------------------- */

export type EventInput = {
  orderId: string;
  kind: EventKind;
  actor: EventActor;
  actorUserId?: string | null;
  visible?: boolean;
  title: string;
  body?: string | null;
  data?: Record<string, unknown> | null;
};

/** Write one timeline row. A failed write is logged; it never stops the caller. */
export async function insertEvent(admin: Client, event: EventInput): Promise<void> {
  const { error } = await admin.from("order_events").insert({
    order_id: event.orderId,
    kind: event.kind,
    actor: event.actor,
    actor_user_id: event.actorUserId ?? null,
    visible_to_customer: event.visible ?? true,
    title: event.title.slice(0, 160),
    body: event.body ? event.body.slice(0, 5000) : null,
    data: (event.data ?? null) as Json,
  });
  if (error) console.error("[orders] event write failed", event.orderId, error.message);
}

/* -------------------------------------------------------------------------- */
/* Create                                                                      */
/* -------------------------------------------------------------------------- */

export type CreateOrderArgs = {
  userId: string;
  product: Product;
  snapshot: ProductSnapshot;
  origin: "customer" | "admin";
  listPriceCents: number;
  discountCents: number;
  amountCents: number;
  paymentMethod: PaymentMethod;
  paymentStatus: "unpaid" | "awaiting_confirmation";
  expiresAt: string | null;
  couponId: string | null;
  couponCode: string | null;
  context: TeamReviewContext;
  intake: TeamReviewIntake;
  /** Who the `created` event names, and how. */
  createdActor: EventActor;
  createdActorUserId?: string | null;
  createdTitle: string;
};

/** The insert and its first events. Returns null when the row could not be written. */
export async function createOrder(admin: Client, args: CreateOrderArgs): Promise<Order | null> {
  const { data, error } = await admin
    .from("orders")
    .insert({
      user_id: args.userId,
      product_id: args.product.id,
      product_snapshot: args.snapshot as unknown as Json,
      origin: args.origin,
      list_price_cents: args.listPriceCents,
      discount_cents: args.discountCents,
      amount_cents: args.amountCents,
      payment_method: args.paymentMethod,
      payment_status: args.paymentStatus,
      fulfillment_status: "pending_payment",
      expires_at: args.expiresAt,
      coupon_id: args.couponId,
      coupon_code: args.couponCode,
      context: args.context as unknown as Json,
      intake: args.intake as unknown as Json,
    })
    .select("*")
    .single();
  if (error || !data) {
    console.error("[orders] insert failed", error?.message);
    return null;
  }
  const order = data as unknown as Order;

  await insertEvent(admin, {
    orderId: order.id,
    kind: "created",
    actor: args.createdActor,
    actorUserId: args.createdActorUserId ?? null,
    title: args.createdTitle,
    data: {
      method: args.paymentMethod,
      listPriceCents: args.listPriceCents,
      discountCents: args.discountCents,
    },
  });
  if (args.couponCode) {
    await insertEvent(admin, {
      orderId: order.id,
      kind: "coupon_applied",
      actor: "system",
      title: `Code ${args.couponCode} applied`,
      body: `${formatMoney(args.discountCents)} off`,
    });
  }
  return order;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export type OrderDetail = {
  order: Order;
  events: OrderEvent[];
  messages: OrderMessage[];
  deliverables: OrderDeliverable[];
};

/**
 * What an owner may select (migration 0353). Chargeback, duplicate, mismatch, refund
 * note and receipt delivery columns are for the admin alone.
 */
const OWNER_ORDER_COLUMNS =
  "id, order_number, user_id, product_id, product_snapshot, origin, list_price_cents, discount_cents, amount_cents, currency, payment_method, payment_status, fulfillment_status, stripe_session_id, stripe_session_attempts, stripe_session_expires_at, stripe_payment_intent_id, livemode, external_payment_reference, customer_reported_paid_at, paid_at, paid_via, due_at, started_at, delivered_at, expires_at, reminder_sent_at, cancelled_at, refunded_cents, refunded_at, context, intake, coupon_id, coupon_code, created_at, updated_at";

async function loadDetail(
  client: Client,
  orderId: string,
  columns: string,
): Promise<OrderDetail | null> {
  const { data, error } = await client.from("orders").select(columns).eq("id", orderId).maybeSingle();
  if (error) console.error("[orders] read failed", orderId, error.message);
  if (!data) return null;

  const [events, messages, deliverables] = await Promise.all([
    client.from("order_events").select("*").eq("order_id", orderId).order("created_at"),
    client.from("order_messages").select("*").eq("order_id", orderId).order("created_at"),
    client
      .from("order_deliverables")
      .select("*")
      .eq("order_id", orderId)
      .order("sort_order")
      .order("created_at"),
  ]);
  return {
    order: data as unknown as Order,
    events: (events.data ?? []) as OrderEvent[],
    messages: messages.data ?? [],
    deliverables: (deliverables.data ?? []) as OrderDeliverable[],
  };
}

/** Pass the SESSION client: RLS is what makes a foreign id return nothing. */
export function loadOrderForOwner(session: Client, orderId: string): Promise<OrderDetail | null> {
  return loadDetail(session, orderId, OWNER_ORDER_COLUMNS);
}

/** Pass the service role client. Every event and every draft comes back. */
export function loadOrderForAdmin(admin: Client, orderId: string): Promise<OrderDetail | null> {
  return loadDetail(admin, orderId, "*");
}

/** One order row by id, for an action to re-read before it touches anything. */
export async function readOrder(admin: Client, orderId: string): Promise<Order | null> {
  const { data, error } = await admin.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (error) console.error("[orders] read failed", orderId, error.message);
  return (data as unknown as Order | null) ?? null;
}

/** Pass the SESSION client, so RLS scopes the list. */
export async function listOrdersForOwner(session: Client, page: number): Promise<OrderPage> {
  const [from, to] = pageRange(page, CUSTOMER_ORDER_PAGE_SIZE);
  const { data, count, error } = await session
    .from("orders")
    .select(OWNER_LIST_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id")
    .range(from, to);
  if (error) console.error("[orders] owner list failed", error.message);
  return {
    rows: (data ?? []) as unknown as OrderListRow[],
    total: count ?? 0,
    pageSize: CUSTOMER_ORDER_PAGE_SIZE,
  };
}

export type OwnerFigures = { open: number; delivered: number; spentCents: number };

/** The list page's three tiles. Counts use head requests; only Spent reads rows. */
export async function loadOwnerFigures(session: Client): Promise<OwnerFigures> {
  const [open, delivered] = await Promise.all([
    session
      .from("orders")
      .select("id", { count: "exact", head: true })
      .not("fulfillment_status", "in", "(delivered,cancelled)")
      .neq("payment_status", "expired"),
    session
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("fulfillment_status", "delivered"),
  ]);

  let spentCents = 0;
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await session
      .from("orders")
      .select("id, amount_cents, refunded_cents")
      .in("payment_status", ["paid", "refunded"])
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("[orders] spent read failed", error.message);
      break;
    }
    for (const row of data ?? []) spentCents += row.amount_cents - row.refunded_cents;
    if ((data ?? []).length < PAGE) break;
  }
  return { open: open.count ?? 0, delivered: delivered.count ?? 0, spentCents };
}

export type AdminView = "attention" | "queue" | "awaiting" | "delivered" | "closed" | "all";

export const ADMIN_VIEWS: AdminView[] = [
  "attention",
  "queue",
  "awaiting",
  "delivered",
  "closed",
  "all",
];

export async function listOrdersForAdmin(
  admin: Client,
  view: AdminView,
  page: number,
  now: Date = new Date(),
): Promise<OrderPage> {
  const [from, to] = pageRange(page, ORDER_PAGE_SIZE);
  let query = admin.from("orders").select(LIST_COLUMNS, { count: "exact" });
  switch (view) {
    case "attention":
      query = query.or(attentionFilter(now)).order("created_at", { ascending: false });
      break;
    case "queue":
      query = query
        .in("fulfillment_status", ["queued", "in_progress"])
        .order("due_at", { ascending: true, nullsFirst: false });
      break;
    case "awaiting":
      query = query
        .in("payment_status", ["unpaid", "awaiting_confirmation"])
        .is("customer_reported_paid_at", null)
        .order("created_at", { ascending: false });
      break;
    case "delivered":
      query = query
        .eq("fulfillment_status", "delivered")
        .order("delivered_at", { ascending: false, nullsFirst: false });
      break;
    case "closed":
      query = query
        .in("payment_status", ["cancelled", "refunded", "expired"])
        .order("created_at", { ascending: false });
      break;
    case "all":
      query = query.order("created_at", { ascending: false });
      break;
  }
  const { data, count, error } = await query.order("id").range(from, to);
  if (error) console.error("[orders] admin list failed", error.message);
  return {
    rows: (data ?? []) as unknown as OrderListRow[],
    total: count ?? 0,
    pageSize: ORDER_PAGE_SIZE,
  };
}

export type OrderSearchKind = "order-number" | "id" | "email";

/** Which search this text is. Pure. */
export function searchKind(q: string): OrderSearchKind | null {
  const trimmed = q.trim();
  if (ORDER_NUMBER_RE.test(trimmed.toUpperCase())) return "order-number";
  if (/^[0-9a-f-]{36}$/.test(trimmed.toLowerCase())) return "id";
  return trimmed.length >= 2 ? "email" : null;
}

export type OrderSearchResult = OrderPage & { noCustomer: boolean };

/**
 * Order number, id, or part of an email. Display names are not searched: a name is
 * derived at render time from several sources and is stored nowhere, so a search
 * over it would have to load every user, which is what this design avoids.
 */
export async function searchOrders(
  admin: Client,
  q: string,
  page: number,
): Promise<OrderSearchResult> {
  const kind = searchKind(q);
  const empty = { rows: [], total: 0, pageSize: ORDER_PAGE_SIZE };
  if (!kind) return { ...empty, noCustomer: false };

  const trimmed = q.trim();
  const [from, to] = pageRange(page, ORDER_PAGE_SIZE);
  let query = admin.from("orders").select(LIST_COLUMNS, { count: "exact" });

  if (kind === "order-number") {
    query = query.eq("order_number", trimmed.toUpperCase());
  } else if (kind === "id") {
    query = query.eq("id", trimmed.toLowerCase());
  } else {
    const customers = await searchCustomers(admin, trimmed, 50);
    if (customers.length === 0) return { ...empty, noCustomer: true };
    query = query.in(
      "user_id",
      customers.map((c) => c.userId),
    );
  }

  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .order("id")
    .range(from, to);
  if (error) console.error("[orders] search failed", error.message);
  return {
    rows: (data ?? []) as unknown as OrderListRow[],
    total: count ?? 0,
    pageSize: ORDER_PAGE_SIZE,
    noCustomer: false,
  };
}

export type AdminFigures = {
  attention: number;
  attentionHint: string | null;
  queued: number;
  inProgress: number;
  awaiting: number;
  revenue30Cents: number;
  weeks: WeekBucket[];
  turnaroundDays: number | null;
};

async function readRevenueRows(admin: Client, sinceIso: string): Promise<RevenueRow[]> {
  const rows: RevenueRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("orders")
      .select("id, amount_cents, refunded_cents, paid_at, livemode, payment_status")
      .gte("paid_at", sinceIso)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as unknown as RevenueRow[]));
    if ((data ?? []).length < PAGE) break;
  }
  return rows;
}

/** The six tiles and the twelve bars. Five reads, none per order. */
export async function loadAdminFigures(admin: Client, now: Date): Promise<AdminFigures> {
  const countWhere = () => admin.from("orders").select("id", { count: "exact", head: true });
  const since30 = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  // Twelve weeks ending Sunday can reach back as far as 13 calendar weeks.
  const since13Weeks = new Date(now.getTime() - 91 * DAY_MS).toISOString();

  const [attention, queued, inProgress, awaiting, revenueRows, delivered] = await Promise.all([
    // The exact count rides along with the rows, so the figure is right past the
    // 1000-row cap even when the hint's breakdown is over the first thousand.
    admin
      .from("orders")
      .select(ATTENTION_COLUMNS, { count: "exact" })
      .or(attentionFilter(now))
      .limit(1000),
    countWhere().eq("fulfillment_status", "queued").eq("payment_status", "paid"),
    countWhere().eq("fulfillment_status", "in_progress"),
    countWhere()
      .in("payment_status", ["unpaid", "awaiting_confirmation"])
      .is("customer_reported_paid_at", null),
    readRevenueRows(admin, since13Weeks),
    admin
      .from("orders")
      .select("paid_at, delivered_at")
      .gte("delivered_at", since30)
      .limit(1000),
  ]);

  const attentionRows = (attention.data ?? []) as unknown as AttentionFields[];
  return {
    attention: attention.count ?? attentionRows.length,
    attentionHint: attentionHint(attentionRows, now),
    queued: queued.count ?? 0,
    inProgress: inProgress.count ?? 0,
    awaiting: awaiting.count ?? 0,
    revenue30Cents: revenueOver(revenueRows, now, 30),
    weeks: revenueWeeks(revenueRows, now),
    turnaroundDays: turnaroundDays(delivered.data ?? []),
  };
}

/* -------------------------------------------------------------------------- */
/* Capacity and duplicates                                                     */
/* -------------------------------------------------------------------------- */

/**
 * What is compared to the cap. Pending orders count because a Stripe payment
 * cannot be refused after the fact: a door checked only at payment time would let
 * any number of unpaid orders be created and all be paid later. A count followed
 * by an insert is not atomic, and two orders in one second can take this one past
 * the cap. That is accepted rather than solved with a lock.
 */
export async function countOpenOrders(
  admin: Client,
  settings: CommerceSettings,
  now: Date = new Date(),
): Promise<number> {
  const working = await admin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .in("fulfillment_status", ["queued", "in_progress"]);
  if (working.error) throw new Error(working.error.message);
  if (!settings.storefront.countPendingPayment) return working.count ?? 0;

  const pending = await admin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .in("payment_status", ["unpaid", "awaiting_confirmation"])
    .gt("expires_at", now.toISOString());
  if (pending.error) throw new Error(pending.error.message);
  return (working.count ?? 0) + (pending.count ?? 0);
}

/** An UNPAID order for the same thing. A paid one is never a duplicate. */
export async function findOpenDuplicate(
  admin: Client,
  args: { userId: string; productId: string; sleeperLeagueId: string; rosterId: number },
): Promise<string | null> {
  const { data, error } = await admin
    .from("orders")
    .select("id")
    .eq("user_id", args.userId)
    .eq("product_id", args.productId)
    .eq("context->>sleeperLeagueId", args.sleeperLeagueId)
    .eq("context->>rosterId", String(args.rosterId))
    .in("payment_status", ["unpaid", "awaiting_confirmation"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) console.error("[orders] duplicate check failed", error.message);
  return data?.id ?? null;
}

export type ReviewInProgress = {
  orderId: string;
  orderNumber: string;
  productName: string;
  teamName: string;
  dueAt: string | null;
};

/** The reader's paid, unfinished reviews in this league, by roster id. */
export async function findReviewsInProgress(
  session: Client,
  sleeperLeagueId: string,
): Promise<Record<number, ReviewInProgress>> {
  const { data, error } = await session
    .from("orders")
    .select(
      "id, order_number, due_at, created_at, product_name:product_snapshot->>name, team_name:context->>teamName, roster_id:context->>rosterId",
    )
    .eq("context->>sleeperLeagueId", sleeperLeagueId)
    .eq("payment_status", "paid")
    .in("fulfillment_status", ["queued", "in_progress"])
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) console.error("[orders] in-progress read failed", error.message);

  const byRoster: Record<number, ReviewInProgress> = {};
  type Row = {
    id: string;
    order_number: string;
    due_at: string | null;
    product_name: string | null;
    team_name: string | null;
    roster_id: string | null;
  };
  for (const row of (data ?? []) as unknown as Row[]) {
    const rosterId = Number(row.roster_id);
    if (!Number.isInteger(rosterId)) continue;
    byRoster[rosterId] = {
      orderId: row.id,
      orderNumber: row.order_number,
      productName: row.product_name ?? "review",
      teamName: row.team_name ?? "this team",
      dueAt: row.due_at,
    };
  }
  return byRoster;
}

/* -------------------------------------------------------------------------- */
/* Email to the customer                                                       */
/* -------------------------------------------------------------------------- */

/** One `order_customer_identities` call. Read at send time, never from a request. */
export async function customerEmailFor(
  admin: Client,
  userId: string | null,
): Promise<string | null> {
  if (!userId) return null;
  const customers = await lookupCustomers(admin, [userId]);
  return customers.get(userId)?.email ?? null;
}

export type EmailOutcome = "sent" | "failed" | "skipped";

export type EmailCustomerResult = {
  status: EmailOutcome;
  subject: string;
  resendId: string | null;
  error: string | null;
};

/**
 * Build, send and record one customer email.
 *
 * No `replyTo` is passed, so the default michael@ffbeacon.com applies; a test holds
 * that line. The template and its extras go on the event so a failed send can be
 * rebuilt by the Resend button.
 */
export async function emailCustomer(
  admin: Client,
  order: Order,
  template: OrderEmailTemplate,
  extra: OrderEmailExtra = {},
  actor: EventActor = "system",
  actorUserId: string | null = null,
): Promise<EmailCustomerResult> {
  const built = renderOrderEmail(template, order, extra);
  const to = await customerEmailFor(admin, order.user_id);

  let result: EmailCustomerResult;
  if (!to) {
    result = {
      status: "failed",
      subject: built.subject,
      resendId: null,
      error: "No email address on the account",
    };
  } else {
    const sent = await sendEmail({ to, subject: built.subject, html: built.html, text: built.text });
    if (sent.ok) {
      result = { status: "sent", subject: built.subject, resendId: sent.id, error: null };
    } else if (sent.skipped) {
      result = {
        status: "skipped",
        subject: built.subject,
        resendId: null,
        error: "RESEND_API_KEY is not configured",
      };
    } else {
      result = { status: "failed", subject: built.subject, resendId: null, error: sent.error };
    }
  }

  await insertEvent(admin, {
    orderId: order.id,
    kind: "email_sent",
    actor,
    actorUserId,
    // A failed send is the admin's to see, with a Resend beside it.
    visible: result.status === "sent",
    title: `Email sent: ${built.subject}`,
    data: {
      template,
      extra,
      status: result.status,
      resendId: result.resendId,
      error: result.error,
    },
  });
  return result;
}

/** Which message is the receipt for this order. */
export function receiptTemplate(
  order: Pick<Order, "payment_method" | "origin">,
): OrderEmailTemplate {
  if (order.origin === "admin") return "E13";
  return order.payment_method === "paypal" || order.payment_method === "venmo" ? "E3" : "E1";
}

/**
 * The one sender of the receipt, and the owner of its status. Retried by the cron
 * and by the admin's button, so it reads the order fresh rather than trusting the
 * caller's copy.
 */
export async function sendReceipt(
  admin: Client,
  orderId: string,
  extra: OrderEmailExtra = {},
): Promise<EmailOutcome | null> {
  const order = await readOrder(admin, orderId);
  if (!order) return null;

  const template = receiptTemplate(order);
  // E13 carries the admin's note. A retry has only what the first attempt recorded.
  let receiptExtra = extra;
  if (template === "E13" && !extra.note) {
    const { data: last } = await admin
      .from("order_events")
      .select("data")
      .eq("order_id", order.id)
      .eq("kind", "email_sent")
      .eq("data->>template", "E13")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    receiptExtra = (last?.data as { extra?: OrderEmailExtra } | null)?.extra ?? extra;
  }
  const result = await emailCustomer(admin, order, template, receiptExtra);
  const now = new Date().toISOString();
  const { error } = await admin
    .from("orders")
    .update({
      receipt_email_status: result.status,
      receipt_email_attempts: order.receipt_email_attempts + 1,
      receipt_email_sent_at: result.status === "sent" ? now : order.receipt_email_sent_at,
      receipt_email_error: result.error ? result.error.slice(0, 500) : null,
    })
    .eq("id", orderId);
  if (error) console.error("[orders] receipt status write failed", orderId, error.message);
  return result.status;
}

/* -------------------------------------------------------------------------- */
/* Paid                                                                        */
/* -------------------------------------------------------------------------- */

export type MarkPaidArgs = {
  paidVia: PaidVia;
  reference?: string | null;
  paidAtIso?: string;
  paymentIntentId?: string | null;
  livemode?: boolean | null;
  /** The redacted Stripe event, for a card payment. */
  metadata?: Json;
  actor: EventActor;
  actorUserId?: string | null;
  title: string;
  via: string;
  /** Carried into E13 for an admin-created order. */
  receiptExtra?: OrderEmailExtra;
};

export type MarkPaidResult =
  | { won: true; followUp: () => Promise<void> }
  | { won: false; error: string | null };

/**
 * The one path to paid: the RPC, then the `paid` event. `followUp` sends the
 * receipt and the admin notice, and the caller runs it inside `after()` so neither
 * Stripe nor a reader waits on an email.
 */
export async function markPaidIfWon(
  admin: Client,
  order: Pick<Order, "id">,
  settings: CommerceSettings,
  args: MarkPaidArgs,
): Promise<MarkPaidResult> {
  const { data, error } = await admin.rpc("try_mark_order_paid", {
    p_order_id: order.id,
    p_paid_via: args.paidVia,
    p_reference: args.reference ?? undefined,
    p_paid_at: args.paidAtIso ?? new Date().toISOString(),
    p_payment_intent_id: args.paymentIntentId ?? undefined,
    p_livemode: args.livemode ?? undefined,
  });
  if (error) {
    console.error("[orders] paid transition failed", order.id, error.message);
    return { won: false, error: error.message };
  }
  if (!data) return { won: false, error: null };

  if (args.metadata !== undefined) {
    const { error: metaError } = await admin
      .from("orders")
      .update({ metadata: args.metadata })
      .eq("id", order.id);
    if (metaError) console.error("[orders] metadata write failed", order.id, metaError.message);
  }

  await insertEvent(admin, {
    orderId: order.id,
    kind: "paid",
    actor: args.actor,
    actorUserId: args.actorUserId ?? null,
    title: args.title,
    data: { via: args.via },
  });

  return {
    won: true,
    followUp: async () => {
      await sendReceipt(admin, order.id, args.receiptExtra);
      await notifyOrderPaid(admin, order.id, settings);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Refunds                                                                     */
/* -------------------------------------------------------------------------- */

export type RefundFields = Pick<
  Order,
  "amount_cents" | "refunded_cents" | "payment_status" | "fulfillment_status"
>;

export type RefundDecision =
  | { apply: false }
  | {
      apply: true;
      deltaCents: number;
      totalCents: number;
      full: boolean;
      paymentStatus: PaymentStatus;
      fulfillmentStatus: FulfillmentStatus;
    };

/**
 * The one arithmetic. `requestedDeltaCents` is capped at what is left, and a
 * request that adds nothing is `apply: false`, which is what makes a redelivered
 * event, or the webhook arriving after the admin's button, a no-op.
 */
export function refundDecision(order: RefundFields, requestedDeltaCents: number): RefundDecision {
  if (order.payment_status !== "paid" && order.payment_status !== "refunded") {
    return { apply: false };
  }
  const left = order.amount_cents - order.refunded_cents;
  const deltaCents = Math.min(Math.floor(requestedDeltaCents), left);
  if (deltaCents <= 0) return { apply: false };

  const totalCents = order.refunded_cents + deltaCents;
  const full = totalCents >= order.amount_cents;
  return {
    apply: true,
    deltaCents,
    totalCents,
    full,
    paymentStatus: full ? "refunded" : order.payment_status,
    fulfillmentStatus:
      full && order.fulfillment_status !== "delivered" ? "cancelled" : order.fulfillment_status,
  };
}

export type RecordRefundArgs = {
  deltaCents: number;
  note: string | null;
  refundedAtIso: string;
  actor: EventActor;
  actorUserId?: string | null;
  /** A lost chargeback is money gone, and stays between the admin and Stripe. */
  visibleToCustomer: boolean;
};

export type RecordRefundResult =
  | { applied: false; error: string | null }
  | { applied: true; deltaCents: number; totalCents: number; full: boolean };

/**
 * Apply one refund. The update is conditional on the total it read, so the webhook
 * and the button racing each other cannot both add to it.
 */
export async function recordRefund(
  admin: Client,
  order: Order,
  args: RecordRefundArgs,
): Promise<RecordRefundResult> {
  const decision = refundDecision(order, args.deltaCents);
  if (!decision.apply) return { applied: false, error: null };

  const { data, error } = await admin
    .from("orders")
    .update({
      refunded_cents: decision.totalCents,
      refunded_at: args.refundedAtIso,
      refund_note: args.note ? args.note.slice(0, 500) : order.refund_note,
      payment_status: decision.paymentStatus,
      fulfillment_status: decision.fulfillmentStatus,
    })
    .eq("id", order.id)
    .eq("refunded_cents", order.refunded_cents)
    // The fulfillment write was computed from the read, so a delivery that landed
    // in between must not be overwritten with cancelled.
    .eq("fulfillment_status", order.fulfillment_status)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[orders] refund write failed", order.id, error.message);
    return { applied: false, error: error.message };
  }
  // The total moved under us. Reported as an error so a webhook retries it.
  if (!data) return { applied: false, error: "The refund total changed. Try again." };

  await insertEvent(admin, {
    orderId: order.id,
    kind: "refunded",
    actor: args.actor,
    actorUserId: args.actorUserId ?? null,
    visible: args.visibleToCustomer,
    title: decision.full ? "Refunded" : "Partly refunded",
    body: `${formatMoney(decision.deltaCents)} refunded to the original payment method`,
    data: { deltaCents: decision.deltaCents, totalCents: decision.totalCents },
  });
  return {
    applied: true,
    deltaCents: decision.deltaCents,
    totalCents: decision.totalCents,
    full: decision.full,
  };
}

/* -------------------------------------------------------------------------- */
/* Small reads for the admin order page                                        */
/* -------------------------------------------------------------------------- */

export type CustomerHistory = { orderCount: number; openChargebacksElsewhere: number };

export async function loadCustomerHistory(
  admin: Client,
  userId: string | null,
  orderId: string,
): Promise<CustomerHistory> {
  if (!userId) return { orderCount: 0, openChargebacksElsewhere: 0 };
  const [orders, disputes] = await Promise.all([
    admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("dispute_status", "open")
      .neq("id", orderId),
  ]);
  return { orderCount: orders.count ?? 0, openChargebacksElsewhere: disputes.count ?? 0 };
}
