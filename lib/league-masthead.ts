/**
 * The League Pulse masthead's inputs, from the league row and its resolved
 * format context.
 *
 * Every section page assembled this same object by hand, ten copies of it,
 * each with its own little relative-time formatter. New pages build it here;
 * the older copies can move over one at a time.
 *
 * The coverage fallbacks are words rather than "N/A", which a screen reader
 * reads as "na", "n slash a", or letter by letter. The masthead hides them when
 * coverage is "none", so they are placeholders, but a placeholder that leaks
 * should not need a second fix.
 */

import type { LeagueMastheadProps } from "@/components/league-shell";
import {
  describeDerived,
  type LeagueContext,
  type LeagueContextEmpty,
} from "@/lib/league-format-resolution";
import { buildLeagueFormatTags, buildLeagueScoringTags } from "@/lib/league-format-tags";
import { formatRelative } from "@/lib/datetime";

/** The columns of a `leagues` row the masthead reads. */
export type MastheadLeague = {
  name: string;
  metadata: unknown;
  season: number | string | null;
  total_rosters: number | null;
  status: string | null;
  roster_positions: unknown;
  scoring_settings: unknown;
  last_pulsed_at: string | null;
};

export function leagueMastheadProps(
  league: MastheadLeague,
  context: LeagueContext | LeagueContextEmpty,
  cached: boolean,
): LeagueMastheadProps {
  const avatar = (league.metadata as { avatar?: unknown } | null)?.avatar;
  const covered = context.coverage !== "none" ? context : null;
  return {
    leagueName: league.name,
    avatarId: typeof avatar === "string" ? avatar : null,
    season: league.season ?? null,
    teamCount: league.total_rosters ?? null,
    status: league.status ?? null,
    formatTags: buildLeagueFormatTags({
      rosterPositions: league.roster_positions,
      scoringSettings: league.scoring_settings,
      teamCount: league.total_rosters,
    }),
    scoringTags: buildLeagueScoringTags(league.scoring_settings),
    lastUpdatedLabel: league.last_pulsed_at ? formatRelative(league.last_pulsed_at) : "never",
    cached,
    coverage: context.coverage,
    sourceDisplay: covered ? covered.sourceDisplay : "Not available",
    formatDisplay: covered ? covered.formatDisplay : "Not available",
    derivedLabel: describeDerived(context.derived),
    fallbackDisplay:
      covered && covered.coverage === "fallback" ? (covered.fallback?.derivedDisplay ?? null) : null,
    pickSourceDisplay:
      covered && covered.pickSource && covered.pickSource.slug !== covered.sourceSlug
        ? covered.pickSource.display
        : null,
  };
}
