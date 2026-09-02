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
import type { TradeStrategy, TradeSuggestion } from "@/lib/trade-finder/types";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/**
 * Leagues loaded per press. The ceiling on what one request can cost.
 *
 * Four rather than three because four is what most of the readers this is built
 * for actually have, and a window that cannot hold the whole portfolio is what
 * turned "search my leagues" into "search my first league repeatedly". The cost
 * is one more roster load per press.
 */
const LEAGUE_WINDOW = 4;

/**
 * Deals taken from any one league, so a single room cannot fill the window.
 *
 * Three, so a full window of four leagues fills the twelve slots exactly one
 * league at a time. The point is not the number, it is that no room can supply
 * more than its share while another room has something to say.
 */
const PER_LEAGUE_TAKE = 3;

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
   * Leagues this walk has not opened yet, counted from the end of the window.
   *
   * Reaches zero on the press that opens the last league, and the cursor wraps
   * to the start on the same press, so a reader who has walked the whole
   * portfolio is told it is finished and can still search it again.
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
    /**
     * Which question the ranking answers, for every league in the walk.
     *
     * One setting across the portfolio, and each league resolves it for itself:
     * a redraft room in the list ranks as a contender search whatever this says,
     * because in a one-year league there is no other honest reading. See
     * resolveStrategy.
     */
    strategy?: TradeStrategy;
    cursor: number;
    excludeByLeague: Map<string, string[]>;
    sessionExcluded: string[];
    /** Consolidation model, so every league is judged on the same curve. */
    qualityConfig?: TradeQualityConfig;
  },
): Promise<CrossLeagueResult> {
  const ids = params.sleeperLeagueIds.slice(0, MAX_CROSS_LEAGUES);
  if (ids.length === 0) {
    return {
      suggestions: [],
      nextCursor: 0,
      examined: 0,
      remaining: 0,
      unreadable: 0,
    };
  }

  // Wrapped into range rather than clamped to the end. A cursor sitting past the
  // last league used to be a terminal state that returned nothing forever, so a
  // reader who walked their whole portfolio could never search it again without
  // reloading the page.
  // The finite check belongs here rather than only at the action. NaN survives
  // Math.trunc and Math.max, and NaN % n is NaN, which would empty the window
  // and pin nextCursor at NaN for the rest of the session. The action sanitises
  // its own input, but this function is exported and called directly by tests.
  const rawCursor = Number.isFinite(params.cursor) ? Math.trunc(params.cursor) : 0;
  const start = Math.max(0, rawCursor) % ids.length;

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
  /** This window's deals, kept per league so the merge can interleave them. */
  const byLeague: CrossLeagueSuggestion[][] = [];

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
      strategy: params.strategy,
      targetPlayerIds: [],
      offerPlayerIds: [],
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

    byLeague.push(
      live.map((s) => ({
        ...s,
        league: {
          sleeperLeagueId: league.sleeperLeagueId,
          name: league.leagueName,
          formatDisplay: league.formatDisplay,
          sourceDisplay: league.sourceDisplay,
          pickSourceDisplay: league.pickSourceDisplay,
        },
      })),
    );
  }

  const suggestions = interleaveLeagues(byLeague).slice(0, SUGGESTION_TAKE);

  /**
   * Where the next press starts.
   *
   * Always past this window, wrapping at the end.
   *
   * It used to stop on the earliest league that still had a deal in it, on the
   * reasoning that the room was not exhausted yet. The effect was the opposite
   * of what a portfolio search is for: a reader whose first league always has
   * something to offer, which is every reader, had a cursor that never moved
   * off zero, so leagues five and beyond were never opened at all no matter how
   * many times they pressed. Advancing is what makes "search again" mean the
   * next part of the portfolio; the window itself already returns several deals
   * per league, so nothing is left behind by moving on.
   */
  const nextCursor = index >= ids.length ? 0 : index;

  return {
    suggestions,
    nextCursor,
    examined: window.length,
    remaining: Math.max(0, ids.length - index),
    unreadable,
  };
}

/**
 * Round-robin the leagues: best from each, then second best from each.
 *
 * The old merge sorted the whole window by score and then walked it, only
 * avoiding two deals from the same league back to back. That is a weaker
 * promise than it sounds: a league whose deals all score well still supplied
 * most of the window, so a manager in four rooms would page through a list that
 * was three-quarters about one of them, which is the report this fixes.
 *
 * Taking one from each league in turn makes the shares equal by construction,
 * and each league's own deals stay in its own order, so the best deal in every
 * room is on the first lap. Nothing is dropped: a league that runs out simply
 * stops contributing and the rest carry on.
 */
function interleaveLeagues(
  groups: CrossLeagueSuggestion[][],
): CrossLeagueSuggestion[] {
  // Rooms with more to say go first on each lap, so the lap order is stable and
  // does not depend on which league happened to load first.
  // Each league's own order is left ALONE. It arrives from the engine's variety
  // walk, which is not score order and deliberately so: it is what stops two
  // consecutive cards from the same room leading with the same player. Sorting
  // each group by score here, which the first version did, threw that away and
  // reintroduced inside one league exactly the repetition the engine spends its
  // last pass preventing. Only the ORDER OF THE LEAGUES is chosen here, by each
  // one's best deal, so the lap order does not depend on which league's rosters
  // happened to load first.
  const ordered = groups
    .filter((g) => g.length > 0)
    .sort((a, b) => b[0].score - a[0].score || a[0].key.localeCompare(b[0].key));

  const out: CrossLeagueSuggestion[] = [];
  const depth = Math.max(0, ...ordered.map((g) => g.length));
  for (let lap = 0; lap < depth; lap += 1) {
    for (const group of ordered) {
      if (lap < group.length) out.push(group[lap]);
    }
  }
  return out;
}

export const CROSS_LEAGUE_LIMITS = {
  LEAGUE_WINDOW,
  MAX_CROSS_LEAGUES,
  PER_LEAGUE_TAKE,
  SUGGESTION_TAKE,
};
