/**
 * The cached full-universe projection read behind Positional WAR.
 *
 * Positional WAR does not evaluate one league's rosters. It evaluates every
 * player the league could theoretically start, whether owned or not, which
 * means the read is roughly three times as wide as Power Pulse's (about 1,083
 * players against roughly 350) and, critically, IDENTICAL for every league in
 * the same season and week window. Two twelve-team leagues both asking for
 * (2026, week 5 through week 17, pts_ppr) get the exact same universe, so the
 * read is memoized rather than re-run per league. See
 * docs/league-pulse/league-pulse-positional-war-plan.md section 12.
 *
 * WHY THE CACHE IS SLICED, and this is the load-bearing decision in this file.
 *
 * The whole universe used to go into ONE unstable_cache entry. Measured
 * against production (2026, weeks 1 to 17, ppr): 6.30 MiB serialized, of which
 * 6.08 MiB is 17,394 projection rows and their raw `stat_line` maps. Next's
 * data cache refuses anything over 2 MiB, so the write failed on every cold
 * load and logged "items over 2MB can not be cached". The read then returned
 * the freshly loaded universe anyway, which is why nothing looked broken: the
 * layer simply never populated, and every fingerprint miss paid for a full
 * rebuild.
 *
 * The raw stat lines cannot be dropped. Each league rescores them under its
 * own literal Sleeper scoring settings (lib/league-scoring.ts), which is the
 * whole reason this model does not vary by format or by value source.
 *
 * So the universe is stored as several entries instead of one, split where the
 * data naturally partitions:
 *
 *   - ONE ENTRY PER (season, week) of projection rows. Largest measured slice
 *     is 390 KiB, 19% of the limit, and a week would have to carry more than
 *     five times today's row count to reach it. A week slice is shared across
 *     every week window AND every scoring base, because a projection row
 *     carries all three scoring columns plus its raw stat line: week 5 is week
 *     5 whether a league asks for weeks 1 to 17 or 9 to 17, ppr or standard.
 *   - ONE ENTRY for the resolved players, keyed by a digest of the exact
 *     player id set the window produced (227 KiB measured).
 *   - ONE ENTRY for projection accuracy, keyed by that same id digest plus the
 *     scoring base.
 *   - ONE ENTRY for the defense-vs-position splits, keyed by scoring base and
 *     the two seasons it covers, which is all it depends on.
 *
 * Every entry carries CACHE_TAGS.playerProjections, so the nightly projections
 * sync busts the whole set together
 * (app/api/cron/sync-weekly-projections/route.ts).
 *
 * KEYING THE ID-DEPENDENT ENTRIES BY A DIGEST OF THE IDS is what stops a
 * partial cache from silently shrinking the universe. An entry can only ever
 * be reused for the exact id set it was built from, so there is no way to pair
 * this window's projections with another window's player map. The resolve also
 * records how many ids it resolved and how many it deliberately dropped (a
 * position Sleeper does not project), and the assembly asserts the two add up
 * to the ids it asked about. A truncated stored array fails that assertion
 * instead of quietly producing a thinner universe and a higher replacement
 * level at every position.
 *
 * ONE UNCACHED READ REMAINS ON PURPOSE: the exact-count guard over the whole
 * window. Each week slice guards its own completeness before it can ever be
 * stored, but a guard inside a cached function can only speak for the moment
 * the entry was written. The window count runs on every assembly, against live
 * Postgres, and is compared against the summed row counts the slices recorded,
 * so a universe assembled entirely from cache entries is verified against the
 * database exactly the way a freshly read one is. It is one head-count query
 * on an indexed column, next to a compute measured in seconds.
 *
 * TWO READER SETS, ONE ASSEMBLY. `assembleUniverse` takes its four reads as an
 * argument. `directReaders` go straight to Postgres; `cachedReaders` wrap the
 * same four functions in the data cache. `loadWarUniverse` uses the cached set
 * and `loadWarUniverseUncached` uses the direct set, so the two cannot drift
 * into computing different universes: they are the same function with
 * different readers, and lib/positional-war/load.test.ts asserts they produce
 * identical output.
 *
 * unstable_cache forbids cookies()/headers(), so this uses the cookie-less
 * read client (lib/supabase/server.ts createCachedReadClient), the same one
 * lib/faab/player-list.ts loadRankedUniverseCached() uses. Every table this
 * module touches (player_weekly_projections, players, player_projection_accuracy,
 * nfl_defense_vs_position) is RLS-public, so a cookie-less anon-key client reads
 * exactly what a request-scoped client would.
 *
 * Pagination note (matching lib/power-pulse/load.ts): Supabase silently
 * truncates a select at 1000 rows. The projection scan below reads every row
 * in the window, easily past 1000, so it pages with a keyset walk on the
 * primary key and an exact-count guard. A short read here would silently
 * shrink the universe, which silently raises every position's replacement
 * level: a plausible-looking wrong answer rather than a failed one. The guard
 * turns it into the latter.
 *
 * ONE SCAN, NOT TWO. This module used to read the window twice: once for
 * (id, player_id) to learn which players exist, and then again through
 * loadProjections for the full rows of exactly those players. The second read
 * returns a strict subset of the first read's rows, so the first one bought
 * nothing but round trips and 13,000 extra rows on the wire. It now makes ONE
 * pass that fetches full rows and derives the player id set from what came
 * back. That is safe here and only here: Positional WAR's universe is by
 * definition every player with a projection in the window, so "the rows I
 * need" and "the rows that exist" are the same set. Power Pulse asks a
 * narrower question (one league's rostered players) and keeps loadProjections
 * with its id filter.
 *
 * Concurrency note: a cache-miss compute used to make roughly 58 sequential
 * round trips, which at ~150-175ms per round trip accounted for nearly all of
 * a ~10.2s cold compute. The projection scan walks each week independently
 * (weeks share no cursor), and the player-resolve chunks, the accuracy read
 * and the defense read all run concurrently. Both concurrent loops are capped
 * at DB_CHUNK_CONCURRENCY in-flight requests, imported from
 * lib/power-pulse/load.ts rather than redefined here, so both files share one
 * cap and one mental model of how much of the connection pool a cold compute
 * is allowed to use at once. Only the inherently sequential parts (a single
 * page depending on the previous page's cursor) stay sequential.
 *
 * The Map-in-cache trap: unstable_cache serializes its return value to JSON to
 * store it, and a JS Map serializes to "{}". So nothing stored here is ever a
 * Map: every cached entry is a plain, JSON-round-trippable shape (arrays, or
 * arrays of [key, value] tuples). The exported loadWarUniverse() rebuilds the
 * Maps AFTER the reads return, every time, whether those reads hit or missed.
 * Getting this backwards (rebuilding once and letting the cache remember Maps)
 * would make every hit come back as empty Maps and zero every projection in
 * every league until the tag was busted or the TTL expired.
 */

import { createHash } from "node:crypto";
import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { ScoringBase, ScoringSettings } from "@/lib/league-scoring";
import { createCachedReadClient } from "@/lib/supabase/server";
import { CACHE_TAGS, CACHE_TTL } from "@/lib/cache-tags";
import {
  loadAccuracy,
  loadDefenseSplits,
  mapWithConcurrency,
  numOrNull,
  DB_CHUNK_CONCURRENCY,
  type AccuracyRow,
  type DefenseRow,
  type ProjectionRow,
} from "@/lib/power-pulse/load";
import { PULSE_POSITIONS, type PulsePosition } from "@/lib/power-pulse/types";
import type { PowerPulseSettings } from "@/lib/power-pulse/default-settings";
import { projectPlayerWeek, reliabilityMultiplier } from "@/lib/power-pulse/project";
import { defenseSeasonsFor } from "@/lib/projections/defense-seasons";
import type { WarPlayerInput } from "./types";

type ServiceClient = SupabaseClient<Database>;

/** Supabase's default row cap. Every multi-row read here pages past it. */
const PAGE = 1000;

/**
 * players.id is a uuid, not a bare integer, so `.in()` is the right filter
 * (not the `.or()` external-id-or-slug-tail match lib/power-pulse/load.ts
 * loadPlayers() uses). That resolver goes Sleeper id -> player because rosters
 * only carry Sleeper ids; this one already has FF Beacon player ids straight
 * off player_weekly_projections.player_id, so a plain `.in("id", chunk)` is
 * both simpler and safer (no injection-guarded `.or()` string to build). Width
 * matches loadPlayers' CHUNK.
 */
const PLAYER_RESOLVE_CHUNK = 200;

/**
 * Bumped by hand when the SHAPE of anything stored under these keys changes.
 *
 * The tag busts entries when the DATA changes; this busts them when the code
 * that wrote them changes, which a tag cannot know about. Without it a deploy
 * that adds a field to WarUniversePlayer would keep reading yesterday's
 * entries, which parse fine and are missing the field.
 */
// v2 scopes every entry to one projection SOURCE. Before it, the week slices
// were keyed on (season, week) alone and the query filtered on nothing, so the
// day player_weekly_projections holds an ffbeacon row beside its sleeper one,
// the same player-week comes back twice and the universe doubles.
const CACHE_SHAPE_VERSION = "v2";

/** One projectable player, before any week is attached. */
export type WarUniversePlayer = {
  playerId: string;
  sleeperId: string | null;
  slug: string;
  name: string;
  team: string | null;
  position: PulsePosition;
  injuryStatus: string | null;
};

/** Everything buildWarPlayers() needs, for one (season, week window, scoring base). */
export type WarUniverse = {
  players: Map<string, WarUniversePlayer>;
  projections: ProjectionRow[];
  accuracy: Map<string, AccuracyRow>;
  defense: Map<string, DefenseRow>;
  defenseSeasons: number[];
};

/** The JSON-serializable shape the assembly returns and the tests round-trip. */
type SerializedWarUniverse = {
  players: [string, WarUniversePlayer][];
  projections: ProjectionRow[];
  accuracy: [string, AccuracyRow][];
  defense: [string, DefenseRow][];
  defenseSeasons: number[];
};

/**
 * One week's cached slice: the rows this module keeps, plus how many rows the
 * query actually matched.
 *
 * `readCount` is stored rather than recomputed because the window-level guard
 * needs it and cannot see inside the walk. It differs from `rows.length`
 * whenever a projection row carries a null player_id: Postgres counts that row
 * and this module declines to keep it, so comparing kept rows against a count
 * would fail an otherwise complete read. (The guard this replaced compared
 * kept rows against the count despite a comment saying it did not.)
 */
type ProjectionWeekSlice = {
  rows: ProjectionRow[];
  readCount: number;
};

/**
 * What the player resolve stores: the resolved rows plus a count of the ids it
 * deliberately declined to keep.
 *
 * `dropped` exists so the assembly can assert `resolved + dropped === asked`
 * and fail loudly on a truncated entry. Storing only the array would make a
 * short read indistinguishable from a window where fewer players resolved,
 * which is the exact silent shrink this cache split has to rule out.
 */
type ResolvedPlayers = {
  players: [string, WarUniversePlayer][];
  /** Ids that resolved to a position this model cannot score, or to no row at all. */
  dropped: number;
};

/** The columns one projection row needs, shared by the walk and its count. */
const PROJECTION_COLUMNS =
  "id, player_id, week, opponent, stat_line, projected_pts_ppr, projected_pts_half_ppr, projected_pts_std, availability, injury_status";

/**
 * A stable digest of a player id set, for the cache keys of the two entries
 * that depend on WHICH players the window covered.
 *
 * Sorted first, so two windows that produced the same set in a different order
 * share one entry. sha256 rather than the raw list, because that list is about
 * 40 kB and a cache key is not a place to put 40 kB.
 */
export function playerIdSetDigest(playerIds: readonly string[]): string {
  const sorted = [...playerIds].sort();
  return createHash("sha256").update(sorted.join(",")).digest("hex");
}

/**
 * Run `fn` through the Next data cache, falling back to running it directly
 * when there is no data cache in this process.
 *
 * WHY THE FALLBACK. `unstable_cache` needs a Next.js incremental cache, which
 * exists during a request and does not exist in a plain node process. So
 * `npm run calculate:positional-war` threw
 * "Invariant: incrementalCache missing in unstable_cache" before it read a
 * single row, and the standalone recompute path was unusable. The memoization
 * is a performance optimization, not a correctness requirement: the direct
 * read returns exactly the same rows, and a script recomputing every league in
 * one pass has no second reader to share an entry with anyway.
 *
 * The catch is deliberately narrow. Only the missing-cache invariant falls
 * through; every other failure (a short paged read, a query error) still
 * throws, because those are the failures that would otherwise shrink the
 * universe and silently raise every replacement level.
 */
async function withDataCache<T>(keyParts: string[], fn: () => Promise<T>): Promise<T> {
  try {
    return await unstable_cache(fn, keyParts, {
      revalidate: CACHE_TTL.daily,
      tags: [CACHE_TAGS.playerProjections],
    })();
  } catch (err) {
    if (!isMissingIncrementalCache(err)) throw err;
    return fn();
  }
}

/**
 * One week's keyset walk over the full projection rows, with its own exact
 * count guard.
 *
 * The walk itself is inherently sequential (each page needs the previous
 * page's last id), but weeks have no cross-week dependency, so the caller runs
 * many of these concurrently instead of running one long walk across the whole
 * window. A per-week walk is also simply shorter: about 17,400 rows over a
 * 17-week window averages a little over a thousand a week, so most weeks
 * finish in one or two round trips instead of contributing to a
 * ~20-round-trip chain.
 *
 * THE PER-WEEK COUNT GUARD IS HERE because this is now the unit that gets
 * cached. A slice is verified complete BEFORE it can be stored, so a truncated
 * week can never become the cache entry every later league reads as truth.
 *
 * PAGE stays at 1000 and must not be raised. PostgREST caps this project at
 * 1000 rows per response, so a larger `limit` silently returns 1000 anyway,
 * and the `data.length < PAGE` stop condition would then read that full page
 * as a short final page and end the walk early. Measured against production:
 * asking for 2000 returns 12,623 of 13,064 rows. The count guard catches it,
 * which is what the guard is for, but the right move is not to ask.
 */
async function readProjectionWeek(
  supabase: ServiceClient,
  season: number,
  week: number,
  source: string,
): Promise<ProjectionWeekSlice> {
  const walk = async (): Promise<ProjectionWeekSlice> => {
    const out: ProjectionRow[] = [];
    let readCount = 0;
    let cursor: string | null = null;
    for (;;) {
      let q = supabase
        .from("player_weekly_projections")
        .select(PROJECTION_COLUMNS)
        .eq("season", season)
        .eq("season_type", "regular")
        .eq("week", week)
        .eq("source", source)
        .order("id", { ascending: true })
        .limit(PAGE);
      if (cursor !== null) q = q.gt("id", cursor);
      const { data, error } = await q;
      if (error) throw new Error(`positional war universe load failed: ${error.message}`);
      if (!data || data.length === 0) break;
      readCount += data.length;
      for (const row of data) {
        if (row.player_id) {
          out.push({
            playerId: row.player_id,
            week: Number(row.week),
            opponent: row.opponent,
            statLine: (row.stat_line as Record<string, unknown> | null) ?? null,
            ppr: numOrNull(row.projected_pts_ppr),
            halfPpr: numOrNull(row.projected_pts_half_ppr),
            std: numOrNull(row.projected_pts_std),
            availability: row.availability,
            injuryStatus: row.injury_status,
          });
        }
      }
      cursor = data[data.length - 1].id;
      if (data.length < PAGE) break;
    }
    return { rows: out, readCount };
  };

  // The count does not depend on the walk, so it runs alongside it; only the
  // assertion afterwards needs both.
  const [walked, countResult] = await Promise.all([
    walk(),
    supabase
      .from("player_weekly_projections")
      .select("id", { count: "exact", head: true })
      .eq("season", season)
      .eq("season_type", "regular")
      .eq("week", week)
      .eq("source", source),
  ]);

  if (countResult.error) {
    throw new Error(`positional war universe count failed: ${countResult.error.message}`);
  }
  const expected = countResult.count;
  if (expected != null && walked.readCount < expected) {
    throw new Error(
      `positional war week ${week} load incomplete: read ${walked.readCount} of ${expected} projection rows`,
    );
  }

  return walked;
}

/**
 * The exact number of regular season projection rows in the window, live.
 *
 * Deliberately NOT cached, and deliberately not folded into the week slices.
 * See the module header: a guard inside a cached function can only speak for
 * the moment the entry was written, and the whole point of this one is to
 * verify a universe assembled from cached slices against the database as it
 * stands now.
 */
async function countWindowProjections(
  supabase: ServiceClient,
  season: number,
  fromWeek: number,
  toWeek: number,
  source: string,
): Promise<number | null> {
  const { count, error } = await supabase
    .from("player_weekly_projections")
    .select("id", { count: "exact", head: true })
    .eq("season", season)
    .eq("season_type", "regular")
    .eq("source", source)
    .gte("week", fromWeek)
    .lte("week", toWeek);
  if (error) {
    throw new Error(`positional war universe count failed: ${error.message}`);
  }
  return count;
}

/**
 * The two fields this resolver wants out of jsonb, extracted BY POSTGRES
 * rather than shipped whole and picked apart in JavaScript.
 *
 * `players.metadata` holds the full raw Sleeper player object per the project's
 * original-source-preservation rule, and it averages about 2kB compressed per
 * row. Selecting the column to read one string cost roughly 2MB of jsonb (a
 * good deal more as wire JSON) for 1,083 players, every cold universe load.
 * `metadata->sleeper->>injury_status` asks Postgres for the string instead.
 * Verified against production over 200 players, 103 of them carrying a
 * designation: the extracted values match what the JavaScript unpacking
 * produced, byte for byte.
 *
 * `->>` yields text, so a Sleeper id stored as a JSON number arrives as its
 * decimal string, which is exactly what the old `String(ext.sleeper)` branch
 * produced. Both fields come back as `null` when the path is absent, and the
 * length checks below still turn an empty string into null the way they did.
 */
const PLAYER_COLUMNS =
  "id, slug, first_name, last_name, full_name, position, team, sleeper_id:external_ids->>sleeper, injury_status:metadata->sleeper->>injury_status";

/** The shape PLAYER_COLUMNS returns. The jsonb paths are text or null. */
type ResolvedPlayerRow = {
  id: string;
  slug: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  position: string | null;
  team: string | null;
  sleeper_id: string | null;
  injury_status: string | null;
};

/**
 * Resolve player ids to name, slug, position, team, injury status and Sleeper
 * id. Drops anyone whose position is not one of QB, RB, WR, TE, K, DEF: those
 * are the only positions Sleeper projects (PULSE_POSITIONS), so anything else
 * cannot be scored here regardless of what slot a league might offer it.
 *
 * Returns the dropped count alongside the rows so the assembly can prove
 * nothing went missing. See ResolvedPlayers.
 */
async function readUniversePlayers(
  supabase: ServiceClient,
  playerIds: string[],
): Promise<ResolvedPlayers> {
  const out = new Map<string, WarUniversePlayer>();
  if (playerIds.length === 0) return { players: [], dropped: 0 };

  const valid = new Set<string>(PULSE_POSITIONS);

  const chunks: string[][] = [];
  for (let i = 0; i < playerIds.length; i += PLAYER_RESOLVE_CHUNK) {
    chunks.push(playerIds.slice(i, i + PLAYER_RESOLVE_CHUNK));
  }

  // Chunks are independent id partitions of the same query, so they run
  // concurrently (capped) rather than one after another.
  const perChunk = await mapWithConcurrency(chunks, DB_CHUNK_CONCURRENCY, async (chunk) => {
    const { data, error } = await supabase.from("players").select(PLAYER_COLUMNS).in("id", chunk);
    if (error) throw new Error(`positional war player resolve failed: ${error.message}`);
    return (data ?? []) as unknown as ResolvedPlayerRow[];
  });

  for (const data of perChunk) {
    for (const p of data) {
      const position = (p.position ?? "").toUpperCase();
      if (!valid.has(position)) continue;

      // typeof rather than a null check: PostgREST returns null for an absent
      // jsonb path, but a row shape that simply lacks the key (a stub, a
      // schema drift) hands back undefined, and treating that as a value is
      // how a loader throws on data it should have skipped.
      const sleeperId = typeof p.sleeper_id === "string" && p.sleeper_id.length > 0 ? p.sleeper_id : null;
      const injuryStatus =
        typeof p.injury_status === "string" && p.injury_status.length > 0 ? p.injury_status : null;

      out.set(p.id, {
        playerId: p.id,
        sleeperId,
        slug: p.slug,
        name: p.full_name ?? (`${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || p.slug),
        team: p.team,
        position: position as PulsePosition,
        injuryStatus,
      });
    }
  }

  // Counted against the ids ASKED ABOUT, not against the rows returned, so an
  // id with no players row at all is counted as dropped exactly once.
  let dropped = 0;
  for (const id of playerIds) if (!out.has(id)) dropped += 1;

  return { players: [...out.entries()], dropped };
}

/** The four reads the assembly needs, so it can run cached or direct. */
type UniverseReaders = {
  projectionWeek: (season: number, week: number) => Promise<ProjectionWeekSlice>;
  players: (playerIds: string[]) => Promise<ResolvedPlayers>;
  accuracy: (playerIds: string[], scoringBase: ScoringBase) => Promise<[string, AccuracyRow][]>;
  defense: (scoringBase: ScoringBase, seasons: number[]) => Promise<[string, DefenseRow][]>;
};

/** Straight to Postgres. No data cache involved at any level. */
function directReaders(supabase: ServiceClient, source: string): UniverseReaders {
  return {
    projectionWeek: (season, week) => readProjectionWeek(supabase, season, week, source),
    players: (playerIds) => readUniversePlayers(supabase, playerIds),
    // Scoped to the SAME source the projections were read from, per migration
    // 0240: a reliability multiplier measured against Sleeper's projection is
    // only meaningful applied to Sleeper's projection.
    accuracy: async (playerIds, scoringBase) => [
      ...(await loadAccuracy(supabase, playerIds, scoringBase, source)).entries(),
    ],
    defense: async (scoringBase, seasons) => [
      ...(await loadDefenseSplits(supabase, scoringBase, seasons)).entries(),
    ],
  };
}

/**
 * The same four reads, each behind its own data cache entry.
 *
 * The id-dependent entries are keyed by a digest of the id set rather than by
 * the window that produced it, so an entry can only ever be reused for exactly
 * the ids it was built from. See the module header.
 */
function cachedReaders(supabase: ServiceClient, source: string): UniverseReaders {
  const direct = directReaders(supabase, source);
  return {
    projectionWeek: (season, week) =>
      withDataCache(
        [
          "positional-war-projection-week",
          CACHE_SHAPE_VERSION,
          source,
          String(season),
          String(week),
        ],
        () => direct.projectionWeek(season, week),
      ),
    players: (playerIds) =>
      withDataCache(
        ["positional-war-players", CACHE_SHAPE_VERSION, playerIdSetDigest(playerIds)],
        () => direct.players(playerIds),
      ),
    accuracy: (playerIds, scoringBase) =>
      withDataCache(
        [
          "positional-war-accuracy",
          CACHE_SHAPE_VERSION,
          source,
          scoringBase,
          playerIdSetDigest(playerIds),
        ],
        () => direct.accuracy(playerIds, scoringBase),
      ),
    defense: (scoringBase, seasons) =>
      withDataCache(
        ["positional-war-defense", CACHE_SHAPE_VERSION, scoringBase, seasons.join("_")],
        () => direct.defense(scoringBase, seasons),
      ),
  };
}

export type WarUniverseParams = {
  season: number;
  fromWeek: number;
  toWeek: number;
  scoringBase: ScoringBase;
  /**
   * Which projection source to build the universe from, resolved by the
   * caller through lib/projections/source.ts.
   *
   * Required rather than defaulted, for two reasons at once. A default is
   * how this module would keep quoting Sleeper on the day the FF Beacon
   * engine is switched on, and the absence of any source filter at all is
   * how it would read BOTH sources' rows as one pool and count every player
   * twice.
   */
  source: string;
};

/**
 * Assemble one universe from whichever readers it is given.
 *
 * The ONLY difference between the cached and the uncached universe is where
 * the four reads come from, which is why they are an argument. Every guard,
 * every filter and every ordering below runs identically either way, so a
 * cached universe and a freshly read one are the same value.
 */
async function assembleUniverse(
  supabase: ServiceClient,
  params: WarUniverseParams,
  readers: UniverseReaders,
): Promise<SerializedWarUniverse> {
  const { season, fromWeek, toWeek, scoringBase } = params;
  const defenseSeasons = defenseSeasonsFor(season);

  const weeks: number[] = [];
  for (let w = fromWeek; w <= toWeek; w++) weeks.push(w);

  // The window's rows, one slice per week, plus the live count that verifies
  // them. Nothing here depends on anything else here.
  const [perWeek, expected] = await Promise.all([
    mapWithConcurrency(weeks, DB_CHUNK_CONCURRENCY, (week) => readers.projectionWeek(season, week)),
    countWindowProjections(supabase, season, fromWeek, toWeek, params.source),
  ]);

  const windowProjections: ProjectionRow[] = [];
  const projectedIdSet = new Set<string>();
  let readCount = 0;
  for (const slice of perWeek) {
    readCount += slice.readCount;
    for (const row of slice.rows) {
      windowProjections.push(row);
      projectedIdSet.add(row.playerId);
    }
  }

  // A short read would silently shrink the universe, which silently raises
  // every position's replacement level: a plausible-looking wrong answer
  // rather than a failed one. This turns it into the latter, and it does so
  // for a universe assembled entirely from cache entries just as much as for
  // one read fresh: a stale slice, an evicted slice that came back empty, or a
  // week missing from the fan-out all show up here as a shortfall.
  if (expected != null && readCount < expected) {
    throw new Error(
      `positional war universe load incomplete: read ${readCount} of ${expected} projection rows`,
    );
  }

  const projectedIds = [...projectedIdSet];

  const [resolved, accuracyEntries, defenseEntries] = await Promise.all([
    readers.players(projectedIds),
    readers.accuracy(projectedIds, scoringBase),
    readers.defense(scoringBase, defenseSeasons),
  ]);

  // The stored player entry must account for every id it was asked about, or
  // it is not the entry for this id set. See ResolvedPlayers.
  if (resolved.players.length + resolved.dropped !== projectedIds.length) {
    throw new Error(
      `positional war player resolve inconsistent: ${resolved.players.length} resolved plus ${resolved.dropped} dropped does not account for ${projectedIds.length} ids`,
    );
  }

  const playersMap = new Map(resolved.players);

  // readUniversePlayers drops anyone outside PULSE_POSITIONS, so the rows are
  // narrowed to the resolved players here rather than by a second query. This
  // keeps `projections` exactly the set the previous id-filtered read
  // returned. Today every projected player is already a pulse position, so
  // this drops nothing; it stays because a future source that publishes an
  // IDP projection must not put an unscoreable row into the engine.
  const projections = windowProjections.filter((row) => playersMap.has(row.playerId));

  // Accuracy is read for every projected id rather than only the resolved
  // ones, because it runs concurrently with the resolve that would narrow it.
  // Trimming it afterwards keeps the assembled payload the same size it was.
  const accuracy = accuracyEntries.filter(([playerId]) => playersMap.has(playerId));

  return {
    players: resolved.players,
    projections,
    accuracy,
    defense: defenseEntries,
    defenseSeasons,
  };
}

/**
 * The universe, read straight from Postgres with no data cache at any level.
 *
 * Exported so lib/positional-war/load.test.ts can assert that it and the
 * cached path produce identical output, and so a parity script can compare the
 * two. Real callers use loadWarUniverse.
 */
export async function loadWarUniverseUncached(
  params: WarUniverseParams,
): Promise<SerializedWarUniverse> {
  const supabase = createCachedReadClient();
  return assembleUniverse(supabase, params, directReaders(supabase, params.source));
}

/**
 * The full projectable universe for one (season, week window, scoring base),
 * assembled from sliced cache entries that are shared across every league.
 *
 * Week slices are shared across week windows and scoring bases too, so a
 * league asking for weeks 9 to 17 reuses the same nine entries a league asking
 * for weeks 1 to 17 already populated.
 */
export async function loadWarUniverse(params: WarUniverseParams): Promise<WarUniverse> {
  const supabase = createCachedReadClient();
  const serialized = await assembleUniverse(
    supabase,
    params,
    cachedReaders(supabase, params.source),
  );

  // Rebuild the Maps every call. See the module header: nothing stored is ever
  // a Map, only ever the tuple arrays it round-trips through JSON as.
  return {
    players: new Map(serialized.players),
    projections: serialized.projections,
    accuracy: new Map(serialized.accuracy),
    defense: new Map(serialized.defense),
    defenseSeasons: serialized.defenseSeasons,
  };
}

/**
 * Whether a thrown error is Next telling us there is no data cache here.
 *
 * Matched on the invariant's own wording rather than on an error class,
 * because Next throws a plain Error for it. Kept narrow on purpose: widening
 * this to "any error" would turn a failed read into a silent second read.
 */
export function isMissingIncrementalCache(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("incrementalCache") || message.includes("incremental cache");
}

/** An ISO timestamp with minutes, seconds and milliseconds zeroed. */
export function truncateToHour(iso: string): string {
  const d = new Date(iso);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

/**
 * max(updated_at) of player_weekly_projections for (season, regular, week >=
 * fromWeek), truncated to the hour and returned as an ISO string, or null when
 * there are no rows. Feeds warFingerprint()'s projectionsSnapshot field, so a
 * fresh sync changes the fingerprint and every league recomputes on next view.
 *
 * Truncated to the hour so a sync still mid-flight (new rows landing minute by
 * minute) does not mint a distinct fingerprint on every request; a recompute
 * mid-sync would be no more current than one an hour later, just more
 * frequent.
 *
 * Deliberately NOT memoized, unlike loadWarUniverse above. This is the read
 * that detects a fresh sync in the first place; caching it would cache away
 * the exact signal it exists to produce. It is a single ordered-and-limited
 * read against an indexed column, not a full table scan, so it is cheap enough
 * to run on every request that needs it.
 */
export async function loadProjectionsSnapshot(params: {
  season: number;
  fromWeek: number;
  /** Scoped to the source the curve will actually be built from. */
  source: string;
}): Promise<string | null> {
  const supabase = createCachedReadClient();
  const { data, error } = await supabase
    .from("player_weekly_projections")
    .select("updated_at")
    .eq("season", params.season)
    .eq("season_type", "regular")
    .eq("source", params.source)
    .gte("week", params.fromWeek)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) {
    throw new Error(`positional war projections snapshot failed: ${error.message}`);
  }
  const row = data?.[0];
  if (!row?.updated_at) return null;
  return truncateToHour(row.updated_at);
}

/**
 * max(computed_at) of player_projection_accuracy, truncated to the hour, or the
 * empty string when the table is empty. Feeds warFingerprint()'s
 * accuracySnapshot field.
 *
 * An empty string rather than null, because unlike the projections an empty
 * reliability table is a perfectly computable state: every player simply scores
 * a neutral 1.0 multiplier. A missing projections table means there is nothing
 * to compute at all, which is why that one returns null and skips the league.
 *
 * Not filtered by season or scoring base. The table is rebuilt wholesale
 * (lib/calculate-projection-accuracy.ts deletes and reinserts every row in one
 * run), so one timestamp describes all of it and a narrower filter would only
 * cost an index that does not exist.
 *
 * Not memoized, for the same reason loadProjectionsSnapshot is not: this is the
 * read that detects the rebuild.
 */
export async function loadAccuracySnapshot(): Promise<string> {
  const supabase = createCachedReadClient();
  const { data, error } = await supabase
    .from("player_projection_accuracy")
    .select("computed_at")
    .order("computed_at", { ascending: false })
    .limit(1);
  if (error) {
    throw new Error(`positional war accuracy snapshot failed: ${error.message}`);
  }
  const row = data?.[0];
  if (!row?.computed_at) return "";
  return truncateToHour(row.computed_at);
}

/**
 * Assemble WarPlayerInput rows from the universe: run projectPlayerWeek() once
 * per player per week in the window, unchanged from what Power Pulse uses.
 *
 * Reliability is computed once per player, outside the week loop, matching how
 * lib/power-pulse/engine.ts and lib/faab/marginal.ts already do it (see
 * engine.ts's `enriched` pass). It depends only on the player's accuracy row
 * and the settings, neither of which varies by week.
 *
 * A null return from projectPlayerWeek is a bye or an unpublished week and the
 * week is left absent from byWeek entirely. It is never stored as a zero: a
 * zero would drag that player's average down every bye and would sum into a
 * season total somebody believes is real. A player with no projectable week at
 * all is excluded from the returned array outright, matching the same rule.
 */
export function buildWarPlayers(params: {
  universe: WarUniverse;
  scoringSettings: ScoringSettings | null;
  settings: PowerPulseSettings;
  weeks: number[];
  currentWeek: number;
}): WarPlayerInput[] {
  const { universe, scoringSettings, settings, weeks, currentWeek } = params;

  const projectionsByPlayer = new Map<string, Map<number, ProjectionRow>>();
  for (const row of universe.projections) {
    let byWeek = projectionsByPlayer.get(row.playerId);
    if (!byWeek) {
      byWeek = new Map<number, ProjectionRow>();
      projectionsByPlayer.set(row.playerId, byWeek);
    }
    byWeek.set(row.week, row);
  }

  const out: WarPlayerInput[] = [];

  for (const player of universe.players.values()) {
    const playerProjections = projectionsByPlayer.get(player.playerId);
    if (!playerProjections) continue;

    const accuracy = universe.accuracy.get(player.playerId) ?? null;
    const reliability = reliabilityMultiplier(accuracy, settings);

    const byWeek = new Map<number, { points: number; sigma: number }>();
    for (const week of weeks) {
      const projected = projectPlayerWeek({
        projection: playerProjections.get(week),
        subject: { position: player.position, injuryStatus: player.injuryStatus },
        accuracy,
        reliability,
        scoringSettings,
        defense: universe.defense,
        defenseSeasons: universe.defenseSeasons,
        week,
        currentWeek,
        settings,
      });
      if (projected === null) continue;
      byWeek.set(week, { points: projected.points, sigma: projected.sigma });
    }

    if (byWeek.size === 0) continue;

    out.push({
      playerId: player.playerId,
      sleeperId: player.sleeperId,
      slug: player.slug,
      name: player.name,
      team: player.team,
      position: player.position,
      injuryStatus: player.injuryStatus,
      byWeek,
    });
  }

  return out;
}
