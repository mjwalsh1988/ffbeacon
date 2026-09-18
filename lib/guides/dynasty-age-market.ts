import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createCachedReadClient } from "@/lib/supabase/server";
import { CACHE_TAGS, CACHE_TTL } from "@/lib/cache-tags";
import {
  getActiveFormats,
  getAvailableSources,
  resolveSourceForFormat,
} from "@/lib/source";
import { isBestBall } from "@/lib/rankings-formats";

/**
 * The one live figure in the dynasty strategy guide: who the dynasty market
 * pays for, by age, at each position.
 *
 * Everything else on that page is invented and says so. This is the exception,
 * because the lesson it sits in ("age is a price, not a stat") is a claim about
 * the market, and the site holds the market: one value per player per format
 * per source, rebuilt nightly. Counting how many of the 24 most valuable
 * players at each position are 28 or older says more than any drawn curve,
 * and it cannot drift from what the rankings boards show, because it reads the
 * same player_value_trends rows they do.
 *
 * SOURCE AND FORMAT RULES (CLAUDE.md, Source and Format Sync). The reader's
 * format and source are resolved by the page through the usual chain and passed
 * in. A reader already on a dynasty format sees that format. A redraft or best
 * ball reader sees the dynasty format with the same quarterback count (one or
 * two), because the guide is about dynasty and a redraft value carries no
 * opinion about a player's age. The value source is resolved for that format
 * through resolveSourceForFormat, pinned to the reader's source when it
 * covers the format, and named by display_name, never by slug.
 *
 * AGE. Computed from players.birth_date on the day of the read. A top-24
 * player with no birth date on file is counted in `unknownAge` rather than
 * dropped, because dropping him would promote the 25th player into a top 24 he
 * is not in. The share of value held by the 28-and-over group is measured
 * against the whole top 24, so an unknown age never inflates it.
 */

export const AGE_MARKET_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export type AgeMarketPosition = (typeof AGE_MARKET_POSITIONS)[number];

/** How many players per position the figure counts. A twelve-team league's two starters. */
export const AGE_MARKET_TOP_N = 24;

/** The age from which the guide calls a player a veteran in the figure. */
export const AGE_MARKET_VETERAN_AGE = 28;

export const AGE_BANDS = [
  { key: "young", label: "23 and under", min: 0, max: 23 },
  { key: "prime", label: "24 to 26", min: 24, max: 26 },
  { key: "late", label: "27 to 29", min: 27, max: 29 },
  { key: "veteran", label: "30 and over", min: 30, max: 200 },
] as const;
export type AgeBandKey = (typeof AGE_BANDS)[number]["key"];

export type AgeMarketInputRow = {
  position: string;
  birthDate: string | null;
  value: number | null;
};

export type AgeMarketPositionSummary = {
  position: AgeMarketPosition;
  /** Players actually counted, at most AGE_MARKET_TOP_N. */
  counted: number;
  bands: Record<AgeBandKey, number>;
  unknownAge: number;
  /** Median age of the counted players with a known age, or null. */
  medianAge: number | null;
  /** Share of the counted players' total value held by players 28 and over, 0 to 100. */
  veteranValueSharePct: number | null;
  /** How many counted players are 28 and over. */
  veteranCount: number;
};

export type DynastyAgeMarket =
  | {
      status: "ok";
      sourceName: string;
      /** The resolved value source, so a link can open the board on the same one. */
      sourceSlug: string;
      format: { slug: string; displayName: string };
      positions: AgeMarketPositionSummary[];
      /** Freshest value capture for this (format, source), ISO, or null. */
      asOf: string | null;
    }
  | { status: "unavailable"; reason: string };

/** Whole years between a birth date and a reference date. Null on a bad date. */
export function ageOn(birthDate: string, on: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthDate);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return null;
  let age = on.getUTCFullYear() - y;
  const beforeBirthday =
    on.getUTCMonth() + 1 < mo ||
    (on.getUTCMonth() + 1 === mo && on.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age >= 15 && age <= 60 ? age : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Pure. Takes every valued player in one (format, source) and returns the age
 * profile of the top N at each position. Players without a value are ignored;
 * players without a birth date are counted as unknown age.
 */
export function summarizeAgeMarket(
  rows: AgeMarketInputRow[],
  on: Date,
  topN: number = AGE_MARKET_TOP_N,
): AgeMarketPositionSummary[] {
  return AGE_MARKET_POSITIONS.map((position) => {
    const top = rows
      .filter(
        (r) =>
          r.position === position &&
          typeof r.value === "number" &&
          Number.isFinite(r.value) &&
          r.value > 0,
      )
      .sort((a, b) => (b.value as number) - (a.value as number))
      .slice(0, topN);

    const bands: Record<AgeBandKey, number> = {
      young: 0,
      prime: 0,
      late: 0,
      veteran: 0,
    };
    let unknownAge = 0;
    let veteranCount = 0;
    let veteranValue = 0;
    let totalValue = 0;
    const ages: number[] = [];

    for (const r of top) {
      const value = r.value as number;
      totalValue += value;
      const age = r.birthDate ? ageOn(r.birthDate, on) : null;
      if (age === null) {
        unknownAge += 1;
        continue;
      }
      ages.push(age);
      const band = AGE_BANDS.find((b) => age >= b.min && age <= b.max);
      if (band) bands[band.key] += 1;
      if (age >= AGE_MARKET_VETERAN_AGE) {
        veteranCount += 1;
        veteranValue += value;
      }
    }

    return {
      position,
      counted: top.length,
      bands,
      unknownAge,
      medianAge: median(ages),
      veteranValueSharePct:
        totalValue > 0 ? Math.round((100 * veteranValue) / totalValue) : null,
      veteranCount,
    };
  });
}

type FormatRow = {
  id: string;
  slug: string;
  display_name: string;
  league_type: string;
  is_superflex: boolean;
  display_order: number | null;
  te_premium_bonus?: number | string | null;
};

function hasTePremium(f: FormatRow): boolean {
  return Number(f.te_premium_bonus ?? 0) > 0;
}

/**
 * The dynasty format the figure should read. The reader's own format when it
 * is a dynasty one that is not best ball, otherwise the dynasty format with the
 * same quarterback count, lowest display order first. Pure.
 *
 * Best ball is read off the slug through isBestBall(), not a column: those
 * formats reuse league_type "dynasty", and getActiveFormats() does not select
 * is_bestball, so a column check here would silently pass every one of them.
 */
export function pickDynastyFormat(
  formats: FormatRow[],
  readerFormatSlug: string | null,
): FormatRow | null {
  const standard = formats.filter(
    (f) => f.league_type === "dynasty" && !isBestBall(f.slug),
  );
  if (standard.length === 0) return null;
  const reader = formats.find((f) => f.slug === readerFormatSlug) ?? null;
  if (reader && standard.some((f) => f.slug === reader.slug)) return reader;
  const wantSuperflex = reader ? reader.is_superflex : true;
  const byOrder = [...standard].sort(
    (a, b) =>
      (a.display_order ?? Number.MAX_SAFE_INTEGER) -
      (b.display_order ?? Number.MAX_SAFE_INTEGER),
  );
  return (
    byOrder.find((f) => f.is_superflex === wantSuperflex && !hasTePremium(f)) ??
    byOrder.find((f) => f.is_superflex === wantSuperflex) ??
    byOrder[0]
  );
}

/** One page is well over the ~600 valued players a source publishes per format. */
const PAGE = 1000;

async function readAgeMarketRows(
  formatConfigId: string,
  source: string,
): Promise<{ rows: AgeMarketInputRow[]; asOf: string | null }> {
  const supabase = createCachedReadClient();
  const rows: AgeMarketInputRow[] = [];
  // Paged with range(): PostgREST truncates a select at 1,000 rows without
  // saying so, and a source that grows past that would silently lose its
  // lowest-valued players, which are exactly the ones that do not matter here,
  // until the day they do.
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("player_value_trends")
      .select("current_value, players!inner(position, birth_date)")
      .eq("format_config_id", formatConfigId)
      .eq("source", source)
      .in("players.position", [...AGE_MARKET_POSITIONS])
      .order("current_value", { ascending: false })
      // Tie-breaker, so two players on the same value cannot swap places
      // between pages and be read twice or not at all.
      .order("player_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`age market read failed: ${error.message}`);
    for (const r of data ?? []) {
      const p = (
        r as unknown as {
          players: { position: string; birth_date: string | null } | null;
        }
      ).players;
      if (!p) continue;
      rows.push({
        position: p.position,
        birthDate: p.birth_date,
        value: r.current_value,
      });
    }
    if (!data || data.length < PAGE) break;
  }

  const { data: captured } = await supabase
    .from("player_value_history")
    .select("captured_at")
    .eq("format_config_id", formatConfigId)
    .eq("source", source)
    .order("captured_at", { ascending: false })
    .limit(1);

  return { rows, asOf: captured?.[0]?.captured_at ?? null };
}

function readAgeMarketRowsCached(formatConfigId: string, source: string) {
  return unstable_cache(
    () => readAgeMarketRows(formatConfigId, source),
    ["guide-dynasty-age-market", formatConfigId, source],
    { revalidate: CACHE_TTL.hourly, tags: [CACHE_TAGS.playerValues] },
  )();
}

export async function loadDynastyAgeMarket(
  supabase: SupabaseClient<Database>,
  readerFormatSlug: string | null,
  requestedSourceSlug: string | null,
): Promise<DynastyAgeMarket> {
  const [registry, formats] = await Promise.all([
    getAvailableSources(supabase),
    getActiveFormats(supabase),
  ]);

  const format = pickDynastyFormat(formats, readerFormatSlug);
  if (!format) {
    return {
      status: "unavailable",
      reason:
        "No dynasty format is active right now, so the live age breakdown is not shown.",
    };
  }

  const resolved = resolveSourceForFormat(
    registry,
    "player_value_history",
    format.slug,
    requestedSourceSlug,
  );
  if (!resolved.source) {
    return {
      status: "unavailable",
      reason: `No active source publishes values for ${format.display_name} right now, so the live age breakdown is not shown.`,
    };
  }

  try {
    const { rows, asOf } = await readAgeMarketRowsCached(
      format.id,
      resolved.source,
    );
    const positions = summarizeAgeMarket(rows, new Date());
    if (positions.every((p) => p.counted === 0)) {
      return {
        status: "unavailable",
        reason: `There are no ${format.display_name} values on file right now, so the live age breakdown is not shown.`,
      };
    }
    return {
      status: "ok",
      sourceName:
        registry.find((r) => r.slug === resolved.source)?.display_name ??
        "the selected source",
      sourceSlug: resolved.source,
      format: { slug: format.slug, displayName: format.display_name },
      positions,
      asOf,
    };
  } catch (err) {
    // The reader gets a fixed sentence; the server log gets the reason.
    console.error("[dynasty-age-market] live figure read failed", err);
    return {
      status: "unavailable",
      reason:
        "The live age breakdown could not be loaded just now. Every other part of this guide works without it.",
    };
  }
}
