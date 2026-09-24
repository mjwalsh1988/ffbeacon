/**
 * Fill the typed IDP columns on player_stats (migration 0296) from the raw
 * payload already stored in player_stats.metadata.
 *
 * ZERO Sleeper calls. Every defender line from 2020 on is already in
 * metadata.stats; this reads it back and writes the IDP columns through the
 * SAME mapper the nightly sync uses (lib/sleeper-stats-map.ts), so the backfill
 * and the sync can never disagree about what a column holds.
 *
 * Idempotent: a row is updated only when a mapped IDP value differs from what
 * is stored, so a second run writes nothing. ONE-TIME operation plus re-runs by
 * hand; never wired into a cron.
 *
 * Read one (season, week) at a time on the existing (season, week) index, and
 * within a week by id keyset (id > last seen), because a bare select() stops
 * silently at 1000 rows and a deep offset over a whole season times out.
 *
 * Run:
 *   npm run backfill:idp-columns                  # every season with stats
 *   npm run backfill:idp-columns -- --season 2025 # one season
 *
 * Plan: docs/idp/idp-guide-and-data-plan.md, task IDP-110.
 */

import { pathToFileURL } from "node:url";
import { getServiceClient, withRetry } from "./_supabase";
import {
  NULLABLE_IDP_COLUMNS,
  mapStatPayloadToRow,
} from "../lib/sleeper-stats-map";

const PAGE_SIZE = 1000;
const UPDATE_CONCURRENCY = 16;
const DEFAULT_SEASONS = [
  2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026,
];
/** Regular, post and preseason weeks all live under week numbers 1 to 18. */
const WEEKS = Array.from({ length: 18 }, (_, i) => i + 1);

/** The IDP-104 columns: the mapper's list plus the derived snap share. */
export const IDP_TYPED_COLUMNS = [
  ...NULLABLE_IDP_COLUMNS,
  "def_snap_pct",
] as const;
export type IdpTypedColumn = (typeof IDP_TYPED_COLUMNS)[number];
export type IdpColumnValues = Record<IdpTypedColumn, number | null>;

/** The IDP column values a stored metadata payload maps to. Pure. */
export function idpColumnsFromMetadata(metadata: unknown): IdpColumnValues {
  const payload =
    metadata && typeof metadata === "object"
      ? (metadata as Record<string, unknown>)
      : {};
  const mapped = mapStatPayloadToRow(payload);
  const out = {} as IdpColumnValues;
  for (const col of IDP_TYPED_COLUMNS) {
    const v = mapped[col];
    out[col] = typeof v === "number" ? v : null;
  }
  return out;
}

/**
 * The columns that need writing, or null when the stored row already matches.
 * A stored numeric may come back as a string from PostgREST, so compare as
 * numbers. Pure.
 */
export function idpColumnPatch(
  stored: Partial<Record<IdpTypedColumn, unknown>>,
  mapped: IdpColumnValues,
): Partial<IdpColumnValues> | null {
  const patch: Partial<IdpColumnValues> = {};
  let changed = false;
  for (const col of IDP_TYPED_COLUMNS) {
    const raw = stored[col];
    const current = raw === null || raw === undefined ? null : Number(raw);
    const next = mapped[col];
    const same =
      current === null || next === null
        ? current === next
        : Math.abs(current - next) < 1e-9;
    if (!same) {
      patch[col] = next;
      changed = true;
    }
  }
  return changed ? patch : null;
}

export function parseSeasons(argv: string[]): number[] {
  const i = argv.indexOf("--season");
  if (i === -1) return DEFAULT_SEASONS;
  const season = Number(argv[i + 1]);
  if (!Number.isInteger(season) || season < 2000 || season > 2100) {
    throw new Error(`--season needs a four digit year, got ${argv[i + 1]}`);
  }
  return [season];
}

async function runPool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const item = items[next];
        next += 1;
        await fn(item);
      }
    },
  );
  await Promise.all(workers);
}

async function backfillSeason(
  season: number,
): Promise<{ scanned: number; updated: number }> {
  const supabase = getServiceClient();
  let scanned = 0;
  let updated = 0;
  const select = ["id", "metadata", ...IDP_TYPED_COLUMNS].join(", ");
  for (const week of WEEKS) {
    let lastId = "";
    for (;;) {
      const rows = await withRetry(
        async () => {
          let query = supabase
            .from("player_stats")
            .select(select)
            .eq("season", season)
            .eq("week", week)
            .order("id")
            .limit(PAGE_SIZE);
          if (lastId) query = query.gt("id", lastId);
          const { data, error } = await query;
          if (error) throw error;
          return (data ?? []) as unknown as ({
            id: string;
            metadata: unknown;
          } & Record<string, unknown>)[];
        },
        {
          label: `player_stats ${season} week ${week} after ${lastId || "start"}`,
        },
      );
      if (rows.length === 0) break;
      lastId = rows[rows.length - 1].id;
      scanned += rows.length;

      const patches: { id: string; patch: Partial<IdpColumnValues> }[] = [];
      for (const row of rows) {
        const stored = row as Partial<Record<IdpTypedColumn, unknown>>;
        const patch = idpColumnPatch(
          stored,
          idpColumnsFromMetadata(row.metadata),
        );
        if (patch) patches.push({ id: row.id, patch });
      }
      await runPool(patches, UPDATE_CONCURRENCY, async ({ id, patch }) => {
        await withRetry(
          async () => {
            const { error } = await supabase
              .from("player_stats")
              .update(patch)
              .eq("id", id);
            if (error) throw error;
          },
          { label: `player_stats update ${id}` },
        );
      });
      updated += patches.length;

      if (rows.length < PAGE_SIZE) break;
    }
  }
  return { scanned, updated };
}

async function main(): Promise<void> {
  const seasons = parseSeasons(process.argv.slice(2));
  for (const season of seasons) {
    const started = Date.now();
    const { scanned, updated } = await backfillSeason(season);
    console.log(
      `[backfill-idp-columns] ${season}: scanned ${scanned}, updated ${updated} in ${Math.round((Date.now() - started) / 1000)}s`,
    );
  }
}

const isRunDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isRunDirectly) {
  main().catch((err) => {
    console.error("[backfill-idp-columns] unexpected error:", err);
    process.exit(1);
  });
}
