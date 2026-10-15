/**
 * What chopped leagues actually pay for a claim, by how much of the field is
 * still alive.
 *
 * Read from faab_market_priors through lib/faab/priors-read.ts, never
 * hardcoded. Shared by the chopped league strategy guide (lessons 4 and 5) and
 * the guillotine FAAB calculator page, so the two can never quote different
 * figures for the same cells.
 */

import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { loadPriorCellsCached } from "@/lib/faab/priors-read";
import { loadFaabSettings } from "@/lib/faab/settings";
import type { PriorCell } from "@/lib/faab/priors-math";
import { newestBuiltAt, readCell, type MarketRead } from "@/lib/guides/faab-market-figures";

/**
 * The measured market for chopped leagues, read once and handed down.
 *
 * `bands` keeps a row for every teams-alive band even when the cell is thin,
 * because a missing row would quietly shorten the table and leave a reader
 * thinking we only measured the part that suited us.
 */
export type ChoppedMarket = {
  bands: { label: string; read: MarketRead | null }[];
  overall: MarketRead | null;
  updatedAt: string | null;
};

export const BAND_LABELS: { key: string; label: string }[] = [
  { key: "chopped|any|any|alive_50p|any", label: "Half the field or more still in" },
  { key: "chopped|any|any|alive_30_50|any", label: "Between 30 and 50 percent left" },
  { key: "chopped|any|any|alive_lt30|any", label: "Under 30 percent left" },
];

/** The cell holding every chopped auction, whatever the field size. */
export const CHOPPED_OVERALL_KEY = "chopped|any|any|any|any";

/** Pure: the bands and the overall read from a set of stored cells. */
export function buildChoppedMarket(cells: PriorCell[], minSamples: number): ChoppedMarket {
  const bands = BAND_LABELS.map((band) => ({
    label: band.label,
    read: readCell(cells, band.key, minSamples),
  }));
  const overall = readCell(cells, CHOPPED_OVERALL_KEY, minSamples);
  return {
    bands,
    overall,
    updatedAt: newestBuiltAt([overall, ...bands.map((b) => b.read)]),
  };
}

export async function loadChoppedMarket(): Promise<ChoppedMarket> {
  const [cells, settings] = await Promise.all([
    loadPriorCellsCached(),
    loadFaabSettings(createAdminClient()),
  ]);
  return buildChoppedMarket(cells, settings.priors.minCellSamples);
}
