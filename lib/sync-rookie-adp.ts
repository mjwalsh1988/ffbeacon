/**
 * Rookie ADP sync (library form): nightly rookie-draft consensus order.
 *
 * Shared by the market cron endpoint (app/api/cron/sync-sleeper-market) and the
 * CLI (scripts/sync-rookie-adp.ts), matching the shape of the other syncs.
 *
 * WHY this exists: Sleeper's projections endpoint exposes an `adp_rookie` field
 * but never populates it (it is the 999 "no data" sentinel for every player, in
 * every season). So rookie-draft ADP has to come from elsewhere. DynastyProcess
 * mirrors FantasyPros' published *dynasty rookie rankings* (the `rookies.php`
 * page, `page_type='dynasty-rk'`) in files/db_fpecr_latest.csv. That page's `ecr`
 * (expert consensus rank) IS the rookie draft order: pick 1.01 ~ ecr 1, 1.02 ~
 * ecr 2, and so on. We store it verbatim, we do not compute a value of our own.
 *
 * WHERE it lands: player_market_snapshots, the same table the Sleeper ADP sync
 * writes, under the reserved `adp` map key "rookie" (lib/on-the-clock/adp.ts has
 * always listed "rookie" as the lead ADP candidate for rookie drafts). The row's
 * `source` is 'dynastyprocess', NOT 'sleeper': provenance stays honest, the raw
 * FantasyPros row is preserved in `metadata`, and the On The Clock reader
 * (resolveAdpSnapshot) pulls the "rookie" key from this source specifically.
 *
 * MATCHING: the incoming rookie class has no `fantasypros_id` in the crosswalk
 * yet (it is `NA` for pre/post-draft rookies), so fp_id matching yields nothing.
 * We match by DynastyProcess's own `mergename` -> the crosswalk's `merge_name`
 * (+ position) -> `sleeper_id` -> our players. That resolves ~93% of the class,
 * and every resolved sleeper_id is present in our players table.
 *
 * Failure posture (per project conventions): a parsed data file, so shape
 * oddities are warned rather than fatal, but a ZERO-row write is a thrown error
 * (an empty extraction means the page_type or column names moved and a silent
 * empty night would poison the "closest snapshot" rookie lookups).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./database.types";
import { parseCsv } from "./csv";
import { normalizeName } from "./sync-dynastyprocess";
import { withRetry } from "./supabase/retry";

type MarketInsert = Database["public"]["Tables"]["player_market_snapshots"]["Insert"];

const FPECR_URL =
  "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_fpecr_latest.csv";
const CROSSWALK_URL =
  "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv";
const FETCH_TIMEOUT_MS = 30_000;
const UPSERT_BATCH_SIZE = 500;

/** Row source slug: this is FantasyPros data mirrored by DynastyProcess, so it
 *  shares the 'dynastyprocess' provenance our value sync already uses. */
export const ROOKIE_ADP_SOURCE = "dynastyprocess";
/** The player_market_snapshots.adp map key rookie order is stored under. */
export const ROOKIE_ADP_KEY = "rookie";
/** FantasyPros ECR page that IS the dynasty rookie draft board. */
export const ROOKIE_PAGE_TYPE = "dynasty-rk";
/** season_type stored on rookie rows (kept uniform with the market rows). */
const ROOKIE_SEASON_TYPE = "regular";

/**
 * Columns db_fpecr_latest.csv MUST carry for this sync to mean anything. The
 * file is wide (image urls, ownership, ids) and its peripheral columns churn,
 * so we guard only on the fields we actually read, not the whole header.
 */
export const REQUIRED_FPECR_COLUMNS = [
  "page_type",
  "ecr",
  "mergename",
  "pos",
  "scrape_date",
] as const;

export type RookieRankingRow = {
  /** DynastyProcess merge name, lowercased. Join key to the crosswalk. */
  mergeName: string;
  /** Position, uppercased. */
  position: string;
  /** Original player display name (for the name fallback + diagnostics). */
  player: string;
  /** FantasyPros consensus rank = the rookie draft order. */
  ecr: number;
  /** Snapshot day (YYYY-MM-DD) the ranking was scraped. */
  scrapeDate: string;
  /** Full raw source row, preserved into metadata. */
  raw: Record<string, string>;
};

/**
 * NFL season a scrape_date belongs to. Mirrors currentNflSeason()'s March
 * rollover so a rookie board scraped any time in a league year maps to that
 * year. Used only for the snapshot's (source, season_type, season, ...) unique
 * key; the reader ignores season, so this just has to be stable per date.
 */
export function seasonForScrapeDate(scrapeDate: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((scrapeDate ?? "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year)) return null;
  // Season "year" rolls over in March, matching lib/sleeper.ts currentNflSeason.
  return month >= 3 ? year : year - 1;
}

/**
 * Extract and de-duplicate the rookie ranking rows from a parsed
 * db_fpecr_latest.csv. The file lists each rookie twice, so we key on
 * mergeName|position and keep the best (lowest) ecr. Rows missing a usable ecr,
 * mergeName, position, or scrape_date are dropped.
 */
export function extractRookieRankings(
  records: Record<string, string>[],
): RookieRankingRow[] {
  const byKey = new Map<string, RookieRankingRow>();
  for (const rec of records) {
    if ((rec.page_type ?? "").trim() !== ROOKIE_PAGE_TYPE) continue;
    const mergeName = (rec.mergename ?? "").trim().toLowerCase();
    const position = (rec.pos ?? "").trim().toUpperCase();
    const scrapeDate = (rec.scrape_date ?? "").trim();
    const ecr = Number(rec.ecr);
    if (!mergeName || !position || !scrapeDate) continue;
    if (!Number.isFinite(ecr) || ecr <= 0) continue;

    const key = `${mergeName}|${position}`;
    const existing = byKey.get(key);
    if (!existing || ecr < existing.ecr) {
      byKey.set(key, {
        mergeName,
        position,
        player: (rec.player ?? "").trim(),
        ecr,
        scrapeDate,
        raw: rec,
      });
    }
  }
  return Array.from(byKey.values());
}

/**
 * merge_name(+position) -> sleeper_id from the DynastyProcess crosswalk. Both
 * sides use DynastyProcess's own merge naming, so this join is exact. Returns a
 * position-qualified map and a name-only fallback map (a few rookies carry a
 * position that differs from the crosswalk's, e.g. an ATH reclassified to WR).
 */
export function buildMergeNameToSleeper(crosswalk: Record<string, string>[]): {
  withPos: Map<string, string>;
  noPos: Map<string, string>;
} {
  const withPos = new Map<string, string>();
  const noPos = new Map<string, string>();
  for (const row of crosswalk) {
    const sleeperId = (row.sleeper_id ?? "").trim();
    if (!sleeperId || sleeperId === "NA") continue;
    const mergeName = (row.merge_name ?? "").trim().toLowerCase();
    if (!mergeName) continue;
    const position = (row.position ?? "").trim().toUpperCase();
    const key = `${mergeName}|${position}`;
    if (!withPos.has(key)) withPos.set(key, sleeperId);
    if (!noPos.has(mergeName)) noPos.set(mergeName, sleeperId);
  }
  return { withPos, noPos };
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

export type MergeNameMaps = { withPos: Map<string, string>; noPos: Map<string, string> };

export type PlayerLookup = {
  /** sleeper_id -> players.id */
  bySleeperId: Map<string, string>;
  /** normalizeName|position -> { id, sleeperId } */
  byName: Map<string, { id: string; sleeperId: string | null }>;
};

/**
 * Resolve one rookie ranking row to a (sleeper_id, player_id) pair. Primary path
 * is DynastyProcess's own merge naming through the crosswalk to a sleeper id;
 * the players name map is a fallback for rookies the crosswalk lacks. sleeper_id
 * can be null (unstorable, since the column is NOT NULL) while player_id can be
 * null on its own (an unmapped-but-real rookie we still record). Shared by the
 * nightly sync and the history backfill so both produce identical keys.
 */
export function resolveRookie(
  row: RookieRankingRow,
  mergeToSleeper: MergeNameMaps,
  players: PlayerLookup,
): { sleeperId: string | null; playerId: string | null } {
  let sleeperId =
    mergeToSleeper.withPos.get(`${row.mergeName}|${row.position}`) ??
    mergeToSleeper.noPos.get(row.mergeName) ??
    null;
  let playerId = sleeperId ? (players.bySleeperId.get(sleeperId) ?? null) : null;

  if (!sleeperId || !playerId) {
    const hit = players.byName.get(`${normalizeName(row.player)}|${row.position}`);
    if (hit) {
      playerId = playerId ?? hit.id;
      sleeperId = sleeperId ?? hit.sleeperId;
    }
  }
  return { sleeperId, playerId };
}

/** Build the player_market_snapshots insert for one resolved rookie row. */
export function buildRookieInsert(
  row: RookieRankingRow,
  season: number,
  sleeperId: string,
  playerId: string | null,
  nowIso: string,
): MarketInsert {
  return {
    source: ROOKIE_ADP_SOURCE,
    season,
    season_type: ROOKIE_SEASON_TYPE,
    snapshot_date: row.scrapeDate,
    sleeper_player_id: sleeperId,
    player_id: playerId,
    adp: { [ROOKIE_ADP_KEY]: row.ecr } as unknown as Json,
    projected_pts_ppr: null,
    projected_pts_half_ppr: null,
    projected_pts_std: null,
    metadata: row.raw as unknown as Json,
    updated_at: nowIso,
  };
}

export async function loadPlayerLookup(
  supabase: SupabaseClient<Database>,
): Promise<PlayerLookup> {
  const bySleeperId = new Map<string, string>();
  const byName = new Map<string, { id: string; sleeperId: string | null }>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const offset = from;
    const page = await withRetry(
      async () => {
        const { data, error } = await supabase
          .from("players")
          .select("id, external_ids, first_name, last_name, position")
          .range(offset, offset + PAGE - 1);
        if (error) throw error;
        return (data ?? []) as Array<{
          id: string;
          external_ids: unknown;
          first_name: string;
          last_name: string;
          position: string;
        }>;
      },
      { label: `players select page ${from}` },
    );
    if (page.length === 0) break;
    for (const p of page) {
      const ext = (p.external_ids as Record<string, unknown>) ?? {};
      const sleeperId = typeof ext.sleeper === "string" ? ext.sleeper : null;
      if (sleeperId) bySleeperId.set(sleeperId, p.id);
      const nameKey = `${normalizeName(`${p.first_name} ${p.last_name}`)}|${p.position}`;
      if (!byName.has(nameKey)) byName.set(nameKey, { id: p.id, sleeperId });
    }
    if (page.length < PAGE) break;
  }
  return { bySleeperId, byName };
}

export type RookieAdpSyncResult = {
  ok: boolean;
  source: string;
  fetched: number;
  rookieRows: number;
  stored: number;
  matchedSleeper: number;
  matchedPlayer: number;
  unmatched: number;
  scrapeDate: string | null;
  season: number | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

export async function runRookieAdpSync(
  supabase: SupabaseClient<Database>,
): Promise<RookieAdpSyncResult> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();

  // Crosswalk first (non-fatal: name fallback still resolves most rookies), then
  // the ECR file (fatal if unreachable).
  console.log("Fetching DynastyProcess id crosswalk...");
  const crosswalkText = await fetchCsvText(CROSSWALK_URL, "db_playerids.csv");
  const mergeToSleeper = crosswalkText
    ? buildMergeNameToSleeper(parseCsv(crosswalkText))
    : { withPos: new Map<string, string>(), noPos: new Map<string, string>() };
  if (mergeToSleeper.withPos.size === 0) {
    console.warn("  WARN: crosswalk unavailable or empty; relying on name-only matching");
  } else {
    console.log(`  ${mergeToSleeper.withPos.size} merge_name -> sleeper_id mappings`);
  }

  console.log("Fetching FantasyPros rookie rankings (db_fpecr_latest.csv)...");
  const fpecrText = await fetchCsvText(FPECR_URL, "db_fpecr_latest.csv");
  if (!fpecrText) {
    throw new Error("runRookieAdpSync: db_fpecr_latest.csv was unreachable.");
  }
  const records = parseCsv(fpecrText);
  if (records.length === 0) {
    throw new Error("runRookieAdpSync: db_fpecr_latest.csv parsed to zero rows.");
  }
  const presentColumns = new Set(Object.keys(records[0]));
  const missing = REQUIRED_FPECR_COLUMNS.filter((c) => !presentColumns.has(c));
  if (missing.length > 0) {
    throw new Error(
      `runRookieAdpSync: db_fpecr_latest.csv missing required columns [${missing.join(", ")}] (FantasyPros schema changed).`,
    );
  }

  const rookies = extractRookieRankings(records);
  if (rookies.length === 0) {
    throw new Error(
      `runRookieAdpSync: no rows with page_type='${ROOKIE_PAGE_TYPE}' (the rookie rankings page moved or was renamed). Refusing to write an empty snapshot.`,
    );
  }
  console.log(`  ${rookies.length} rookie ranking rows extracted`);

  const players = await loadPlayerLookup(supabase);

  const nowIso = new Date().toISOString();
  const inserts: MarketInsert[] = [];
  const seenSleeperIds = new Set<string>();
  let matchedSleeper = 0;
  let matchedPlayer = 0;
  let unmatched = 0;
  let scrapeDate: string | null = null;

  for (const row of rookies) {
    if (!scrapeDate) scrapeDate = row.scrapeDate;
    const season = seasonForScrapeDate(row.scrapeDate);
    if (season === null) continue;

    const { sleeperId, playerId } = resolveRookie(row, mergeToSleeper, players);

    // sleeper_player_id is NOT NULL: without a sleeper id we cannot store the row.
    if (!sleeperId) {
      unmatched += 1;
      continue;
    }
    // One row per rookie per snapshot. extractRookieRankings already keeps the
    // best ecr per name; this second guard covers two distinct names resolving to
    // one sleeper id (rare), keeping whichever the extract emitted first. Order is
    // stable for a given file, so the nightly sync and the backfill agree.
    if (seenSleeperIds.has(sleeperId)) continue;
    seenSleeperIds.add(sleeperId);

    matchedSleeper += 1;
    if (playerId) matchedPlayer += 1;

    inserts.push(buildRookieInsert(row, season, sleeperId, playerId, nowIso));
  }

  if (inserts.length === 0) {
    throw new Error(
      `runRookieAdpSync: ${rookies.length} rookie rows fetched but none resolved to a sleeper id. The crosswalk merge naming may have changed; refusing to write.`,
    );
  }

  const season = seasonForScrapeDate(scrapeDate ?? "");

  for (let i = 0; i < inserts.length; i += UPSERT_BATCH_SIZE) {
    const chunk = inserts.slice(i, i + UPSERT_BATCH_SIZE);
    await withRetry(
      async () => {
        const { error } = await supabase
          .from("player_market_snapshots")
          .upsert(chunk, {
            onConflict: "source,season_type,season,sleeper_player_id,snapshot_date",
          });
        if (error) throw error;
      },
      { label: `player_market_snapshots rookie upsert ${i}` },
    );
  }

  if (unmatched > 0) {
    console.warn(
      `[sync-rookie-adp] ${unmatched} of ${rookies.length} rookie rows had no sleeper id (deep prospects not yet in the crosswalk); skipped.`,
    );
  }

  const finished = Date.now();
  return {
    ok: true,
    source: ROOKIE_ADP_SOURCE,
    fetched: records.length,
    rookieRows: rookies.length,
    stored: inserts.length,
    matchedSleeper,
    matchedPlayer,
    unmatched,
    scrapeDate,
    season,
    startedAt,
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
  };
}
