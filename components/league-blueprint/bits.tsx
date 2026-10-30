/**
 * Small shared pieces for the Team Blueprint panels: number formats and the
 * figure classes of plan section 10.1, so every panel draws the same
 * hierarchy from one place.
 */

import { ordinal } from "@/lib/league-team-status";
import { proposalHref } from "@/lib/trade-impact/proposal-url";
import type { TradeProposal } from "@/lib/trade-impact/types";
import type { BlueprintPlayer } from "@/lib/league-blueprint/types";

/** Hero figure (one per section). */
export const HERO_FIGURE = "font-mono text-4xl font-black leading-none tabular-nums sm:text-5xl";
export const HERO_LABEL = "text-[11px] font-semibold uppercase tracking-wide text-brand-cyan";
export const HERO_SUB = "font-mono text-[11px] tabular-nums text-ink-subtle";
/** Secondary figure (up to four per section). */
export const SECONDARY_FIGURE = "font-mono text-2xl font-black tabular-nums text-ink";
export const SECONDARY_LABEL = "text-[10px] font-semibold uppercase tracking-wide text-ink-subtle";
/** List or row figure. */
export const ROW_FIGURE = "font-mono text-base font-extrabold tabular-nums text-ink sm:text-lg";
export const ROW_SUB = "whitespace-nowrap font-mono text-[11px] tabular-nums text-ink-subtle";
/** Sub-list heading. */
export const SUBLIST_HEADING = "text-[11px] font-bold uppercase tracking-[0.14em] text-ink-subtle";
/** A text link with a 44px target. */
export const LINK =
  "inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-cyan underline-offset-4 transition-colors duration-[180ms] hover:text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

/** "Team (@handle)", without doubling a handle the team name already carries. */
export function teamWithHandle(teamName: string, handle: string | null): string {
  if (!handle || teamName.includes(`@${handle}`)) return teamName;
  return `${teamName} (@${handle})`;
}

export function fmtValue(v: number | null | undefined): string {
  return v === null || v === undefined ? "No market value" : Math.round(v).toLocaleString("en-US");
}

export function fmtSigned(v: number, digits = 0): string {
  const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${v > 0 ? "+" : v < 0 ? "-" : ""}${s}`;
}

export function rankOf(rank: number | null, teamCount: number): string {
  return rank === null ? "Unranked" : `${ordinal(rank)} of ${teamCount}`;
}

export function posRank(p: BlueprintPlayer): string | null {
  return p.positionRank === null ? null : `${p.position}${p.positionRank}`;
}

/** A builder link for a stored proposal, with the reader's own username and source. */
export function builderHref(
  sleeperLeagueId: string,
  proposal: TradeProposal,
  linkUsername: string | null,
  sourceSlug: string | null,
): string {
  return proposalHref(sleeperLeagueId, proposal, { searchedUsername: linkUsername, source: sourceSlug });
}
