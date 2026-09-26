import "server-only";
import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createCachedReadClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { pickFallbackFormat } from "@/lib/format-fallback";
import { getActiveFormats, getAvailableSources, sourceSupportsFormat } from "@/lib/source";
import { isDefenderScope, isSinglePositionScope, type BoardScope } from "@/lib/ranking-boards";
import type { ComparisonRanks, RankComparison } from "./compare";

/**
 * "vs FF Beacon" (plan section 6).
 *
 * A DELIBERATE EXCEPTION TO THE SOURCE AND FORMAT SYNC RULE. The comparison is
 * always against FF Beacon, whatever the reader's chosen source and whatever
 * the board was seeded from: the figure answers "how far are you from our
 * rankings", and a column that changed subject with the header toggle would
 * answer nothing. The format is the BOARD's own (what the board means), never
 * the header's, except on a board made before boards stored one, where the
 * reader's current format stands in and the note says so.
 *
 * ALWAYS TODAY'S RANK. `rankings` holds one current season and no history, so
 * a board built in August and read in October shows October's gap. The label
 * says "today".
 *
 * FF Beacon publishes no half PPR or standard rankings. Those boards compare
 * with FF Beacon's nearest format through the ordinary fallback chain, and the
 * note names it.
 */

export const BEACON_SOURCE_SLUG = "ffbeacon";

type Client = SupabaseClient<Database>;

/** FF Beacon's current ranks for one format, keyed by player id. Public data,
 * the same for every reader, rebuilt nightly: cached for an hour. */
function loadBeaconRanks(formatConfigId: string): Promise<Record<string, ComparisonRanks>> {
  return unstable_cache(
    async () => {
      const supabase = createCachedReadClient();
      const rows = await fetchAllRows("ffbeacon ranks for comparison", (from, to) =>
        supabase
          .from("rankings")
          .select("id, player_id, overall_rank, position_rank")
          .eq("format_config_id", formatConfigId)
          .eq("source", BEACON_SOURCE_SLUG)
          .is("week", null)
          .order("overall_rank", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      );
      const out: Record<string, ComparisonRanks> = {};
      for (const row of rows) {
        out[row.player_id] = { overall: row.overall_rank, position: row.position_rank };
      }
      return out;
    },
    ["ranking-boards:beacon-ranks", formatConfigId],
    { revalidate: 3600 },
  )();
}

export type BeaconComparisonResult = {
  comparison: RankComparison | null;
  /** One line for the page: which ranking and format the figure compares
   * with, or why there is no figure. */
  note: string;
};

/**
 * @param boardFormatSlug  the format stored on the board, or null
 * @param readerFormatSlug the reader's resolved format, used only when the
 *                         board has none (and named in the note). A cached
 *                         public page passes the site default instead, with
 *                         readerFormatIsSiteDefault, because reading the
 *                         reader's cookie would make the page uncacheable.
 * @param restrictTo       optional player ids to keep (a public page ships only
 *                         the ranks of the players it shows)
 */
export async function loadBeaconComparison(
  supabase: Client,
  opts: {
    scope: BoardScope;
    boardFormatSlug: string | null;
    readerFormatSlug: string;
    readerFormatIsSiteDefault?: boolean;
    restrictTo?: readonly string[];
  },
): Promise<BeaconComparisonResult> {
  if (isDefenderScope(opts.scope)) {
    return {
      comparison: null,
      note: "No source ranks defensive players, so this board has no FF Beacon comparison.",
    };
  }

  const [formats, registry] = await Promise.all([
    getActiveFormats(supabase),
    getAvailableSources(supabase),
  ]);
  const beacon = registry.find((s) => s.slug === BEACON_SOURCE_SLUG);
  if (!beacon || !beacon.data_type.includes("rankings")) {
    return { comparison: null, note: "FF Beacon rankings are not published right now." };
  }

  const wanted = opts.boardFormatSlug ?? opts.readerFormatSlug;
  const wantedFormat = formats.find((f) => f.slug === wanted) ?? null;
  let used = wantedFormat;
  let fellBack = false;
  if (!wantedFormat || !sourceSupportsFormat(beacon, wantedFormat.slug)) {
    const fallback = pickFallbackFormat(formats, wanted, beacon.supported_format_slugs);
    used = fallback ? formats.find((f) => f.slug === fallback.slug) ?? null : null;
    fellBack = true;
  }
  if (!used) {
    return { comparison: null, note: "FF Beacon does not rank a format close to this board's." };
  }

  let ranks = await loadBeaconRanks(used.id);
  if (opts.restrictTo) {
    const keep = new Set(opts.restrictTo);
    ranks = Object.fromEntries(Object.entries(ranks).filter(([id]) => keep.has(id)));
  }

  const basis = isSinglePositionScope(opts.scope) ? "position" : "overall";
  const comparison: RankComparison = {
    label: "vs FF Beacon",
    subject: "FF Beacon",
    fallbackFormatDisplay: fellBack ? used.display_name : null,
    basis,
    ranks,
  };

  const kind = basis === "position" ? "positional rank" : "overall rank";
  let note: string;
  if (!opts.boardFormatSlug) {
    note = `This board has no saved format, so it compares with FF Beacon's ${kind} today in ${
      opts.readerFormatIsSiteDefault ? "the site's default format" : "your current format"
    }, ${used.display_name}.`;
  } else if (fellBack) {
    note = `FF Beacon does not rank ${wantedFormat?.display_name ?? "this format"}, so this compares with its ${kind} today in ${used.display_name}.`;
  } else {
    note = `Compared with FF Beacon's ${kind} today, ${used.display_name}.`;
  }
  return { comparison, note };
}
