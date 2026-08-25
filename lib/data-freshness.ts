/**
 * Is the data actually current, and how would anyone know?
 *
 * WHY THIS EXISTS
 * The cron ledger answers "did the job run". It cannot answer "is the table it
 * writes still moving", and those come apart in two ways that both happened
 * here.
 *
 * A job that was never scheduled writes no ledger row and no failure. The
 * Sleeper player dimension sat untouched from 2026-05-18 to 2026-08-25 because
 * nothing ever ran it, and the ledger was correct and silent the whole time.
 * The only visible symptom was 104 players on IR reading as healthy, and 4
 * healthy starters reading as out for the season, which is not something anyone
 * spots by browsing.
 *
 * The reverse also happens: a job that runs, succeeds, and quietly stops
 * refreshing part of its subject. The weekly projections sync ran green every
 * night while Ricky Pearsall's numbers stayed frozen at 2026-08-01, because a
 * player Sleeper withholds points for was skipped rather than written.
 *
 * So freshness is measured on the TABLES, not on the jobs. Every check here
 * starts from "what is the newest row" and compares that to how often the table
 * is supposed to move. A stale table is reported whether or not a job exists,
 * whether or not it ran, and whether or not it said it succeeded.
 *
 * Pure functions first; the one that touches rows is at the bottom.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const HOUR_MS = 60 * 60 * 1000;

export type FreshnessLevel = "fresh" | "stale" | "unknown";

/**
 * One table we expect to keep moving.
 *
 * `maxAgeHours` is the silence that means something, not the cadence. A nightly
 * table gets 48 hours so a single missed window is not an alarm, which is the
 * same reasoning behind the cron watchdog's 26-hour daily grace: an alert that
 * fires on ordinary jitter gets ignored, and then it is not an alert.
 */
export type FreshnessSpec = {
  table: keyof Database["public"]["Tables"];
  /** Column holding the row's write time. */
  column: string;
  label: string;
  maxAgeHours: number;
  /** What breaks downstream when this goes stale. Shown with the warning. */
  matters: string;
  /** Only check inside these months (1-12). Seasonal tables are idle by design. */
  months?: number[];
};

export type FreshnessResult = {
  label: string;
  table: string;
  level: FreshnessLevel;
  /** Newest row's timestamp, or null when the table is empty. */
  newestAt: string | null;
  ageHours: number | null;
  maxAgeHours: number;
  matters: string;
  /** True when the table is out of season and was therefore not judged. */
  outOfSeason: boolean;
};

/**
 * The tables whose staleness changes what a reader is shown.
 *
 * Deliberately not "every table". A table nobody reads for a live answer does
 * not need a watchdog, and a watchdog on a table that legitimately sits still
 * teaches people to ignore the panel.
 */
export const FRESHNESS_SPECS: readonly FreshnessSpec[] = [
  {
    table: "players",
    column: "updated_at",
    label: "Player dimension",
    maxAgeHours: 48,
    matters:
      "Injury designations live here. When this stops moving, players on IR project as healthy and players who have recovered stay projected at zero, in both directions at once.",
  },
  {
    table: "player_weekly_projections",
    column: "updated_at",
    label: "Weekly projections",
    maxAgeHours: 48,
    matters:
      "Power Pulse, playoff odds, Trade Ideas and the schedule board all read these. Stale rows do not look stale; they look like this week's numbers.",
  },
  {
    table: "player_value_history",
    column: "captured_at",
    label: "Player values",
    maxAgeHours: 48,
    matters: "Trade values, rankings and every trade evaluation are built on these snapshots.",
  },
  {
    table: "player_value_trends",
    column: "updated_at",
    label: "Value trends",
    maxAgeHours: 48,
    matters: "The derived table the player pages and trade analyzer read instead of raw history.",
  },
  {
    table: "player_market_snapshots",
    column: "created_at",
    label: "Draft-market ADP",
    maxAgeHours: 48,
    matters: "Draft guides and the Beacon Steals board compare our values against this ADP.",
  },
  {
    table: "player_stats",
    column: "updated_at",
    label: "Player stats",
    maxAgeHours: 48,
    months: [1, 2, 8, 9, 10, 11, 12],
    matters:
      "Actual production, which feeds projection accuracy and opponent strength. Idle by design outside the season.",
  },
];

/** Whether a seasonal spec should be judged at this moment. */
export function isInSeason(spec: FreshnessSpec, nowMs: number): boolean {
  if (!spec.months || spec.months.length === 0) return true;
  const month = new Date(nowMs).getUTCMonth() + 1;
  return spec.months.includes(month);
}

/** Grade one table from its newest row. Pure, so the thresholds are testable. */
export function gradeFreshness(
  spec: FreshnessSpec,
  newestAt: string | null,
  nowMs: number,
): FreshnessResult {
  const outOfSeason = !isInSeason(spec, nowMs);
  const base = {
    label: spec.label,
    table: spec.table as string,
    newestAt,
    maxAgeHours: spec.maxAgeHours,
    matters: spec.matters,
    outOfSeason,
  };

  if (newestAt === null) {
    // An empty table is not evidence of staleness, it is an absence of
    // evidence. Saying "stale" would put a red mark on a table that may simply
    // not be in use yet.
    return { ...base, level: "unknown", ageHours: null };
  }

  const writtenMs = new Date(newestAt).getTime();
  if (!Number.isFinite(writtenMs)) {
    return { ...base, level: "unknown", ageHours: null };
  }

  const ageHours = Math.max(0, (nowMs - writtenMs) / HOUR_MS);
  if (outOfSeason) return { ...base, level: "fresh", ageHours };
  return { ...base, level: ageHours > spec.maxAgeHours ? "stale" : "fresh", ageHours };
}

/** The stale ones, worst first. What an alert would actually say. */
export function staleOnly(results: readonly FreshnessResult[]): FreshnessResult[] {
  return results
    .filter((r) => r.level === "stale")
    .sort((a, b) => (b.ageHours ?? 0) - (a.ageHours ?? 0));
}

/* ------------------------------------------------------------------ *
 * The part that reads rows.
 * ------------------------------------------------------------------ */

/**
 * Newest write per watched table.
 *
 * One `order by <column> desc limit 1` per spec, which has to be an INDEX SCAN
 * and not a sort. Two of these tables run to hundreds of thousands of rows and
 * one to millions, so a sort blows the 8-second statement timeout, and the
 * failure is silent by design: the catch below grades a failed read as
 * "unknown", so a watchdog whose own queries time out would sit there reporting
 * nothing wrong about the two most important tables on the site. It did exactly
 * that on the first run of this file.
 *
 * The cause was the ordering, not the volume. Passing nullsFirst:false emits
 * `desc nulls last`, while a plain `... DESC` index is `desc nulls first`, so
 * the planner could not use idx_player_value_history_captured_at and sorted the
 * whole table instead. Every column here is NOT NULL, so the default ordering
 * is both correct and index-friendly, and the hint is simply left off.
 *
 * A failed lookup still grades as "unknown" rather than "stale": a query that
 * errored tells us nothing about the data, and crying wolf costs more than
 * staying quiet. But it is logged loudly, because "unknown" on a table that
 * should be readable is itself a defect.
 */
export async function checkDataFreshness(
  admin: SupabaseClient<Database>,
  nowMs: number = Date.now(),
  specs: readonly FreshnessSpec[] = FRESHNESS_SPECS,
): Promise<FreshnessResult[]> {
  const results = await Promise.all(
    specs.map(async (spec) => {
      try {
        const { data, error } = await admin
          .from(spec.table)
          .select(spec.column)
          .order(spec.column, { ascending: false })
          .limit(1)
          .maybeSingle()
          .overrideTypes<Record<string, string | null>>();
        if (error) throw error;
        const newestAt = data ? ((data as Record<string, string | null>)[spec.column] ?? null) : null;
        return gradeFreshness(spec, newestAt, nowMs);
      } catch (err) {
        console.error(
          `[data-freshness] could not read ${spec.table}, so its freshness is unknown:`,
          err instanceof Error ? err.message : JSON.stringify(err),
        );
        return gradeFreshness(spec, null, nowMs);
      }
    }),
  );
  return results;
}
