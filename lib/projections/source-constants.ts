/**
 * The projection source slugs, and nothing else.
 *
 * Split out from ./source.ts so the BUILDER can name the source it writes
 * without importing the READER's selection logic. lib/build-beacon-projections
 * runs server side against the service role; the reader path is called from
 * page renders. Keeping the constants in a leaf module with no imports of its
 * own means neither side can drag the other's dependencies along.
 *
 * These are stored values. They appear in `player_weekly_projections.source`
 * and in `player_projection_accuracy.source`, so changing one is a data
 * migration, not a rename.
 */

/** Sleeper's own published projection. The default, and the fallback. */
export const SLEEPER_SOURCE = "sleeper";

/** Our own, from lib/projections/. Blended with Sleeper, never replacing it. */
export const BEACON_SOURCE = "ffbeacon";

export const PROJECTION_SOURCES = [SLEEPER_SOURCE, BEACON_SOURCE] as const;
export type ProjectionSourceSlug = (typeof PROJECTION_SOURCES)[number];

/**
 * The name a reader sees for a projection source.
 *
 * A surface that shows projected points has to say whose they are, and it has
 * to keep saying the right one after an admin flips the engine over. Every
 * heading that used to read "Sleeper projections" now reads this instead, so
 * the label and the number can never describe different engines.
 *
 * Lives here rather than in ./source.ts because client components need it and
 * this module is a leaf with no imports: pulling in the reader's selection
 * logic (and its Supabase types) just to spell a name would drag the server
 * data layer into the browser bundle.
 */
export function projectionSourceDisplay(source: string | null | undefined): string {
  if (source === BEACON_SOURCE) return "FF Beacon";
  if (source === SLEEPER_SOURCE) return "Sleeper";
  // An unknown slug names itself rather than being relabelled as one of the
  // two we know: a heading that says "Sleeper" over somebody else's numbers is
  // worse than one that says a word the reader has to look up.
  return source && source.trim().length > 0 ? source : "Sleeper";
}
