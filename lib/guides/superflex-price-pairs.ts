import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  getActiveFormats,
  getAvailableSources,
  resolveSourceForFormat,
  sourceSupportsFormat,
  type SourceRegistryRow,
} from "@/lib/source";
import {
  loadFreshestRankingsGeneratedAt,
  loadRankingsBoardCached,
  type RankingsBoardRow,
} from "@/lib/rankings-board";

/**
 * The one live figure in the superflex guide: the same quarterbacks, priced
 * in a one-quarterback format and in its superflex twin, side by side.
 *
 * Everything else on that page is invented and says so. This is the exception,
 * because the guide's whole argument is that a quarterback's price is a
 * property of the league and not of the player, and the site already holds
 * the proof: one rankings board per format, from the same source, rebuilt
 * nightly. Showing the reader that QB6 is a second-round pick on one board and
 * a seventh-round pick on the other, by name, does more than any drawn curve.
 *
 * SOURCE AND FORMAT RULES (CLAUDE.md, Source and Format Sync). The reader's
 * source comes through the usual resolver chain and is passed in here; the
 * pair of formats is chosen by league type, dynasty or redraft, so a dynasty
 * reader sees the dynasty pair. Both boards are read from ONE source, never
 * one each: two sources would put two opinions in one table and call the
 * difference "superflex". If the reader's source does not cover both formats
 * of the preferred pair, the other pair is tried; if no source covers a pair,
 * the figure renders its unavailable state rather than a half table. The
 * source is named by display_name, never by slug.
 *
 * The reads go through lib/rankings-board.ts's cached loader, the same read
 * every /rankings/[format] page makes, so this figure and those boards cannot
 * disagree about a rank.
 */

export type PricePairRow = {
  name: string;
  slug: string;
  team: string | null;
  superflexRank: number;
  superflexValue: number | null;
  oneQbRank: number | null;
  oneQbValue: number | null;
};

export type PricePairFormat = { slug: string; displayName: string };

export type SuperflexPricePairs =
  | {
      status: "ok";
      sourceName: string;
      leagueType: "dynasty" | "redraft";
      oneQb: PricePairFormat;
      superflex: PricePairFormat;
      rows: PricePairRow[];
      /** Freshest value capture on the superflex board, ISO, or null. */
      asOf: string | null;
    }
  | { status: "unavailable"; reason: string };

/** The two pairs the site carries. Order is the preference when both work. */
const PAIRS: Record<
  "dynasty" | "redraft",
  { oneQb: string; superflex: string }
> = {
  dynasty: { oneQb: "dynasty-ppr-std", superflex: "dynasty-ppr-sflex" },
  redraft: { oneQb: "redraft-ppr-std", superflex: "redraft-ppr-sflex" },
};

/** How many quarterbacks the table shows. Eight fits a phone without scrolling. */
export const PRICE_PAIR_ROWS = 8;

/**
 * Pick one source that publishes rankings for BOTH formats of a pair. The
 * requested source wins when it qualifies, then the site default, then the
 * first qualifying source by priority. Null when nothing covers the pair.
 */
export function pickPairSource(
  registry: SourceRegistryRow[],
  pair: { oneQb: string; superflex: string },
  requestedSlug: string | null,
): string | null {
  const coversBoth = registry.filter(
    (r) =>
      r.data_type.includes("rankings") &&
      sourceSupportsFormat(r, pair.oneQb) &&
      sourceSupportsFormat(r, pair.superflex),
  );
  if (coversBoth.length === 0) return null;
  if (requestedSlug && coversBoth.some((r) => r.slug === requestedSlug)) {
    return requestedSlug;
  }
  return coversBoth.find((r) => r.is_default)?.slug ?? coversBoth[0].slug;
}

/** Join the two boards on player slug, top quarterbacks of the superflex board first. */
export function joinPricePairs(
  superflexRows: RankingsBoardRow[],
  oneQbRows: RankingsBoardRow[],
  limit: number = PRICE_PAIR_ROWS,
): PricePairRow[] {
  const oneQbBySlug = new Map<string, RankingsBoardRow>();
  for (const row of oneQbRows) {
    if (row.position === "QB") oneQbBySlug.set(row.slug, row);
  }
  return superflexRows
    .filter((row) => row.position === "QB")
    .sort((a, b) => a.overall_rank - b.overall_rank)
    .slice(0, limit)
    .map((row) => {
      const twin = oneQbBySlug.get(row.slug);
      return {
        name: row.name,
        slug: row.slug,
        team: row.team,
        superflexRank: row.overall_rank,
        superflexValue: row.value,
        oneQbRank: twin?.overall_rank ?? null,
        oneQbValue: twin?.value ?? null,
      };
    });
}

export async function loadSuperflexPricePairs(
  supabase: SupabaseClient<Database>,
  requestedSourceSlug: string | null,
  preferredLeagueType: "dynasty" | "redraft",
): Promise<SuperflexPricePairs> {
  const [registry, formats] = await Promise.all([
    getAvailableSources(supabase),
    getActiveFormats(supabase),
  ]);

  const order: ("dynasty" | "redraft")[] =
    preferredLeagueType === "dynasty"
      ? ["dynasty", "redraft"]
      : ["redraft", "dynasty"];

  // Read once, outside the loop: it is the same value for every pair, and it
  // is part of the cache key rather than something the cached read resolves.
  const generatedAt = await loadFreshestRankingsGeneratedAt(supabase);

  for (const leagueType of order) {
    const pair = PAIRS[leagueType];
    const oneQbFormat = formats.find((f) => f.slug === pair.oneQb);
    const superflexFormat = formats.find((f) => f.slug === pair.superflex);
    if (!oneQbFormat || !superflexFormat) continue;

    const sourceSlug = pickPairSource(registry, pair, requestedSourceSlug);
    if (!sourceSlug) continue;

    // The value-history source may differ from the rankings source for a
    // format (a source can publish one table and not the other). Resolve each
    // the way the board page does, pinned to the chosen rankings source.
    const oneQbValues = resolveSourceForFormat(
      registry,
      "player_value_history",
      pair.oneQb,
      sourceSlug,
    );
    const superflexValues = resolveSourceForFormat(
      registry,
      "player_value_history",
      pair.superflex,
      sourceSlug,
    );

    const [superflexBoard, oneQbBoard] = await Promise.all([
      loadRankingsBoardCached({
        formatConfigId: superflexFormat.id,
        rankingsSource: sourceSlug,
        valueHistorySource: superflexValues.source,
        generatedAt,
      }),
      loadRankingsBoardCached({
        formatConfigId: oneQbFormat.id,
        rankingsSource: sourceSlug,
        valueHistorySource: oneQbValues.source,
        generatedAt,
      }),
    ]);

    const rows = joinPricePairs(superflexBoard.rows, oneQbBoard.rows);
    if (rows.length === 0) continue;

    return {
      status: "ok",
      sourceName:
        registry.find((r) => r.slug === sourceSlug)?.display_name ?? sourceSlug,
      leagueType,
      oneQb: { slug: oneQbFormat.slug, displayName: oneQbFormat.display_name },
      superflex: {
        slug: superflexFormat.slug,
        displayName: superflexFormat.display_name,
      },
      rows,
      asOf: superflexBoard.lastCapturedAt,
    };
  }

  return {
    status: "unavailable",
    reason:
      "No active source publishes rankings for both a one-quarterback format and its superflex twin right now, so the live comparison is not shown.",
  };
}
