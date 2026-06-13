/**
 * DynastyProcess value sync (library form).
 *
 * Extracted so the CLI script (`npm run sync:dynastyprocess`) and the Vercel
 * cron endpoint (`/api/cron/sync-dynastyprocess`) share one code path, matching
 * the KTC/FantasyCalc shape.
 *
 * Source: https://github.com/dynastyprocess/data (GPL-3.0, weekly GitHub Action
 * updates, no auth). We read two public CSVs:
 *   values-players.csv  FantasyPros-ECR-derived dynasty values
 *   db_playerids.csv    id crosswalk (fantasypros_id -> sleeper_id, ...)
 *
 * Format mapping (DP publishes dynasty PPR only, in two QB variants):
 *   value_1qb / ecr_1qb  -> dynasty-ppr-std
 *   value_2qb / ecr_2qb  -> dynasty-ppr-sflex
 * No redraft, no half/standard, no TEP. See migration 0033.
 *
 * Matching: values rows carry fp_id; the crosswalk maps fp_id (column name
 * `fantasypros_id`) -> sleeper_id, and every one of our players has a Sleeper
 * id, so the primary path is fp_id -> fantasypros_id -> sleeper_id -> player,
 * with a normalized name|position fallback for players the crosswalk misses.
 *
 * captured_at is the DP scrape_date normalized to <scrape_date>T12:00:00.000Z,
 * NOT now(). DP refreshes ~weekly, so keying history snapshots on the source's
 * own publish date makes daily cron re-runs idempotent (the unique constraint
 * absorbs them) instead of writing six identical duplicate snapshots per week.
 * The trend windows in lib/calculate-trends.ts anchor on captured_at, so this
 * is also the more truthful timestamp. Do NOT "fix" this back to now().
 *
 * Values are on DP's own ~0..10,232 exponential-decay scale (not capped at
 * 10,000). Stored raw; rankings/trends are computed per-source, so DP's scale
 * never needs reconciling against KTC or FantasyCalc.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCsv } from "./csv";
import { withRetry } from "./supabase/retry";
import type { Database, Json } from "./database.types";

const VALUES_URL =
  "https://raw.githubusercontent.com/dynastyprocess/data/master/files/values-players.csv";
const CROSSWALK_URL =
  "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv";
const FETCH_TIMEOUT_MS = 30_000;
const SOURCE_SLUG = "dynastyprocess";

type FormatTarget = {
  formatSlug: "dynasty-ppr-std" | "dynasty-ppr-sflex";
  valueCol: "value_1qb" | "value_2qb";
};

const TARGETS: FormatTarget[] = [
  { formatSlug: "dynasty-ppr-std", valueCol: "value_1qb" },
  { formatSlug: "dynasty-ppr-sflex", valueCol: "value_2qb" },
];

// Columns the values file MUST carry for this sync to be valid. If any are
// missing, DP changed its schema and we abort rather than write garbage.
const REQUIRED_VALUE_COLUMNS = ["player", "pos", "value_1qb", "value_2qb", "scrape_date", "fp_id"];

export type DynastyProcessSyncResult = {
  ok: boolean;
  totalRows: number;
  unmatched: number;
  mergedPlayers: number;
  perFormat: Array<{ formatSlug: string; rows: number }>;
  warnings: string[];
  scrapeDate: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.'']/g, "")
    .replace(/\s+/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .trim();
}

/** YYYY-MM-DD -> <date>T12:00:00.000Z. Returns null on a malformed date. */
export function scrapeDateToCapturedAt(scrapeDate: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(scrapeDate.trim());
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T12:00:00.000Z`;
}

async function fetchCsvText(url: string, label: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { accept: "text/csv,text/plain", "user-agent": "ffbeacon-sync/1.0" },
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn(`  ${label}: HTTP ${response.status}`);
      return null;
    }
    return await response.text();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  ${label}: fetch failed - ${msg}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function trailingNumericId(slug: string): string | null {
  const m = slug.match(/-(\d+)$/);
  return m ? m[1] : null;
}

/** fantasypros_id -> sleeper_id from the crosswalk. Non-fatal: returns an empty
 *  map if the crosswalk is unreachable, and the sync falls back to name match. */
export function buildFpToSleeper(crosswalk: Record<string, string>[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of crosswalk) {
    const fpId = (row.fantasypros_id ?? "").trim();
    const sleeperId = (row.sleeper_id ?? "").trim();
    if (fpId && sleeperId) map.set(fpId, sleeperId);
  }
  return map;
}

export async function runDynastyProcessSync(
  supabase: SupabaseClient<Database>,
): Promise<DynastyProcessSyncResult> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const warnings: string[] = [];

  console.log("Loading format_configs and existing players...");
  const formats = await withRetry(
    async () => {
      const { data, error } = await supabase.from("format_configs").select("id, slug");
      if (error) throw error;
      if (!data) throw new Error("missing format data");
      return data;
    },
    { label: "format_configs select" },
  );
  const formatBySlug = new Map(formats.map((f) => [f.slug, f.id]));

  type PlayerRow = {
    id: string;
    slug: string;
    external_ids: unknown;
    first_name: string;
    last_name: string;
    position: string;
  };
  const players: PlayerRow[] = [];
  const PAGE_SIZE = 1000;
  for (let from = 0; ; from += PAGE_SIZE) {
    const pageOffset = from;
    const page = await withRetry(
      async () => {
        const { data, error } = await supabase
          .from("players")
          .select("id, slug, external_ids, first_name, last_name, position")
          .range(pageOffset, pageOffset + PAGE_SIZE - 1);
        if (error) throw error;
        return (data ?? []) as PlayerRow[];
      },
      { label: `players select page ${from}` },
    );
    if (page.length === 0) break;
    players.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  console.log(`  ${players.length} players loaded`);

  const playerBySleeperId = new Map<string, string>();
  const playerBySlugTail = new Map<string, string>();
  const playerByName = new Map<string, string>();
  for (const p of players) {
    const ext = (p.external_ids as Record<string, unknown>) ?? {};
    const sleeperId = typeof ext.sleeper === "string" ? ext.sleeper : null;
    if (sleeperId) playerBySleeperId.set(sleeperId, p.id);
    const tail = trailingNumericId(p.slug);
    if (tail) playerBySlugTail.set(tail, p.id);
    const nameKey = `${normalizeName(`${p.first_name} ${p.last_name}`)}|${p.position}`;
    if (!playerByName.has(nameKey)) playerByName.set(nameKey, p.id);
  }

  // Crosswalk first (non-fatal), then values (fatal if unusable).
  console.log("Fetching DynastyProcess id crosswalk...");
  const crosswalkText = await fetchCsvText(CROSSWALK_URL, "db_playerids.csv");
  const fpToSleeper = crosswalkText
    ? buildFpToSleeper(parseCsv(crosswalkText))
    : new Map<string, string>();
  if (fpToSleeper.size === 0) {
    const msg = "crosswalk unavailable or empty; falling back to name-only matching";
    warnings.push(msg);
    console.warn(`  WARN: ${msg}`);
  } else {
    console.log(`  ${fpToSleeper.size} fantasypros_id -> sleeper_id mappings`);
  }

  console.log("Fetching DynastyProcess player values...");
  const valuesText = await fetchCsvText(VALUES_URL, "values-players.csv");
  if (!valuesText) {
    throw new Error("runDynastyProcessSync: values-players.csv was unreachable.");
  }
  const valueRecords = parseCsv(valuesText);
  if (valueRecords.length === 0) {
    throw new Error("runDynastyProcessSync: values-players.csv parsed to zero rows.");
  }
  const presentColumns = new Set(Object.keys(valueRecords[0]));
  const missing = REQUIRED_VALUE_COLUMNS.filter((c) => !presentColumns.has(c));
  if (missing.length > 0) {
    throw new Error(
      `runDynastyProcessSync: values-players.csv missing required columns [${missing.join(", ")}] (DP schema changed).`,
    );
  }
  console.log(`  ${valueRecords.length} DynastyProcess value rows`);

  // Resolve a values record to one of our player ids: crosswalk sleeper path
  // first, then name|position fallback.
  const resolvePlayerId = (rec: Record<string, string>, position: string): string | undefined => {
    const fpId = (rec.fp_id ?? "").trim();
    const sleeperId = fpId ? fpToSleeper.get(fpId) : undefined;
    if (sleeperId) {
      const bySleeper = playerBySleeperId.get(sleeperId) ?? playerBySlugTail.get(sleeperId);
      if (bySleeper) return bySleeper;
    }
    return playerByName.get(`${normalizeName(rec.player ?? "")}|${position}`);
  };

  type Batch = {
    formatSlug: string;
    formatId: string;
    rows: Array<{
      player_id: string;
      format_config_id: string;
      value: number;
      source: string;
      captured_at: string;
      metadata: Json;
    }>;
    fingerprint: Map<string, number>;
  };

  const batches: Batch[] = [];
  let totalUnmatched = 0;
  let scrapeDate: string | null = null;

  for (const target of TARGETS) {
    const formatId = formatBySlug.get(target.formatSlug);
    if (!formatId) {
      console.warn(`  ${target.formatSlug}: no format_config found`);
      continue;
    }
    const rows: Batch["rows"] = [];
    const fingerprint = new Map<string, number>();
    // captured_at is constant within a scrape, so two value rows resolving to
    // the same player_id would collide on the (player, format, source,
    // captured_at) conflict key inside one upsert ("ON CONFLICT DO UPDATE
    // cannot affect row a second time"). The CSV is rank-sorted, so keep the
    // first (better-ranked) occurrence and count the rest as collapsed.
    const seenPlayerIds = new Set<string>();
    let unmatchedInBatch = 0;
    let collapsedInBatch = 0;

    for (const rec of valueRecords) {
      const position = (rec.pos ?? "").trim().toUpperCase();
      if (!position) continue;
      const value = Number(rec[target.valueCol]);
      if (!Number.isFinite(value)) continue;
      const capturedAt = scrapeDateToCapturedAt(rec.scrape_date ?? "");
      if (!capturedAt) continue;
      if (!scrapeDate) scrapeDate = (rec.scrape_date ?? "").trim();

      const nameKey = `${normalizeName(rec.player ?? "")}|${position}`;
      fingerprint.set(nameKey, value);

      const playerId = resolvePlayerId(rec, position);
      if (!playerId) {
        unmatchedInBatch += 1;
        continue;
      }
      if (seenPlayerIds.has(playerId)) {
        collapsedInBatch += 1;
        continue;
      }
      seenPlayerIds.add(playerId);

      rows.push({
        player_id: playerId,
        format_config_id: formatId,
        value,
        source: SOURCE_SLUG,
        captured_at: capturedAt,
        metadata: rec as unknown as Json,
      });
    }

    totalUnmatched += unmatchedInBatch;
    if (collapsedInBatch > 0) {
      const msg = `${target.formatSlug}: ${collapsedInBatch} DP rows collapsed onto an already-matched player (kept the better-ranked row).`;
      warnings.push(msg);
      console.warn(`  WARN: ${msg}`);
    }
    if (rows.length === 0) continue;
    batches.push({ formatSlug: target.formatSlug, formatId, rows, fingerprint });
    console.log(`  ${target.formatSlug}: ${rows.length} rows (${unmatchedInBatch} unmatched, ${collapsedInBatch} collapsed)`);
  }

  // Non-fatal canary: value_1qb and value_2qb must not be 100% identical across
  // shared players (QB values differ between 1QB and superflex by construction).
  // A 100%-identical result means we mapped the same column to both formats.
  // This reads a parsed CSV (not an HTML scrape), so like FantasyCalc we warn
  // rather than abort: dropping a good night's data over a soft signal is worse.
  {
    const fa = batches.find((b) => b.formatSlug === "dynasty-ppr-std")?.fingerprint;
    const fb = batches.find((b) => b.formatSlug === "dynasty-ppr-sflex")?.fingerprint;
    if (fa && fb) {
      let shared = 0;
      let identical = 0;
      for (const [key, va] of fa) {
        const vb = fb.get(key);
        if (typeof vb !== "number") continue;
        shared += 1;
        if (va === vb) identical += 1;
      }
      if (shared > 0 && identical === shared) {
        const msg = `dynasty-ppr-std and dynasty-ppr-sflex returned identical values for all ${shared} shared players (value_1qb/value_2qb may have been mapped to the same column).`;
        warnings.push(msg);
        console.warn(`  WARN: ${msg}`);
      }
    }
  }

  let totalRows = 0;
  const perFormat: Array<{ formatSlug: string; rows: number }> = [];
  for (const batch of batches) {
    let formatRows = 0;
    for (let i = 0; i < batch.rows.length; i += 200) {
      const chunk = batch.rows.slice(i, i + 200);
      await withRetry(
        async () => {
          const { error } = await supabase.from("player_value_history").upsert(chunk, {
            onConflict: "player_id,format_config_id,source,captured_at",
            ignoreDuplicates: false,
          });
          if (error) throw error;
        },
        { label: `player_value_history upsert ${batch.formatSlug}` },
      );
      totalRows += chunk.length;
      formatRows += chunk.length;
    }
    perFormat.push({ formatSlug: batch.formatSlug, rows: formatRows });
  }

  // A run that writes nothing is a failure, not a quiet success. Surface a 500
  // so the outage is visible instead of a green "ok" with no data behind it.
  if (totalRows === 0) {
    throw new Error(
      "runDynastyProcessSync: wrote 0 rows — every matched batch was empty (fetch, parse, or match failure).",
    );
  }

  // Merge DP provenance onto matched players: external_ids.fantasypros (the
  // join key), source_synced_at.dynastyprocess (operational, = run time), and
  // metadata.dynastyprocess (full raw value record). One update per player.
  const now = new Date().toISOString();
  const rawByPlayerId = new Map<string, { fpId: string; raw: Record<string, string> }>();
  for (const rec of valueRecords) {
    const position = (rec.pos ?? "").trim().toUpperCase();
    if (!position) continue;
    const playerId = resolvePlayerId(rec, position);
    if (!playerId || rawByPlayerId.has(playerId)) continue;
    rawByPlayerId.set(playerId, { fpId: (rec.fp_id ?? "").trim(), raw: rec });
  }

  const updateIds = Array.from(rawByPlayerId.keys());
  const existingByPlayerId = new Map<
    string,
    {
      external_ids: Record<string, unknown>;
      source_synced_at: Record<string, unknown>;
      metadata: Record<string, unknown>;
    }
  >();
  for (let from = 0; from < updateIds.length; from += 200) {
    const batchIds = updateIds.slice(from, from + 200);
    const data = await withRetry(
      async () => {
        const { data, error } = await supabase
          .from("players")
          .select("id, external_ids, source_synced_at, metadata")
          .in("id", batchIds);
        if (error) throw error;
        return data ?? [];
      },
      { label: "players select for merge" },
    );
    for (const p of data) {
      existingByPlayerId.set(p.id, {
        external_ids: (p.external_ids as Record<string, unknown>) ?? {},
        source_synced_at: (p.source_synced_at as Record<string, unknown>) ?? {},
        metadata: (p.metadata as Record<string, unknown>) ?? {},
      });
    }
  }

  let mergeCount = 0;
  for (const [playerId, { fpId, raw }] of rawByPlayerId) {
    const existing = existingByPlayerId.get(playerId);
    if (!existing) continue;
    const existingFpId =
      typeof existing.external_ids.fantasypros === "string"
        ? (existing.external_ids.fantasypros as string)
        : null;
    const externalIds: Json = {
      ...(existing.external_ids as Record<string, Json>),
      fantasypros: existingFpId ?? (fpId || null),
    };
    const sourceSyncedAt: Json = {
      ...(existing.source_synced_at as Record<string, Json>),
      dynastyprocess: now,
    };
    const metadata: Json = {
      ...(existing.metadata as Record<string, Json>),
      dynastyprocess: raw as unknown as Json,
    };
    await withRetry(
      async () => {
        const { error } = await supabase
          .from("players")
          .update({ external_ids: externalIds, source_synced_at: sourceSyncedAt, metadata })
          .eq("id", playerId);
        if (error) throw error;
      },
      { label: `players update ${playerId.slice(0, 8)}` },
    );
    mergeCount += 1;
  }

  const finished = Date.now();
  console.log(
    `\nDone. Inserted ${totalRows} player_value_history rows. Merged ${mergeCount} players. Unmatched: ${totalUnmatched}. Warnings: ${warnings.length}`,
  );

  return {
    ok: true,
    totalRows,
    unmatched: totalUnmatched,
    mergedPlayers: mergeCount,
    perFormat,
    warnings,
    scrapeDate,
    startedAt,
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
  };
}
