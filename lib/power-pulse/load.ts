/**
 * Data loading for the Power Pulse engine.
 *
 * Everything the engine needs for one league, fetched in as few round trips as
 * the shape allows. Kept separate from the math so the engine stays testable
 * against plain objects.
 *
 * Pagination note: Supabase silently truncates a select at 1000 rows. A twelve
 * team league can roster 350 players across 18 weeks of projections, which is
 * well past that, so every multi-row read here pages explicitly.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import type { ScoringSettings } from "@/lib/league-scoring";
import { SLEEPER_SOURCE } from "@/lib/projections/source-constants";
import type { PulsePosition, ScheduleWeek } from "./types";
import { PULSE_POSITIONS } from "./types";

type ServiceClient = SupabaseClient<Database>;

const PAGE = 1000;

/**
 * Cap on simultaneous chunk reads for the concurrent loops below (and the
 * ones in lib/positional-war/load.ts, which imports this helper rather than
 * duplicating it). A cold Positional WAR compute alone fires 6 to 8 chunks
 * across a handful of these loops; running all of them at once would let one
 * request saturate the Supabase connection pool for every other request this
 * instance is serving. 5 is comfortably below that ceiling while still
 * cutting wall-clock time by roughly a factor of 5 versus the fully
 * sequential walk it replaces.
 */
export const DB_CHUNK_CONCURRENCY = 5;

/**
 * Runs `fn` over `items` with at most `limit` calls in flight at once,
 * preserving result order (out[i] corresponds to items[i]) regardless of
 * which call finishes first. Used for independent chunk reads only: a walk
 * where one page's query depends on the previous page's cursor must stay a
 * plain sequential loop, never this.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return out;
}

export type LeagueRow = {
  id: string;
  sleeperLeagueId: string;
  name: string;
  season: number;
  status: string | null;
  rosterPositions: string[];
  scoringSettings: ScoringSettings;
  playoffTeams: number;
  playoffWeekStart: number;
  /**
   * Sleeper's playoff_round_type. 0 is one week per round, 1 is two weeks for
   * every round, 2 is two weeks for the championship round only. It changes who
   * wins, not just how long it takes: a two-week round sums two draws, which
   * cuts the spread by about 30 percent and hands the better team a real edge
   * that a single week does not.
   */
  playoffRoundType: number;
};

export type RosterRow = {
  id: string;
  sleeperRosterId: number;
  playerSleeperIds: string[];
  starterSleeperIds: string[];
  reserveSleeperIds: string[];
  taxiSleeperIds: string[];
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  teamName: string;
  /**
   * The Sleeper user who owns this roster, and their avatar id. `teamName`
   * alone used to be the whole identity here, which forced every caller that
   * shows a face or an @handle (the Schedule matchup page, the matchup share
   * card) to re-read `rosters` and `league_users` for two columns this query
   * had already joined. Both are one extra column on reads that happen anyway.
   */
  ownerUserId: string | null;
  ownerHandle: string | null;
  ownerAvatarId: string | null;
};

export type PlayerRow = {
  playerId: string;
  sleeperId: string;
  name: string;
  position: PulsePosition;
  team: string | null;
  injuryStatus: string | null;
  depthOrder: number | null;
};

export type ProjectionRow = {
  playerId: string;
  week: number;
  opponent: string | null;
  statLine: Record<string, unknown> | null;
  ppr: number | null;
  halfPpr: number | null;
  std: number | null;
  /**
   * Why this row holds the number it holds. "projected" means Sleeper published
   * points with any injury already priced in; "out" means Sleeper scheduled the
   * player a game and published nothing, so the stored zero is a real answer.
   * Optional so a caller constructing rows by hand keeps the old, more
   * conservative behaviour: an absent value is treated as "nobody priced this
   * in", and our own injury discount still applies.
   */
  availability?: string | null;
  /** Sleeper's designation captured on this row at sync time. Null when healthy. */
  injuryStatus?: string | null;
};

export type AccuracyRow = {
  playerId: string;
  shrunkMultiplier: number | null;
  beatRate: number | null;
  availabilityRate: number | null;
  ratioStdev: number | null;
  weeksPlayed: number;
};

export type DefenseRow = {
  team: string;
  season: number;
  position: PulsePosition;
  /** Raw audit-trail value. Never change what this means; read the adjusted or shrunk figure instead. */
  multiplier: number;
  /** Opponent-adjusted for the schedule the defense actually faced. Null until the defense-splits calc has re-run since migration 0237. */
  adjustedMultiplier: number | null;
  /** The adjusted multiplier, pulled toward 1.0 by the position's measured signal and by sample size. Null under the same condition as adjustedMultiplier. */
  shrunkMultiplier: number | null;
  gamesSampled: number;
};

function asStringArray(value: Json | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is string => typeof v === "string" && v.length > 0 && v !== "0",
  );
}

function intOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * A positive integer, or null.
 *
 * Sleeper writes `playoff_week_start: 0` and omits `playoff_teams` on leagues
 * whose bracket has not been configured, and zero is a value `intOrNull`
 * happily returns, so `?? default` never fired and the league inherited a
 * playoff week of 0. Everything downstream reads that as "the regular season
 * ended before week 1": no weeks get projected, the remaining slate comes back
 * empty, and the league is written off as having no games left rather than
 * scored. Anything at or below zero is an unset field, not a real week.
 */
function positiveIntOrNull(v: unknown): number | null {
  const n = intOrNull(v);
  return n !== null && n > 0 ? n : null;
}

/**
 * Exported so lib/positional-war/load.ts builds its ProjectionRow objects from
 * the exact same coercion this file's own reader uses. Two copies of "what
 * counts as a number here" reading the same table is one copy too many.
 */
export function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Load the league, including the playoff shape the simulation needs. */
export async function loadLeague(
  supabase: ServiceClient,
  leagueRowId: string,
): Promise<LeagueRow | null> {
  const { data, error } = await supabase
    .from("leagues")
    .select(
      "id, sleeper_league_id, name, season, status, roster_positions, scoring_settings, metadata",
    )
    .eq("id", leagueRowId)
    .maybeSingle();
  if (error || !data) return null;

  const meta = (data.metadata ?? {}) as { settings?: Record<string, unknown> };
  const settings = meta.settings ?? {};

  return {
    id: data.id,
    sleeperLeagueId: data.sleeper_league_id,
    name: data.name,
    season: Number(data.season),
    status: data.status,
    rosterPositions: asStringArray(data.roster_positions),
    scoringSettings: (data.scoring_settings ?? {}) as ScoringSettings,
    // Sleeper defaults: a six-team field starting in week 15.
    playoffTeams: positiveIntOrNull(settings.playoff_teams) ?? 6,
    playoffWeekStart: positiveIntOrNull(settings.playoff_week_start) ?? 15,
    // Zero is a real value here (one week per round) rather than an absent one,
    // so intOrNull, not positiveIntOrNull.
    playoffRoundType: intOrNull(settings.playoff_round_type) ?? 0,
  };
}

export async function loadRosters(
  supabase: ServiceClient,
  leagueRowId: string,
): Promise<RosterRow[]> {
  const [rostersRes, usersRes] = await Promise.all([
    supabase
      .from("rosters")
      .select(
        "id, sleeper_roster_id, owner_user_id, player_ids, starter_ids, reserve_ids, taxi_ids, wins, losses, ties, points_for",
      )
      .eq("league_id", leagueRowId)
      .order("sleeper_roster_id", { ascending: true }),
    supabase
      .from("league_users")
      .select("sleeper_user_id, display_name, team_name, avatar")
      .eq("league_id", leagueRowId),
  ]);

  const usersById = new Map(
    (usersRes.data ?? []).map((u) => [u.sleeper_user_id, u]),
  );

  return (rostersRes.data ?? []).map((r) => {
    const user = r.owner_user_id ? usersById.get(r.owner_user_id) : null;
    return {
      id: r.id,
      sleeperRosterId: r.sleeper_roster_id,
      playerSleeperIds: asStringArray(r.player_ids),
      starterSleeperIds: asStringArray(r.starter_ids),
      reserveSleeperIds: asStringArray(r.reserve_ids),
      taxiSleeperIds: asStringArray(r.taxi_ids),
      wins: Number(r.wins ?? 0),
      losses: Number(r.losses ?? 0),
      ties: Number(r.ties ?? 0),
      pointsFor: Number(r.points_for ?? 0),
      teamName:
        user?.team_name || user?.display_name || `Team ${r.sleeper_roster_id}`,
      ownerUserId: r.owner_user_id ?? null,
      ownerHandle: user?.display_name ?? null,
      ownerAvatarId: user?.avatar ?? null,
    };
  });
}

/**
 * Resolve Sleeper ids to FF Beacon players, carrying the injury and depth chart
 * signals that live in players.metadata.sleeper.
 *
 * Matching mirrors lib/league-view-data.ts: external_ids.sleeper first, with a
 * slug-tail fallback for rows whose external id was stripped.
 */
export async function loadPlayers(
  supabase: ServiceClient,
  sleeperIds: string[],
): Promise<Map<string, PlayerRow>> {
  const out = new Map<string, PlayerRow>();
  if (sleeperIds.length === 0) return out;

  const valid = new Set<string>(PULSE_POSITIONS);

  // PostgREST `.or()` takes a comma-separated filter string, so an id carrying a
  // comma or a parenthesis would rewrite the filter rather than be matched by
  // it. Real Sleeper ids are numeric strings for players and team codes like
  // "BUF" for defenses, so anything outside that alphabet is dropped before it
  // reaches the query.
  const safeIds = sleeperIds.filter((id) => /^[A-Za-z0-9]{1,32}$/.test(id));
  if (safeIds.length === 0) return out;

  const SELECT =
    "id, slug, first_name, last_name, full_name, position, team, external_ids, metadata";

  /** One row as the two queries below return it. */
  type PlayerQueryRow = {
    id: string;
    slug: string;
    first_name: string | null;
    last_name: string | null;
    full_name: string | null;
    position: string | null;
    team: string | null;
    external_ids: unknown;
    metadata: unknown;
  };

  // THE INDEXED LOOKUP FIRST, IN CHUNKS, THEN ONE SLUG FALLBACK FOR WHATEVER IS
  // STILL MISSING.
  //
  // This used to be a single `.or()` per chunk pairing the equality with
  // `slug.like.*-{id}`. A leading-wildcard LIKE cannot use an index, and ONE
  // unindexable branch in an OR forces a sequential scan for the whole
  // predicate: measured on production, a 200-id chunk scanned all of `players`,
  // discarded 2,095,800 join-filter rows and took 398ms. The same 200 ids
  // through idx_players_external_sleeper take 11.8ms. Power Pulse, Positional
  // WAR and the Manager Ledger all make this read.
  //
  // The slug fallback is kept rather than deleted: the slug tail is a real
  // recovery path for a row whose external id was stripped, and removing it
  // would change behaviour rather than just its cost. It now runs ONCE for the
  // union of everything the indexed passes missed, instead of once per chunk,
  // so a league needing it pays one scan and a league that does not pays none.
  // On the current corpus it never fires: all 10,480 player rows carry
  // external_ids->>'sleeper'.
  const CHUNK = 200;
  const rows: PlayerQueryRow[] = [];
  const resolved = new Set<string>();

  for (let i = 0; i < safeIds.length; i += CHUNK) {
    const chunk = safeIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("players")
      .select(SELECT)
      .in("external_ids->>sleeper", chunk);
    if (error)
      throw new Error(`power pulse player resolve failed: ${error.message}`);
    for (const p of data ?? []) {
      rows.push(p as PlayerQueryRow);
      const ext = (p.external_ids as Record<string, unknown>) ?? {};
      if (typeof ext.sleeper === "string") resolved.add(ext.sleeper);
    }
  }

  const missing = safeIds.filter((id) => !resolved.has(id));
  if (missing.length > 0) {
    for (let i = 0; i < missing.length; i += CHUNK) {
      const ors = missing
        .slice(i, i + CHUNK)
        .map((id) => `slug.like.*-${id}`)
        .join(",");
      const { data, error } = await supabase
        .from("players")
        .select(SELECT)
        .or(ors);
      if (error)
        throw new Error(`power pulse player resolve failed: ${error.message}`);
      for (const p of data ?? []) rows.push(p as PlayerQueryRow);
    }
  }

  const wanted = new Set(safeIds);
  {
    for (const p of rows) {
      const ext = (p.external_ids as Record<string, unknown>) ?? {};
      const fromExternal = typeof ext.sleeper === "string" ? ext.sleeper : null;
      const tail = (p.slug as string).match(/-(\d+)$/)?.[1] ?? null;
      const sid = fromExternal ?? tail;
      if (!sid || !wanted.has(sid) || out.has(sid)) continue;

      const position = (p.position ?? "").toUpperCase();
      if (!valid.has(position)) continue;

      const meta =
        (p.metadata as { sleeper?: Record<string, unknown> } | null)?.sleeper ??
        {};
      out.set(sid, {
        playerId: p.id,
        sleeperId: sid,
        name:
          p.full_name ??
          (`${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || p.slug),
        position: position as PulsePosition,
        team: p.team,
        injuryStatus:
          typeof meta.injury_status === "string" &&
          meta.injury_status.length > 0
            ? meta.injury_status
            : null,
        depthOrder: intOrNull(meta.depth_chart_order),
      });
    }
  }
  return out;
}

/**
 * Weekly projections for a player set from `fromWeek` forward, optionally
 * stopping at `toWeek`. Paged, because a full league easily exceeds the 1000-row
 * default cap.
 *
 * Paging is keyset on the primary key. An offset walk over an unsorted query is
 * not stable, because Postgres may return rows in a different order per
 * request, so rows get skipped and others repeated. Here a skipped row is a
 * player projected at zero for that week, which quietly drags down his team's
 * score, its projected wins, and the playoff odds that follow from them. The
 * count guard turns a short read into a failed run rather than a plausible
 * looking wrong answer.
 *
 * `toWeek` exists for the callers that want ONE week, not the rest of the
 * season. Filtering in JavaScript after the read looks equivalent and is not:
 * the rows still cross the wire, and sixty players times eighteen weeks clears
 * the PAGE cap, so a single-week question pays for a second keyset round trip
 * plus a count over rows nobody will look at. Measured against the live database
 * for one matchup: 306 rows and 261ms without the ceiling, 16 rows and 1.0ms
 * with it. The parameter is optional and omitting it changes nothing about the
 * query, so Power Pulse, FAAB and Trade Ideas keep the exact reads they had.
 */
/**
 * One chunk's worth of loadProjections: its own count guard, then its own
 * keyset walk. Kept as a standalone function so the outer chunk loop below
 * can run chunks concurrently while the walk inside a single chunk (each
 * page depends on the previous page's cursor) stays exactly as sequential as
 * it always was.
 *
 * `source` is optional and, when omitted, changes nothing about the query:
 * every caller written before lib/projections/read.ts existed keeps reading
 * every source's rows for the window, exactly as before. Once ffbeacon rows
 * exist alongside sleeper's, an unfiltered read would return one row per
 * source per player-week, so lib/projections/read.ts always passes one.
 */
async function loadProjectionsChunk(
  supabase: ServiceClient,
  chunk: string[],
  season: number,
  fromWeek: number,
  toWeek?: number,
  source?: string,
): Promise<ProjectionRow[]> {
  const out: ProjectionRow[] = [];

  let countQ = supabase
    .from("player_weekly_projections")
    .select("id", { count: "exact", head: true })
    .eq("season", season)
    .eq("season_type", "regular")
    .gte("week", fromWeek)
    .in("player_id", chunk);
  // The ceiling has to sit on the count as well as the select. The count is
  // what the completeness guard below compares against, so a count over
  // eighteen weeks and a select over one would fail every run.
  if (toWeek !== undefined) countQ = countQ.lte("week", toWeek);
  if (source !== undefined) countQ = countQ.eq("source", source);
  const { count: expected, error: countErr } = await countQ;
  if (countErr) {
    throw new Error(`power pulse projection count failed: ${countErr.message}`);
  }

  let loaded = 0;
  let cursor: string | null = null;
  for (;;) {
    let q = supabase
      .from("player_weekly_projections")
      .select(
        "id, player_id, week, opponent, stat_line, projected_pts_ppr, projected_pts_half_ppr, projected_pts_std, availability, injury_status",
      )
      .eq("season", season)
      .eq("season_type", "regular")
      .gte("week", fromWeek)
      .in("player_id", chunk)
      .order("id", { ascending: true })
      .limit(PAGE);
    if (toWeek !== undefined) q = q.lte("week", toWeek);
    if (source !== undefined) q = q.eq("source", source);
    if (cursor !== null) q = q.gt("id", cursor);
    const { data, error } = await q;
    if (error)
      throw new Error(`power pulse projection load failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      if (!row.player_id) continue;
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
    loaded += data.length;
    cursor = data[data.length - 1].id;
    if (data.length < PAGE) break;
  }

  if (expected != null && loaded < expected) {
    throw new Error(
      `power pulse projection load incomplete: read ${loaded} of ${expected} rows for ${chunk.length} players`,
    );
  }
  return out;
}

/**
 * `source` is optional. Omitted, this reads every source's rows for the
 * window, unchanged from before lib/projections/read.ts existed: Power
 * Pulse, FAAB, Positional WAR and every other existing caller keep calling
 * this with four arguments and keep the exact behaviour they always had.
 * lib/projections/read.ts is the one caller that passes a fifth, because it
 * has already resolved which single source a reader should see.
 */
export async function loadProjections(
  supabase: ServiceClient,
  playerIds: string[],
  season: number,
  fromWeek: number,
  toWeek?: number,
  source?: string,
): Promise<ProjectionRow[]> {
  if (playerIds.length === 0) return [];

  const CHUNK = 150;
  const chunks: string[][] = [];
  for (let i = 0; i < playerIds.length; i += CHUNK) {
    chunks.push(playerIds.slice(i, i + CHUNK));
  }

  // Chunks are independent player-id partitions of the same query shape, so
  // they run concurrently (capped) instead of one after another. Each chunk
  // keeps its own count-then-page walk unchanged, including its own guard,
  // so a short read in one chunk still fails the whole call exactly as
  // before; only the wall-clock ordering across chunks has changed.
  const perChunk = await mapWithConcurrency(
    chunks,
    DB_CHUNK_CONCURRENCY,
    (chunk) => loadProjectionsChunk(supabase, chunk, season, fromWeek, toWeek, source),
  );
  return perChunk.flat();
}

/**
 * Blended, recency-weighted reliability rows for one scoring base, scoped to
 * one projection source.
 *
 * Migration 0240 re-keyed `player_projection_accuracy`'s unique indexes to
 * include `source` for exactly this reason: a multiplier measured against
 * Sleeper's projection is only meaningful applied to Sleeper's projection, and
 * once a `source='ffbeacon'` blended row exists for a player (the first time a
 * played week gets graded), an unfiltered query can return BOTH rows with no
 * ORDER BY, and whichever came back last would silently win. `source` filters
 * that out at the query rather than leaving it to insertion order.
 *
 * Defaults to SLEEPER_SOURCE so every caller written before this parameter
 * existed keeps exactly the behaviour it always had. lib/projections/read.ts
 * is the one caller that passes the source it actually resolved, because a
 * reader on the ffbeacon source needs reliability measured against ffbeacon,
 * not against Sleeper.
 */
export async function loadAccuracy(
  supabase: ServiceClient,
  playerIds: string[],
  scoring: string,
  source: string = SLEEPER_SOURCE,
): Promise<Map<string, AccuracyRow>> {
  const out = new Map<string, AccuracyRow>();
  if (playerIds.length === 0) return out;

  const CHUNK = 300;
  const chunks: string[][] = [];
  for (let i = 0; i < playerIds.length; i += CHUNK) {
    chunks.push(playerIds.slice(i, i + CHUNK));
  }

  // Independent id partitions of one query shape, so they run concurrently
  // (capped) rather than one after another, matching loadProjections above.
  // Positional WAR asks this for 1,083 players, four chunks deep, and paid
  // four serial round trips for what is one wave.
  const perChunk = await mapWithConcurrency(
    chunks,
    DB_CHUNK_CONCURRENCY,
    async (chunk) => {
      const { data, error } = await supabase
        .from("player_projection_accuracy")
        .select(
          "player_id, shrunk_multiplier, beat_rate, availability_rate, ratio_stdev, weeks_played",
        )
        .eq("scoring", scoring)
        .eq("source", source)
        .is("season", null)
        .in("player_id", chunk);
      if (error)
        throw new Error(`power pulse accuracy load failed: ${error.message}`);
      return data ?? [];
    },
  );

  for (const data of perChunk) {
    for (const row of data) {
      out.set(row.player_id, {
        playerId: row.player_id,
        shrunkMultiplier: numOrNull(row.shrunk_multiplier),
        beatRate: numOrNull(row.beat_rate),
        availabilityRate: numOrNull(row.availability_rate),
        ratioStdev: numOrNull(row.ratio_stdev),
        weeksPlayed: Number(row.weeks_played ?? 0),
      });
    }
  }
  return out;
}

/**
 * Opponent-strength splits for whichever candidate seasons the caller passes
 * (see lib/projections/defense-seasons.ts). opponentMultiplier in ./project.ts
 * walks them most recent first and blends the first two that actually have a
 * usable row, weighting the more recent one more heavily.
 */
export async function loadDefenseSplits(
  supabase: ServiceClient,
  scoring: string,
  seasons: number[],
): Promise<Map<string, DefenseRow>> {
  const out = new Map<string, DefenseRow>();
  if (seasons.length === 0) return out;

  const { data, error } = await supabase
    .from("nfl_defense_vs_position")
    .select(
      "team, season, position, multiplier, adjusted_multiplier, shrunk_multiplier, games_sampled",
    )
    .eq("scoring", scoring)
    .in("season", seasons);
  if (error)
    throw new Error(`power pulse defense split load failed: ${error.message}`);

  for (const row of data ?? []) {
    out.set(`${row.team}|${row.season}|${row.position}`, {
      team: row.team,
      season: Number(row.season),
      position: row.position as PulsePosition,
      multiplier: Number(row.multiplier),
      adjustedMultiplier: numOrNull(row.adjusted_multiplier),
      shrunkMultiplier: numOrNull(row.shrunk_multiplier),
      gamesSampled: Number(row.games_sampled ?? 0),
    });
  }
  return out;
}

/** The head-to-head slate, plus the set lineup Sleeper has on file per week. */
export async function loadSchedule(
  supabase: ServiceClient,
  leagueRowId: string,
  season: number,
): Promise<{
  weeks: ScheduleWeek[];
  setLineups: Map<string, string[]>;
}> {
  const { data, error } = await supabase
    .from("league_matchups")
    .select("week, sleeper_roster_id, matchup_id, is_final, starter_ids")
    .eq("league_id", leagueRowId)
    .eq("season", season)
    .order("week", { ascending: true });
  if (error)
    throw new Error(`power pulse schedule load failed: ${error.message}`);

  const byWeek = new Map<
    number,
    { matchups: Map<number, number[]>; isFinal: boolean }
  >();
  const setLineups = new Map<string, string[]>();

  for (const row of data ?? []) {
    const week = Number(row.week);
    const rosterId = Number(row.sleeper_roster_id);
    setLineups.set(`${week}|${rosterId}`, asStringArray(row.starter_ids));

    if (row.matchup_id === null || row.matchup_id === undefined) continue;
    const entry = byWeek.get(week) ?? {
      matchups: new Map<number, number[]>(),
      isFinal: false,
    };
    const list = entry.matchups.get(Number(row.matchup_id)) ?? [];
    list.push(rosterId);
    entry.matchups.set(Number(row.matchup_id), list);
    entry.isFinal = entry.isFinal || Boolean(row.is_final);
    byWeek.set(week, entry);
  }

  const weeks: ScheduleWeek[] = [];
  for (const [week, entry] of [...byWeek.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    const opponents = new Map<number, number>();
    for (const pair of entry.matchups.values()) {
      if (pair.length !== 2) continue;
      opponents.set(pair[0], pair[1]);
      opponents.set(pair[1], pair[0]);
    }
    weeks.push({ week, opponents, isFinal: entry.isFinal });
  }
  return { weeks, setLineups };
}

/**
 * Actual weekly results for the current season, used by the form component.
 * Reads points straight off league_matchups so it reflects the league's own
 * scoring exactly, with no re-derivation.
 */
export async function loadCompletedResults(
  supabase: ServiceClient,
  leagueRowId: string,
  season: number,
): Promise<Map<number, { week: number; points: number }[]>> {
  const out = new Map<number, { week: number; points: number }[]>();
  const { data, error } = await supabase
    .from("league_matchups")
    .select("week, sleeper_roster_id, points, is_final")
    .eq("league_id", leagueRowId)
    .eq("season", season)
    .eq("is_final", true)
    .order("week", { ascending: true });
  if (error) return out;
  for (const row of data ?? []) {
    const rosterId = Number(row.sleeper_roster_id);
    const list = out.get(rosterId) ?? [];
    list.push({ week: Number(row.week), points: Number(row.points ?? 0) });
    out.set(rosterId, list);
  }
  return out;
}
