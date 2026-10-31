/**
 * The checkout link for one review, and the words every offer shares.
 *
 * Three surfaces sell the same two reviews (the strip, the sidebar rail and the
 * sales section at the foot of the Blueprint), so the link and the proof points
 * live here rather than in any one of them.
 */

import { withUsername } from "@/components/league-schedule/format";
import type { PaymentMethod } from "@/lib/commerce/types";

/** The checkout link for one tier. */
export function reviewHref(args: {
  sleeperLeagueId: string;
  rosterId: number | null;
  tier: string;
  linkUsername: string | null;
}): string {
  const params = new URLSearchParams();
  if (args.rosterId != null) params.set("roster", String(args.rosterId));
  params.set("tier", args.tier);
  return withUsername(`/leagues/${args.sleeperLeagueId}/review?${params.toString()}`, args.linkUsername);
}

/** The Blueprint's sales section, with the reader's handle carried and the hash last. */
export function reviewSectionHref(args: {
  sleeperLeagueId: string;
  rosterId: number | null;
  linkUsername: string | null;
}): string {
  const path = `/leagues/${args.sleeperLeagueId}/blueprint${args.rosterId != null ? `?roster=${args.rosterId}` : ""}`;
  return `${withUsername(path, args.linkUsername)}#review`;
}

/** "card, Apple Pay, Google Pay, PayPal or Venmo", from what is switched on. */
export function payWays(methods: readonly PaymentMethod[]): string | null {
  const words: string[] = [];
  if (methods.includes("stripe")) words.push("card", "Apple Pay", "Google Pay");
  if (methods.includes("paypal")) words.push("PayPal");
  if (methods.includes("venmo")) words.push("Venmo");
  if (words.length === 0) return null;
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;
}

/** "within 3 days" or "within 1 day". */
export function withinDays(days: number): string {
  return `within ${days} ${days === 1 ? "day" : "days"}`;
}
