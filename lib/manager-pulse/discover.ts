/**
 * Manager Pulse: handle to user id to league-seasons.
 *
 * docs/manager-pulse-plan.md sections 2.1, 4.1-4.5 and 9.
 *
 * HANDLE VALIDATION HAPPENS BEFORE ANY NETWORK CALL. A handle reaches this
 * from a URL segment, so it is untrusted input. Sleeper's own handle grammar
 * is lowercase alphanumeric plus underscore, 1 to 32 characters
 * (HANDLE_PATTERN), and `isValidSleeperHandle` checks that shape directly on
 * whatever string it is given, with no internal case-folding: a mixed-case or
 * out-of-shape string is rejected outright rather than normalized and
 * accepted. A caller that wants to be forgiving about case should lowercase
 * before calling in, and `resolveManagerHandle` calls `encodeURIComponent` at
 * the point it builds a request regardless of what the pattern already
 * guarantees, as a second, independent guard on the same string.
 *
 * PREVIOUS_LEAGUE_ID IS FOR LINKING, NOT DISCOVERY. Sleeper sets
 * `previous_league_id` on any league continued season to season, redraft
 * included (see the comment on `categorizeLeague` in lib/league-category.ts),
 * so walking that chain here would misfile a continued redraft league as
 * dynasty and would double-count leagues the per-season user endpoint already
 * finds directly. Discovery is `GET /v1/user/{id}/leagues/nfl/{season}`,
 * walked one season at a time; `previousLeagueId` is carried on the output
 * only so a future league-continuity feature has it without a second sync.
 */

import { categorizeLeague, type LeagueCategoryKey } from "@/lib/league-category";
import { getSleeperUser, getSleeperLeagues, mapLimit } from "@/lib/sleeper";
import type { ManagerLeagueCategory, ManagerPulseSettings } from "./types";

/** Sleeper's own handle grammar: lowercase alphanumeric plus underscore, 1-32 chars. */
export const HANDLE_PATTERN = /^[a-z0-9_]{1,32}$/;

/**
 * True when `raw` already matches Sleeper's handle grammar exactly, with no
 * normalization performed here. Uppercase, spaces, path separators, and an
 * empty or over-length string are all rejected, on purpose: this is the gate
 * that runs before any fetch, so it has to reject what it is actually given,
 * not a cleaned-up version of it.
 */
export function isValidSleeperHandle(raw: string): boolean {
  return typeof raw === "string" && HANDLE_PATTERN.test(raw);
}

/** How many Sleeper season requests run at once while walking a discovery window. */
const SEASON_FETCH_CONCURRENCY = 3;

const SLEEPER_AVATAR_BASE = "https://sleepercdn.com/avatars";

export type DiscoveredLeagueSeason = {
  sleeperLeagueId: string;
  season: number;
  leagueName: string | null;
  category: ManagerLeagueCategory | null;
  previousLeagueId: string | null;
};

/**
 * Resolve a validated handle to the Sleeper account it names.
 *
 * Returns null for an invalid handle shape (no network call at all) and for
 * a handle Sleeper does not recognize. `handle` on the result is Sleeper's
 * own `username`, which may differ in case or content from what the caller
 * typed if Sleeper renamed the account; downstream code keys on
 * `sleeperUserId`, never on the typed string, for exactly that reason.
 */
export async function resolveManagerHandle(
  handle: string,
): Promise<{ sleeperUserId: string; handle: string; avatarUrl: string | null } | null> {
  if (!isValidSleeperHandle(handle)) return null;

  // encodeURIComponent at the call site regardless of what HANDLE_PATTERN
  // already guarantees about the characters in play. getSleeperUser encodes
  // again internally; encoding an already-safe [a-z0-9_] string is a no-op,
  // so the double encoding costs nothing and removes one place this could
  // ever drift.
  const user = await getSleeperUser(encodeURIComponent(handle));
  if (!user || !user.user_id) return null;

  return {
    sleeperUserId: user.user_id,
    handle: user.username || handle,
    avatarUrl: user.avatar ? `${SLEEPER_AVATAR_BASE}/${user.avatar}` : null,
  };
}

/**
 * Every league-season this Sleeper user shows up in across the window,
 * discovered by walking `GET /v1/user/{id}/leagues/nfl/{season}` one season
 * at a time, fetched CONCURRENTLY but bounded (SEASON_FETCH_CONCURRENCY),
 * then capped by `selectLeagueSeasons`.
 *
 * Best ball leagues are dropped entirely, before capping, when
 * `settings.capture.includeBestBall` is false: they should not count against
 * either cap for a reader who has turned them off.
 */
export async function discoverLeagueSeasons(params: {
  sleeperUserId: string;
  seasonFrom: number;
  seasonTo: number;
  settings: ManagerPulseSettings;
}): Promise<{ leagueSeasons: DiscoveredLeagueSeason[]; skipped: number }> {
  const { sleeperUserId, seasonFrom, seasonTo, settings } = params;

  const seasons: number[] = [];
  for (let season = seasonTo; season >= seasonFrom; season -= 1) {
    seasons.push(season);
  }

  const perSeason = await mapLimit(seasons, SEASON_FETCH_CONCURRENCY, async (season) => ({
    season,
    leagues: await getSleeperLeagues(sleeperUserId, String(season)),
  }));

  const found: DiscoveredLeagueSeason[] = [];
  for (const { season, leagues } of perSeason) {
    for (const league of leagues) {
      if (!league.league_id) continue;
      const category: LeagueCategoryKey = categorizeLeague(league);
      const isBestBall = category === "best-ball-dynasty" || category === "best-ball-redraft";
      if (isBestBall && !settings.capture.includeBestBall) continue;

      found.push({
        sleeperLeagueId: league.league_id,
        season,
        leagueName: league.name ?? null,
        category,
        previousLeagueId: league.previous_league_id ?? null,
      });
    }
  }

  const { kept, skipped } = selectLeagueSeasons(found, settings);
  return { leagueSeasons: kept, skipped };
}

/**
 * Cap a discovered list at `maxLeaguesPerRun`, MOST RECENT SEASON FIRST, and
 * at `maxLeaguesPerSeason` within any one season. Pure, so a run's cap
 * behaviour is testable without a Sleeper call, and reused by the capture
 * step, which needs the same cap applied to the same input.
 *
 * A manager in 200 leagues gets their most recent seasons' worth rather than
 * an arbitrary slice of the whole list, so the report is always the newest
 * evidence available rather than whatever order Sleeper happened to answer
 * in.
 */
export function selectLeagueSeasons(
  found: DiscoveredLeagueSeason[],
  settings: ManagerPulseSettings,
): { kept: DiscoveredLeagueSeason[]; skipped: number } {
  const { maxLeaguesPerRun, maxLeaguesPerSeason } = settings.capture;

  const bySeason = new Map<number, DiscoveredLeagueSeason[]>();
  for (const leagueSeason of found) {
    const existing = bySeason.get(leagueSeason.season);
    if (existing) existing.push(leagueSeason);
    else bySeason.set(leagueSeason.season, [leagueSeason]);
  }

  const seasonsDesc = [...bySeason.keys()].sort((a, b) => b - a);

  const kept: DiscoveredLeagueSeason[] = [];
  let skipped = 0;

  for (const season of seasonsDesc) {
    const leagues = bySeason.get(season) ?? [];

    if (kept.length >= maxLeaguesPerRun) {
      skipped += leagues.length;
      continue;
    }

    const roomLeftInRun = maxLeaguesPerRun - kept.length;
    const perSeasonCap = Math.max(0, Math.min(maxLeaguesPerSeason, roomLeftInRun));
    const keepFromSeason = leagues.slice(0, perSeasonCap);

    kept.push(...keepFromSeason);
    skipped += leagues.length - keepFromSeason.length;
  }

  return { kept, skipped };
}
