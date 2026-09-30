/**
 * Resolving the reader's format and source for a waiver page, in one place.
 *
 * The hub and every weekly page need exactly the same four things before they
 * can draw a board, and getting that chain wrong is how a page quietly stops
 * respecting a reader's selection. So it happens once, here.
 *
 * THIS IS NOT A LEAGUE VIEW. `resolveLeagueContext` is for `/leagues/**`, where
 * the format is derived from the league's own Sleeper scoring and the global
 * toggle is ignored by contract. A waiver page has no league, so it uses the
 * ordinary preference chain from CLAUDE.md's Source and Format Sync section:
 * URL, then the signed-in reader's stored default, then the cookie, then the
 * registry default.
 *
 * THE FORMAT FALLS THROUGH, THE SOURCE STAYS. A reader whose chosen source does
 * not cover their chosen format keeps the source and is moved to the nearest
 * format it does cover (reconcileFormatWithSource), with a banner, exactly as
 * the rankings board does. The source-level fallback below remains only for a
 * source that covers the format but publishes no rankings table for it.
 */

import { createClient, createAdminClient } from "@/lib/supabase/server";
import {
  describeSource,
  getActiveFormats,
  getAvailableSources,
  reconcileFormatWithSource,
  resolveSourceForFormat,
  type ReconciledFormat,
} from "@/lib/source";
import { resolveFormatSlug, resolveSourceSlug } from "@/lib/preferences";
import { loadFaabSettings } from "@/lib/faab/settings";
import { resolveSeasonClock } from "@/lib/start-sit/clock";
import type { FaabSettings } from "@/lib/faab/types";

export type WaiverContext = {
  format: {
    id: string;
    slug: string;
    display_name: string;
    scoring_type: string | null;
    te_premium_bonus: number | null;
  } | null;
  /**
   * Null when no active source has rankings for the resolved format at all.
   * The page renders its "no ranked players" empty state rather than querying
   * with a slug it invented.
   */
  sourceSlug: string | null;
  sourceName: string;
  /** Set when the reader's chosen source had nothing for this format. */
  fallbackBanner: { requested: string; actual: string } | null;
  /** Set when the reader's source does not cover their format and the format moved. */
  formatFallback: ReconciledFormat["fallback"];
  settings: FaabSettings;
  season: number | null;
  currentWeek: number;
};

export async function resolveWaiverContext(params: {
  format?: string;
  source?: string;
}): Promise<WaiverContext> {
  const supabase = await createClient();

  // The settings row is service-role only (RLS), same as the calculator's, and
  // loadFaabSettings never throws: a missing row falls back to the shipped
  // defaults so a board still renders.
  const [settings, formatResolution, sourceResolution, clock] = await Promise.all([
    loadFaabSettings(createAdminClient()),
    resolveFormatSlug(supabase, params.format),
    resolveSourceSlug(supabase, params.source),
    resolveSeasonClock(supabase),
  ]);

  const [registry, allFormats] = await Promise.all([
    getAvailableSources(supabase),
    getActiveFormats(supabase),
  ]);

  // Keep the reader's SOURCE and move the FORMAT when that source does not
  // cover it, with a banner. Read-time only, never written back to the cookie
  // or the saved preference.
  const reconciled = reconcileFormatWithSource(
    registry,
    allFormats,
    sourceResolution.slug,
    formatResolution.slug,
  );
  const formatRow = allFormats.find((f) => f.slug === reconciled.formatSlug) ?? null;
  const format = formatRow
    ? {
        id: formatRow.id,
        slug: formatRow.slug,
        display_name: formatRow.display_name,
        scoring_type: formatRow.scoring_type,
        te_premium_bonus: formatRow.te_premium_bonus,
      }
    : null;

  const resolution = format
    ? resolveSourceForFormat(registry, "rankings", format.slug, sourceResolution.slug)
    : null;

  const sourceSlug = resolution?.source ?? sourceResolution.slug;

  return {
    format: format ?? null,
    sourceSlug,
    sourceName: describeSource(registry, sourceSlug),
    fallbackBanner:
      resolution?.fellBack && resolution.source && resolution.requested
        ? {
            requested: describeSource(registry, resolution.requested),
            actual: describeSource(registry, resolution.source),
          }
        : null,
    formatFallback: reconciled.fallback,
    settings,
    season: clock.season,
    currentWeek: clock.currentWeek,
  };
}
