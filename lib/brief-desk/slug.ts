/**
 * The suggested slug and title for an edition, and the in-season pattern the
 * validator enforces (docs/beacon-brief/relays-and-briefs-plan.md, 11.1).
 *
 * In season the pattern is fixed: week-{n}-fantasy-football-news-injuries-{season}
 * and "Week {n} Fantasy Football News and Injuries ({season})". The run and the
 * owner may extend the title after a colon; the slug must start with the week
 * token. Off-season the run proposes three title and slug pairs and the owner
 * picks one at approval; the provisional slug below only holds the in-review
 * row, which has no public URL.
 *
 * Pure.
 */

import { formatEasternDate } from "@/lib/datetime";
import type { RelayPhase } from "@/lib/relays/week";

export interface EditionPeriodLike {
  season: string;
  week: number | null;
  phase: RelayPhase;
  /** Pre-season only: weeks to kickoff. */
  preSeasonWeek: number | null;
  periodEnd: string;
}

export function suggestedEditionSlug(p: EditionPeriodLike): string {
  if (p.phase === "regular" && p.week !== null) {
    return `week-${p.week}-fantasy-football-news-injuries-${p.season}`;
  }
  if (p.phase === "post" && p.week !== null) {
    return `playoffs-week-${p.week}-fantasy-football-news-injuries-${p.season}`;
  }
  if (p.phase === "pre" && p.preSeasonWeek !== null) {
    return `preseason-${p.preSeasonWeek}-weeks-to-kickoff-fantasy-football-news-${p.season}`;
  }
  return `offseason-fantasy-football-news-${p.periodEnd.slice(0, 10)}`;
}

export function suggestedEditionTitle(p: EditionPeriodLike): string {
  if (p.phase === "regular" && p.week !== null) {
    return `Week ${p.week} Fantasy Football News and Injuries (${p.season})`;
  }
  if (p.phase === "post" && p.week !== null) {
    // 58 characters at week 20; "NFL Playoffs" made it 62, past the 60 the
    // validator warns at, so every playoff edition carried a warning it could
    // only clear by leaving the fixed pattern.
    return `Playoffs Week ${p.week} Fantasy Football News and Injuries (${p.season})`;
  }
  if (p.phase === "pre" && p.preSeasonWeek !== null) {
    return `Preseason Fantasy Football News, ${p.preSeasonWeek} Weeks to Kickoff (${p.season})`;
  }
  return `Fantasy Football Off-Season News through ${formatEasternDate(p.periodEnd)}`;
}

/** The token an in-season slug must start with. */
export function requiredSlugPrefix(p: EditionPeriodLike): string | null {
  if (p.phase === "regular" && p.week !== null) return `week-${p.week}-`;
  if (p.phase === "post" && p.week !== null) return `playoffs-week-${p.week}-`;
  if (p.phase === "pre" && p.preSeasonWeek !== null) return `preseason-${p.preSeasonWeek}-`;
  return null;
}

/** Is the phase one where the title pattern is fixed and title_options are forbidden? */
export function isInSeasonPhase(phase: RelayPhase): boolean {
  return phase === "regular" || phase === "post" || phase === "pre";
}

export const KEBAB_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
