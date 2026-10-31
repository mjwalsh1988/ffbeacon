/**
 * The shapes of the Beacon Store, and the rules they carry.
 *
 * Products are rows, so a second product is an admin form rather than a code
 * change. The first family is the Personal Team Review.
 *
 * Money correctness, each held in code and tested:
 *   - Money is cents everywhere past the admin's price field. The order freezes
 *     what was sold in `amount_cents` and `product_snapshot`, so changing a price
 *     never changes a past receipt.
 *   - The browser never names a price. It posts the price it DISPLAYED
 *     (`expectedCents`), and the server refuses when its own total differs.
 *   - `try_mark_order_paid` is the one path to paid. The webhook never takes it
 *     when Stripe's amount or currency differs from the order.
 *   - Exactly one Stripe session is payable for an order. The open one is expired
 *     before a replacement, a method switch or a cancel, and a `complete` answer
 *     there is a payment, never something to ignore.
 *   - `refunded_cents` is one running total that only grows, and an order is
 *     `refunded` only when it reaches the amount paid. The system never moves
 *     money out; it records what happened at the processor.
 *
 * Identity is the account, never a copy: `orders.user_id` points at auth.users,
 * and name and email are read from Auth at render and send time.
 *
 * RLS is row level, not column level. The owner can read every column of their
 * order row, so nothing on a customer-readable table is for the admin alone.
 * Internal notes are `order_events` rows with `visible_to_customer = false`.
 *
 * Nothing here is a model. No number is computed about a team by this feature; it
 * stores what the Team Blueprint already computed.
 */

import type { Database } from "@/lib/database.types";
import type { BlueprintView } from "@/lib/league-blueprint/types";

type Tables = Database["public"]["Tables"];

export type PaymentMethod = "stripe" | "paypal" | "venmo" | "complimentary";
export type ManualMethod = "paypal" | "venmo";
export type PaymentStatus =
  | "unpaid"
  | "awaiting_confirmation"
  | "paid"
  | "expired"
  | "cancelled"
  | "refunded";
export type FulfillmentStatus =
  | "pending_payment"
  | "queued"
  | "in_progress"
  | "delivered"
  | "cancelled";
export type DisputeStatus = "open" | "won" | "lost" | "warning_closed";
export type ReceiptEmailStatus = "pending" | "sent" | "failed" | "skipped";
export type PaidVia = "stripe-webhook" | "stripe-reconcile" | "manual" | "coupon" | "complimentary";
export type OrderOrigin = "customer" | "admin";

export type ProductPlacement = "blueprint" | "league-overview" | "my-beacon";

export type EventKind =
  | "created"
  | "payment_pending"
  | "payment_reported"
  | "payment_not_found"
  | "paid"
  | "payment_expired"
  | "payment_cancelled"
  | "refunded"
  | "status_changed"
  | "email_sent"
  | "note"
  | "delivered"
  | "delivery_updated"
  | "duplicate_payment"
  | "payment_mismatch"
  | "dispute_opened"
  | "dispute_updated"
  | "dispute_closed"
  | "coupon_applied"
  | "intake_updated"
  | "attachment_added";

export type EventActor = "system" | "admin" | "customer";

export type ProductSnapshot = {
  slug: string;
  family: string;
  tier_rank: number;
  name: string;
  tagline: string | null;
  features: string[];
  price_cents: number;
  turnaround_days: number;
  intake_form: string;
};

export type TeamReviewBlueprintSnapshot = {
  generatedAt: string;
  overall: number;
  statusLabel: string | null;
  modelVersion: number;
  view: BlueprintView;
};

export type TeamReviewContext = {
  sleeperLeagueId: string;
  leagueRowId: string;
  leagueName: string;
  season: string;
  totalRosters: number;
  rosterId: number;
  teamName: string;
  ownerHandle: string | null;
  formatSlug: string | null;
  formatDisplay: string;
  sourceSlug: string;
  sourceDisplay: string;
  blueprint: TeamReviewBlueprintSnapshot | null;
  links: { blueprint: string; overview: string; lineups: string; tradeIdeas: string };
};

export type TeamReviewDirection = "contend" | "rebuild" | "unsure";

export type TeamReviewIntake = {
  direction: TeamReviewDirection;
  questions: string;
  offLimits: string;
  contact: "email";
  /** Set when the admin created the order and the customer has yet to answer. */
  providedBy?: "admin";
};

type OrderRow = Tables["orders"]["Row"];

/** An orders row with its text columns narrowed and its json columns shaped. */
export type Order = Omit<
  OrderRow,
  | "payment_method"
  | "payment_status"
  | "fulfillment_status"
  | "dispute_status"
  | "receipt_email_status"
  | "paid_via"
  | "origin"
  | "product_snapshot"
  | "context"
  | "intake"
> & {
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  fulfillment_status: FulfillmentStatus;
  dispute_status: DisputeStatus | null;
  receipt_email_status: ReceiptEmailStatus | null;
  paid_via: PaidVia | null;
  origin: OrderOrigin;
  product_snapshot: ProductSnapshot;
  context: TeamReviewContext;
  intake: TeamReviewIntake;
};

export type OrderEvent = Omit<Tables["order_events"]["Row"], "kind" | "actor"> & {
  kind: EventKind;
  actor: EventActor;
};

export type OrderMessage = Tables["order_messages"]["Row"];

export type OrderDeliverable = Omit<
  Tables["order_deliverables"]["Row"],
  "kind" | "status" | "upload_state"
> & {
  kind: "section" | "attachment";
  status: "draft" | "published";
  upload_state: "pending" | "ready";
};

export type Product = Omit<Tables["products"]["Row"], "features" | "placements"> & {
  features: string[];
  placements: ProductPlacement[];
};

export type Coupon = Omit<Tables["coupons"]["Row"], "kind"> & {
  kind: "percent" | "amount";
};
