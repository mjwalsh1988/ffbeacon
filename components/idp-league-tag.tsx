import { leagueHasIdp } from "@/lib/league-format-tags";

/**
 * The "IDP" tag on a league card (plan R-28): this league starts individual
 * defensive players. The accessible name of the row control carries the same
 * fact in words through idpLabelPart, because a tag inside a control with its
 * own aria-label is never read.
 */
export function IdpLeagueTag() {
  return (
    <span className="inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-position-lb/15 text-position-lb">
      <span aria-hidden="true">IDP</span>
      <span className="sr-only">IDP league</span>
    </span>
  );
}

/** ", IDP league" for an accessible name, or "" when the league has no IDP slot. */
export function idpLabelPart(league: { roster_positions?: unknown }): string {
  return leagueHasIdp(league.roster_positions) ? ", IDP league" : "";
}
