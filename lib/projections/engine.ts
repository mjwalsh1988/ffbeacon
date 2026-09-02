/**
 * computeBeaconProjections: the FF Beacon projection, assembled.
 *
 * PURE. Takes plain data, returns plain data, does no I/O and reads no clock,
 * the same contract as lib/positional-war/engine.ts. The I/O half is
 * lib/build-beacon-projections.ts.
 *
 * THE MODEL, IN ONE PARAGRAPH
 *
 * A player's ROLE is measured from our own player_stats and shrunk with a small
 * prior, because a role is the part of a line that persists. His EFFICIENCY is
 * measured the same way and shrunk with a prior six times larger toward the
 * positional average, because touchdown rate, yards per carry and yards per
 * target all revert hard. Role times his team's expected volume gives
 * opportunity; opportunity times efficiency gives a component stat line. The
 * game's published total and spread move the volume and the scoring rate. The
 * result is calibrated for the over-spread every projection source has, then
 * BLENDED with Sleeper rather than replacing it.
 *
 * WHY EVERY SLEEPER ROW IS MIRRORED, EVEN THE ONES WE CANNOT IMPROVE
 *
 * The stored ffbeacon source is a COMPLETE mirror of Sleeper's rows for the
 * window. A rookie with no history, a week Sleeper marked "out", a player whose
 * team we could not identify: all of them are copied through unchanged with a
 * blend weight of 0.
 *
 * That is not tidiness, it is correctness. A reader switching to the ffbeacon
 * source reads ONLY ffbeacon rows, so any week we declined to write would
 * simply vanish from that reader's world, and a vanished week is indembleable
 * from a bye. Mirroring means switching sources can change what a number IS but
 * can never change which weeks EXIST, and it keeps Sleeper's availability
 * taxonomy (projected, out, unprojected) intact across the switch.
 *
 * Bye weeks are the one thing that stays absent, because Sleeper has no row for
 * them either, and inventing one would put a real number where the season has
 * no game.
 *
 * WHAT WE DO NOT PROJECT
 *
 * Kickers and defenses. Their production is a function of team scoring and
 * opponent turnovers rather than individual usage, so a usage model would be
 * worse than Sleeper's number rather than better. They are mirrored at weight 0
 * and left alone.
 */

import { scoreStatMap, type ScoringSettings } from "@/lib/league-scoring";
import { canonicalScoringForFormat } from "@/lib/draft-value/default-settings";
import { blendStatLines, blendWeight } from "./blend";
import { calibrateStatLine } from "./calibrate";
import { toStatLine } from "./convert";
import type { ProjectionSettings } from "./default-settings";
import {
  computeEfficiencyRates,
  computeUsageShares,
  type PlayerStatRow,
} from "./usage";
import {
  applyEnvironment,
  computeTeamVolume,
  environmentEffect,
} from "./volume";
import {
  isProjectablePosition,
  type BeaconProjection,
  type EfficiencyRates,
  type GameEnvironment,
  type ProjectionPosition,
  type StatLine,
} from "./types";

/** The three canonical bases every stored projection row carries. */
const CANONICAL_SCORING: Record<
  "pts_ppr" | "pts_half_ppr" | "pts_std",
  ScoringSettings
> = {
  pts_ppr: canonicalScoringForFormat({ scoringType: "ppr", tePremiumBonus: 0 }),
  pts_half_ppr: canonicalScoringForFormat({
    scoringType: "half_ppr",
    tePremiumBonus: 0,
  }),
  pts_std: canonicalScoringForFormat({
    scoringType: "standard",
    tePremiumBonus: 0,
  }),
};

/**
 * How many players at each position sit inside the range where starters live.
 *
 * Used ONLY as the population the calibration mean is taken over. The published
 * calibration slopes were measured on top players, not on the whole projectable
 * pool, and a mean dragged down by three hundred deep-bench receivers projected
 * near zero would leave the correction with almost nothing to compress toward.
 *
 * These are the same startable counts lib/power-pulse/default-settings.ts used
 * when it measured the variance fallbacks, and for the same stated reason: the
 * range where starters live is the range the number is about.
 */
const STARTABLE_DEPTH: Record<ProjectionPosition, number> = {
  QB: 24,
  RB: 36,
  WR: 48,
  TE: 18,
};

/**
 * Bounds on red zone leverage.
 *
 * A back who takes a larger share of his team's red zone carries than of its
 * carries overall scores more touchdowns per carry than his workload alone
 * implies, and a back used only between the twenties scores fewer. That is the
 * goal-line back against the committee back, and it is the one piece of
 * situational information our stats carry that a raw carry share throws away.
 *
 * Bounded hard because the ratio is a quotient of two small numbers and can run
 * away: a back with two red zone carries and eight carries would otherwise read
 * as scoring at three times the normal rate.
 */
const RZ_LEVERAGE_MIN = 0.5;
const RZ_LEVERAGE_MAX = 1.75;

/** Sleeper's stored row for one player and week, as the engine needs it. */
export type SleeperProjectionRow = {
  playerId: string;
  week: number;
  statLine: StatLine | null;
  team: string | null;
  opponent: string | null;
  /** Sleeper's own verdict: projected, out, or unprojected. */
  availability: string;
  /**
   * Sleeper's own PUBLISHED point totals, carried verbatim.
   *
   * These are NOT the dot product of the stat line above against canonical
   * scoring, and assuming they were is a mistake that costs real accuracy.
   * Measured against a live 2026 quarterback row on 2026-09-01: the stat line
   * dot-products to 20.36 PPR while Sleeper publishes 23.26, a gap of about
   * 14%, because Sleeper's own default scoring counts things the canonical map
   * does not (that row carries `bonus_rush_td_qb`, `pass_fd` and `rush_fd`).
   *
   * So the stored total is anchored on THIS number and our model is applied as
   * a delta to it. At a blend weight of 0 our row is then byte-identical to
   * Sleeper's in every scoring base, which is exactly what a mirror should be.
   */
  points: { ppr: number | null; halfPpr: number | null; std: number | null };
  /**
   * The `sleeper_player_id` stamped on THIS row, the one actually being
   * mirrored. This is the authoritative id, straight off the Sleeper row in
   * `player_weekly_projections`, and it is the primary write key for the
   * mirrored row this engine produces.
   *
   * Optional so a caller (or a test) that has not threaded it through still
   * type-checks: `toProjection` below falls back to the subject's
   * `players.external_ids.sleeper` mapping when it is absent. That fallback
   * is what this field exists to demote to a fallback rather than the only
   * option: before this field existed, the players-table mapping was the ONLY
   * source for the write key, so a missing or drifted `external_ids.sleeper`
   * silently dropped the player-week with no log line and no counter.
   */
  sleeperPlayerId?: string;
};

/** Who we are projecting. */
export type EngineSubject = {
  playerId: string;
  sleeperPlayerId: string;
  /** Any position, including K and DEF, which are mirrored rather than modelled. */
  position: string;
  team: string | null;
};

export type EngineInput = {
  /** The season being projected. */
  season: number;
  /** The season whose stats count as current for recency weighting. */
  currentSeason: number;
  /** The newest week of `currentSeason` that has stats. */
  latestWeek: number;
  /** History the usage and efficiency models read. */
  stats: readonly PlayerStatRow[];
  subjects: readonly EngineSubject[];
  /** Sleeper's rows, keyed `${playerId}|${week}`. */
  sleeper: ReadonlyMap<string, SleeperProjectionRow>;
  /** Game environment, keyed `${team}|${week}`. */
  environment: ReadonlyMap<string, GameEnvironment>;
  settings: ProjectionSettings;
};

export type EngineResult = {
  projections: BeaconProjection[];
  /**
   * Why rows came out mirrored rather than modelled. Every one of these is a
   * legitimate outcome, not an error, but the counts are how anyone can tell
   * whether the model is actually doing anything.
   */
  mirrored: {
    /** Position we deliberately do not model. */
    notProjectable: number;
    /** No usage shares: too little history, which is a rookie in week 1. */
    noShares: number;
    /** No team, so no volume to apply a share to. */
    noTeamVolume: number;
    /** Sleeper published no stat line and we had nothing to blend against. */
    noSleeperStatLine: number;
    /** Sleeper says the player cannot play. His own verdict stands. */
    unavailable: number;
    /** Shares and volume existed but produced no opportunity worth pricing. */
    noOpportunity: number;
  };
  modelled: number;
};

type Draft = {
  subject: EngineSubject;
  row: SleeperProjectionRow;
  position: ProjectionPosition | null;
  /** Our own line, before blending. Null when this row is mirrored. */
  beaconLine: StatLine | null;
  blendWeight: number;
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function pointsIn(line: StatLine, base: keyof typeof CANONICAL_SCORING): number {
  const scored = scoreStatMap(line, CANONICAL_SCORING[base]);
  return scored !== null && Number.isFinite(scored) ? scored : 0;
}

export function computeBeaconProjections(input: EngineInput): EngineResult {
  const { settings, sleeper, environment } = input;
  const params = {
    currentSeason: input.currentSeason,
    latestWeek: input.latestWeek,
  };

  const shares = computeUsageShares(input.stats, params, settings);
  const { byPlayer: playerRates, leagueByPosition } = computeEfficiencyRates(
    input.stats,
    params,
    settings,
  );
  const teamVolume = computeTeamVolume(input.stats, params, settings);

  // The pool of targets a team throws is not the same as the pool of passes it
  // attempts: a spike, a throwaway and a batted ball are all attempts that no
  // receiver is credited a target for. `computeTeamVolume` reports attempts,
  // and target share is measured against targets, so multiplying one by the
  // other without this correction would inflate every receiving projection by
  // the size of that gap. Measured league-wide off the same rows rather than
  // assumed, so it tracks whatever the real ratio turns out to be.
  const targetsPerAttempt = leagueTargetsPerAttempt(input.stats);
  const weekIndex = buildWeekIndex(sleeper);

  const mirrored: EngineResult["mirrored"] = {
    notProjectable: 0,
    noShares: 0,
    noTeamVolume: 0,
    noSleeperStatLine: 0,
    unavailable: 0,
    noOpportunity: 0,
  };
  let modelled = 0;

  const drafts: Draft[] = [];

  for (const subject of input.subjects) {
    const projectable = isProjectablePosition(subject.position)
      ? (subject.position.toUpperCase() as ProjectionPosition)
      : null;
    const share = shares.get(subject.playerId) ?? null;
    const rates = playerRates.get(subject.playerId) ?? null;

    for (const week of weekIndex.get(subject.playerId) ?? []) {
      const row = sleeper.get(`${subject.playerId}|${week}`);
      if (!row) continue;

      const mirror = (reason: keyof EngineResult["mirrored"]): void => {
        mirrored[reason] += 1;
        drafts.push({ subject, row, position: projectable, beaconLine: null, blendWeight: 0 });
      };

      if (projectable === null) {
        mirror("notProjectable");
        continue;
      }
      // Sleeper's own verdict about whether a player suits up is better than
      // anything a usage model can say, because a usage model has no idea he is
      // hurt. An "out" week keeps its real zero and an "unprojected" week keeps
      // its nulls.
      if (row.availability !== "projected") {
        mirror("unavailable");
        continue;
      }
      if (!row.statLine) {
        mirror("noSleeperStatLine");
        continue;
      }
      if (!share) {
        mirror("noShares");
        continue;
      }

      const team = subject.team ?? row.team ?? share.team;
      const base = team ? teamVolume.get(team) : undefined;
      if (!team || !base) {
        mirror("noTeamVolume");
        continue;
      }

      const env = environment.get(`${team}|${week}`) ?? null;
      const effect = environmentEffect(env, settings);
      const volume = applyEnvironment(base, effect);

      const opportunity = {
        targets: (share.targetShare ?? 0) * volume.passAttempts * targetsPerAttempt,
        carries: (share.carryShare ?? 0) * volume.rushAttempts,
        passAttempts: (share.passAttemptShare ?? 0) * volume.passAttempts,
      };
      if (
        opportunity.targets <= 0 &&
        opportunity.carries <= 0 &&
        opportunity.passAttempts <= 0
      ) {
        mirror("noOpportunity");
        continue;
      }

      const player = withRedZoneLeverage(rates, share.rushRedZoneShare, share.carryShare);
      const league = leagueByPosition.get(projectable) ?? emptyRates();

      const beaconLine = toStatLine(
        {
          position: projectable,
          opportunity,
          player,
          league,
          scoringMultiplier: effect.scoring,
        },
        settings,
      );

      modelled += 1;
      drafts.push({
        subject,
        row,
        position: projectable,
        beaconLine,
        blendWeight: blendWeight(share.currentSeasonGames, settings),
      });
    }
  }

  // ---- blend, then calibrate --------------------------------------------
  //
  // Calibration runs LAST and on the BLENDED line, because the over-spread it
  // corrects is a property of every projection source, Sleeper's included. A
  // row mirrored at weight 0 is therefore still calibrated, which is most of
  // what our source is worth before we have a season of usage behind it.
  const blended = drafts.map((draft) => {
    // A null Sleeper line is "no opinion" and stays null all the way to
    // storage. Coercing it to {} here would turn an unprojected week into a
    // confident zero, which is the one mistake the availability taxonomy was
    // built to stop. A mirrored line is COPIED rather than referenced, so a
    // later calibration cannot mutate the caller's row.
    const sleeperLine = draft.row.statLine;
    const line =
      draft.beaconLine === null
        ? sleeperLine === null
          ? null
          : { ...sleeperLine }
        : blendStatLines(draft.beaconLine, sleeperLine ?? {}, draft.blendWeight);

    // POINTS ARE ANCHORED ON SLEEPER'S PUBLISHED TOTAL, NOT RE-DERIVED.
    //
    // Two things go wrong if the stored total is the canonical dot product of
    // the line, and the first one is severe.
    //
    // A kicker's line is fgm and fgmiss; a defense's is sacks, interceptions
    // and points allowed. The canonical scoring map scores NONE of those keys,
    // so re-deriving turns every mirrored kicker and every mirrored defense
    // into a flat 0.00, which is exactly what the first build of this engine
    // did to 1,119 rows before it was measured.
    //
    // Even for the four positions we do model, Sleeper's own published total
    // is not the canonical dot product of its own line: a live 2026
    // quarterback row dot-products to 20.36 while Sleeper publishes 23.26,
    // because Sleeper scores keys the canonical map does not.
    //
    // Both are fixed by treating our model as a DELTA. Scoring is linear in
    // the stat line and so is the blend, so the blended total is just the
    // weighted average of the two sources' own totals, and at weight 0 our row
    // is byte-identical to Sleeper's in all three bases.
    const points = blendedPoints(draft, line);
    return { draft, line, points };
  });

  const means = startableMeans(blended);
  const thresholds = startableThresholds(blended);

  const projections: BeaconProjection[] = [];
  for (const entry of blended) {
    const { draft } = entry;
    const key = draft.position === null ? null : `${draft.position}|${draft.row.week}`;
    const mean = key === null ? null : (means.get(key) ?? null);
    const threshold = key === null ? null : (thresholds.get(key) ?? null);
    const ppr = entry.points.ppr;

    // CALIBRATION APPLIES INSIDE THE STARTABLE RANGE ONLY.
    //
    // The published slopes were fitted among starters, and applying them to
    // the whole pool does real damage in the other direction: compressing 130
    // tight ends toward the top-18 mean pulls every deep-bench player UP
    // toward a startable number. Measured on the first build, that inflated
    // the average tight end projection by 54%, turning a third-string tight
    // end into a plausible-looking streamer.
    //
    // Below the threshold the row keeps its number exactly. That is the
    // conservative choice and it is also the honest one: we measured a
    // relationship among starters, so we apply it among starters.
    const calibrate =
      entry.line !== null &&
      ppr !== null &&
      draft.position !== null &&
      mean !== null &&
      threshold !== null &&
      ppr >= threshold;

    if (!calibrate || entry.line === null || ppr === null || draft.position === null || mean === null) {
      projections.push(toProjection(input.season, draft, entry.line, entry.points));
      continue;
    }

    const line = calibrateStatLine(entry.line, draft.position, mean, ppr, settings);
    // The same uniform factor the line was scaled by, applied to all three
    // stored totals so the row stays internally consistent across bases.
    const factor = calibrationFactor(entry.line, line);
    projections.push(
      toProjection(input.season, draft, line, scalePoints(entry.points, factor)),
    );
  }

  return { projections, mirrored, modelled };
}

type StoredPoints = { ppr: number | null; halfPpr: number | null; std: number | null };

/**
 * The blended total in each base: our model's contribution weighted against
 * Sleeper's own published number.
 *
 * A mirrored row returns Sleeper's totals untouched. A modelled row returns
 * `w * ours + (1 - w) * Sleeper's`, which is what blending a linear stat line
 * under linear scoring actually means.
 */
function blendedPoints(draft: Draft, line: StatLine | null): StoredPoints {
  const sleeper = draft.row.points;
  if (line === null || draft.beaconLine === null) return sleeper;

  const w = draft.blendWeight;
  const mix = (
    base: keyof typeof CANONICAL_SCORING,
    published: number | null,
  ): number | null => {
    const ours = pointsIn(draft.beaconLine as StatLine, base);
    if (published === null) return ours;
    const blendedValue = w * ours + (1 - w) * published;
    return Number.isFinite(blendedValue) ? blendedValue : published;
  };

  return {
    ppr: mix("pts_ppr", sleeper.ppr),
    halfPpr: mix("pts_half_ppr", sleeper.halfPpr),
    std: mix("pts_std", sleeper.std),
  };
}

/** How much calibration scaled a line, read off the line itself. */
function calibrationFactor(before: StatLine, after: StatLine): number {
  for (const [key, value] of Object.entries(before)) {
    // `gp` is deliberately not scaled by calibrateStatLine, so reading the
    // factor off it would always return 1.
    if (key === "gp") continue;
    if (!Number.isFinite(value) || value === 0) continue;
    const scaled = after[key];
    if (typeof scaled !== "number" || !Number.isFinite(scaled)) continue;
    const factor = scaled / value;
    if (Number.isFinite(factor) && factor >= 0) return factor;
  }
  return 1;
}

function scalePoints(points: StoredPoints, factor: number): StoredPoints {
  if (!Number.isFinite(factor) || factor < 0) return points;
  const scale = (v: number | null): number | null =>
    v === null ? null : v * factor;
  return {
    ppr: scale(points.ppr),
    halfPpr: scale(points.halfPpr),
    std: scale(points.std),
  };
}

/**
 * Which weeks Sleeper has a row for, per player.
 *
 * Built ONCE. Scanning the whole projection map inside the per-subject loop
 * would be quadratic, and the map holds roughly ten thousand entries against
 * six hundred subjects, so that mistake costs six million string comparisons a
 * run rather than ten thousand.
 */
function buildWeekIndex(
  sleeper: ReadonlyMap<string, SleeperProjectionRow>,
): Map<string, number[]> {
  const index = new Map<string, number[]>();
  for (const row of sleeper.values()) {
    const weeks = index.get(row.playerId);
    if (weeks) weeks.push(row.week);
    else index.set(row.playerId, [row.week]);
  }
  for (const weeks of index.values()) weeks.sort((a, b) => a - b);
  return index;
}

/**
 * League-wide targets per pass attempt, from the same rows the model reads.
 *
 * Falls back to 1 when there is nothing to measure, which makes the correction
 * a no-op rather than a guess.
 */
export function leagueTargetsPerAttempt(rows: readonly PlayerStatRow[]): number {
  let targets = 0;
  let attempts = 0;
  for (const row of rows) {
    if (row.gp <= 0) continue;
    if (typeof row.targets === "number" && Number.isFinite(row.targets)) {
      targets += row.targets;
    }
    if (Number.isFinite(row.passAttempts)) attempts += row.passAttempts;
  }
  if (attempts <= 0 || targets <= 0) return 1;
  const ratio = targets / attempts;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

/**
 * A copy of the player's rates with his rushing touchdown rate scaled by how
 * much of his team's red zone work he takes relative to his overall workload.
 *
 * Returns the rates untouched when either share is missing, so a player we know
 * nothing about is neither rewarded nor punished.
 */
export function withRedZoneLeverage(
  rates: EfficiencyRates | null,
  rushRedZoneShare: number | null,
  carryShare: number | null,
): EfficiencyRates {
  const base = rates ?? emptyRates();
  if (
    rushRedZoneShare === null ||
    carryShare === null ||
    !(carryShare > 0) ||
    base.rushTdPerCarry === null
  ) {
    return base;
  }
  const leverage = clamp(rushRedZoneShare / carryShare, RZ_LEVERAGE_MIN, RZ_LEVERAGE_MAX);
  return { ...base, rushTdPerCarry: base.rushTdPerCarry * leverage };
}

function emptyRates(): EfficiencyRates {
  return {
    catchRate: null,
    yardsPerReception: null,
    recTdPerTarget: null,
    yardsPerCarry: null,
    rushTdPerCarry: null,
    completionRate: null,
    yardsPerAttempt: null,
    passTdPerAttempt: null,
    intPerAttempt: null,
    fumbleLostPerTouch: null,
    weightedGames: 0,
  };
}

/**
 * The mean PPR projection inside the startable range, per position per week.
 *
 * The population matters more than the arithmetic here. See STARTABLE_DEPTH.
 */
function startablePools(
  entries: ReadonlyArray<{ draft: Draft; points: StoredPoints }>,
): Map<string, number[]> {
  const pools = new Map<string, number[]>();
  for (const entry of entries) {
    const position = entry.draft.position;
    const ppr = entry.points.ppr;
    if (position === null || ppr === null || !Number.isFinite(ppr)) continue;
    const key = `${position}|${entry.draft.row.week}`;
    const pool = pools.get(key) ?? [];
    pool.push(ppr);
    pools.set(key, pool);
  }
  for (const pool of pools.values()) pool.sort((a, b) => b - a);
  return pools;
}

function startableMeans(
  entries: ReadonlyArray<{ draft: Draft; points: StoredPoints }>,
): Map<string, number> {
  const means = new Map<string, number>();
  for (const [key, pool] of startablePools(entries)) {
    const position = key.split("|")[0] as ProjectionPosition;
    const depth = STARTABLE_DEPTH[position] ?? 36;
    const top = pool.slice(0, depth);
    if (top.length === 0) continue;
    const sum = top.reduce((a, b) => a + b, 0);
    const mean = sum / top.length;
    if (Number.isFinite(mean) && mean > 0) means.set(key, mean);
  }
  return means;
}

/**
 * The projected total that marks the bottom of the startable range, per
 * position per week. Rows below it are not calibrated. See the call site.
 */
function startableThresholds(
  entries: ReadonlyArray<{ draft: Draft; points: StoredPoints }>,
): Map<string, number> {
  const thresholds = new Map<string, number>();
  for (const [key, pool] of startablePools(entries)) {
    const position = key.split("|")[0] as ProjectionPosition;
    const depth = STARTABLE_DEPTH[position] ?? 36;
    if (pool.length === 0) continue;
    // A week with fewer players than the startable depth has no bench to
    // protect, so every row in it is inside the range.
    const cut = pool.length <= depth ? pool[pool.length - 1] : pool[depth - 1];
    if (Number.isFinite(cut)) thresholds.set(key, cut);
  }
  return thresholds;
}

function toProjection(
  season: number,
  draft: Draft,
  line: StatLine | null,
  points: StoredPoints,
): BeaconProjection {
  // A mirrored row keeps its real position and, crucially, SLEEPER'S OWN
  // availability verdict. Stamping every row "projected" would turn a week
  // Sleeper marked "out" into a week we claim to have a forecast for, which is
  // exactly the fabrication the availability taxonomy exists to prevent.
  //
  // The write key prefers the AUTHORITATIVE id off the row actually being
  // mirrored (draft.row.sleeperPlayerId), falling back to the subject's
  // players.external_ids.sleeper mapping only when the row did not carry one.
  // See the comment on SleeperProjectionRow.sleeperPlayerId.
  return {
    playerId: draft.subject.playerId,
    sleeperPlayerId: draft.row.sleeperPlayerId || draft.subject.sleeperPlayerId,
    position: draft.subject.position,
    season,
    week: draft.row.week,
    team: draft.subject.team ?? draft.row.team,
    opponent: draft.row.opponent,
    statLine: line,
    pointsPpr: points.ppr,
    pointsHalfPpr: points.halfPpr,
    pointsStd: points.std,
    blendWeight: draft.blendWeight,
    modelled: draft.beaconLine !== null,
    availability: draft.row.availability,
  };
}
