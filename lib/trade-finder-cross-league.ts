/**
 * Trade Finder across every league a reader is in.
 *
 * Same engine, same one-at-a-time answer. The only thing that changes is where
 * the suggestion is allowed to come from: instead of eleven counterparties in
 * one room, it is eleven counterparties in each of however many rooms this
 * person has, which for the readers this is built for is often more than ten.
 *
 * WHY IT WALKS RATHER THAN SWEEPS
 *   Evaluating fourteen leagues on one button press means fourteen roster loads,
 *   fourteen projection windows, and fourteen sets of lineup fills, most of it
 *   thrown away because only one suggestion is shown. So a request examines a
 *   small window of leagues, returns the best deal in that window, and reports
 *   where it stopped. Passing on that deal re-runs the same window, which now
 *   has one fewer candidate in it; when a window is used up the cursor moves on
 *   to the next leagues.
 *
 *   The result is that a reader who keeps pressing does walk their whole
 *   portfolio, one deal at a time, and no single press ever costs the whole
 *   portfolio's worth of work. What it gives up is a guarantee that the very
 *   first suggestion is the globally best one across all fourteen leagues. That
 *   is the right trade for a surface whose answer is "here is one thing to go
 *   and do", and the window is stated in the UI rather than hidden.
 *
 * READS ONLY. A league nobody has synced cannot be evaluated and is counted as
 * unexamined rather than skipped silently, so the panel can say how much of the
 * portfolio it could actually see.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  DEFAULT_TRADE_QUALITY_CONFIG,
  type TradeQualityConfig,
} from "@/lib/trade-quality";
import { findTrades } from "@/lib/trade-finder/engine";
import { loadTradeFinderLeague } from "@/lib/trade-finder-data";
import type { TradeGoal, TradeSuggestion } from "@/lib/trade-finder/types";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/** Leagues loaded per press. The ceiling on what one request can cost. */
const LEAGUE_WINDOW = 3;

/** Deals taken from any one league, so a single room cannot fill the window. */
const PER_LEAGUE_TAKE = 4;

/** Deals returned in total. Matches the action's transport window. */
const SUGGESTION_TAKE = 12;

/** Hard ceiling on the portfolio one call will walk. */
export const MAX_CROSS_LEAGUES = 60;

export type CrossLeagueSuggestion = TradeSuggestion & {
  league: {
    sleeperLeagueId: string;
    name: string;
    formatDisplay: string;
    sourceDisplay: string;
    pickSourceDisplay: string | null;
  };
};

export type CrossLeagueResult = {
  /**
   * The deals this window turned up, best first, ready to page through.
   *
   * Bounded per league AND overall, because the reader can walk further with the
   * cursor whenever they exhaust these. A window that returned everything from
   * three leagues would be a list, and this feature is deliberately not one.
   */
  suggestions: CrossLeagueSuggestion[];
  /** Where the next press should start. */
  nextCursor: number;
  /** Leagues this press actually opened. */
  examined: number;
  /**
   * Leagues this walk has not opened yet.
   *
   * Counted from the end of the window rather than from the cursor. The cursor
   * deliberately sticks on a league that still has deals in it, so counting from
   * there would report every league including the one on screen, and a reader
   * who had just searched three would be told there were still twenty-seven to
   * go.
   */
  remaining: number;
  /**
   * Leagues in the window we could not evaluate: never synced, no value
   * coverage, or no roster we could match to this reader.
   */
  unreadable: number;
};

/**
 * Find the next suggestion across a reader's leagues.
 *
 * `excludeByLeague` carries the stored passes. `sessionExcluded` carries passes
 * the client is holding for this visit, which is how a signed-out reader on a
 * public surface gets a working button without a row in the database.
 */
export async function findCrossLeagueTrade(
  supabase: AnySupabase,
  params: {
    sleeperLeagueIds: string[];
    sleeperUserId: string | null;
    sourceSlug: string | null;
    goal: TradeGoal;
    cursor: number;
    excludeByLeague: Map<string, string[]>;
    sessionExcluded: string[];
    /** Consolidation model, so every league is judged on the same curve. */
    qualityConfig?: TradeQualityConfig;
  },
): Promise<CrossLeagueResult> {
  const ids = params.sleeperLeagueIds.slice(0, MAX_CROSS_LEAGUES);
  const start = Math.max(0, Math.min(params.cursor, ids.length));

  const empty: CrossLeagueResult = {
    suggestions: [],
    // Past the end. A reader who has walked their whole portfolio should be told
    // it is finished rather than sent back to the start of it.
    nextCursor: ids.length,
    examined: 0,
    remaining: 0,
    unreadable: 0,
  };
  if (ids.length === 0 || start >= ids.length) return empty;

  const sessionExcluded = new Set(params.sessionExcluded);

  const window = ids.slice(start, start + LEAGUE_WINDOW);
  const index = start + window.length;

  // The window is loaded in parallel. Sequentially it would be the sum of every
  // league's read time, which on a portfolio of the size this is built for is
  // the difference between a button that answers and a button that hangs. The
  // window itself is what bounds the concurrency.
  const loaded = await Promise.all(
    window.map((sleeperLeagueId) =>
      loadTradeFinderLeague(supabase, {
        sleeperLeagueId,
        sourceSlug: params.sourceSlug,
        identity: { sleeperUserId: params.sleeperUserId },
      }).catch(() => null),
    ),
  );

  let unreadable = 0;
  const found: CrossLeagueSuggestion[] = [];
  /** The earliest league in this window that still has something to offer. */
  let firstLiveIndex: number | null = null;

  for (let offset = 0; offset < window.length; offset += 1) {
    const sleeperLeagueId = window[offset];
    const league = loaded[offset];
    if (!league || league.myRosterId === null) {
      unreadable += 1;
      continue;
    }

    const stored = params.excludeByLeague.get(sleeperLeagueId) ?? [];
    const result = findTrades({
      myRosterId: league.myRosterId,
      teams: league.teams,
      startingSlots: league.startingSlots,
      isDynasty: league.isDynasty,
      allowPicks: league.allowPicks,
      goal: params.goal,
      targetPlayerId: null,
      offerPlayerId: null,
      excludeKeys: [...stored, ...sessionExcluded],
      quality: {
        config: params.qualityConfig ?? DEFAULT_TRADE_QUALITY_CONFIG,
        poolMax: league.poolMax,
      },
    });

    const live = result.suggestions
      .filter((s) => !sessionExcluded.has(s.key))
      .slice(0, PER_LEAGUE_TAKE);
    if (live.length === 0) continue;

    if (firstLiveIndex === null) firstLiveIndex = start + offset;
    for (const s of live) {
      found.push({
        ...s,
        league: {
          sleeperLeagueId: league.sleeperLeagueId,
          name: league.leagueName,
          formatDisplay: league.formatDisplay,
          sourceDisplay: league.sourceDisplay,
          pickSourceDisplay: league.pickSourceDisplay,
        },
      });
    }
  }

  // Merged on score across the window, then spread so consecutive deals are in
  // different leagues where possible. Without that, one strong room supplies the
  // first four and the reader pages through a portfolio feature that only ever
  // talks about one league.
  found.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  const suggestions = spreadByLeague(found).slice(0, SUGGESTION_TAKE);

  // A league that still has suggestions holds the cursor where it is, so the
  // next press reconsiders it with one fewer candidate. A window that produced
  // nothing moves the cursor past every league in it, which is what stops a
  // portfolio of empty leagues looping forever.
  const nextCursor = firstLiveIndex ?? index;

  return {
    suggestions,
    nextCursor,
    examined: window.length,
    remaining: Math.max(0, ids.length - index),
    unreadable,
  };
}

/**
 * Reorder so consecutive suggestions come from different leagues.
 *
 * Same greedy walk the single-league engine uses to spread by player and by
 * counterparty, applied to the room. Stable: the input is already sorted by
 * score and nothing is dropped, so a league with the best four deals still
 * supplies four, just not four in a row.
 */
function spreadByLeague(sorted: CrossLeagueSuggestion[]): CrossLeagueSuggestion[] {
  const remaining = [...sorted];
  const out: CrossLeagueSuggestion[] = [];
  let lastLeague: string | null = null;

  while (remaining.length > 0) {
    let index = remaining.findIndex((s) => s.league.sleeperLeagueId !== lastLeague);
    if (index === -1) index = 0;
    const [next] = remaining.splice(index, 1);
    out.push(next);
    lastLeague = next.league.sleeperLeagueId;
  }
  return out;
}

export const CROSS_LEAGUE_LIMITS = {
  LEAGUE_WINDOW,
  MAX_CROSS_LEAGUES,
  PER_LEAGUE_TAKE,
  SUGGESTION_TAKE,
};
