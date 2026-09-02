/**
 * ESPN scoreboard adapter: game total, spread, and the implied team totals
 * derived from them, for the projection engine's game-environment signal.
 *
 * Source: https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard,
 * public, no key, no auth. This is the ONLY file allowed to call that host, the
 * same rule lib/sleeper.ts follows for api.sleeper.app.
 *
 * TEAM CODES. ESPN's 32 abbreviations match nfl_teams exactly except Washington,
 * which ESPN calls WSH and we call WAS. normalizeEspnTeam() is the one place
 * that mapping lives, so a future divergence is one entry.
 *
 * SPREAD SIGN. ESPN's `spread` number and its `details` string ("SEA -3.5") are
 * both quoted relative to the FAVOURITE, not always relative to the home team.
 * parseHomeSpread() reads which team `details` names and normalises to
 * home_spread, where NEGATIVE means the home team is favoured, matching how a
 * book quotes it and matching migration 0238's column comment. When `details`
 * cannot be parsed it falls back to the `homeTeamOdds` / `awayTeamOdds`
 * `favorite` booleans ESPN also publishes. When neither resolves it, the spread
 * is null rather than guessed: a sign error here silently inverts every game
 * script the projection engine derives from it.
 *
 * FAILURE POSTURE. getEspnScoreboard() returns null when the request itself
 * failed and [] when ESPN answered with no games. Collapsing that distinction
 * is the exact bug CLAUDE.md's Power Pulse section warns about for Sleeper: a
 * throttled fetch must never read as "this week has no games."
 */

import { NFL_TEAM_CODES } from "./nfl-teams";

const ESPN_SCOREBOARD_URL =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

const DEFAULT_TIMEOUT_MS = 20_000;

/** Generous cap for a scoreboard payload (16 games, a few hundred KB in practice). */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

const headers = { "user-agent": "ffbeacon/1.0" };

export type EspnSeasonType = "pre" | "regular" | "post";

const SEASON_TYPE_TO_ESPN: Record<EspnSeasonType, number> = {
  pre: 1,
  regular: 2,
  post: 3,
};

/** ESPN abbreviations that differ from ours. WSH is the only known case. */
const ESPN_TEAM_ALIASES: Record<string, string> = {
  WSH: "WAS",
};

/** Map one ESPN team abbreviation to ours. Unknown codes pass through unchanged. */
export function normalizeEspnTeam(abbr: string): string {
  const code = abbr.trim().toUpperCase();
  return ESPN_TEAM_ALIASES[code] ?? code;
}

/**
 * Normalise ESPN's favourite-relative spread to home_spread, where negative
 * means the home team is favoured.
 *
 * `details` (e.g. "SEA -3.5") is parsed first: the named team gets the signed
 * number, and the sign is flipped if that team is the away side. "PK" / "EVEN"
 * (pick 'em) resolves to 0 without needing a team name. When `details` cannot
 * be parsed or names neither team, the raw `spread` magnitude is combined with
 * the `favorite` hints ESPN also publishes on the odds object. When nothing
 * resolves the sign, null is returned rather than guessed.
 */
export function parseHomeSpread(
  details: string | null | undefined,
  spread: number | null | undefined,
  homeTeam: string,
  awayTeam: string,
  hints?: { homeFavorite?: boolean | null; awayFavorite?: boolean | null },
): number | null {
  const home = normalizeEspnTeam(homeTeam);
  const away = normalizeEspnTeam(awayTeam);
  const trimmed = typeof details === "string" ? details.trim() : "";

  if (/^(pk|pick(?:'?em)?|even)$/i.test(trimmed)) return 0;

  const match = /^([A-Za-z]{2,4})\s+([+-]?\d+(?:\.\d+)?)$/.exec(trimmed);
  if (match) {
    const favTeam = normalizeEspnTeam(match[1]);
    const magnitude = Math.abs(Number(match[2]));
    if (Number.isFinite(magnitude)) {
      if (favTeam === home) return -magnitude;
      if (favTeam === away) return magnitude;
    }
  }

  if (typeof spread === "number" && Number.isFinite(spread)) {
    const magnitude = Math.abs(spread);
    if (magnitude === 0) return 0;
    if (hints?.homeFavorite === true) return -magnitude;
    if (hints?.awayFavorite === true) return magnitude;
  }

  return null;
}

/**
 * The implied team totals a game total and a home spread carry.
 *
 * home = total/2 - spread/2, away = total/2 + spread/2. Either input missing
 * returns nulls for both: never a confident half of nothing.
 */
export function impliedTotals(
  gameTotal: number | null,
  homeSpread: number | null,
): { home: number | null; away: number | null } {
  if (gameTotal === null || homeSpread === null) return { home: null, away: null };
  return {
    home: gameTotal / 2 - homeSpread / 2,
    away: gameTotal / 2 + homeSpread / 2,
  };
}

export type EspnOddsGame = {
  season: number;
  seasonType: EspnSeasonType;
  week: number;
  homeTeam: string; // our code
  awayTeam: string; // our code
  kickoffAt: string | null;
  gameTotal: number | null;
  homeSpread: number | null; // negative means home favoured
  provider: string | null;
  raw: unknown; // the original competition object, for metadata
};

// Minimal, loosely-typed views of the ESPN scoreboard payload. Every field is
// optional because we only trust what we can validate at read time.
type EspnTeamRef = { abbreviation?: string };
type EspnCompetitor = { homeAway?: string; team?: EspnTeamRef };
type EspnOddsProvider = { name?: string };
type EspnTeamOdds = { favorite?: boolean };
type EspnOdds = {
  provider?: EspnOddsProvider;
  details?: string;
  overUnder?: number;
  spread?: number;
  homeTeamOdds?: EspnTeamOdds;
  awayTeamOdds?: EspnTeamOdds;
};
type EspnCompetition = {
  competitors?: EspnCompetitor[];
  odds?: EspnOdds[];
};
type EspnEvent = {
  shortName?: string;
  date?: string;
  competitions?: EspnCompetition[];
};
type EspnScoreboardResponse = {
  events?: EspnEvent[];
};

/** Read a response body enforcing a hard byte cap. Returns null past the cap. */
async function readCapped(response: Response, maxBytes: number): Promise<string | null> {
  const text = await response.text();
  return Buffer.byteLength(text, "utf8") > maxBytes ? null : text;
}

async function safeFetchEspn<T>(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) return null;

    const text = await readCapped(response, MAX_RESPONSE_BYTES);
    if (text === null) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function findCompetitor(
  competitors: EspnCompetitor[],
  side: "home" | "away",
): EspnCompetitor | null {
  return competitors.find((c) => c.homeAway === side) ?? null;
}

/**
 * One week's game odds from ESPN's public scoreboard.
 *
 * Returns null when the request itself failed (timeout, non-2xx, oversized or
 * unparseable body) and [] when ESPN answered with a genuinely empty slate.
 * That distinction is load-bearing for the sync: see the file header.
 *
 * A game with no published odds still produces a row, with null gameTotal and
 * null homeSpread. That is a real fact about the game, not a skipped row.
 */
export async function getEspnScoreboard(
  season: number,
  week: number,
  seasonType: EspnSeasonType = "regular",
): Promise<EspnOddsGame[] | null> {
  const params = new URLSearchParams({
    seasontype: String(SEASON_TYPE_TO_ESPN[seasonType]),
    week: String(week),
    dates: String(season),
  });
  const url = `${ESPN_SCOREBOARD_URL}?${params.toString()}`;

  const payload = await safeFetchEspn<EspnScoreboardResponse>(url);
  if (payload === null) return null;

  const events = Array.isArray(payload.events) ? payload.events : [];
  const games: EspnOddsGame[] = [];

  for (const event of events) {
    const competition = event.competitions?.[0];
    if (!competition) continue;

    const competitors = Array.isArray(competition.competitors) ? competition.competitors : [];
    const homeAbbr = findCompetitor(competitors, "home")?.team?.abbreviation;
    const awayAbbr = findCompetitor(competitors, "away")?.team?.abbreviation;
    if (typeof homeAbbr !== "string" || typeof awayAbbr !== "string") continue;

    const homeTeam = normalizeEspnTeam(homeAbbr);
    const awayTeam = normalizeEspnTeam(awayAbbr);

    const oddsList = Array.isArray(competition.odds) ? competition.odds : [];
    const primaryOdds = oddsList.length > 0 ? oddsList[0] : null;

    const gameTotal =
      primaryOdds && typeof primaryOdds.overUnder === "number" && Number.isFinite(primaryOdds.overUnder)
        ? primaryOdds.overUnder
        : null;

    const homeSpread = primaryOdds
      ? parseHomeSpread(
          typeof primaryOdds.details === "string" ? primaryOdds.details : null,
          typeof primaryOdds.spread === "number" ? primaryOdds.spread : null,
          homeTeam,
          awayTeam,
          {
            homeFavorite: primaryOdds.homeTeamOdds?.favorite ?? null,
            awayFavorite: primaryOdds.awayTeamOdds?.favorite ?? null,
          },
        )
      : null;

    games.push({
      season,
      seasonType,
      week,
      homeTeam,
      awayTeam,
      kickoffAt: typeof event.date === "string" ? event.date : null,
      gameTotal,
      homeSpread,
      provider:
        primaryOdds && typeof primaryOdds.provider?.name === "string"
          ? primaryOdds.provider.name
          : null,
      raw: competition,
    });
  }

  return games;
}

/** Exported for the alias-map test: the set of codes normalizeEspnTeam must resolve to. */
export const OUR_NFL_TEAM_CODES = NFL_TEAM_CODES;
