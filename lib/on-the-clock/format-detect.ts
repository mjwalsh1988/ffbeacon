/**
 * Auto-detect the FF Beacon format for a Sleeper league, the way Signal Check
 * does. On The Clock derives the format from the league's actual Sleeper scoring /
 * roster settings, NOT the global format toggle, and matches it to an FF
 * Beacon-supported format (exact when carried, else the closest within the same
 * redraft/dynasty type). Source is always FF Beacon (forced elsewhere).
 *
 * Reuses lib/sleeper-to-format.ts (deriveLeagueFormat / mapToFormatSlug /
 * describeDerivedFormat / pickClosestSupportedFormat) and the FF Beacon source
 * slug from lib/signal-check/format.ts. No Sleeper calls here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { SleeperLeague } from "@/lib/sleeper";
import {
  deriveLeagueFormat,
  mapToFormatSlug,
  describeDerivedFormat,
  pickClosestSupportedFormat,
  type FormatCandidate,
} from "@/lib/sleeper-to-format";
import { FFBEACON_SOURCE_SLUG } from "@/lib/signal-check/format";

type Client = SupabaseClient<Database>;

export interface DetectedFormat {
  slug: string;
  label: string;
  /** Plain-language description of the league's derived format. */
  derivedLabel: string;
  /** True when the exact derived format is not FF Beacon-supported and a closest match was used. */
  isClosest: boolean;
}

/**
 * FF Beacon-supported active formats, as closeness candidates: the intersection
 * of FF Beacon's supported_format_slugs (null = all) and active format_configs.
 * Mirrors lib/signal-check/format.ts supportedFormatCandidates (without Signal
 * Check's admin-disabled list, which is its own concern).
 */
export async function ffbeaconFormatCandidates(supabase: Client): Promise<FormatCandidate[]> {
  const { data: src } = await supabase
    .from("source_registry")
    .select("supported_format_slugs")
    .eq("slug", FFBEACON_SOURCE_SLUG)
    .maybeSingle();
  const supported = (src?.supported_format_slugs as string[] | null) ?? null;

  const { data } = await supabase
    .from("format_configs")
    .select("slug, display_name, league_type, scoring_type, is_superflex, te_premium_bonus, display_order")
    .eq("is_active", true)
    .order("display_order", { ascending: true });

  return (data ?? [])
    .filter((fc) => (supported ? supported.includes(fc.slug) : true))
    .map((fc) => ({
      slug: fc.slug,
      display: fc.display_name,
      league_type: fc.league_type,
      scoring_type: fc.scoring_type,
      is_superflex: fc.is_superflex,
      is_tep: fc.te_premium_bonus > 0,
      display_order: fc.display_order,
    }));
}

/**
 * Detect the FF Beacon format for a Sleeper league: the exact derived format when
 * FF Beacon carries it, else the closest supported format (never crossing the
 * redraft/dynasty line). Returns null only when no candidate shares the league
 * type (should not happen while both types have FF Beacon formats).
 */
export function detectLeagueFormat(
  league: SleeperLeague,
  candidates: FormatCandidate[],
): DetectedFormat | null {
  const derived = deriveLeagueFormat(league);
  const derivedLabel = describeDerivedFormat(derived);

  const exactSlug = mapToFormatSlug(derived);
  const exact = exactSlug ? candidates.find((c) => c.slug === exactSlug) : undefined;
  if (exact) {
    return { slug: exact.slug, label: exact.display, derivedLabel, isClosest: false };
  }

  const closest = pickClosestSupportedFormat(derived, candidates);
  if (!closest) return null;
  return { slug: closest.slug, label: closest.display, derivedLabel, isClosest: true };
}
