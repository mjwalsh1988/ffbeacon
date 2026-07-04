const BASE = "https://api.sleeper.app/v1";

const headers = { "user-agent": "ffbeacon/1.0" };

const DEFAULT_TIMEOUT_MS = 20_000;

async function safeFetch<T>(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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

export async function getAllSleeperTransactions(
  leagueId: string,
  maxWeek = 25,
  emptyStop = 3,
): Promise<SleeperTransaction[]> {
  const all: SleeperTransaction[] = [];
  let emptyStreak = 0;
  for (let week = 0; week <= maxWeek; week++) {
    const batch = await getSleeperWeekTransactions(leagueId, week);
    if (batch.length === 0) {
      emptyStreak++;
      if (emptyStreak >= emptyStop && week > 0) break;
      continue;
    }
    emptyStreak = 0;
    all.push(...batch);
  }
  return all;
}

export async function getSleeperTradedPicks(leagueId: string): Promise<SleeperTradedPick[]> {
  return (await safeFetch<SleeperTradedPick[]>(`${BASE}/league/${leagueId}/traded_picks`)) ?? [];
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

export async function getSleeperDraftPicks(draftId: string): Promise<SleeperDraftPick[]> {
  return (await safeFetch<SleeperDraftPick[]>(`${BASE}/draft/${draftId}/picks`)) ?? [];
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
 */
export async function getNflState(): Promise<SleeperNflState | null> {
  return safeFetch<SleeperNflState>(`${BASE}/state/nfl`);
}

export type SleeperSeasonType = "regular" | "post" | "pre";

export type SleeperStatEntry = {
  sleeperId: string;
  payload: Record<string, number>;
};

/**
 * Weekly player stats for one (seasonType, season, week).
 *
 * Sleeper's stats endpoint is undocumented but stable. It returns an object
 * keyed by Sleeper player_id whose values are the FLAT stats object (there is
 * no `.stats` wrapper, and no `opponent` / `game_id` / `team` fields). We
 * normalize to an array so callers don't depend on the keyed-object shape.
 * Returns [] on any failure, matching this lib's empty-on-failure convention.
 */
export async function getWeeklyStats(
  seasonType: SleeperSeasonType,
  season: number,
  week: number,
): Promise<SleeperStatEntry[]> {
  const raw = await safeFetch<Record<string, Record<string, number>>>(
    `${BASE}/stats/nfl/${seasonType}/${season}/${week}`,
  );
  if (!raw || typeof raw !== "object") return [];
  const out: SleeperStatEntry[] = [];
  for (const [sleeperId, payload] of Object.entries(raw)) {
    if (!sleeperId || !payload || typeof payload !== "object") continue;
    out.push({ sleeperId, payload: payload as Record<string, number> });
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

export function currentNflSeason(): string {
  const now = new Date();
  // NFL season "year" rolls over March-ish. If we're past March, this year is the season.
  const year = now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
  return String(year);
}
