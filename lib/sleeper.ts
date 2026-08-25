const BASE = "https://api.sleeper.app/v1";

/** The schedule and projections host. Same origin, no /v1 prefix. */
const SCHEDULE_BASE = "https://api.sleeper.com";

const headers = { "user-agent": "ffbeacon/1.0" };

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Hard response-size cap for Sleeper fetches (FFB-SEC-020). Generous enough to exceed
 * the largest legitimate payload (the full NFL players dump is only a few MB) while
 * bounding a pathological or malformed response so it cannot exhaust server memory.
 * Callers may override per endpoint if they ever need a different ceiling.
 */
export const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

async function safeFetch<T>(
  url: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = MAX_RESPONSE_BYTES,
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;

    // Fast reject when the server declares an over-limit body up front.
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) return null;

    // Enforce the cap while reading, since Content-Length may be absent or wrong
    // (chunked / gzipped responses). Abort past the cap rather than buffer unbounded.
    const text = await readCapped(response, maxBytes);
    if (text === null) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Read a response body enforcing a hard byte cap. Returns null if the cap is exceeded.
 * Exported for the FFB-SEC-020 size-guard tests. */
export async function readCapped(response: Response, maxBytes: number): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    return Buffer.byteLength(text, "utf8") > maxBytes ? null : text;
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export type SleeperUser = {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string | null;
  metadata?: Record<string, unknown> | null;
};

export type SleeperLeague = {
  league_id: string;
  name: string;
  season: string;
  sport: string;
  status: string;
  total_rosters: number;
  previous_league_id?: string | null;
  scoring_settings?: Record<string, number>;
  roster_positions?: string[];
  settings?: Record<string, number>;
  // The Sleeper league object carries the draft id and avatar at the top level.
  // On The Clock reads draft_id from here to avoid a per-league drafts fetch.
  draft_id?: string | null;
  avatar?: string | null;
};

export type SleeperRoster = {
  roster_id: number;
  owner_id: string | null;
  co_owners?: string[] | null;
  players: string[] | null;
  starters: string[] | null;
  reserve?: string[] | null;
  taxi?: string[] | null;
  settings?: Record<string, number>;
  metadata?: Record<string, unknown> | null;
};

export type SleeperLeagueUser = SleeperUser & {
  is_owner?: boolean;
  is_bot?: boolean;
};

export type SleeperTransaction = {
  transaction_id: string;
  type: string;
  status: string;
  status_updated?: number | null;
  created?: number | null;
  week?: number | null;
  leg?: number | null;
  roster_ids?: number[];
  adds: Record<string, number> | null;
  drops: Record<string, number> | null;
  draft_picks?: unknown;
  waiver_budget?: unknown;
  metadata?: Record<string, unknown> | null;
};

export type SleeperTradedPick = {
  season: string;
  round: number;
  roster_id: number;
  previous_owner_id: number;
  owner_id: number;
};

export type SleeperDraft = {
  draft_id: string;
  league_id: string | null;
  season: string;
  status: string;
  type: string;
  settings?: Record<string, number>;
  metadata?: Record<string, unknown> | null;
  slot_to_roster_id?: Record<string, number>;
  start_time?: number | null;
  last_picked?: number | null;
};

export async function getSleeperUser(username: string): Promise<SleeperUser | null> {
  return safeFetch<SleeperUser>(`${BASE}/user/${encodeURIComponent(username)}`);
}

export async function getSleeperLeagues(
  userId: string,
  season: string,
): Promise<SleeperLeague[]> {
  return (await safeFetch<SleeperLeague[]>(`${BASE}/user/${userId}/leagues/nfl/${season}`)) ?? [];
}

export async function getSleeperLeague(leagueId: string): Promise<SleeperLeague | null> {
  return safeFetch<SleeperLeague>(`${BASE}/league/${leagueId}`);
}

export async function getSleeperRosters(leagueId: string): Promise<SleeperRoster[]> {
  return (await safeFetch<SleeperRoster[]>(`${BASE}/league/${leagueId}/rosters`)) ?? [];
}

export async function getSleeperLeagueUsers(leagueId: string): Promise<SleeperLeagueUser[]> {
  return (await safeFetch<SleeperLeagueUser[]>(`${BASE}/league/${leagueId}/users`)) ?? [];
}

export async function getSleeperWeekTransactions(
  leagueId: string,
  week: number,
): Promise<SleeperTransaction[]> {
  return (
    (await safeFetch<SleeperTransaction[]>(`${BASE}/league/${leagueId}/transactions/${week}`)) ?? []
  );
}

/**
 * How many Sleeper requests we allow in flight at once when walking a range of
 * weeks. Sleeper's published ceiling is 1000 calls per minute, so this is not
 * about their limit: it is about not opening 26 sockets from one page render.
 */
export const SLEEPER_BATCH_SIZE = 6;

/**
 * Run `task` over `items` with at most `limit` running concurrently, returning
 * results in input order. Used to turn the week-by-week walks below from a
 * queue of sequential round trips into a handful of batches.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await task(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Every transaction in a league from `fromWeek` forward.
 *
 * Sleeper exposes transactions one week at a time with no "give me everything"
 * endpoint, and no way to ask how many weeks exist, so we walk until we see
 * `emptyStop` consecutive empty weeks. The walk runs in batches rather than one
 * request at a time; the stop condition is still evaluated in week order, so a
 * batch may fetch a few weeks past the stopping point. That costs a couple of
 * cheap requests and saves the wall-clock of ~20 sequential ones.
 *
 * `fromWeek` exists because past weeks are settled history. A caller that has
 * already stored weeks 0 through 9 only needs to ask about 9 onward.
 */
export async function getAllSleeperTransactions(
  leagueId: string,
  maxWeek = 25,
  emptyStop = 3,
  fromWeek = 0,
): Promise<SleeperTransaction[]> {
  const all: SleeperTransaction[] = [];
  const start = Math.max(0, Math.trunc(fromWeek));
  let emptyStreak = 0;

  for (let batchStart = start; batchStart <= maxWeek; batchStart += SLEEPER_BATCH_SIZE) {
    const weeks: number[] = [];
    for (let w = batchStart; w <= Math.min(maxWeek, batchStart + SLEEPER_BATCH_SIZE - 1); w += 1) {
      weeks.push(w);
    }
    const batches = await mapLimit(weeks, SLEEPER_BATCH_SIZE, (week) =>
      getSleeperWeekTransactions(leagueId, week),
    );

    let stop = false;
    for (let i = 0; i < weeks.length; i += 1) {
      const batch = batches[i];
      if (batch.length === 0) {
        emptyStreak += 1;
        if (emptyStreak >= emptyStop && weeks[i] > 0) {
          stop = true;
          break;
        }
        continue;
      }
      emptyStreak = 0;
      all.push(...batch);
    }
    if (stop) break;
  }
  return all;
}

export async function getSleeperTradedPicks(leagueId: string): Promise<SleeperTradedPick[]> {
  return (await safeFetch<SleeperTradedPick[]>(`${BASE}/league/${leagueId}/traded_picks`)) ?? [];
}

/**
 * One roster's entry in a week's head-to-head slate. `matchup_id` pairs the two
 * rosters facing each other; both sides carry the same value. `points` is 0 for
 * any week that has not been played.
 *
 * `starters` is the lineup Sleeper has set for that week. For future weeks this
 * is the manager's current lineup, which is what makes lineup efficiency
 * measurable before kickoff.
 */
export type SleeperMatchup = {
  roster_id: number;
  matchup_id: number | null;
  points: number | null;
  custom_points?: number | null;
  starters: string[] | null;
  starters_points?: number[] | null;
  players: string[] | null;
  players_points?: Record<string, number> | null;
};

/**
 * The head-to-head slate for one week. Sleeper generates the full season
 * schedule when a league is created, so weeks far in the future already return
 * populated `matchup_id` pairings during the preseason.
 *
 * Returns `null` when the request itself failed (timeout, 429, 5xx) and `[]`
 * when Sleeper answered and the league genuinely has no games that week. The
 * distinction is load-bearing: Power Pulse reads "no games all season" as "this
 * league has no schedule", and collapsing a throttled request into an empty
 * week made a transient failure look like a permanent fact about the league.
 */
export async function getSleeperMatchups(
  leagueId: string,
  week: number,
): Promise<SleeperMatchup[] | null> {
  // The league id can originate in a route param, so it is encoded rather than
  // interpolated raw: a crafted id containing path separators would otherwise
  // reach a different Sleeper endpoint than the one intended. The week is
  // always ours, but coercing it keeps the path free of anything unexpected.
  const id = encodeURIComponent(leagueId);
  const w = Number.isFinite(week) ? Math.trunc(week) : 0;
  return safeFetch<SleeperMatchup[]>(`${BASE}/league/${id}/matchups/${w}`);
}

export async function getSleeperLeagueDrafts(leagueId: string): Promise<SleeperDraft[]> {
  return (await safeFetch<SleeperDraft[]>(`${BASE}/league/${leagueId}/drafts`)) ?? [];
}

export async function getSleeperDraft(draftId: string): Promise<SleeperDraft | null> {
  return safeFetch<SleeperDraft>(`${BASE}/draft/${draftId}`);
}

/**
 * One drafted pick from `GET /draft/{id}/picks`.
 *
 * `player_id` is the Sleeper player id (numeric string for skill players, a team
 * code like "BUF" for defenses). `metadata` is loosely typed by Sleeper and may
 * carry first_name / last_name / position / team / amount (auction). `is_keeper`
 * arrives as boolean or null. Normalize defensively at the call site.
 */
export type SleeperDraftPick = {
  draft_id: string;
  pick_no: number;
  round: number;
  draft_slot: number;
  roster_id: number | null;
  picked_by: string | null;
  player_id: string | null;
  is_keeper?: boolean | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * Every pick in a draft, or NULL when the request failed.
 *
 * The distinction matters, and collapsing it is a bug we have shipped before:
 * `[]` means Sleeper answered and the draft has no picks, while `null` means we
 * do not know. A caller that treats a throttled or 5xx response as "no picks"
 * will conclude the draft is empty and act on it. See the same rule for
 * getSleeperMatchups, and CLAUDE.md's Power Pulse note about a failed request
 * not being evidence.
 */
export async function getSleeperDraftPicksOrNull(
  draftId: string,
): Promise<SleeperDraftPick[] | null> {
  // Encoded like getSleeperMatchups does with its league id. Every caller today
  // passes a value that originated from Sleeper itself, so this is not
  // exploitable, but the id now also reaches here from the League Pulse capture
  // path rather than only from a route that had already validated it.
  const id = encodeURIComponent(draftId);
  return await safeFetch<SleeperDraftPick[]>(`${BASE}/draft/${id}/picks`);
}

/** Picks, with a failure flattened to empty. Only safe where empty is harmless. */
export async function getSleeperDraftPicks(draftId: string): Promise<SleeperDraftPick[]> {
  return (await getSleeperDraftPicksOrNull(draftId)) ?? [];
}

export type SleeperNflState = {
  week: number;
  leg: number;
  season: string;
  season_type: string; // "pre" | "regular" | "post" | "off"
  league_season: string;
  previous_season: string;
  display_week: number;
  season_has_scores?: boolean;
  season_start_date?: string | null;
};

/**
 * Current NFL state: which season, phase, and week Sleeper considers live.
 * `season_type` is "off" between the Super Bowl and the next preseason, which
 * is the signal the stats sync uses to skip work entirely. Null on failure.
 *
 * Memoised in-process for NFL_STATE_TTL_MS. This answer changes at most once a
 * week, and every league page load asks for it (Power Pulse checks it before
 * deciding it has nothing to recompute), so an uncached call put a Sleeper
 * round trip on the critical path of a page that otherwise reads only our own
 * database. A failure is not cached, so a blip is retried on the next call.
 */
const NFL_STATE_TTL_MS = 60 * 1000;
let nflStateCache: { at: number; value: SleeperNflState } | null = null;
let nflStateInFlight: Promise<SleeperNflState | null> | null = null;

export async function getNflState(): Promise<SleeperNflState | null> {
  if (nflStateCache && Date.now() - nflStateCache.at < NFL_STATE_TTL_MS) {
    return nflStateCache.value;
  }
  // Concurrent callers (a page rendering several league surfaces at once) share
  // one request rather than starting a stampede of identical ones.
  if (!nflStateInFlight) {
    nflStateInFlight = safeFetch<SleeperNflState>(`${BASE}/state/nfl`)
      .then((value) => {
        if (value) nflStateCache = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        nflStateInFlight = null;
      });
  }
  return nflStateInFlight;
}

/**
 * One scheduled NFL game, from Sleeper's published season schedule.
 *
 * This is the ONLY place we can learn home and away. The weekly projections and
 * the weekly stats both carry `opponent` as a bare team code with no venue
 * marker, and `game_id` is an opaque numeric id shared by both sides of the
 * game, so neither can answer "is this a road game". A schedule row names the
 * two teams by role and carries the same `game_id`, which is what joins them.
 */
export type SleeperScheduleGame = {
  game_id: string;
  week: number;
  date: string | null;
  status: string | null;
  home: string | null;
  away: string | null;
};

/**
 * Home and away for one season, keyed `${week}|${TEAM}` to true when that team
 * is at home.
 *
 * WHY A DERIVED MAP RATHER THAN THE ROWS. Every caller asks the same question
 * one player at a time ("is BUF home in week 4"), and a list scan per player per
 * week is the shape that turns a lineup render into a few hundred array walks.
 *
 * Memoised for an hour. A season's schedule is fixed once published, and the
 * only thing that moves is a flexed kickoff time, which this does not read.
 * Failures are not cached, so a blip retries on the next call, and a null tells
 * the caller to say nothing about venue rather than guess.
 */
const NFL_SCHEDULE_TTL_MS = 60 * 60 * 1000;
const nflScheduleCache = new Map<number, { at: number; value: Map<string, boolean> }>();
const nflScheduleInFlight = new Map<number, Promise<Map<string, boolean> | null>>();

export async function getNflHomeAwayMap(
  season: number,
  seasonType: SleeperSeasonType = "regular",
): Promise<Map<string, boolean> | null> {
  const cached = nflScheduleCache.get(season);
  if (cached && Date.now() - cached.at < NFL_SCHEDULE_TTL_MS) return cached.value;

  const existing = nflScheduleInFlight.get(season);
  if (existing) return existing;

  const request = safeFetch<SleeperScheduleGame[]>(
    `${SCHEDULE_BASE}/schedule/nfl/${encodeURIComponent(seasonType)}/${season}`,
    20_000,
  )
    .then((games) => {
      if (!Array.isArray(games) || games.length === 0) return null;
      const map = new Map<string, boolean>();
      for (const game of games) {
        const week = Number(game?.week);
        if (!Number.isFinite(week)) continue;
        if (typeof game?.home === "string" && game.home) {
          map.set(`${week}|${game.home.toUpperCase()}`, true);
        }
        if (typeof game?.away === "string" && game.away) {
          map.set(`${week}|${game.away.toUpperCase()}`, false);
        }
      }
      if (map.size === 0) return null;
      nflScheduleCache.set(season, { at: Date.now(), value: map });
      return map;
    })
    .finally(() => {
      nflScheduleInFlight.delete(season);
    });

  nflScheduleInFlight.set(season, request);
  return request;
}

export type SleeperSeasonType = "regular" | "post" | "pre";

export type SleeperStatEntry = {
  sleeperId: string;
  /**
   * The FULL per-player object from api.sleeper.com. The stat map is nested
   * under `.stats`; game context lives at the top level (`opponent`, `team`,
   * `game_id`, `date`, `player`). Preserved verbatim into player_stats.metadata.
   */
  payload: Record<string, unknown>;
};

/**
 * Weekly player stats for one (seasonType, season, week).
 *
 * We read from api.sleeper.com (NOT api.sleeper.app/v1). Both hosts expose the
 * same underlying Sleeper stat data, but the .com host returns the richer per-
 * player object that carries game context: `opponent`, `team`, `game_id`, and
 * `date`, with the stat map nested under `.stats`. The legacy .app/v1 endpoint
 * returned only the flat stat map with no opponent, which is why weekly game
 * logs had no opponent column. The `.stats` sub-object is byte-for-byte
 * identical to the old .app payload, so column mapping is unchanged; we simply
 * also capture the opponent and game id (see lib/sleeper-stats-map.ts).
 *
 * The .com host requires a User-Agent header (403s without one); safeFetch
 * already sends one. Response is an ARRAY of per-player rows. Returns [] on any
 * failure, matching this lib's empty-on-failure convention.
 */
export async function getWeeklyStats(
  seasonType: SleeperSeasonType,
  season: number,
  week: number,
): Promise<SleeperStatEntry[]> {
  const raw = await safeFetch<Array<Record<string, unknown>>>(
    `https://api.sleeper.com/stats/nfl/${season}/${week}?season_type=${seasonType}`,
  );
  if (!Array.isArray(raw)) return [];
  const out: SleeperStatEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const sleeperId = (row as { player_id?: unknown }).player_id;
    if (typeof sleeperId !== "string" || sleeperId.length === 0) continue;
    out.push({ sleeperId, payload: row });
  }
  return out;
}

/**
 * One row from Sleeper's season projections endpoint. `stats` is a flat map
 * carrying both projection points (pts_ppr / pts_half_ppr / pts_std plus
 * component stats) and ADP keys (adp_ppr, adp_half_ppr, adp_std, adp_2qb,
 * adp_dynasty_ppr, adp_dynasty_half_ppr, adp_dynasty_std, adp_dynasty_2qb,
 * adp_idp, adp_idp_1qb, adp_rookie, adp_dynasty). Sleeper uses 999 as the
 * "no ADP data" sentinel; callers must strip it. `player` is a reduced player
 * object (name / position / team) that may lag the canonical players sync.
 */
export type SleeperSeasonProjection = {
  player_id: string;
  season: string;
  season_type: string;
  week: number | null;
  stats: Record<string, number> | null;
  player?: {
    first_name?: string | null;
    last_name?: string | null;
    position?: string | null;
    team?: string | null;
    fantasy_positions?: string[] | null;
    years_exp?: number | null;
    /**
     * Sleeper's injury designation for this player, carried on every
     * projection row. This is the SAME designation the full player dump
     * publishes, which makes it a second, independent copy that arrives with
     * the nightly projections even if the player sync has not run. That
     * redundancy is deliberate: when Sleeper withholds a point projection, the
     * designation sitting next to it is the evidence for why.
     */
    injury_status?: string | null;
    injury_body_part?: string | null;
  } | null;
  company?: string | null;
  updated_at?: number | null;
  last_modified?: number | null;
};

/**
 * Season-long projections + ADP for every fantasy-relevant position, from
 * Sleeper's undocumented (but stable, publicly read-only) projections host.
 * NOTE: this endpoint lives on api.sleeper.com WITHOUT the /v1 prefix, unlike
 * everything else in this file. One call returns the full player set (~3 MB),
 * so the timeout is raised above the default. Returns [] on any failure.
 */
const PROJECTIONS_BASE = "https://api.sleeper.com";
const PROJECTION_POSITIONS = ["DEF", "K", "QB", "RB", "TE", "WR"] as const;

export async function getSleeperSeasonProjections(
  season: string,
  seasonType: SleeperSeasonType = "regular",
): Promise<SleeperSeasonProjection[]> {
  const params = new URLSearchParams({ season_type: seasonType, order_by: "adp_ppr" });
  for (const pos of PROJECTION_POSITIONS) params.append("position[]", pos);
  const url = `${PROJECTIONS_BASE}/projections/nfl/${encodeURIComponent(season)}?${params.toString()}`;
  return (await safeFetch<SleeperSeasonProjection[]>(url, 45_000)) ?? [];
}

/**
 * One row from Sleeper's per-week projections endpoint. Same `stats` shape as
 * the season projection (pts_ppr / pts_half_ppr / pts_std plus component stats),
 * but a single week and with the game context (opponent / team / game_id) at the
 * top level, matching the weekly stats endpoint.
 */
export type SleeperWeeklyProjection = SleeperSeasonProjection & {
  opponent?: string | null;
  team?: string | null;
  game_id?: string | null;
};

/**
 * Per-player projected points for one week, from Sleeper's projections host.
 * Same host and empty-on-failure convention as getSleeperSeasonProjections, but
 * the URL carries the week segment. A single week is far smaller than the season
 * dump, but the timeout is kept generous for parity. Returns [] on any failure.
 */
export async function getSleeperWeeklyProjections(
  season: number,
  week: number,
  seasonType: SleeperSeasonType = "regular",
): Promise<SleeperWeeklyProjection[]> {
  const params = new URLSearchParams({ season_type: seasonType, order_by: "pts_ppr" });
  for (const pos of PROJECTION_POSITIONS) params.append("position[]", pos);
  const url = `${PROJECTIONS_BASE}/projections/nfl/${season}/${week}?${params.toString()}`;
  return (await safeFetch<SleeperWeeklyProjection[]>(url, 45_000)) ?? [];
}

/**
 * One player from Sleeper's full NFL player dump.
 *
 * `injury_status` is the field the whole availability model hangs on: it is
 * Sleeper's own designation (IR, PUP, Questionable, Out, ...) and it is what
 * tells us a player is unavailable for the rest of the season rather than for
 * one week. `status` is the roster-level state (Active, Inactive, Practice
 * Squad) and answers a different question, so both are kept.
 */
export type SleeperPlayer = {
  player_id?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  fantasy_positions?: string[];
  team?: string | null;
  status?: string;
  injury_status?: string | null;
  injury_body_part?: string | null;
  active?: boolean;
  birth_date?: string;
  height?: string;
  weight?: string;
  college?: string;
  years_exp?: number;
};

/**
 * The full NFL player dump, keyed by Sleeper player id.
 *
 * This is a large response (roughly 15 MB for ~12,000 players), so the timeout
 * is generous and the size cap is left at the file default, which already sits
 * well above it. Returns null on any failure rather than an empty map, because
 * an empty map and a failed request mean opposite things here: one would say
 * "the NFL has no players" and the caller must never act on that.
 */
export async function getSleeperPlayers(): Promise<Record<string, SleeperPlayer> | null> {
  return safeFetch<Record<string, SleeperPlayer>>(`${BASE}/players/nfl`, 90_000);
}

export function currentNflSeason(): string {
  const now = new Date();
  // NFL season "year" rolls over March-ish. If we're past March, this year is the season.
  const year = now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
  return String(year);
}
