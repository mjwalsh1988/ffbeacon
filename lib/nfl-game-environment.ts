/**
 * What kind of game a player is walking into this week.
 *
 * `nfl_game_odds` already holds ESPN's published total and spread for every
 * game, plus the two implied team totals derived from them (lib/nfl-odds.ts
 * impliedTotals). Until now the only thing reading that table was
 * lib/build-beacon-projections.ts, which folds the numbers into a projection
 * and never shows them. This is the read path that puts them on a screen.
 *
 * WHY AN IMPLIED TOTAL IS WORTH SHOWING BESIDE A PROJECTION
 *   A projection says what one player is expected to score. An implied team
 *   total says how many points the betting market expects his whole offense to
 *   score, which is the size of the pie he is taking a slice of. Two receivers
 *   with the same projection in a 17-point game and a 31-point game are not the
 *   same bet, and nothing else on a lineup page says so.
 *
 * ONE ROW PER GAME, TWO ENTRIES PER ROW. The table is keyed on the HOME team,
 * so each row produces an entry for the home side and one for the away side,
 * each carrying its own implied total, its own spread, and the venue. That
 * venue is a second, independent answer to the home-or-away question that
 * lib/sleeper.ts getNflHomeAwayMap answers from Sleeper's schedule; a caller
 * holding both should prefer whichever it already trusts and must never treat
 * a missing row as "away".
 *
 * EVERY FIGURE IS NULLABLE AND NONE OF THEM IS EVER A ZERO. ESPN publishes a
 * game days before it publishes a line, so a row can exist with no total and no
 * spread. A zero implied total would read as "this offense is expected to score
 * nothing", which is a claim, and the wrong one.
 *
 * Pure functions plus one query. No Sleeper, no ESPN: this reads what
 * lib/sync-nfl-odds.ts already stored.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/** The slug lib/sync-nfl-odds.ts writes. Only source we hold odds from. */
export const ODDS_SOURCE_SLUG = "espn";

/** One team's game, one week. */
export type GameEnvironment = {
  /** Our team code, uppercase. */
  team: string;
  /** The other team's code. */
  opponent: string;
  /** True when this team is at home. Never inferred: it is which column the row put them in. */
  isHome: boolean;
  /** The over/under for the whole game. Null when no line is published. */
  gameTotal: number | null;
  /**
   * This team's spread, negative when they are favoured. Flipped from the
   * stored home spread for the away side, in one place, so nothing downstream
   * can read a favourite as an underdog.
   */
  spread: number | null;
  /** What the market expects THIS team to score. Null with no line. */
  impliedTotal: number | null;
  /**
   * 1 is the highest implied total in the week. Null when this team has no
   * implied total, so a team with no line never appears to be ranked last.
   */
  impliedRank: number | null;
  /** How many teams were ranked, so "3rd of 32" can be said honestly. */
  rankedTeams: number;
  kickoffAt: string | null;
  /** The book ESPN quoted. Shown as attribution, never as a number. */
  provider: string | null;
};

/**
 * How rich a game environment is, as one word.
 *
 * Bands rather than a continuous scale, because the number itself is already
 * on the screen and the word exists to be scannable. The cut points are
 * deliberately wide: a 1.5-point difference in an implied total is inside the
 * noise of which book ESPN happened to quote, and a page that promotes that to
 * "shootout" is inventing precision the line does not have.
 */
export type EnvironmentTier = "high" | "neutral" | "low";

/** Points above the week's average implied total before a game reads as high. */
export const ENVIRONMENT_HIGH_MARGIN = 2.5;
/** Points below it before a game reads as low. */
export const ENVIRONMENT_LOW_MARGIN = 2.5;

/**
 * Which band an implied total falls in, against the week's own average.
 *
 * Measured against the WEEK rather than a fixed threshold on purpose. Totals
 * drift across a season (weather, bye weeks, which teams are playing), so a
 * 23-point total can be the fourth richest game on one slate and below average
 * on another. Null in, null out: no line means no opinion.
 */
export function environmentTier(
  impliedTotal: number | null,
  weekAverage: number | null,
): EnvironmentTier | null {
  if (impliedTotal === null || weekAverage === null) return null;
  if (impliedTotal >= weekAverage + ENVIRONMENT_HIGH_MARGIN) return "high";
  if (impliedTotal <= weekAverage - ENVIRONMENT_LOW_MARGIN) return "low";
  return "neutral";
}

/** The short label for a tier. Paired with the number every time it is drawn. */
export const ENVIRONMENT_TIER_LABEL: Record<EnvironmentTier, string> = {
  high: "High scoring",
  neutral: "Average game",
  low: "Low scoring",
};

/**
 * One sentence a reader can act on, in plain words.
 *
 * Says the number and what it means, in that order, because the number is the
 * fact and the band is our reading of it. Never mentions betting, a book or a
 * line: the reader is setting a lineup, not placing a bet.
 */
export function describeEnvironment(env: GameEnvironment | null, weekAverage: number | null): string {
  if (!env) return "No game found for this week.";
  if (env.impliedTotal === null) {
    return `${env.isHome ? "Home against" : "Away at"} ${env.opponent}. No scoring line published yet.`;
  }
  const tier = environmentTier(env.impliedTotal, weekAverage);
  const where = env.isHome ? `at home against ${env.opponent}` : `away at ${env.opponent}`;
  const expected = `His offense is expected to score about ${env.impliedTotal.toFixed(1)} ${where}`;
  if (tier === "high") return `${expected}, one of the higher totals this week.`;
  if (tier === "low") return `${expected}, one of the lower totals this week.`;
  return `${expected}, about average for this week.`;
}

/** Favoured by, underdog by, or a pick 'em. Null spread gives null. */
export function describeSpread(spread: number | null): string | null {
  if (spread === null) return null;
  if (spread === 0) return "Even game";
  return spread < 0 ? `Favoured by ${Math.abs(spread).toFixed(1)}` : `Underdog by ${spread.toFixed(1)}`;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** One stored row, narrowed to what this module reads. */
export type OddsRow = {
  home_team: string;
  away_team: string;
  game_total: number | null;
  home_spread: number | null;
  home_implied_total: number | null;
  away_implied_total: number | null;
  kickoff_at: string | null;
  provider: string | null;
};

/**
 * Turn stored rows into one entry per TEAM, ranked.
 *
 * Pure, and exported so the ranking can be tested without a database. Two rows
 * naming the same team (a duplicate the unique key should prevent, but which a
 * caller passing a wider window could still produce) resolve to the first one
 * seen rather than throwing: this feeds a badge, and a page must not fail to
 * render because a table holds an unexpected row.
 */
export function buildEnvironmentMap(rows: OddsRow[]): Map<string, GameEnvironment> {
  const out = new Map<string, GameEnvironment>();

  for (const row of rows) {
    const home = (row.home_team ?? "").trim().toUpperCase();
    const away = (row.away_team ?? "").trim().toUpperCase();
    if (!home || !away) continue;

    const gameTotal = numOrNull(row.game_total);
    const homeSpread = numOrNull(row.home_spread);

    if (!out.has(home)) {
      out.set(home, {
        team: home,
        opponent: away,
        isHome: true,
        gameTotal,
        spread: homeSpread,
        impliedTotal: numOrNull(row.home_implied_total),
        impliedRank: null,
        rankedTeams: 0,
        kickoffAt: row.kickoff_at ?? null,
        provider: row.provider ?? null,
      });
    }
    if (!out.has(away)) {
      out.set(away, {
        team: away,
        opponent: home,
        isHome: false,
        gameTotal,
        // The stored spread is quoted for the home side, so the away side is
        // its negation. One flip, in one place: see lib/nfl-odds.ts
        // parseHomeSpread for why the sign is worth this much care.
        spread: homeSpread === null ? null : -homeSpread,
        impliedTotal: numOrNull(row.away_implied_total),
        impliedRank: null,
        rankedTeams: 0,
        kickoffAt: row.kickoff_at ?? null,
        provider: row.provider ?? null,
      });
    }
  }

  // Rank only the teams that actually have an implied total. A team on a bye,
  // or in a game with no published line, is unranked rather than last.
  const ranked = [...out.values()]
    .filter((e) => e.impliedTotal !== null)
    .sort((a, b) => (b.impliedTotal ?? 0) - (a.impliedTotal ?? 0));

  ranked.forEach((entry, index) => {
    entry.impliedRank = index + 1;
  });
  for (const entry of out.values()) entry.rankedTeams = ranked.length;

  return out;
}

/** The week's mean implied total, or null when nothing is published. */
export function weekAverageImpliedTotal(map: Map<string, GameEnvironment>): number | null {
  const totals = [...map.values()]
    .map((e) => e.impliedTotal)
    .filter((t): t is number => t !== null);
  if (totals.length === 0) return null;
  return totals.reduce((sum, t) => sum + t, 0) / totals.length;
}

export type GameEnvironmentWeek = {
  byTeam: Map<string, GameEnvironment>;
  /** Mean implied total across every team with a line. Null when none have one. */
  average: number | null;
};

/** Nothing published, and nothing pretending otherwise. */
export const EMPTY_GAME_ENVIRONMENT: GameEnvironmentWeek = {
  byTeam: new Map(),
  average: null,
};

/**
 * Every team's game environment for one week.
 *
 * ONE query against an indexed `(season, season_type, week)`, sixteen rows.
 * A read error returns the empty map rather than throwing: this decorates a
 * lineup, and a missing betting line must never be the reason a manager cannot
 * see who they are starting.
 */
export async function loadGameEnvironment(
  supabase: AnySupabase,
  season: number,
  week: number,
  seasonType: string = "regular",
): Promise<GameEnvironmentWeek> {
  const { data, error } = await supabase
    .from("nfl_game_odds")
    .select(
      "home_team, away_team, game_total, home_spread, home_implied_total, away_implied_total, kickoff_at, provider",
    )
    .eq("source", ODDS_SOURCE_SLUG)
    .eq("season", season)
    .eq("season_type", seasonType)
    .eq("week", week);

  if (error || !data || data.length === 0) return EMPTY_GAME_ENVIRONMENT;

  const byTeam = buildEnvironmentMap(data as unknown as OddsRow[]);
  return { byTeam, average: weekAverageImpliedTotal(byTeam) };
}
