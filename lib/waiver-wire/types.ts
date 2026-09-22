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
 *   5. WHAT SHOULD I BID. `bid`, from
 *      `lib/faab/calculate-faab.ts calculateFaabRecommendation`, the same
 *      function the FAAB calculator runs. One engine, so the article and the
 *      tool can never disagree about a player.
 *
 * ABSOLUTE RULE: the bid on this page is priced for a STATED standard league
 * and is labelled as one everywhere it appears. The calculator can ask what a
 * player does for YOUR roster because it has your roster; a public article
 * cannot, and pretending otherwise would put a precise-looking number on a
 * question nobody asked. Every board says which league it priced
 * (`BoardAssumptions`) and links to the calculator for the reader's own.
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

/** The recommended claim, priced for the board's stated standard league. */
export type BoardBid = {
  /** Dollars in a $100 budget, which is also the percentage of one. */
  lowPct: number;
  highPct: number;
  /** The calculator's own label for the tier this claim fell in. */
  tierLabel: string;
  /** True when the engine's answer is "do not bid, he will clear waivers". */
  isDumpCandidate: boolean;
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
  budget: number;
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

/** Everything one week's board needs to render. */
export type WaiverBoard = {
  season: number;
  week: number;
  /** The live NFL week, which may be behind or ahead of the board's week. */
  currentWeek: number;
  rows: BoardRow[];
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
