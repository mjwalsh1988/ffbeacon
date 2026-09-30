/**
 * The waiver wire board: shared shapes, and the rules that hold it together.
 *
 * WHAT THIS FEATURE IS. One page per NFL week listing the players most worth a
 * waiver claim, plus an evergreen hub explaining how the wire works. Every
 * other waiver wire page on the internet is a columnist's list. This one is
 * measured, and each column says where its number came from.
 *
 * THE FIVE THINGS EVERY ROW ANSWERS, in the order a manager actually asks them:
 *
 *   1. CAN I GET HIM. `rosterRate`, from `player_roster_rates`: the share of
 *      the real synced Sleeper leagues we hold that already have him. This is
 *      measured from rosters, not published by a platform about itself, and the
 *      page states the population beside it every time.
 *   2. WHY NOW. `opportunity`, from `player_stats`: what his touches and snap
 *      share did last week against the weeks before it. A waiver add is almost
 *      always a role change, and a role change shows up in opportunity before
 *      it shows up in points.
 *   3. WHAT HE DOES THIS WEEK. `projection`, through
 *      `lib/projections/read.ts loadAdjustedProjections` on whichever engine
 *      `lib/projections/source.ts` resolves. Never a raw `projected_pts_*`
 *      read: the repo-wide guard forbids it and the adjusted figure is the one
 *      every other surface shows.
 *   4. IS THAT ACTUALLY AN UPGRADE. `pointsAboveReplacement`, his projection
 *      minus the last startable player at his position in a league this size.
 *      Ten points from a tight end is a different thing from ten points from a
 *      running back, and the raw projection cannot tell you which.
 *   5. WHAT SHOULD I BID. `bid`, a share of the season budget read from what
 *      waiver claims actually cost: the same measured market cells the FAAB
 *      calculator reads (`faab_market_priors`, through the same `pickCell` and
 *      `priorCdf`), weighted toward this player's OWN recent auctions in the
 *      synced leagues (`market`, from `waiver_claim_market()`). See
 *      `lib/waiver-wire/bid.ts` for why the old rank curve was retired here.
 *
 * ABSOLUTE RULE: the bid on this page is a PERCENTAGE OF THE SEASON BUDGET and
 * never a dollar figure. A public page cannot see a reader's budget, and a
 * percentage is the one form of the answer that is right in every league. It
 * prices what it takes to WIN the player, not what he is worth to a roster it
 * cannot see; the calculator asks that second question against the reader's
 * own league, and every board links to it.
 *
 * ABSOLUTE RULE: a missing number is never a zero. Sleeper publishes no
 * projection for IDP slots, publishes snap share a week late, and publishes
 * nothing at all for a player on a bye. Every field below that can be absent is
 * nullable, and every surface renders the absence in words rather than
 * printing 0.0 and letting a reader believe it.
 *
 * ABSOLUTE RULE: this page respects the reader's source and format selection,
 * per the Source and Format Sync section of CLAUDE.md. Values, rankings and
 * the scoring behind every projection all resolve through the normal chain. It
 * is NOT a league view, so `resolveLeagueContext` does not apply here.
 */

/** Sleeper publishes an 18-week regular season. */
export const MAX_NFL_WEEK = 18;

/** The positions a waiver board covers. Sleeper projects exactly these six. */
export const BOARD_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;
export type BoardPosition = (typeof BOARD_POSITIONS)[number];

/**
 * How widely rostered a player is, and across what.
 *
 * `total` travels with `rostered` on purpose. A share with its population
 * detached is a number nobody can check, and this one describes a specific,
 * self-selected set of leagues rather than the whole of Sleeper.
 */
export type RosterRate = {
  rostered: number;
  total: number;
  /** 0 to 100. Null when we hold no leagues for the season at all. */
  pct: number | null;
  dynastyRostered: number;
  dynastyTotal: number;
  dynastyPct: number | null;
  redraftRostered: number;
  redraftTotal: number;
  redraftPct: number | null;
};

/**
 * What his role did, measured rather than asserted.
 *
 * "Touches" is targets plus carries, which is the one opportunity figure
 * Sleeper populates reliably for the week just played. Snap share is better and
 * arrives later, so it is carried separately and is allowed to be null for the
 * most recent week without making the row useless.
 */
export type Opportunity = {
  /** Targets plus carries in the most recent week we hold a line for. */
  lastTouches: number | null;
  /** The week that figure came from. Null when he has no line at all. */
  lastWeek: number | null;
  /** Mean touches over the weeks BEFORE lastWeek. Null with nothing to compare. */
  priorTouches: number | null;
  /** lastTouches minus priorTouches. Null when either side is missing. */
  touchDelta: number | null;
  /** Share of his team's offensive snaps, 0 to 100, in the newest week carrying one. */
  snapPct: number | null;
  /** Which week that snap figure is from. It lags the touch figure by design. */
  snapWeek: number | null;
  /** Fantasy points he actually scored in `lastWeek`, in the board's scoring. */
  lastPoints: number | null;
  /** How many weeks of any kind we hold for him this season. */
  weeksPlayed: number;
};

/** The week's projection for one player, already adjusted and already scored. */
export type BoardProjection = {
  /** Adjusted points for the board's week, in the board format's scoring. */
  points: number;
  /** Before our matchup and reliability multipliers. */
  rawPoints: number;
  /** The NFL team he faces. Null when the slate has not been published. */
  opponent: string | null;
  /** Share of weeks his raw projection was beaten. Null without history. */
  beatRate: number | null;
};

/**
 * What this player actually cost on waivers in the synced leagues, over the
 * most recent waiver runs we hold. From `waiver_claim_market()` (migration
 * 0331). Every price is a share of that league's full season budget, 0 to 100,
 * so a $100 league and a $1,000 league read on the same scale.
 */
export type ClaimMarket = {
  /** Auctions he was won in. One per league per waiver week. */
  auctions: number;
  /** Distinct leagues those auctions ran in. */
  leagues: number;
  /** Mean teams bidding on him per auction, the winner included. */
  avgBidders: number;
  /** Share of his auctions with at least two bidders, 0 to 1. */
  contestedShare: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  /** The newest waiver week in the window he was claimed in. */
  latestWeek: number;
};

/** How many teams the price assumes are bidding. The market cells' own keys. */
export type BidderKey = "1" | "2" | "3" | "4p";

/**
 * The recommended claim, as a SHARE OF THE SEASON BUDGET.
 *
 * ABSOLUTE RULE: the board never prints a dollar figure. A public page does not
 * know a reader's budget, and a $12 bid means one thing in a $100 league and
 * another in a $1,000 one. A share of the budget means the same thing in both,
 * which is why the calculator works in shares throughout and this does too.
 */
export type BoardBid = {
  /**
   * The value bid: the smallest share that wins about 60 percent of the time
   * against a market like this one (settings.goal.valueTarget).
   */
  lowPct: number;
  /** The make-sure bid: about 90 percent (settings.goal.sureTarget). */
  highPct: number;
  /** Rivals the price assumes, including the reader. */
  bidders: BidderKey;
  /**
   * Where the number came from. "claims" when his own recent auctions carry
   * most of the weight, "blended" when they carry some, "market" when he has
   * none and the price is the measured market for players like him.
   */
  basis: "claims" | "blended" | "market";
  tier: "free" | "cheap" | "real" | "priority";
  tierLabel: string;
};

/** One player on the board. */
export type BoardRow = {
  playerId: string;
  slug: string;
  sleeperId: string | null;
  name: string;
  position: BoardPosition;
  team: string | null;
  /** Overall and positional rank in the reader's resolved source and format. */
  overallRank: number;
  positionRank: number;
  /** Trade value in the reader's resolved source. Null when the source has none. */
  value: number | null;
  rosterRate: RosterRate | null;
  opportunity: Opportunity;
  projection: BoardProjection | null;
  /**
   * His projection minus the last startable player at his position, in a
   * league of the board's stated size. Null when he has no projection.
   */
  pointsAboveReplacement: number | null;
  /** His own recent auctions. Null when nobody claimed him in the window. */
  market: ClaimMarket | null;
  bid: BoardBid | null;
  /**
   * The one sentence saying why he is on the list, built from the figures on
   * the row by `lib/waiver-wire/reasons.ts`. Deterministic templates, never a
   * language model: every clause cites a number the reader can see beside it.
   */
  reason: string;
  /** The ordering score. Exposed so a test can pin the sort. */
  score: number;
};

/**
 * The league this board priced, stated rather than assumed.
 *
 * Printed on the page in full. A bid range means nothing without it, and a
 * reader whose league is different needs to know that before they trust the
 * number rather than after.
 */
export type BoardAssumptions = {
  teams: number;
  offensiveStarters: number;
  /** Which market the bids were read from, in words, e.g. "dynasty superflex". */
  marketName: string;
  /** The waiver weeks the per-player claim prices cover. Null when none. */
  claimWeeks: { from: number; to: number } | null;
  /** Auctions behind the per-player prices, summed across the board. */
  claimAuctions: number;
  /** The format's display name, e.g. "Redraft PPR". */
  formatName: string;
  /** The value source's display name, e.g. "KeepTradeCut". */
  sourceName: string;
  /** Which projection engine produced the points. */
  projectionSourceName: string;
  /**
   * The rostered share at or above which a player is treated as unavailable
   * and left off the board, 0 to 100.
   */
  availabilityCeilingPct: number;
};

/**
 * One of the most-claimed players in the latest waiver runs, whether or not he
 * is still available. The board lists who you can still get; this lists what
 * the room actually spent on, which is the market the bids are read from.
 */
export type HotClaim = {
  playerId: string;
  slug: string;
  name: string;
  position: string;
  team: string | null;
  sleeperId: string | null;
  market: ClaimMarket;
  /** Rostered share now, 0 to 100. Null without a roster-rate row. */
  rosterPct: number | null;
  /** True when he is still on this week's board. */
  onBoard: boolean;
};

/** Everything one week's board needs to render. */
export type WaiverBoard = {
  season: number;
  week: number;
  /** The live NFL week, which may be behind or ahead of the board's week. */
  currentWeek: number;
  rows: BoardRow[];
  /** The most-claimed players in the claim window, most auctions first. */
  hotClaims: HotClaim[];
  assumptions: BoardAssumptions;
  /** When the roster rates behind the availability column were computed. */
  rosterRatesComputedAt: string | null;
  /**
   * Why the board is empty, when it is. Null when there are rows. An empty
   * board is never presented as "nobody is worth adding": it is presented as
   * the specific thing we are missing.
   */
  emptyReason: BoardEmptyReason | null;
};

export type BoardEmptyReason =
  | "no-season"
  | "no-projections"
  | "no-roster-rates"
  | "no-rankings";
