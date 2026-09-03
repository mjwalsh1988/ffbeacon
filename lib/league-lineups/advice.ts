/**
 * Who to cut, and who to pick up, framed by what this team is playing for.
 *
 * Pure. Everything arrives already projected by lib/league-lineups/build.ts, so
 * no number here is computed a second way.
 *
 * WHAT A "GOAL" IS, AND WHY IT CHANGES THE ANSWER
 *   lib/league-team-status.ts already classifies every synced roster as a
 *   Contender, a Bubble team or a Rebuilder, from its Power Pulse rank and its
 *   trade-value rank. Redraft and keeper leagues take the redraft vocabulary,
 *   where the third band reads Longshot rather than Rebuilder, because there is
 *   no next season to hold assets for.
 *
 *   That single word changes which free agent is worth a claim. A contender
 *   wants the player who scores most THIS WEEK, even if he is 31 and on a
 *   one-year deal. A rebuilder wants the player who might matter next season and
 *   should not spend a roster spot on a streamer. So the same available player
 *   is a different recommendation in two different rooms, and the note says
 *   which room the reader is in rather than leaving them to infer it.
 *
 * WHY THE CUT LIST IS A LIST AND NEVER A VERDICT
 *   Same reasoning as lib/faab/types.ts DropCandidate, stated there and worth
 *   repeating here: the model sees projected points and market value. It does
 *   not see the handcuff whose stock jumped this morning, the rookie the manager
 *   is high on, or the player already inside a trade in the league chat. Naming
 *   one player in a confident sentence reads as an instruction. Naming a few,
 *   cheapest first, reads as what it is.
 *
 * WHY A DYNASTY CUT IS HELD TO A HIGHER BAR
 *   In a redraft league a cut gives up the rest of one season. In a dynasty
 *   league it gives up the asset itself, permanently, to whoever claims him. So
 *   a dynasty roster's cut list drops anyone still carrying real market value,
 *   and says so, rather than quietly recommending a manager give away a second
 *   round pick's worth of player to stream a kicker.
 */

import type { TeamStatus } from "@/lib/league-team-status";
import type { DropOption, LineupPlayer, WaiverFit, WaiverSuggestion } from "./types";

/** How many cut candidates to name. Enough to choose from, few enough to read. */
export const DROP_OPTION_LIMIT = 4;

/** How many available players to name. */
export const WAIVER_SUGGESTION_LIMIT = 5;

/**
 * The smallest weekly gain that makes a free agent a "starts this week" pickup.
 *
 * Same half-point floor as MIN_MOVE_GAIN in ./build.ts, and the same reason:
 * below it the difference sits inside the model's own noise, and telling
 * somebody to burn a waiver claim for a tenth of a point is worse advice than
 * saying nothing.
 */
export const WAIVER_START_MIN_GAIN = 0.5;

/**
 * Market value above which a dynasty roster is not told to cut somebody.
 *
 * Deliberately a round number and deliberately low. It is not a claim about
 * what a player is worth; it is the line under which giving him away for free
 * is a defensible move rather than a mistake the page talked a reader into.
 * Leagues price on different scales, so callers hand in values already
 * normalised to the reader's own format and source.
 */
export const DYNASTY_KEEP_VALUE = 1500;

/**
 * One line saying why a player is on the cut list.
 *
 * Never phrased as an instruction. "Nothing projected the rest of the way" is a
 * fact about the roster; "cut him" is an order, and this module does not give
 * orders.
 */
function dropNote(
  player: LineupPlayer,
  restOfSeasonPerWeek: number | null,
  isKeeperLeague: boolean,
): string {
  if (player.rosterSlot === "reserve") {
    return "On injured reserve, so he is not taking a bench spot right now.";
  }
  if (player.rosterSlot === "taxi") {
    return "On the taxi squad, so he is not taking a bench spot right now.";
  }
  if (restOfSeasonPerWeek === null) {
    return "No projection left this season, so he adds nothing to a lineup as things stand.";
  }
  if (restOfSeasonPerWeek < 1) {
    return "Projected under a point a week for the rest of the season.";
  }
  const perWeek = restOfSeasonPerWeek.toFixed(1);
  return isKeeperLeague
    ? `About ${perWeek} points a week left this season, and he does not crack your lineup.`
    : `About ${perWeek} points a week left, and he does not crack your lineup.`;
}

export type DropInput = {
  /** Everyone on the roster who is not in the optimal lineup this week. */
  benchable: LineupPlayer[];
  /** Rest-of-season projected points per week, by Sleeper id. Absent means none. */
  restOfSeasonPerWeek: Map<string, number>;
  /** Market value in the reader's own format, by Sleeper id. */
  valueBySleeperId: Map<string, number>;
  /** True for dynasty and keeper leagues, where a cut gives up the asset itself. */
  isKeeperLeague: boolean;
  /** Sleeper ids the optimal lineup seats this week. Never offered as a cut. */
  seatedSleeperIds: Set<string>;
};

export type DropResult = {
  options: DropOption[];
  /**
   * Set when the search declined to name anybody, with the reason. Null when
   * there are options. Never both.
   */
  note: string | null;
};

/**
 * The players this roster would miss least, cheapest first.
 *
 * ANYONE THE OPTIMISER SEATS THIS WEEK IS EXCLUDED OUTRIGHT. He is, by
 * definition, one of the best nine players available to start, and a page that
 * offers a starter as a cut in one panel while telling you to start him in
 * another is two panels disagreeing on the same screen.
 */
export function buildDropOptions(input: DropInput): DropResult {
  const kept: string[] = [];
  const scored: Array<{ option: DropOption; sort: number }> = [];

  for (const player of input.benchable) {
    if (input.seatedSleeperIds.has(player.sleeperId)) continue;

    const perWeek = input.restOfSeasonPerWeek.get(player.sleeperId) ?? null;
    const value = input.valueBySleeperId.get(player.sleeperId) ?? null;

    // The dynasty guard. A player worth real money is an asset to trade, not a
    // player to release, and naming him here would be the page's worst possible
    // advice: the reader loses him for nothing and somebody else claims him.
    if (input.isKeeperLeague && value !== null && value >= DYNASTY_KEEP_VALUE) {
      kept.push(player.name);
      continue;
    }

    scored.push({
      option: {
        player,
        restOfSeasonPerWeek: perWeek,
        value,
        note: dropNote(player, perWeek, input.isKeeperLeague),
      },
      // A player with nothing projected sorts first, as -1: he is the emptiest
      // seat on the roster. Never treated as a zero elsewhere; this is a sort
      // key inside one function, not a number shown to anyone.
      sort: perWeek ?? -1,
    });
  }

  scored.sort((a, b) => {
    if (a.sort !== b.sort) return a.sort - b.sort;
    return a.option.player.name.localeCompare(b.option.player.name);
  });

  const options = scored.slice(0, DROP_OPTION_LIMIT).map((s) => s.option);

  if (options.length > 0) return { options, note: null };

  if (kept.length > 0) {
    return {
      options: [],
      note:
        kept.length === 1
          ? `${kept[0]} is the only player your lineup could spare, and he is worth too much to give away. Trade him instead.`
          : `The players your lineup could spare are all worth too much to give away. Trade one instead of cutting them.`,
    };
  }

  return {
    options: [],
    note: "Every player on this roster is either starting or projected to matter. Nothing to cut.",
  };
}

export type WaiverCandidate = {
  player: LineupPlayer;
  /** Points the optimal lineup gains this week by adding him. Zero when he does not start. */
  pointsAdded: number;
  /** The slot he would take. Null when he does not crack the lineup. */
  slotLabel: string | null;
  /** Overall rank in the reader's format and source. Null when unranked. */
  overallRank: number | null;
};

/**
 * Which of these available players are worth naming, and why, for this team.
 *
 * `status` is the whole point. It decides both the ORDER and the WORDS:
 *
 *   - A contender (and every redraft team, which is always contending, because
 *     there is no next season to build for) is ranked on what a player adds to
 *     THIS week's lineup. A stash is noise to them.
 *   - A rebuilder is ranked on overall rank instead, because the player who
 *     might be a starter next season is worth more than the one who adds two
 *     points to a lineup that is not going anywhere. A start-now pickup is
 *     still listed and still labelled honestly; it is simply not led with.
 *   - A bubble team gets the contender ordering, because a team still in it
 *     should act like one until it is not.
 *
 * A null `status` means Power Pulse has not run for this league yet. Everything
 * still works: the ordering falls back to what helps this week, which is the
 * answer that needs no opinion about the future, and the note says nothing
 * about a goal we have not measured.
 */
export function buildWaiverSuggestions(
  candidates: WaiverCandidate[],
  status: TeamStatus | null,
): WaiverSuggestion[] {
  const rebuilding = status?.key === "rebuilder";

  const fitOf = (c: WaiverCandidate): WaiverFit => {
    if (c.pointsAdded >= WAIVER_START_MIN_GAIN) return "start-now";
    // No lineup gain this week. In a keeper or dynasty room that can still be
    // worth a roster spot; in a redraft room it is bench depth and nothing more.
    return status?.variant === "dynasty" ? "upside" : "depth";
  };

  const ranked = [...candidates].sort((a, b) => {
    if (rebuilding) {
      // Best long-term asset first. An unranked player sorts last rather than
      // first: no rank is missing information, not a good one.
      const ar = a.overallRank ?? Number.POSITIVE_INFINITY;
      const br = b.overallRank ?? Number.POSITIVE_INFINITY;
      if (ar !== br) return ar - br;
      return b.pointsAdded - a.pointsAdded;
    }
    if (a.pointsAdded !== b.pointsAdded) return b.pointsAdded - a.pointsAdded;
    const ar = a.overallRank ?? Number.POSITIVE_INFINITY;
    const br = b.overallRank ?? Number.POSITIVE_INFINITY;
    return ar - br;
  });

  return ranked.slice(0, WAIVER_SUGGESTION_LIMIT).map((c) => {
    const fit = fitOf(c);
    return {
      player: c.player,
      fit,
      pointsAdded: c.pointsAdded,
      slotLabel: c.slotLabel,
      overallRank: c.overallRank,
      note: waiverNote(c, fit, status),
    };
  });
}

/**
 * One plain line about one available player, for this reader.
 *
 * Says the number first and the reason second, and never mentions a bid: FAAB
 * pricing is a whole tool of its own at /tools/faab, and half an answer about
 * money here would compete with it.
 */
function waiverNote(
  candidate: WaiverCandidate,
  fit: WaiverFit,
  status: TeamStatus | null,
): string {
  const points = candidate.pointsAdded.toFixed(1);

  if (fit === "start-now") {
    const where = candidate.slotLabel ? ` at ${candidate.slotLabel}` : "";
    if (status?.key === "rebuilder") {
      return `Adds about ${points} points${where} this week. Useful, though a rebuild is not usually won on a waiver claim.`;
    }
    return `Adds about ${points} points${where} to your best lineup this week.`;
  }

  if (fit === "upside") {
    return candidate.overallRank !== null
      ? `Does not crack your lineup this week, but he is ranked ${candidate.overallRank} overall and is free to hold.`
      : "Does not crack your lineup this week. Worth a bench spot if you have one spare.";
  }

  return "Does not crack your lineup this week. Bench cover only.";
}

/**
 * The one-line brief at the top of the recommendations, in the reader's own
 * situation.
 *
 * A redraft league is always contending, whatever the record says: there is no
 * next season to trade toward, so the only thing to do with a bad team is try
 * to make it better. That is not a modelling choice, it is what the format is.
 */
export function goalBrief(status: TeamStatus | null): string {
  if (!status) {
    return "Power Pulse has not run for this league yet, so these are ranked on what helps this week.";
  }
  if (status.variant === "redraft") {
    return status.key === "competitor"
      ? "You are near the top, so these are ranked on what wins this week."
      : "There is no next season in a redraft league, so these are ranked on what wins this week.";
  }
  if (status.key === "competitor") {
    return "You are built to win now, so these are ranked on what adds the most points this week.";
  }
  if (status.key === "rebuilder") {
    return "Your assets are ahead of your wins, so these are ranked on who is worth holding rather than who helps on Sunday.";
  }
  return "You are in the pack, so these are ranked on what helps this week. Nothing here is worth mortgaging.";
}
