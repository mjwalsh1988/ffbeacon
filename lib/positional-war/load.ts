/**
 * The cached full-universe projection read behind Positional WAR.
 *
 * Positional WAR does not evaluate one league's rosters. It evaluates every
 * player the league could theoretically start, whether owned or not, which
 * means the read is roughly three times as wide as Power Pulse's (about 1,083
 * players against roughly 350) and, critically, IDENTICAL for every league in
 * the same season and week window. Two twelve-team leagues both asking for
 * (2026, week 5 through week 17, pts_ppr) get the exact same universe, so the
 * read is memoized once per (season, fromWeek, toWeek, scoringBase) rather than
 * re-run per league. See docs/league-pulse-positional-war-plan.md section 12.
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
 * a ~10.2s cold compute. The projection scan now walks each week
 * independently (weeks share no cursor) and its completeness count runs
 * alongside the walks rather than ahead of them, and the player-resolve
 * chunks, the accuracy read and the defense read all run concurrently. Both
 * concurrent loops are capped at DB_CHUNK_CONCURRENCY in-flight requests,
 * imported from lib/power-pulse/load.ts rather than redefined here, so both
 * files share one cap and one mental model of how much of the connection pool
 * a cold compute is allowed to use at once. Only the inherently sequential
 * parts (a single page depending on the previous page's cursor) stay
 * sequential.
 *
 * The Map-in-cache trap: unstable_cache serializes its return value to JSON
 * to store it, and a JS Map serializes to "{}". So the function actually
 * wrapped in unstable_cache (loadWarUniverseUncached) returns a plain,
 * JSON-round-trippable shape: arrays of [key, value] tuples instead of Maps.
 * The exported loadWarUniverse() rebuilds the Maps AFTER the cached read
 * returns, every time, whether that read was a cache hit or a miss. Getting
 * this backwards (rebuilding once and letting the cache remember Maps) would
 * make every cache hit come back as three empty Maps and zero every projection
 * in every league until the tag was busted or the TTL expired.
 */

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

/** The JSON-serializable shape actually stored in the Next data cache. */
type SerializedWarUniverse = {
  players: [string, WarUniversePlayer][];
  projections: ProjectionRow[];
  accuracy: [string, AccuracyRow][];
  defense: [string, DefenseRow][];
  defenseSeasons: number[];
};

/** The columns one projection row needs, shared by the walk and its count. */
const PROJECTION_COLUMNS =
  "id, player_id, week, opponent, stat_line, projected_pts_ppr, projected_pts_half_ppr, projected_pts_std, availability, injury_status";

/**
 * One week's keyset walk over the full projection rows.
 *
 * The walk itself is inherently sequential (each page needs the previous
 * page's last id), but weeks have no cross-week dependency, so the caller runs
 * many of these concurrently instead of running one long walk across the whole
 * window. A per-week walk is also simply shorter: about 18,413 rows over an
 * 18-week season averages a little over a thousand a week, so most weeks
 * finish in one or two round trips instead of contributing to a
 * ~20-round-trip chain.
 *
 * PAGE stays at 1000 and must not be raised. PostgREST caps this project at
 * 1000 rows per response, so a larger `limit` silently returns 1000 anyway,
 * and the `data.length < PAGE` stop condition would then read that full page
 * as a short final page and end the walk early. Measured against production:
 * asking for 2000 returns 12,623 of 13,064 rows. The count guard below catches
 * it, which is what the guard is for, but the right move is not to ask.
 */
async function loadProjectionWeek(
  supabase: ServiceClient,
  season: number,
  week: number,
): Promise<ProjectionRow[]> {
  const out: ProjectionRow[] = [];
  let cursor: string | null = null;
  for (;;) {
    let q = supabase
      .from("player_weekly_projections")
      .select(PROJECTION_COLUMNS)
      .eq("season", season)
      .eq("season_type", "regular")
      .eq("week", week)
      .order("id", { ascending: true })
      .limit(PAGE);
    if (cursor !== null) q = q.gt("id", cursor);
    const { data, error } = await q;
    if (error) throw new Error(`positional war universe load failed: ${error.message}`);
    if (!data || data.length === 0) break;
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
  return out;
}

/**
 * Every regular season projection row in the window, plus the distinct player
 * ids they cover.
 *
 * This is the read that used to be two reads. The completeness guard is
 * unchanged in substance: it still compares what was actually read against an
 * exact count over the WHOLE window, so a short read in one week cannot hide
 * behind a complete read in another. What changed is that the count now runs
 * ALONGSIDE the walks instead of ahead of them, because nothing in the walk
 * depends on it; only the assertion afterwards does.
 *
 * A short read would silently shrink the universe, which silently raises every
 * position's replacement level: a plausible-looking wrong answer rather than a
 * failed one. The guard turns it into the latter.
 *
 * `readCount` is what the guard compares, not `rows.length`. A row whose
 * player_id is null is a row the query matched and this function declines to
 * keep, and counting it as missing would fail an otherwise complete read.
 */
async function loadWindowProjections(
  supabase: ServiceClient,
  season: number,
  fromWeek: number,
  toWeek: number,
): Promise<{ rows: ProjectionRow[]; playerIds: string[] }> {
  const weeks: number[] = [];
  for (let w = fromWeek; w <= toWeek; w++) weeks.push(w);

  const [perWeek, countResult] = await Promise.all([
    mapWithConcurrency(weeks, DB_CHUNK_CONCURRENCY, (week) =>
      loadProjectionWeek(supabase, season, week),
    ),
    supabase
      .from("player_weekly_projections")
      .select("id", { count: "exact", head: true })
      .eq("season", season)
      .eq("season_type", "regular")
      .gte("week", fromWeek)
      .lte("week", toWeek),
  ]);

  if (countResult.error) {
    throw new Error(`positional war universe count failed: ${countResult.error.message}`);
  }

  const rows: ProjectionRow[] = [];
  const ids = new Set<string>();
  for (const week of perWeek) {
    for (const row of week) {
      rows.push(row);
      ids.add(row.playerId);
    }
  }

  const expected = countResult.count;
  if (expected != null && rows.length < expected) {
    throw new Error(
      `positional war universe load incomplete: read ${rows.length} of ${expected} projection rows`,
    );
  }

  return { rows, playerIds: [...ids] };
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
 */
async function resolveUniversePlayers(
  supabase: ServiceClient,
  playerIds: string[],
): Promise<Map<string, WarUniversePlayer>> {
  const out = new Map<string, WarUniversePlayer>();
  if (playerIds.length === 0) return out;

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

  return out;
}

/**
 * The uncached body wrapped in unstable_cache below. Kept as a plain function
 * (rather than inline) so the query shape is readable and so the serialization
 * boundary in loadWarUniverse() is the only place a Map ever crosses the cache.
 *
 * Exported (only) so lib/positional-war/load.test.ts can assert the JSON
 * round trip on the exact shape the Next data cache stores, without reaching
 * into unstable_cache's internals. Real callers use loadWarUniverse.
 */
export async function loadWarUniverseUncached(params: {
  season: number;
  fromWeek: number;
  toWeek: number;
  scoringBase: ScoringBase;
}): Promise<SerializedWarUniverse> {
  const { season, fromWeek, toWeek, scoringBase } = params;
  const supabase = createCachedReadClient();
  const defenseSeasons = [season - 1, season - 2];

  // One pass over the window. Everything after it depends on the player ids
  // this returns, so it is the only phase that has to happen first.
  const { rows: windowProjections, playerIds: projectedIds } = await loadWindowProjections(
    supabase,
    season,
    fromWeek,
    toWeek,
  );

  const [playersMap, accuracy, defense] = await Promise.all([
    resolveUniversePlayers(supabase, projectedIds),
    loadAccuracy(supabase, projectedIds, scoringBase),
    loadDefenseSplits(supabase, scoringBase, defenseSeasons),
  ]);

  // resolveUniversePlayers drops anyone outside PULSE_POSITIONS, so the rows
  // are narrowed to the resolved players here rather than by a second query.
  // This keeps `projections` exactly the set the previous id-filtered read
  // returned. Today every projected player is already a pulse position, so
  // this drops nothing; it stays because a future source that publishes an
  // IDP projection must not put an unscoreable row into the engine.
  const projections = windowProjections.filter((row) => playersMap.has(row.playerId));

  // Accuracy is read for every projected id rather than only the resolved
  // ones, because it runs concurrently with the resolve that would narrow it.
  // Trimming it afterwards keeps the cached payload the same size it was.
  for (const playerId of accuracy.keys()) {
    if (!playersMap.has(playerId)) accuracy.delete(playerId);
  }

  return {
    players: [...playersMap.entries()],
    projections,
    accuracy: [...accuracy.entries()],
    defense: [...defense.entries()],
    defenseSeasons,
  };
}

/**
 * The full projectable universe for one (season, week window, scoring base),
 * memoized across every league that shares those four values. TTL matches the
 * data's real refresh cadence (nightly), tagged so a projections sync can bust
 * it directly.
 *
 * WHY THERE IS A FALLBACK. `unstable_cache` needs a Next.js incremental cache,
 * which exists during a request and does not exist in a plain node process. So
 * `npm run calculate:positional-war` threw
 * "Invariant: incrementalCache missing in unstable_cache" before it read a
 * single row, and the standalone recompute path was unusable. The memoization
 * is a performance optimization, not a correctness requirement: the uncached
 * read returns exactly the same universe, and a script recomputing every league
 * in one pass has no second reader to share a cache entry with anyway.
 *
 * The catch is deliberately narrow. Only the missing-cache invariant falls
 * through; every other failure (a short paged read, a query error) still
 * throws, because those are the failures that would otherwise shrink the
 * universe and silently raise every replacement level.
 */
export async function loadWarUniverse(params: {
  season: number;
  fromWeek: number;
  toWeek: number;
  scoringBase: ScoringBase;
}): Promise<WarUniverse> {
  let serialized: SerializedWarUniverse;
  try {
    serialized = await unstable_cache(
      () => loadWarUniverseUncached(params),
      [
        "positional-war-universe",
        String(params.season),
        String(params.fromWeek),
        String(params.toWeek),
        params.scoringBase,
      ],
      { revalidate: CACHE_TTL.daily, tags: [CACHE_TAGS.playerProjections] },
    )();
  } catch (err) {
    if (!isMissingIncrementalCache(err)) throw err;
    serialized = await loadWarUniverseUncached(params);
  }

  // Rebuild the Maps every call. See the module header: the cached value is
  // never a Map, only ever the tuple arrays it round-trips through JSON as.
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
}): Promise<string | null> {
  const supabase = createCachedReadClient();
  const { data, error } = await supabase
    .from("player_weekly_projections")
    .select("updated_at")
    .eq("season", params.season)
    .eq("season_type", "regular")
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
