/**
 * The ruled list of orders, shared by the customer's list and the admin queue. The
 * whole row is one link with the order number as its leading text, so a screen
 * reader hears the number first.
 *
 * Below `md` a row is two stacked lines rather than a squeezed table: the number,
 * who and how much, then what, the chips and the due line. Nothing is hidden at any
 * width; it only moves.
 */

import Link from "next/link";
import type { Route } from "next";
import { formatEastern, formatEasternDate, formatEasternShortDate, formatRelative } from "@/lib/datetime";
import { formatMoney } from "@/lib/commerce/constants";
import type { Customer } from "@/lib/commerce/customers";
import type { OrderListRow } from "@/lib/commerce/orders";
import {
  disputeChip,
  FREE_CHIP,
  FULFILLMENT_LABEL,
  paymentChip,
  progressStep,
  TEST_CHIP,
} from "@/lib/commerce/transitions";
import type { PaymentMethod } from "@/lib/commerce/types";
import { RULED } from "@/components/league-blueprint/sheet";
import { CompactProgress } from "./order-progress";
import { StatusChip } from "./status-chip";

const METHOD_WORD: Record<PaymentMethod, string> = {
  stripe: "card",
  paypal: "PayPal",
  venmo: "Venmo",
  complimentary: "free",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function dueLine(row: OrderListRow, now: Date): { text: string; late: boolean } | null {
  if (row.fulfillment_status === "delivered") {
    return row.delivered_at
      ? { text: `Delivered ${formatEasternShortDate(row.delivered_at)}`, late: false }
      : null;
  }
  if (row.fulfillment_status === "cancelled" || !row.due_at) return null;
  const days = Math.ceil((new Date(row.due_at).getTime() - now.getTime()) / DAY_MS);
  if (days < 0) {
    const late = Math.abs(days);
    return { text: `Overdue by ${late} ${late === 1 ? "day" : "days"}`, late: true };
  }
  if (days === 0) return { text: "Due today", late: false };
  return { text: `Due in ${days} ${days === 1 ? "day" : "days"}`, late: false };
}

const ROW_LINK =
  "block min-h-11 py-3 transition-colors hover:bg-ink/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-cyan";

function CustomerRow({ row }: { row: OrderListRow }) {
  const chip = paymentChip(row, "customer");
  const fulfillment = FULFILLMENT_LABEL[row.fulfillment_status];
  return (
    <li>
      <Link href={`/my-beacon/orders/${row.id}` as Route} className={ROW_LINK}>
        <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="font-mono text-sm font-bold tabular-nums text-ink">{row.order_number}</span>
          <span className="font-mono text-[11px] text-ink-muted">{formatEasternDate(row.created_at)}</span>
        </span>
        <span className="mt-1 block text-sm font-semibold text-ink">{row.product_name}</span>
        <span className="block break-words text-sm text-ink-muted">
          {row.team_name} in {row.league_name}
        </span>
        <span className="mt-2 flex flex-wrap items-center gap-1.5">
          <StatusChip chip={chip} />
          <StatusChip chip={fulfillment} />
          {/* The chips beside it already say the state; the marks add only how far along it is. */}
          <CompactProgress
            steps={progressStep(row)}
            label={`${progressStep(row).filter((s) => s.state === "complete").length} of 4 steps done`}
          />
        </span>
      </Link>
    </li>
  );
}

function AdminRow({ row, customer, now }: { row: OrderListRow; customer: Customer | undefined; now: Date }) {
  const dispute = disputeChip(row.dispute_status ?? null);
  const due = dueLine(row, now);
  return (
    <li>
      <Link
        href={`/admin/orders/${row.id}` as Route}
        className={`${ROW_LINK} grid gap-x-4 gap-y-1.5 md:grid-cols-[9rem_minmax(0,1.2fr)_minmax(0,1.3fr)_8rem_minmax(0,1.1fr)_7rem] md:items-start`}
      >
        <span className="flex flex-wrap items-center gap-1.5 md:col-start-1 md:row-start-1 md:flex-col md:items-start">
          <span className="font-mono text-sm font-bold tabular-nums text-ink">{row.order_number}</span>
          {row.livemode === false && <StatusChip chip={TEST_CHIP} />}
          {row.amount_cents === 0 && <StatusChip chip={FREE_CHIP} />}
        </span>

        <span className="min-w-0">
          <span className="block break-words text-sm font-semibold text-ink">
            {customer?.displayName ?? "Deleted account"}
          </span>
          <span className="block break-all text-xs text-ink-subtle">{customer?.email ?? "No address"}</span>
        </span>

        <span className="min-w-0">
          <span className="block text-sm text-ink">{row.product_name}</span>
          <span className="block break-words text-xs text-ink-muted">
            {row.team_name} in {row.league_name}
          </span>
        </span>

        <span>
          <span className="font-mono text-sm font-bold tabular-nums text-ink">{formatMoney(row.amount_cents)}</span>
          <span className="ml-1.5 text-xs text-ink-muted md:ml-0 md:block">
            {METHOD_WORD[row.payment_method]}
            {row.refunded_cents > 0 ? ", partly refunded" : ""}
          </span>
        </span>

        <span className="flex flex-wrap items-center gap-1.5">
          <StatusChip chip={paymentChip(row, "admin")} />
          {dispute && <StatusChip chip={dispute} />}
          <StatusChip chip={FULFILLMENT_LABEL[row.fulfillment_status]} />
        </span>

        <span className="text-xs">
          {due && (
            <span className={`block font-semibold ${due.late ? "text-signal-danger" : "text-ink-muted"}`}>
              {due.text}
            </span>
          )}
          <span className="block text-ink-subtle">
            {formatRelative(row.created_at, now.getTime())}
            <span className="sr-only">, placed {formatEastern(row.created_at)}</span>
          </span>
        </span>
      </Link>
    </li>
  );
}

export function OrderList(
  props:
    | { variant: "customer"; rows: OrderListRow[] }
    | { variant: "admin"; rows: OrderListRow[]; customers: Map<string, Customer>; now: Date },
) {
  return (
    <ul role="list" className={RULED}>
      {props.variant === "customer"
        ? props.rows.map((row) => <CustomerRow key={row.id} row={row} />)
        : props.rows.map((row) => (
            <AdminRow
              key={row.id}
              row={row}
              customer={row.user_id ? props.customers.get(row.user_id) : undefined}
              now={props.now}
            />
          ))}
    </ul>
  );
}
