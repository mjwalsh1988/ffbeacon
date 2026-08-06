/**
 * Shared shapes for the Beacon Breakdown.
 *
 * Split out of lib/beacon-breakdown.ts so the scoring, metric, edge, and verdict
 * modules can all speak the same language without importing the loader (and the
 * Supabase client that comes with it). Everything here is plain data, so the
 * client bundles can import the types freely.
 */

import type { PositionalFinish } from "@/lib/player-profile";

/** Which side of the matchup holds the edge for a given row or takeaway. */
export type EdgeWinner = "a" | "b" | "even" | "na";

/** The two players slotted into the matchup. */
export type BreakdownSlot = "a" | "b";

/**
 * The question the reader is actually asking. Each lens is a different weighting
 * of the same measured metrics, so switching lenses never changes the numbers,
 * only how much each one counts toward the verdict.
 */
export type LensId = "dynasty" | "win-now" | "this-week";

export type Lens = {
  id: LensId;
  label: string;
  /** One line explaining what this lens optimizes for. */
  blurb: string;
};

export const LENSES: Lens[] = [
  {
    id: "dynasty",
    label: "Dynasty",
    blurb: "Long-term value: what this player is worth to hold for years.",
  },
  {
    id: "win-now",
    label: "Win now",
    blurb: "The rest of this season: who helps you win games between now and the playoffs.",
  },
  {
    id: "this-week",
    label: "This week",
    blurb: "The next game only: projection, matchup, and whether he is healthy.",
  },
];

export const DEFAULT_LENS: LensId = "dynasty";

export function isLensId(value: unknown): value is LensId {
  return LENSES.some((l) => l.id === value);
}

/** One remaining week of a player's projected output. */
export type ProjectedWeekPoint = {
  week: number;
  /** Projected points after opponent, reliability, availability, and injury. */
  points: number;
  /** Before those adjustments, so the UI can show what moved. */
  rawPoints: number;
  /** One standard deviation, from the player's own measured spread. */
  sigma: number;
  opponent: string | null;
  /** Below 1 is a tough matchup, above 1 is a generous one. */
  opponentMultiplier: number;
};

/** The forward-looking read for one player. Null fields mean "we have nothing". */
export type BreakdownProjection = {
  season: number;
  fromWeek: number;
  weeks: ProjectedWeekPoint[];
  /** Summed projected points across every remaining week we can project. */
  totalPoints: number;
  perGame: number | null;
  /** Roll-up of the weekly sigmas, treating weeks as independent. */
  seasonSigma: number;
  /** Roughly a one-sigma band on the season total, floored at zero. */
  floorPoints: number;
  ceilingPoints: number;
  nextWeek: ProjectedWeekPoint | null;
  /** Mean opponent multiplier across the remaining weeks. Higher is easier. */
  scheduleMultiplier: number | null;
  /** True when the league's own scoring settings drove the numbers. */
  usedLeagueScoring: boolean;
};

/** How well a player has historically held up against his own projection. */
export type BreakdownReliability = {
  /** Share of projected weeks he met or beat the number, 0..1. */
  beatRate: number | null;
  /** Share of projected weeks he actually played, 0..1. */
  availabilityRate: number | null;
  /** Average points above or below projection, per graded week. */
  meanDiff: number | null;
  /** Standard deviation of the actual/projected ratio. Lower is steadier. */
  ratioStdev: number | null;
  /** Recency-weighted multiplier the projection engine applies. */
  shrunkMultiplier: number | null;
  weeksPlayed: number;
  weeksProjected: number;
  /** Per-week actual versus projected for the most recent graded season. */
  weeks: ReliabilityWeek[];
  season: number | null;
};

export type ReliabilityWeek = {
  week: number;
  projected: number | null;
  actual: number | null;
  /** True when he was projected for the week and did not play. */
  missed: boolean;
};

/** Where the draft market has a player, versus where we rank him. */
export type BreakdownMarket = {
  /** Sleeper ADP for the closest published format, or null. */
  adp: number | null;
  /** Which Sleeper ADP key the number came from, for the footnote. */
  adpBasis: string | null;
  /** Rounds early or late versus our overall rank. Positive means undervalued. */
  adpRoundsLate: number | null;
  /** Value history for the overlay chart, ascending by capture time. */
  series: { t: string; value: number }[];
  high30d: number | null;
  low30d: number | null;
  volatility30d: number | null;
  rankChange30d: number | null;
  change90dPct: number | null;
};

/** Everything one player contributes to the comparison. */
export type BreakdownPlayer = {
  slug: string;
  id: string;
  name: string;
  position: string;
  team: string | null;
  /** The team's primary brand color (nfl_teams.primary_color), for the card
   * gradient. Null when the player is a free agent or the team is unmapped. */
  teamPrimary: string | null;
  sleeperId: string | null;
  /** Whole-years age, used for the youth/age scoring. */
  age: number | null;
  /** Exact age carried to one decimal, for display only (e.g. 23.4). */
  ageDecimal: number | null;
  yearsExperience: number | null;
  /** Sleeper injury designation, verbatim. Null when healthy. */
  injuryStatus: string | null;
  value: number | null;
  overallRank: number | null;
  positionRank: number | null;
  tier: number | null;
  change7d: number | null;
  change30d: number | null;
  change30dPct: number | null;
  change90dPct: number | null;
  trend30d: "up" | "down" | "stable" | null;
  volatility30d: number | null;
  high30d: number | null;
  low30d: number | null;
  rankChange30d: number | null;
  latestFinish: PositionalFinish | null;
  recentFinishes: PositionalFinish[];
  depthRole: string | null;
  /** Depth chart slot (1 = first on the chart). Null when not depth-charted. */
  depthOrder: number | null;
};

/** A player plus every optional read the later tabs need. */
export type BreakdownExtras = {
  projection: BreakdownProjection | null;
  reliability: BreakdownReliability | null;
  market: BreakdownMarket | null;
};

/** One comparison row in the breakdown table. */
export type BreakdownRow = {
  key: string;
  /** Plain-language category label. */
  label: string;
  /** One-sentence explanation of what the row measures. */
  help: string;
  /** Player A's cell value (already formatted for display). */
  aDisplay: string;
  /** Player B's cell value. */
  bDisplay: string;
  /** Optional short qualitative note under each cell (derived rows). */
  aNote?: string;
  bNote?: string;
  winner: EdgeWinner;
  /** True when the numbers render with the FF Beacon value mark. */
  valueIsBeacon?: boolean;
  /** Player A's share of the pair, 0..1, or null when a side is missing. */
  share: number | null;
  /** How much this row moved the active lens's verdict, signed toward A. */
  contribution: number | null;
  /** The renormalized weight this row carried under the active lens, 0..1. */
  weight: number;
};

export type EdgeLabel = "Toss-Up" | "Slight Edge" | "Clear Edge" | "Strong Edge";

/** One row's signed pull on the composite, for the contribution chart. */
export type EdgeContribution = {
  key: string;
  label: string;
  /** Player A's share of the pair, 0..1. */
  share: number;
  weight: number;
  /** weight * (share - 0.5). Positive favors A. Sums to aShare - 0.5. */
  contribution: number;
  winner: EdgeWinner;
};

/** The headline "Beacon Edge" verdict meter. */
export type BeaconEdge = {
  /** Player A's share of the combined signal, 0-100 (a + b === 100). */
  aPct: number;
  bPct: number;
  leader: "a" | "b" | "even";
  label: EdgeLabel;
  /** What the meter is measured on, named in plain language. */
  basis: string;
  lens: LensId;
  /** Every row that carried weight, largest pull first. */
  contributions: EdgeContribution[];
  /** How many metrics actually had data on both sides. */
  metricsUsed: number;
};

/** A plain-English scannable takeaway. */
export type Takeaway = {
  key: string;
  label: string;
  winner: EdgeWinner;
  detail: string;
};
