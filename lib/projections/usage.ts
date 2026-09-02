/**
 * Recency-weighted role shares and per-opportunity efficiency rates, read off
 * player_stats. Plan section 3.5 "Usage shares".
 *
 * WHY SHARES AND NOT COUNTS: a target COUNT moves with a team's pass volume,
 * which moves with game script, opponent, and injuries to other people. A
 * target SHARE is a player's job, and the published stabilisation research
 * says a share reads as signal rather than noise by four to six games. The
 * half life below puts that finding directly into the weighting: at a four
 * week half life, the last four games carry about as much weight as
 * everything before them combined.
 *
 * Pure. No Supabase client, no Date, no fetch, no Math.random. Plain data in,
 * plain data out, the same contract as lib/positional-war/engine.ts.
 */

import type { ProjectionSettings } from "./default-settings";
import type { EfficiencyRates, ProjectionPosition, UsageShares } from "./types";

/** One row, mapped one to one onto a player_stats record. */
export type PlayerStatRow = {
  playerId: string;
  position: ProjectionPosition;
  team: string | null;
  season: number;
  week: number;
  gp: number;
  offSnaps: number | null; // off_snp
  targets: number | null; // rec_tgt
  receptions: number; // rec
  recYards: number; // rec_yd
  recTds: number; // rec_td
  carries: number; // rush_att
  rushYards: number; // rush_yd
  rushTds: number; // rush_td
  rushRedZoneAttempts: number; // rush_rz_att
  passAttempts: number; // pass_att
  passCompletions: number; // pass_cmp
  passYards: number; // pass_yd
  passTds: number; // pass_td
  interceptions: number; // pass_int
  fumblesLost: number; // fum_lost
};

/**
 * A past season's own "latest week" is not carried in this input, only the
 * row's own season and week, so the within-season decay for a PAST season is
 * measured from a fixed assumed end of season rather than from data we do not
 * have here. 18 is the current NFL regular season length (2021 onward); for
 * the 17-week seasons at the start of the player_stats history (2020) this
 * slightly overstates how many weeks ago week 17 was, which only matters for
 * the oldest data in the window, and that data already carries the smallest
 * season weight of the ladder.
 */
const ASSUMED_SEASON_FINAL_WEEK = 18;

/**
 * `seasonWeight(season) * 0.5 ** (weeksAgo / halfLifeWeeks)`.
 *
 * The within-season decay applies to EVERY season, not only the current one.
 * A game in week 2 of last season is older than a game in week 17 of last
 * season, and treating them identically (for example by decaying only within
 * the current season and letting every prior-season game share one flat
 * season weight) would throw away exactly the recency signal the half life
 * exists to capture. So `weeksAgo` is measured from that season's own latest
 * week for a past season, and from `params.latestWeek` for the current one,
 * where "current" means the row's season is not older than
 * `params.currentSeason` (a season at or ahead of the current one is treated
 * as current rather than falling into the "older" bucket).
 */
export function recencyWeight(
  row: { season: number; week: number },
  params: { currentSeason: number; latestWeek: number },
  settings: ProjectionSettings,
): number {
  const distance = Math.max(0, params.currentSeason - row.season);

  const seasonWeight =
    distance === 0
      ? settings.usage.seasonWeights.currentSeason
      : distance === 1
        ? settings.usage.seasonWeights.oneSeasonBack
        : distance === 2
          ? settings.usage.seasonWeights.twoSeasonsBack
          : settings.usage.seasonWeights.olderSeasons;

  const referenceWeek = distance === 0 ? params.latestWeek : ASSUMED_SEASON_FINAL_WEEK;
  const weeksAgo = Math.max(0, referenceWeek - row.week);

  // A zero or negative half life would divide by zero or invert the decay.
  // Neither is a meaningful setting, so it is floored rather than trusted.
  const halfLifeWeeks = settings.usage.halfLifeWeeks > 0 ? settings.usage.halfLifeWeeks : 1;

  return seasonWeight * 0.5 ** (weeksAgo / halfLifeWeeks);
}

function teamWeekKey(team: string, season: number, week: number): string {
  return `${team}|${season}|${week}`;
}

type TeamWeekTotals = {
  /** Maximum off_snp on the team-week. Null when no row carried a value. */
  snaps: number | null;
  targets: number;
  carries: number;
  rushRedZoneCarries: number;
  passAttempts: number;
};

/**
 * Team denominators, computed from the SAME rows a share's numerator comes
 * from.
 *
 * Snaps use the MAXIMUM on the team-week: that is the quarterback in almost
 * every case, and is the right denominator when it is not, since whoever
 * played the most offensive snaps on a team-week is the closest available
 * proxy for how many snaps the offense actually ran. Targets, carries, red
 * zone carries and pass attempts are SUMS, since those are genuinely
 * team-wide totals split across every player who touched the ball.
 *
 * Every row in the input contributes here, including a row with gp <= 0. A
 * denominator is a TEAM aggregate, not a statement about one player's game,
 * and a player who did not suit up still belongs to the team-week the
 * denominator describes. His own row contributes nothing material (an
 * inactive player's counted stats are 0, so he cannot inflate a sum, and can
 * only move the snap max if he somehow logged more snaps than the players who
 * did play, which does not happen). Filtering him out here would not change
 * a healthy team-week's denominator, but it WOULD silently drop a
 * denominator entirely for a team-week where the only rows on file that day
 * happen to be inactives with recorded zeros, which is a worse failure than
 * counting a harmless zero.
 */
function buildTeamWeekTotals(rows: readonly PlayerStatRow[]): Map<string, TeamWeekTotals> {
  const totals = new Map<string, TeamWeekTotals>();
  for (const row of rows) {
    if (row.team === null) continue;
    const key = teamWeekKey(row.team, row.season, row.week);
    const existing = totals.get(key) ?? {
      snaps: null,
      targets: 0,
      carries: 0,
      rushRedZoneCarries: 0,
      passAttempts: 0,
    };
    if (row.offSnaps !== null) {
      existing.snaps = existing.snaps === null ? row.offSnaps : Math.max(existing.snaps, row.offSnaps);
    }
    existing.targets += row.targets ?? 0;
    existing.carries += row.carries;
    existing.rushRedZoneCarries += row.rushRedZoneAttempts;
    existing.passAttempts += row.passAttempts;
    totals.set(key, existing);
  }
  return totals;
}

type ShareKey = "snapShare" | "targetShare" | "carryShare" | "rushRedZoneShare" | "passAttemptShare";

const SHARE_KEYS: readonly ShareKey[] = [
  "snapShare",
  "targetShare",
  "carryShare",
  "rushRedZoneShare",
  "passAttemptShare",
];

type ShareConfig = {
  key: ShareKey;
  playerCount: (row: PlayerStatRow) => number | null;
  teamTotal: (totals: TeamWeekTotals) => number | null;
  minimum: (settings: ProjectionSettings) => number;
};

const SHARE_CONFIGS: Record<ShareKey, ShareConfig> = {
  snapShare: {
    key: "snapShare",
    playerCount: (row) => row.offSnaps,
    teamTotal: (totals) => totals.snaps,
    // Spec: "use a minimum of 1 for snaps and pass attempts."
    minimum: () => 1,
  },
  targetShare: {
    key: "targetShare",
    playerCount: (row) => row.targets,
    teamTotal: (totals) => totals.targets,
    minimum: (settings) => settings.usage.minTeamTargets,
  },
  carryShare: {
    key: "carryShare",
    playerCount: (row) => row.carries,
    teamTotal: (totals) => totals.carries,
    minimum: (settings) => settings.usage.minTeamCarries,
  },
  rushRedZoneShare: {
    key: "rushRedZoneShare",
    playerCount: (row) => row.rushRedZoneAttempts,
    teamTotal: (totals) => totals.rushRedZoneCarries,
    // ProjectionSettings has no dedicated minimum for red zone carries.
    // minTeamCarries is reused as the "this team-week had a real rushing
    // sample" floor rather than inventing an unspecified setting; a
    // team-week too thin to trust for carry share is too thin to trust for
    // red zone carry share either.
    minimum: (settings) => settings.usage.minTeamCarries,
  },
  passAttemptShare: {
    key: "passAttemptShare",
    playerCount: (row) => row.passAttempts,
    teamTotal: (totals) => totals.passAttempts,
    minimum: () => 1,
  },
};

type ShareEntry = { rawShare: number | null; weight: number };

/**
 * Recency-weighted role shares for every player who cleared
 * `settings.usage.minWeightedGames`.
 *
 * A player below that threshold is omitted entirely rather than published
 * with a fabricated or all-null row, so a rookie in week 1 has no beacon
 * usage record and the caller falls back to Sleeper, which is the correct
 * answer rather than a guess dressed up as one.
 */
export function computeUsageShares(
  rows: readonly PlayerStatRow[],
  params: { currentSeason: number; latestWeek: number },
  settings: ProjectionSettings,
): Map<string, UsageShares> {
  const teamWeekTotals = buildTeamWeekTotals(rows);

  const rowsByPlayer = new Map<string, PlayerStatRow[]>();
  for (const row of rows) {
    const playerRows = rowsByPlayer.get(row.playerId);
    if (playerRows) playerRows.push(row);
    else rowsByPlayer.set(row.playerId, [row]);
  }

  // The player's role at each of the five share types, unshrunk, plus the
  // recency weight sum backing it. A row only contributes to a player's own
  // numerator when he actually played (gp > 0): an inactive week is not part
  // of his role, however his teammates' stat lines get aggregated above.
  const shareByPlayer: Record<ShareKey, Map<string, ShareEntry>> = {
    snapShare: new Map(),
    targetShare: new Map(),
    carryShare: new Map(),
    rushRedZoneShare: new Map(),
    passAttemptShare: new Map(),
  };

  for (const shareKey of SHARE_KEYS) {
    const config = SHARE_CONFIGS[shareKey];
    const minimum = config.minimum(settings);
    for (const [playerId, playerRows] of rowsByPlayer) {
      let weightedNumerator = 0;
      let weightedDenominator = 0;
      let weightSum = 0;
      for (const row of playerRows) {
        if (row.gp <= 0) continue;
        if (row.team === null) continue;
        const count = config.playerCount(row);
        if (count === null) continue;
        const totals = teamWeekTotals.get(teamWeekKey(row.team, row.season, row.week));
        const denomTotal = totals ? config.teamTotal(totals) : null;
        // A team-week below the minimum is thin data, not a zero: it is
        // simply excluded rather than counted as "this player got 0 of it".
        if (denomTotal === null || denomTotal < minimum) continue;
        const weight = recencyWeight(row, params, settings);
        weightedNumerator += weight * count;
        weightedDenominator += weight * denomTotal;
        weightSum += weight;
      }
      const rawShare = weightedDenominator > 0 ? weightedNumerator / weightedDenominator : null;
      shareByPlayer[shareKey].set(playerId, { rawShare, weight: weightSum });
    }
  }

  const positionByPlayer = new Map<string, ProjectionPosition>();
  const teamByPlayer = new Map<string, string | null>();
  for (const [playerId, playerRows] of rowsByPlayer) {
    const sorted = [...playerRows].sort((a, b) => a.season - b.season || a.week - b.week);
    positionByPlayer.set(playerId, sorted[sorted.length - 1].position);
    let latestTeam: string | null = null;
    for (const row of sorted) {
      if (row.team !== null) latestTeam = row.team;
    }
    teamByPlayer.set(playerId, latestTeam);
  }

  // The empirical Bayes prior mean for each (position, share type): the
  // weighted average raw share across every player at that position who has
  // one, using every such player regardless of whether he clears
  // minWeightedGames. A thin-sample player still measured a real share and
  // belongs in the pool average; minWeightedGames only gates PUBLISHING a
  // player's own row, not whether he counts toward the position's mean.
  const positionAverage: Record<ShareKey, Map<ProjectionPosition, number>> = {
    snapShare: new Map(),
    targetShare: new Map(),
    carryShare: new Map(),
    rushRedZoneShare: new Map(),
    passAttemptShare: new Map(),
  };

  for (const shareKey of SHARE_KEYS) {
    const sums = new Map<ProjectionPosition, { weighted: number; weight: number }>();
    for (const [playerId, entry] of shareByPlayer[shareKey]) {
      if (entry.rawShare === null || entry.weight <= 0) continue;
      const position = positionByPlayer.get(playerId);
      if (!position) continue;
      const bucket = sums.get(position) ?? { weighted: 0, weight: 0 };
      bucket.weighted += entry.weight * entry.rawShare;
      bucket.weight += entry.weight;
      sums.set(position, bucket);
    }
    for (const [position, bucket] of sums) {
      if (bucket.weight > 0) positionAverage[shareKey].set(position, bucket.weighted / bucket.weight);
    }
  }

  const result = new Map<string, UsageShares>();
  for (const [playerId, playerRows] of rowsByPlayer) {
    let weightedGames = 0;
    let games = 0;
    let currentSeasonGames = 0;
    for (const row of playerRows) {
      if (row.gp <= 0) continue;
      weightedGames += recencyWeight(row, params, settings);
      games += 1;
      if (row.season === params.currentSeason) currentSeasonGames += 1;
    }

    if (weightedGames < settings.usage.minWeightedGames) continue;

    const position = positionByPlayer.get(playerId);
    if (!position) continue;

    const shrunkShare: Record<ShareKey, number | null> = {
      snapShare: null,
      targetShare: null,
      carryShare: null,
      rushRedZoneShare: null,
      passAttemptShare: null,
    };
    for (const shareKey of SHARE_KEYS) {
      const entry = shareByPlayer[shareKey].get(playerId);
      if (!entry || entry.rawShare === null) continue;
      const prior = positionAverage[shareKey].get(position);
      if (prior === undefined) {
        // Nothing to shrink toward (this player is the only measurement at
        // this position for this share type), so publish the raw share
        // rather than losing it.
        shrunkShare[shareKey] = entry.rawShare;
        continue;
      }
      const priorGames = settings.usage.priorGames;
      shrunkShare[shareKey] = (entry.weight * entry.rawShare + priorGames * prior) / (entry.weight + priorGames);
    }

    result.set(playerId, {
      playerId,
      position,
      team: teamByPlayer.get(playerId) ?? null,
      snapShare: shrunkShare.snapShare,
      targetShare: shrunkShare.targetShare,
      carryShare: shrunkShare.carryShare,
      rushRedZoneShare: shrunkShare.rushRedZoneShare,
      passAttemptShare: shrunkShare.passAttemptShare,
      weightedGames,
      games,
      currentSeasonGames,
    });
  }

  return result;
}

/**
 * A weighted ratio of weighted sums: `sum(weight * numerator) /
 * sum(weight * denominator)`. Never a mean of per-game ratios, since that
 * would let a two-target game outvote a twelve-target game.
 *
 * Only rows where the player suited up (gp > 0) AND the denominator field is
 * present contribute. Returns weight 0 and value null when nothing
 * qualified.
 */
function weightedRatio(
  rows: readonly PlayerStatRow[],
  numerator: (row: PlayerStatRow) => number,
  denominator: (row: PlayerStatRow) => number | null,
  params: { currentSeason: number; latestWeek: number },
  settings: ProjectionSettings,
): { value: number | null; weight: number } {
  let weightedNumerator = 0;
  let weightedDenominator = 0;
  let weightSum = 0;
  for (const row of rows) {
    if (row.gp <= 0) continue;
    const denominatorValue = denominator(row);
    if (denominatorValue === null) continue;
    const weight = recencyWeight(row, params, settings);
    weightedNumerator += weight * numerator(row);
    weightedDenominator += weight * denominatorValue;
    weightSum += weight;
  }
  return {
    value: weightedDenominator > 0 ? weightedNumerator / weightedDenominator : null,
    weight: weightSum,
  };
}

function computeRatesForRows(
  rows: readonly PlayerStatRow[],
  params: { currentSeason: number; latestWeek: number },
  settings: ProjectionSettings,
): EfficiencyRates {
  let weightedGames = 0;
  for (const row of rows) {
    if (row.gp > 0) weightedGames += recencyWeight(row, params, settings);
  }

  const catchRate = weightedRatio(rows, (r) => r.receptions, (r) => r.targets, params, settings).value;
  const yardsPerReception = weightedRatio(rows, (r) => r.recYards, (r) => r.receptions, params, settings).value;
  const recTdPerTarget = weightedRatio(rows, (r) => r.recTds, (r) => r.targets, params, settings).value;
  const yardsPerCarry = weightedRatio(rows, (r) => r.rushYards, (r) => r.carries, params, settings).value;
  const rushTdPerCarry = weightedRatio(rows, (r) => r.rushTds, (r) => r.carries, params, settings).value;
  const completionRate = weightedRatio(
    rows,
    (r) => r.passCompletions,
    (r) => r.passAttempts,
    params,
    settings,
  ).value;
  const yardsPerAttempt = weightedRatio(rows, (r) => r.passYards, (r) => r.passAttempts, params, settings).value;
  const passTdPerAttempt = weightedRatio(rows, (r) => r.passTds, (r) => r.passAttempts, params, settings).value;
  const intPerAttempt = weightedRatio(rows, (r) => r.interceptions, (r) => r.passAttempts, params, settings).value;
  const fumbleLostPerTouch = weightedRatio(
    rows,
    (r) => r.fumblesLost,
    (r) => r.carries + r.receptions + r.passAttempts,
    params,
    settings,
  ).value;

  return {
    catchRate,
    yardsPerReception,
    recTdPerTarget,
    yardsPerCarry,
    rushTdPerCarry,
    completionRate,
    yardsPerAttempt,
    passTdPerAttempt,
    intPerAttempt,
    fumbleLostPerTouch,
    weightedGames,
  };
}

/**
 * Recency-weighted per-opportunity conversion rates, by player and pooled by
 * position.
 *
 * This module only REPORTS what it measured. Blending a player's own rate
 * toward the league rate is lib/projections/convert.ts's job, against
 * settings.efficiency.priorGames: that boundary is deliberate (a different
 * agent owns convert.ts) and must not be re-crossed here.
 */
export function computeEfficiencyRates(
  rows: readonly PlayerStatRow[],
  params: { currentSeason: number; latestWeek: number },
  settings: ProjectionSettings,
): { byPlayer: Map<string, EfficiencyRates>; leagueByPosition: Map<ProjectionPosition, EfficiencyRates> } {
  const rowsByPlayer = new Map<string, PlayerStatRow[]>();
  const rowsByPosition = new Map<ProjectionPosition, PlayerStatRow[]>();
  for (const row of rows) {
    const playerRows = rowsByPlayer.get(row.playerId);
    if (playerRows) playerRows.push(row);
    else rowsByPlayer.set(row.playerId, [row]);

    const positionRows = rowsByPosition.get(row.position);
    if (positionRows) positionRows.push(row);
    else rowsByPosition.set(row.position, [row]);
  }

  const byPlayer = new Map<string, EfficiencyRates>();
  for (const [playerId, playerRows] of rowsByPlayer) {
    byPlayer.set(playerId, computeRatesForRows(playerRows, params, settings));
  }

  const leagueByPosition = new Map<ProjectionPosition, EfficiencyRates>();
  for (const [position, positionRows] of rowsByPosition) {
    leagueByPosition.set(position, computeRatesForRows(positionRows, params, settings));
  }

  return { byPlayer, leagueByPosition };
}
