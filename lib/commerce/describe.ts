/**
 * The words that name what an order is about, for both kinds of review.
 *
 * A team review is about "Night Owls in The League"; a trade review is about
 * "Josh Allen for Bijan Robinson and a 2027 1st". The order sheet, the lists, the
 * receipt, the Stripe line and the admin notices all need that line, and each
 * kind spells it differently, so it is written once here. Pure and client-safe.
 */

import type { PublicSharePayload } from "@/lib/signal-check/types";
import { isTradeReviewContext, type Order, type OrderContext } from "./types";

const SUMMARY_MAX = 140;

/** "Side A" or the team label the import gave it. */
export function tradeSideName(trade: PublicSharePayload, side: "a" | "b"): string {
  const found = trade.sides.find((s) => s.side === side);
  return found?.teamLabel || `Side ${side.toUpperCase()}`;
}

function joinNames(names: string[]): string {
  if (names.length === 0) return "nothing";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "Josh Allen for Bijan Robinson and a 2027 1st", capped for a list row. */
export function tradeLine(trade: PublicSharePayload): string {
  const names = (side: "a" | "b") =>
    (trade.sides.find((s) => s.side === side)?.assets ?? []).map((a) => a.name);
  const line = `${joinNames(names("a"))} for ${joinNames(names("b"))}`;
  if (line.length <= SUMMARY_MAX) return line;
  return `${line.slice(0, SUMMARY_MAX - 3).trimEnd()}...`;
}

/**
 * "within 24 hours" for a one-day turnaround, else "within 3 days". The column
 * holds whole days with a floor of one, and a day reads better as hours.
 */
export function withinDays(days: number): string {
  if (days <= 1) return "within 24 hours";
  return `within ${days} days`;
}

/** The subject of an order in one line: the team and league, or the trade. */
export function orderSubjectLine(context: OrderContext): string {
  if (isTradeReviewContext(context)) return context.summary || tradeLine(context.trade);
  return `${context.teamName} in ${context.leagueName}`;
}

/** The subject with its setting: the season for a team, the format for a trade. */
export function orderSubjectDetail(context: OrderContext): string {
  if (isTradeReviewContext(context)) return `${orderSubjectLine(context)}, ${context.trade.formatDisplay}`;
  return `${context.teamName} in ${context.leagueName}, ${context.season}`;
}

/** The label beside that line on a receipt or an admin page. */
export function orderSubjectLabel(context: OrderContext): "Team" | "Trade" {
  return isTradeReviewContext(context) ? "Trade" : "Team";
}

/** The family's public name, for a Stripe line item and a page title. */
export function productKindName(order: Pick<Order, "context">): string {
  return isTradeReviewContext(order.context) ? "Trade Review" : "Personal Team Review";
}

/** Where a customer starts a new order of the same kind, in words. */
export function reorderPlace(context: OrderContext): string {
  return isTradeReviewContext(context) ? "the trade calculator" : "your Blueprint";
}
