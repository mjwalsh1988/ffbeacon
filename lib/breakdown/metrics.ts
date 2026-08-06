/**
 * The single registry of everything the Beacon Breakdown compares.
 *
 * This file exists to fix one specific dishonesty. The headline verdict used to
 * be `valueA / (valueA + valueB)` while the table underneath computed eleven
 * separate comparisons, which meant the table could favour one player seven rows
 * to four while the meter above it pointed the other way. The table looked like
 * the evidence for a verdict it had played no part in producing.
 *
 * Now there is one list. Every entry knows how to display itself, how to score
 * itself as player A's share of the pair, and how much it counts under each
 * lens. The table renders the list, and the meter is the weighted average of the
 * same list. They cannot disagree, because they are the same numbers.
 *
 * Weights are raw and are renormalized at scoring time over the metrics that
 * actually resolved (see edge.ts). A metric we cannot measure drops out and the
 * survivors share its weight, rather than the missing value being treated as a
 * tie and quietly dragging the verdict toward the middle.
 *
 * `scored: false` marks the rows that are blends of other rows. Dynasty Outlook
 * is a useful label to read, but its inputs (value, age) are already weighted
 * individually, so counting it again would double count them. Those rows render
 * in the table and are excluded from the composite.
 */

import {
  fmtChange,
  fmtPct,
  fmtPoints,
  fmtRank,
  fmtValue,
  dynastyPhrase,
  finishText,
  healthScore,
  matchupPhrase,
  productionScore,
  redraftPhrase,
  riskPhrase,
  roleWeight,
  safetyScore,
  schedulePhrase,
  shareHigh,
  shareLow,
  shareSigned,
  upsidePhrase,
  upsideScore,
  youthScore,
} from "./scoring";
import type { BreakdownExtras, BreakdownPlayer, LensId } from "./types";

/** What a league connection contributes to a single player's comparison. */
export type LeagueImpact = {
  /** Points per week the reader's optimal lineup gains, after any cut. */
  netPointsPerWeek: number;
  /** Points he adds in the weeks he actually starts. */
  pointsPerStartedWeek: number;
  weeksStarting: number;
  weeksConsidered: number;
  isBenchOnly: boolean;
  /** Who the reader would cut to make room, when the roster is full. */
  dropName: string | null;
  dropCostPerWeek: number | null;
  /** Playoff odds with and without him, when we have a stored schedule. */
  playoffOddsBefore: number | null;
  playoffOddsAfter: number | null;
  titleOddsBefore: number | null;
  titleOddsAfter: number | null;
  expectedWinsAdded: number | null;
  /** True when this player is already on the reader's roster. */
  onYourRoster: boolean;
  /** The team that rosters him in this league, when someone does. */
  rosteredBy: string | null;
  weeks: { week: number; startsForYou: boolean; pointsAdded: number }[];
};

/** Everything one side of the comparison can be scored against. */
export type MetricSide = {
  player: BreakdownPlayer;
  extras: BreakdownExtras;
  league: LeagueImpact | null;
};

export type MetricGroup = "Market" | "Production" | "Outlook" | "Reliability" | "Your league";

export type Metric = {
  key: string;
  label: string;
  help: string;
  group: MetricGroup;
  /** False for blended rows that would double count their own inputs. */
  scored: boolean;
  /** Near-even guard for the row's Edge badge. */
  guard: number;
  /** True when the number renders with the FF Beacon value mark. */
  isBeaconValue?: boolean;
  display: (side: MetricSide) => string;
  note?: (side: MetricSide) => string | undefined;
  share: (a: MetricSide, b: MetricSide) => number | null;
  /** Raw weight per lens. Renormalized over the metrics that resolve. */
  weights: Record<LensId, number>;
};

const NO_WEIGHT: Record<LensId, number> = { dynasty: 0, "win-now": 0, "this-week": 0 };

/** Read a nested projection field without repeating the null checks. */
function proj(side: MetricSide) {
  return side.extras.projection;
}

function rel(side: MetricSide) {
  return side.extras.reliability;
}

/**
 * Reliability numbers are only shown once enough games have been graded. Four
 * weeks of data produces a beat rate that looks authoritative and is noise.
 */
const MIN_GRADED_WEEKS = 4;

function gradedRel(side: MetricSide) {
  const r = rel(side);
  if (!r || r.weeksPlayed < MIN_GRADED_WEEKS) return null;
  return r;
}

export const METRICS: Metric[] = [
  /* ---------------------------------------------------------------- */
  /* Market                                                            */
  /* ---------------------------------------------------------------- */
  {
    key: "value",
    label: "FF Beacon Value",
    help: "Current market value on the trusted FF Beacon scale for this format.",
    group: "Market",
    scored: true,
    guard: 0.02,
    isBeaconValue: true,
    display: (s) => fmtValue(s.player.value),
    share: (a, b) => shareHigh(a.player.value, b.player.value),
    weights: { dynasty: 0.32, "win-now": 0.08, "this-week": 0 },
  },
  {
    key: "overall-rank",
    label: "Overall Rank",
    help: "Where each player sits among every player at every position.",
    group: "Market",
    scored: true,
    guard: 0,
    display: (s) => fmtRank(s.player.overallRank),
    note: (s) =>
      s.player.rankChange30d != null && s.player.rankChange30d !== 0
        ? `${s.player.rankChange30d > 0 ? "Up" : "Down"} ${Math.abs(s.player.rankChange30d)} in 30 days`
        : undefined,
    share: (a, b) => shareLow(a.player.overallRank, b.player.overallRank),
    weights: { dynasty: 0.1, "win-now": 0.14, "this-week": 0 },
  },
  {
    key: "position-rank",
    label: "Positional Rank",
    help: "Rank within their own position group.",
    group: "Market",
    scored: true,
    guard: 0,
    display: (s) =>
      s.player.positionRank != null
        ? `${s.player.position.toUpperCase()}${s.player.positionRank}`
        : "-",
    note: (s) => (s.player.tier != null ? `Tier ${s.player.tier}` : undefined),
    share: (a, b) => shareLow(a.player.positionRank, b.player.positionRank),
    weights: { dynasty: 0.08, "win-now": 0.06, "this-week": 0 },
  },
  {
    key: "trend",
    label: "30-Day Trend",
    help: "How each player's value has moved over the last month.",
    group: "Market",
    scored: true,
    guard: 0.01,
    display: (s) => fmtChange(s.player.change30dPct, s.player.change30d),
    note: (s) =>
      s.player.high30d != null && s.player.low30d != null
        ? `Range ${s.player.low30d.toLocaleString()} to ${s.player.high30d.toLocaleString()}`
        : undefined,
    share: (a, b) => shareSigned(a.player.change30dPct, b.player.change30dPct),
    weights: { dynasty: 0.08, "win-now": 0.02, "this-week": 0 },
  },

  /* ---------------------------------------------------------------- */
  /* Production                                                        */
  /* ---------------------------------------------------------------- */
  {
    key: "production",
    label: "Recent Production",
    help: "Most recent full-season finish within their position by fantasy points.",
    group: "Production",
    scored: true,
    guard: 0,
    display: (s) => finishText(s.player),
    note: (s) => {
      const prior = s.player.recentFinishes.slice(1, 3);
      if (prior.length === 0) return undefined;
      const pos = s.player.position.toUpperCase();
      return `Before that: ${prior.map((f) => `${pos}${f.finish}`).join(", ")}`;
    },
    share: (a, b) =>
      shareLow(a.player.latestFinish?.finish ?? null, b.player.latestFinish?.finish ?? null),
    weights: { dynasty: 0.06, "win-now": 0.1, "this-week": 0 },
  },
  {
    key: "opportunity",
    label: "Opportunity",
    help: "Role on their team's depth chart, a proxy for expected volume.",
    group: "Production",
    scored: true,
    guard: 0.05,
    display: (s) => s.player.depthRole ?? "-",
    note: (s) =>
      s.player.depthOrder != null ? `Depth chart slot ${s.player.depthOrder}` : undefined,
    share: (a, b) => shareHigh(roleWeight(a.player.depthRole), roleWeight(b.player.depthRole)),
    weights: { dynasty: 0.03, "win-now": 0.08, "this-week": 0.12 },
  },
  {
    key: "health",
    label: "Health",
    help: "Current injury designation, which decides whether he can help you at all.",
    group: "Production",
    scored: true,
    guard: 0.02,
    display: (s) => s.player.injuryStatus ?? "Healthy",
    // Two healthy players can only ever score 0.5 here, so the row would consume
    // weight it cannot use and dilute every metric that actually differentiates
    // them. It resolves only once at least one side carries a designation.
    share: (a, b) => {
      if (a.player.injuryStatus == null && b.player.injuryStatus == null) return null;
      return shareHigh(healthScore(a.player.injuryStatus), healthScore(b.player.injuryStatus));
    },
    weights: { dynasty: 0.01, "win-now": 0.04, "this-week": 0.1 },
  },

  /* ---------------------------------------------------------------- */
  /* Outlook (forward-looking, from the Power Pulse projection model)   */
  /* ---------------------------------------------------------------- */
  {
    key: "ros-points",
    label: "Rest-of-Season Points",
    help: "Projected fantasy points across every remaining game, adjusted for matchups and reliability.",
    group: "Outlook",
    scored: true,
    guard: 0.02,
    display: (s) => fmtPoints(proj(s)?.totalPoints ?? null),
    note: (s) => {
      const p = proj(s);
      return p ? `${p.weeks.length} game${p.weeks.length === 1 ? "" : "s"} left` : undefined;
    },
    share: (a, b) => shareHigh(proj(a)?.totalPoints ?? null, proj(b)?.totalPoints ?? null),
    weights: { dynasty: 0.04, "win-now": 0.24, "this-week": 0 },
  },
  {
    key: "per-game-points",
    label: "Projected Per Game",
    help: "Average projected points in each remaining game.",
    group: "Outlook",
    scored: true,
    guard: 0.02,
    display: (s) => fmtPoints(proj(s)?.perGame ?? null),
    note: (s) => {
      const p = proj(s);
      if (!p || p.weeks.length === 0) return undefined;
      return `Range ${fmtPoints(p.floorPoints / Math.max(1, p.weeks.length))} to ${fmtPoints(
        p.ceilingPoints / Math.max(1, p.weeks.length),
      )}`;
    },
    share: (a, b) => shareHigh(proj(a)?.perGame ?? null, proj(b)?.perGame ?? null),
    weights: { dynasty: 0.02, "win-now": 0.1, "this-week": 0.04 },
  },
  {
    key: "next-week",
    label: "Next Game",
    help: "Projected points in the very next game we have a projection for.",
    group: "Outlook",
    scored: true,
    guard: 0.02,
    display: (s) => fmtPoints(proj(s)?.nextWeek?.points ?? null),
    note: (s) => {
      const nw = proj(s)?.nextWeek;
      if (!nw) return undefined;
      return nw.opponent ? `Week ${nw.week} vs ${nw.opponent}` : `Week ${nw.week}`;
    },
    share: (a, b) => shareHigh(proj(a)?.nextWeek?.points ?? null, proj(b)?.nextWeek?.points ?? null),
    weights: { dynasty: 0, "win-now": 0.02, "this-week": 0.34 },
  },
  {
    key: "matchup",
    label: "Next Matchup",
    help: "How generous the next opponent has been to this position, from our own defensive splits.",
    group: "Outlook",
    scored: true,
    guard: 0.01,
    display: (s) => {
      const nw = proj(s)?.nextWeek;
      return nw ? matchupPhrase(nw.opponentMultiplier) : "-";
    },
    note: (s) => {
      const nw = proj(s)?.nextWeek;
      if (!nw?.opponent) return undefined;
      return `vs ${nw.opponent}, ${nw.opponentMultiplier.toFixed(2)}x`;
    },
    share: (a, b) =>
      shareHigh(
        proj(a)?.nextWeek?.opponentMultiplier ?? null,
        proj(b)?.nextWeek?.opponentMultiplier ?? null,
      ),
    weights: { dynasty: 0, "win-now": 0.02, "this-week": 0.16 },
  },
  {
    key: "schedule",
    label: "Remaining Schedule",
    help: "Average matchup difficulty across every game left, from our own defensive splits.",
    group: "Outlook",
    scored: true,
    guard: 0.01,
    display: (s) => schedulePhrase(proj(s)?.scheduleMultiplier ?? null),
    note: (s) => {
      const m = proj(s)?.scheduleMultiplier;
      return m != null ? `${m.toFixed(2)}x average` : undefined;
    },
    share: (a, b) =>
      shareHigh(proj(a)?.scheduleMultiplier ?? null, proj(b)?.scheduleMultiplier ?? null),
    weights: { dynasty: 0, "win-now": 0.06, "this-week": 0 },
  },

  /* ---------------------------------------------------------------- */
  /* Reliability (measured against their own projections)               */
  /* ---------------------------------------------------------------- */
  {
    key: "beat-rate",
    label: "Beat Rate",
    help: "How often he meets or beats his own weekly projection. Weeks he was projected for but missed count against him.",
    group: "Reliability",
    scored: true,
    guard: 0.02,
    display: (s) => fmtPct(gradedRel(s)?.beatRate ?? null),
    note: (s) => {
      const r = gradedRel(s);
      return r ? `${r.weeksPlayed} graded game${r.weeksPlayed === 1 ? "" : "s"}` : undefined;
    },
    share: (a, b) => shareHigh(gradedRel(a)?.beatRate ?? null, gradedRel(b)?.beatRate ?? null),
    weights: { dynasty: 0.02, "win-now": 0.1, "this-week": 0.14 },
  },
  {
    key: "availability",
    label: "Availability",
    help: "Share of the weeks he was projected for that he actually played.",
    group: "Reliability",
    scored: true,
    guard: 0.02,
    display: (s) => fmtPct(gradedRel(s)?.availabilityRate ?? null),
    share: (a, b) =>
      shareHigh(gradedRel(a)?.availabilityRate ?? null, gradedRel(b)?.availabilityRate ?? null),
    weights: { dynasty: 0.02, "win-now": 0.08, "this-week": 0 },
  },
  {
    key: "consistency",
    label: "Week-to-Week Consistency",
    help: "How much his weekly score bounces around his projection. Steadier is better for setting a lineup.",
    group: "Reliability",
    scored: true,
    guard: 0.02,
    display: (s) => riskPhrase(s.player, gradedRel(s)?.ratioStdev ?? null),
    note: (s) => {
      const r = gradedRel(s);
      return r?.ratioStdev != null ? `Spread ${r.ratioStdev.toFixed(2)}` : undefined;
    },
    share: (a, b) => shareLow(gradedRel(a)?.ratioStdev ?? null, gradedRel(b)?.ratioStdev ?? null),
    weights: { dynasty: 0.02, "win-now": 0.06, "this-week": 0.1 },
  },

  /* ---------------------------------------------------------------- */
  /* Long-term profile                                                  */
  /* ---------------------------------------------------------------- */
  {
    key: "age",
    label: "Age & Long-Term Appeal",
    help: "Younger players hold value longer in dynasty formats.",
    group: "Outlook",
    scored: true,
    guard: 0.06,
    display: (s) =>
      s.player.ageDecimal != null ? `${s.player.ageDecimal.toFixed(1)} yrs` : "-",
    note: (s) =>
      s.player.yearsExperience != null
        ? `${s.player.yearsExperience === 0 ? "Rookie" : `Year ${s.player.yearsExperience + 1}`}`
        : undefined,
    share: (a, b) => shareHigh(youthScore(a.player.age), youthScore(b.player.age)),
    weights: { dynasty: 0.18, "win-now": 0, "this-week": 0 },
  },
  {
    key: "risk",
    label: "Risk Level",
    help: "Lower-risk profiles combine a steady weekly score, a proven tier, and prime age.",
    group: "Reliability",
    scored: true,
    guard: 0.05,
    display: (s) => riskPhrase(s.player, gradedRel(s)?.ratioStdev ?? null),
    share: (a, b) =>
      shareHigh(
        safetyScore(a.player, gradedRel(a)?.ratioStdev ?? null),
        safetyScore(b.player, gradedRel(b)?.ratioStdev ?? null),
      ),
    weights: { dynasty: 0.06, "win-now": 0.02, "this-week": 0 },
  },
  {
    key: "upside",
    label: "Upside",
    help: "Room to climb, blending recent momentum, youth, and tier.",
    group: "Outlook",
    scored: true,
    guard: 0.05,
    display: (s) => upsidePhrase(s.player),
    share: (a, b) => shareHigh(upsideScore(a.player), upsideScore(b.player)),
    weights: { dynasty: 0.12, "win-now": 0.02, "this-week": 0 },
  },

  /* ---------------------------------------------------------------- */
  /* Your league (only resolves when a league is connected)             */
  /* ---------------------------------------------------------------- */
  {
    key: "lineup-impact",
    label: "Points Added to Your Lineup",
    help: "What your optimal starting lineup gains each week by adding him, after cutting whoever you would cut.",
    group: "Your league",
    scored: true,
    guard: 0.02,
    display: (s) =>
      s.league ? `${s.league.netPointsPerWeek >= 0 ? "+" : ""}${s.league.netPointsPerWeek.toFixed(1)}/wk` : "-",
    note: (s) => {
      if (!s.league) return undefined;
      if (s.league.onYourRoster) return "Already on your roster";
      if (s.league.isBenchOnly) return "Never cracks your lineup";
      return `Starts ${s.league.weeksStarting} of ${s.league.weeksConsidered} weeks`;
    },
    // Lineup gains are small non-negative numbers, so a plain ratio would call
    // 0.4 against 0.2 a blowout. The shift compresses that into a sane share.
    share: (a, b) =>
      shareSigned(a.league?.netPointsPerWeek ?? null, b.league?.netPointsPerWeek ?? null, 6),
    weights: { dynasty: 0.05, "win-now": 0.3, "this-week": 0.22 },
  },
  {
    key: "weeks-starting",
    label: "Weeks He Starts for You",
    help: "How many of your remaining weeks he would actually be in your starting lineup.",
    group: "Your league",
    scored: true,
    guard: 0.03,
    display: (s) =>
      s.league ? `${s.league.weeksStarting} of ${s.league.weeksConsidered}` : "-",
    share: (a, b) =>
      shareSigned(a.league?.weeksStarting ?? null, b.league?.weeksStarting ?? null, 2),
    weights: { dynasty: 0, "win-now": 0.1, "this-week": 0.1 },
  },
  {
    key: "playoff-odds",
    label: "Your Playoff Odds With Him",
    help: "Your simulated playoff chance after adding him, against your chance as you stand now.",
    group: "Your league",
    scored: true,
    guard: 0.01,
    display: (s) =>
      s.league?.playoffOddsAfter != null ? fmtPct(s.league.playoffOddsAfter, 1) : "-",
    note: (s) => {
      const l = s.league;
      if (!l || l.playoffOddsBefore == null || l.playoffOddsAfter == null) return undefined;
      const delta = (l.playoffOddsAfter - l.playoffOddsBefore) * 100;
      return `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} points versus now`;
    },
    share: (a, b) =>
      shareSigned(
        a.league?.playoffOddsAfter != null && a.league?.playoffOddsBefore != null
          ? a.league.playoffOddsAfter - a.league.playoffOddsBefore
          : null,
        b.league?.playoffOddsAfter != null && b.league?.playoffOddsBefore != null
          ? b.league.playoffOddsAfter - b.league.playoffOddsBefore
          : null,
        0.25,
      ),
    weights: { dynasty: 0, "win-now": 0.12, "this-week": 0.04 },
  },

  /* ---------------------------------------------------------------- */
  /* Blended reads. Displayed, never scored (their inputs already are). */
  /* ---------------------------------------------------------------- */
  {
    key: "dynasty",
    label: "Dynasty Outlook",
    help: "A plain-language read blending market value with age. Shown for context; its inputs are already scored above, so it does not count twice.",
    group: "Outlook",
    scored: false,
    guard: 0.04,
    display: (s) => dynastyPhrase(s.player),
    note: (s) => (s.player.ageDecimal != null ? `Age ${s.player.ageDecimal.toFixed(1)}` : undefined),
    share: (a, b) => {
      const vShare = shareHigh(a.player.value, b.player.value);
      const yShare = shareHigh(youthScore(a.player.age), youthScore(b.player.age));
      if (vShare != null && yShare != null) return 0.6 * vShare + 0.4 * yShare;
      return vShare ?? yShare;
    },
    weights: NO_WEIGHT,
  },
  {
    key: "redraft",
    label: "Redraft Outlook",
    help: "A plain-language read blending rank with recent production. Shown for context; its inputs are already scored above.",
    group: "Outlook",
    scored: false,
    guard: 0.04,
    display: (s) => redraftPhrase(s.player),
    share: (a, b) => {
      const rShare = shareLow(a.player.overallRank, b.player.overallRank);
      const pShare = shareHigh(
        productionScore(a.player.latestFinish?.finish ?? null),
        productionScore(b.player.latestFinish?.finish ?? null),
      );
      if (rShare != null && pShare != null) return 0.6 * rShare + 0.4 * pShare;
      return rShare ?? pShare;
    },
    weights: NO_WEIGHT,
  },
];

/** Metric lookup by key, for the takeaway builders. */
export const METRIC_BY_KEY = new Map(METRICS.map((m) => [m.key, m]));
