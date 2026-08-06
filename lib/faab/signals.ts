/**
 * The reads that sharpen a bid once we know what a player would add.
 *
 * The swap test says how many points he puts in your lineup if the projection
 * is right. These signals are about how much to trust that projection, and they
 * split into two kinds that behave differently:
 *
 *   - Signals that MOVE the bid. A player who beats his number two weeks in
 *     three is worth more than the same projection attached to someone who
 *     misses it constantly.
 *   - Signals that WIDEN the bid. A boom-or-bust player does not deserve a
 *     higher or lower number, he deserves a less confident one. Collapsing that
 *     into a point estimate would be the model lying about what it knows.
 *
 * The most important one here is opportunity. The single best predictor of
 * whether a waiver add keeps producing is not last week's points, it is last
 * week's snap share: 22 points on 12 snaps is a coincidence, and 11 points on
 * 70% of the snaps is a job. We have snap counts, so we say which one it is.
 *
 * Pure. Everything arrives as plain numbers.
 */

import type { MarginalWeek, FaabSignal, SignalSettings } from "./types";

/** Reliability history for one player, already blended across seasons. */
export type AccuracySignalInput = {
  beatRate: number | null;
  availabilityRate: number | null;
  ratioStdev: number | null;
  weeksPlayed: number;
};

/** One completed game, most recent last. */
export type GameLogEntry = {
  season: number;
  week: number;
  /** Share of his team's offensive snaps, 0 to 1. Null when not recorded. */
  snapPct: number | null;
  /** His team's offensive snap count that game. Guards against garbage reads. */
  teamSnaps: number | null;
  /** Targets plus carries. The volume half of the opportunity story. */
  touches: number | null;
};

export type PositionalFinish = {
  season: number;
  finish: number;
  playersRanked: number;
};

export type SignalInput = {
  position: string;
  accuracy: AccuracySignalInput | null;
  /** Ascending by week. Only completed games. */
  gameLogs: GameLogEntry[];
  /** Per-week detail from the swap, so matchups are weighted to weeks he plays. */
  weeks: MarginalWeek[];
  positionalFinishes: PositionalFinish[];
  currentSeason: number;
  settings: SignalSettings;
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function pctLabel(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/**
 * Turn a measurement into a multiplier that never exceeds its own ceiling.
 * `strength` is expected in -1..1, where 1 means "as good as this signal gets".
 */
function toMultiplier(strength: number, maxAdjustPct: number): number {
  return 1 + clamp(strength, -1, 1) * (maxAdjustPct / 100);
}

/** How often he meets or beats his own projection. */
function beatRateSignal(input: SignalInput): FaabSignal | null {
  const cfg = input.settings.beatRate;
  const acc = input.accuracy;
  if (!cfg.enabled || !acc || acc.beatRate === null) return null;
  if (acc.weeksPlayed < cfg.minWeeks) return null;

  // Distance from neutral, scaled by the room available on that side, so a
  // neutral of 0.5 treats 0.75 and 0.25 as equal and opposite.
  const span = acc.beatRate >= cfg.neutral ? 1 - cfg.neutral : cfg.neutral;
  const strength = span > 0 ? (acc.beatRate - cfg.neutral) / span : 0;
  if (Math.abs(strength) < 0.05) return null;

  const good = strength > 0;
  return {
    id: "beat-rate",
    label: good ? "Beats his projection" : "Misses his projection",
    detail: good
      ? `Beats his weekly number ${pctLabel(acc.beatRate)} of the time over ${acc.weeksPlayed} games. Treat the projection as a floor.`
      : `Hits his weekly number only ${pctLabel(acc.beatRate)} of the time over ${acc.weeksPlayed} games. Treat the projection as optimistic.`,
    tone: good ? "good" : "bad",
    multiplier: toMultiplier(strength, cfg.maxAdjustPct),
    spread: 0,
  };
}

/** Whether he is actually on the field. */
function availabilitySignal(input: SignalInput): FaabSignal | null {
  const cfg = input.settings.availability;
  const acc = input.accuracy;
  if (!cfg.enabled || !acc || acc.availabilityRate === null) return null;

  const span = acc.availabilityRate >= cfg.neutral ? 1 - cfg.neutral : cfg.neutral;
  const strength = span > 0 ? (acc.availabilityRate - cfg.neutral) / span : 0;
  // Only the downside is worth saying. "He shows up" is not news.
  if (strength >= -0.05) return null;

  return {
    id: "availability",
    label: "Misses time",
    detail: `Played only ${pctLabel(acc.availabilityRate)} of the weeks he was projected for. Points you cannot start are points you did not buy.`,
    tone: "bad",
    multiplier: toMultiplier(strength, cfg.maxAdjustPct),
    spread: 0,
  };
}

/**
 * Boom or bust. This widens the range rather than moving it, because the right
 * response to an unpredictable player is an unconfident number, not a smaller
 * one. A manager chasing a ceiling and a manager protecting a lead should read
 * the same wide range and make opposite decisions from it.
 */
function volatilitySignal(input: SignalInput): FaabSignal | null {
  const cfg = input.settings.volatility;
  const acc = input.accuracy;
  if (!cfg.enabled || !acc || acc.ratioStdev === null) return null;
  if (acc.ratioStdev <= cfg.neutral) return null;

  const over = (acc.ratioStdev - cfg.neutral) / Math.max(1e-6, cfg.neutral);
  const spread = clamp(over, 0, 1) * (cfg.maxSpreadPct / 100);
  if (spread < 0.02) return null;

  return {
    id: "volatility",
    label: "Boom or bust",
    detail:
      "His weekly scores swing hard, so this range is wider than usual. That is the shape of the add, not a knock on him.",
    tone: "neutral",
    multiplier: 1,
    spread,
  };
}

/**
 * Is the role real?
 *
 * Compares his snap share in the most recent games against the block before
 * them. A jump is the thing you are actually bidding on. A collapse is the trap
 * the box score hides.
 */
function opportunitySignal(input: SignalInput): FaabSignal | null {
  const cfg = input.settings.opportunity;
  if (!cfg.enabled) return null;

  const usable = input.gameLogs.filter(
    (g) =>
      g.snapPct !== null &&
      g.snapPct > 0 &&
      (g.teamSnaps === null || g.teamSnaps >= cfg.minTeamSnaps),
  );
  if (usable.length < cfg.recentGames + 1) return null;

  const recent = usable.slice(-cfg.recentGames);
  const prior = usable.slice(0, -cfg.recentGames).slice(-4);
  if (prior.length === 0) return null;

  const recentShare = mean(recent.map((g) => g.snapPct as number));
  const priorShare = mean(prior.map((g) => g.snapPct as number));
  const deltaPoints = (recentShare - priorShare) * 100;

  const recentTouches = mean(recent.map((g) => g.touches ?? 0));

  if (deltaPoints >= cfg.breakoutDeltaPoints) {
    const strength = clamp(deltaPoints / (cfg.breakoutDeltaPoints * 2), 0, 1);
    return {
      id: "opportunity",
      label: "His role just grew",
      detail: `Snap share ${pctLabel(priorShare)} to ${pctLabel(recentShare)} over the last ${recent.length} game${recent.length === 1 ? "" : "s"}${recentTouches > 0 ? `, on ~${recentTouches.toFixed(0)} touches a game` : ""}. A new role is what you are actually paying for.`,
      tone: "good",
      multiplier: toMultiplier(strength, cfg.maxAdjustPct),
      spread: 0,
    };
  }

  if (deltaPoints <= -cfg.collapseDeltaPoints) {
    const strength = clamp(deltaPoints / (cfg.collapseDeltaPoints * 2), -1, 0);
    return {
      id: "opportunity",
      label: "His role is shrinking",
      detail: `Snap share ${pctLabel(priorShare)} to ${pctLabel(recentShare)} over the last ${recent.length} game${recent.length === 1 ? "" : "s"}. Whatever the box score said, he is on the field less.`,
      tone: "bad",
      multiplier: toMultiplier(strength, cfg.maxAdjustPct),
      spread: 0,
    };
  }

  return null;
}

/**
 * Who he actually plays.
 *
 * Weighted to the weeks he would start for you, because a brutal week 15 draw
 * is irrelevant if he is on your bench that week. The multipliers come from our
 * own defense-versus-position table, which is built from real game results.
 * Sleeper's weekly projections cannot answer this: they are close to a season
 * average repeated every week, so every matchup would look identical.
 */
function matchupSignal(input: SignalInput): FaabSignal | null {
  const cfg = input.settings.matchup;
  if (!cfg.enabled) return null;

  const relevant = input.weeks.filter((w) => w.startsForYou && w.opponent);
  const pool = relevant.length > 0 ? relevant : input.weeks.filter((w) => w.opponent);
  if (pool.length === 0) return null;

  const avg = mean(pool.map((w) => w.opponentMultiplier));
  // The table runs roughly 0.8 to 1.25, so a tenth off neutral is a real edge.
  const strength = clamp((avg - 1) / 0.15, -1, 1);
  if (Math.abs(strength) < 0.2) return null;

  const good = strength > 0;
  const easy = pool.filter((w) => w.opponentMultiplier >= 1.08).length;
  const hard = pool.filter((w) => w.opponentMultiplier <= 0.92).length;

  return {
    id: "matchup",
    label: good ? "Favorable run of games" : "Rough run of games",
    detail: good
      ? `${easy} of his next ${pool.length} games are against defenses that give up more than average to his position.`
      : `${hard} of his next ${pool.length} games are against defenses that hold his position below average.`,
    tone: good ? "good" : "bad",
    multiplier: toMultiplier(strength, cfg.maxAdjustPct),
    spread: 0,
  };
}

/**
 * What his ceiling has actually looked like. Framing only: it never moves the
 * number, it just stops a reader from imagining a league-winner where the
 * history says flex piece.
 */
function ceilingSignal(input: SignalInput): FaabSignal | null {
  const cfg = input.settings.ceiling;
  if (!cfg.enabled) return null;

  const cutoff = input.currentSeason - cfg.lookbackSeasons;
  const recent = input.positionalFinishes.filter((f) => f.season > cutoff);
  if (recent.length === 0) return null;

  const best = recent.reduce((a, b) => (a.finish <= b.finish ? a : b));
  return {
    id: "ceiling",
    label: "His ceiling so far",
    detail: `Best finish in ${cfg.lookbackSeasons} seasons: ${input.position}${best.finish} in ${best.season}. Context, not a forecast.`,
    tone: "neutral",
    multiplier: 1,
    spread: 0,
  };
}

/** Every signal we can read for this player, strongest effect first. */
export function buildSignals(input: SignalInput): FaabSignal[] {
  const signals = [
    opportunitySignal(input),
    beatRateSignal(input),
    availabilitySignal(input),
    matchupSignal(input),
    volatilitySignal(input),
    ceilingSignal(input),
  ].filter((s): s is FaabSignal => s !== null);

  return signals.sort(
    (a, b) =>
      Math.abs(b.multiplier - 1) + b.spread - (Math.abs(a.multiplier - 1) + a.spread),
  );
}

/** The combined effect of every signal that moves the number. */
export function combinedMultiplier(signals: FaabSignal[]): number {
  return signals.reduce((product, s) => product * s.multiplier, 1);
}

/** The combined widening, capped so the range stays a range. */
export function combinedSpread(signals: FaabSignal[]): number {
  return clamp(
    signals.reduce((sum, s) => sum + s.spread, 0),
    0,
    0.6,
  );
}
