/**
 * Opportunity to points.
 *
 * Turns an expected volume (targets, carries, pass attempts) into a component
 * stat line in Sleeper's own key vocabulary, so lib/league-scoring.ts
 * scoreStatMap() prices it exactly under any league's rules.
 *
 * THE ASYMMETRIC PRIOR IS THE WHOLE MODEL
 *
 * shrinkRate() shrinks a player's own rate toward the league average with a
 * prior expressed in games. The two callers of that prior below use very
 * different sizes on purpose:
 *
 *   - shares (how many targets or carries a player gets) are not shrunk in
 *     this module at all; opportunity.targets/carries/passAttempts arrive
 *     already computed with a SMALL prior (settings.usage.priorGames,
 *     default 4) upstream in usage.ts computeUsageShares, which shrinks each
 *     share toward its position's pooled average. Not volume.ts, which only
 *     computes unshrunk team-level play counts. A role is the part of a
 *     player's line that persists and we trust it fast.
 *   - efficiency (catch rate, yards per target, touchdown rate) is shrunk
 *     right here with a LARGE prior (settings.efficiency.priorGames, default
 *     24), because touchdown rate, yards per carry and yards per target all
 *     revert hard toward the positional mean. Expected touchdowns are more
 *     stable AND more predictive than actual touchdowns: a player who scored
 *     on 12 percent of his carries last season is mostly telling us he got
 *     lucky.
 */

import type { EfficiencyRates, ProjectionPosition, StatLine } from "./types";
import type { ProjectionSettings } from "./default-settings";

export type ConversionInput = {
  position: ProjectionPosition;
  /** Expected opportunity this week, already environment-adjusted. */
  opportunity: {
    targets: number;
    carries: number;
    passAttempts: number;
  };
  /** What this player has done. Any field may be null. */
  player: EfficiencyRates;
  /** What an average player at this position does. The fallback. */
  league: EfficiencyRates;
  /** Multiplier on touchdown rates from the game environment. */
  scoringMultiplier: number;
};

/**
 * Empirical Bayes shrinkage of one rate toward a prior.
 *
 * `weightedGames` (n) is how many recency-weighted games back the player's
 * own rate. `priorGames` is how many games of the league rate we weigh
 * against it. A missing side is returned whole rather than treated as a
 * zero: a null player rate means we have no measurement of our own, so the
 * league rate stands alone; a null league rate means we have nothing to
 * shrink toward, so the player rate stands alone.
 *
 * `n + priorGames` can legitimately be zero (a brand new player with no
 * games yet, shrunk with a settings.efficiency.priorGames of 0). That is 0/0,
 * not a real ratio, so it is guarded explicitly rather than left to produce
 * NaN: with no games of evidence on either axis, the league rate is the only
 * defensible answer.
 */
export function shrinkRate(
  playerRate: number | null,
  leagueRate: number | null,
  weightedGames: number,
  priorGames: number,
): number | null {
  const hasPlayer = playerRate !== null && Number.isFinite(playerRate);
  const hasLeague = leagueRate !== null && Number.isFinite(leagueRate);

  if (!hasPlayer && !hasLeague) return null;
  if (!hasPlayer) return leagueRate;
  if (!hasLeague) return playerRate;

  const n = Number.isFinite(weightedGames) && weightedGames > 0 ? weightedGames : 0;
  const prior = Number.isFinite(priorGames) && priorGames > 0 ? priorGames : 0;
  const denom = n + prior;
  if (denom <= 0) return leagueRate;

  return (n * (playerRate as number) + prior * (leagueRate as number)) / denom;
}

/** Finite and non-negative, or null when the value cannot be trusted. */
function safe(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return value < 0 ? 0 : value;
}

/**
 * Turn expected opportunity into a component stat line.
 *
 * Every emitted value is finite and non-negative. A component whose rate
 * shrunk to null (no player measurement and no league measurement, which in
 * practice only happens for a position/rate combination that does not apply)
 * contributes nothing and its key is OMITTED rather than written as 0: an
 * omitted key and an asserted zero are different claims, and scoreStatMap()
 * would price them the same only by accident.
 *
 * BONUS_REC_TE DECISION
 *
 * Sleeper prices a TE premium two ways: `bonus_rec_te` (an explicit per
 * reception bonus, the common case) or a raised `rec_te` above `rec`
 * (lib/league-scoring.ts tePremiumPerReception()). scoreStatMap() is a pure
 * dot product over whatever keys the SCORING map names; it does no
 * position-based special casing. If a TE premium league's scoring_settings
 * carries `bonus_rec_te: 0.5` and our stat line has no `bonus_rec_te` key,
 * scoreStatMap() reads that key from our line as missing, contributes zero,
 * and the entire premium silently disappears from our own projection while
 * Sleeper's projection (which does carry bonus_rec_te, set to its own
 * reception count) prices correctly. That is a silent, position-specific
 * mispricing of every TE premium league, so we DO emit `bonus_rec_te` for
 * TE stat lines, set equal to the reception count, exactly mirroring what
 * Sleeper itself publishes. It is omitted whenever `rec` itself is omitted,
 * since a bonus on a reception count we have no opinion on is not a claim we
 * can make either.
 */
export function toStatLine(input: ConversionInput, settings: ProjectionSettings): StatLine {
  const { position, opportunity, player, league, scoringMultiplier } = input;
  const priorGames = settings.efficiency.priorGames;
  const n = player.weightedGames;
  const multiplier = Number.isFinite(scoringMultiplier) ? scoringMultiplier : 1;

  const hasReceiving = position === "RB" || position === "WR" || position === "TE";
  const hasRushing = position === "QB" || position === "RB" || position === "WR";
  const hasPassing = position === "QB";

  const targets = safe(opportunity.targets) ?? 0;
  const carries = safe(opportunity.carries) ?? 0;
  const passAttempts = safe(opportunity.passAttempts) ?? 0;

  const line: StatLine = { gp: 1 };

  let receptions: number | null = null;
  if (hasReceiving) {
    line.rec_tgt = targets;

    const catchRate = shrinkRate(player.catchRate, league.catchRate, n, priorGames);
    const yardsPerReception = shrinkRate(
      player.yardsPerReception,
      league.yardsPerReception,
      n,
      priorGames,
    );
    const recTdPerTarget = shrinkRate(player.recTdPerTarget, league.recTdPerTarget, n, priorGames);

    if (catchRate !== null) {
      const rec = safe(targets * catchRate);
      if (rec !== null) {
        line.rec = rec;
        receptions = rec;

        if (yardsPerReception !== null) {
          const recYd = safe(rec * yardsPerReception);
          if (recYd !== null) line.rec_yd = recYd;
        }
      }
    }

    if (recTdPerTarget !== null) {
      const recTd = safe(targets * recTdPerTarget * multiplier);
      if (recTd !== null) line.rec_td = recTd;
    }

    if (position === "TE" && receptions !== null) {
      line.bonus_rec_te = receptions;
    }
  }

  let rushingTouches = 0;
  if (hasRushing) {
    line.rush_att = carries;
    rushingTouches = carries;

    const yardsPerCarry = shrinkRate(player.yardsPerCarry, league.yardsPerCarry, n, priorGames);
    const rushTdPerCarry = shrinkRate(player.rushTdPerCarry, league.rushTdPerCarry, n, priorGames);

    if (yardsPerCarry !== null) {
      const rushYd = safe(carries * yardsPerCarry);
      if (rushYd !== null) line.rush_yd = rushYd;
    }

    if (rushTdPerCarry !== null) {
      const rushTd = safe(carries * rushTdPerCarry * multiplier);
      if (rushTd !== null) line.rush_td = rushTd;
    }
  }

  if (hasPassing) {
    line.pass_att = passAttempts;

    const completionRate = shrinkRate(player.completionRate, league.completionRate, n, priorGames);
    const yardsPerAttempt = shrinkRate(player.yardsPerAttempt, league.yardsPerAttempt, n, priorGames);
    const passTdPerAttempt = shrinkRate(
      player.passTdPerAttempt,
      league.passTdPerAttempt,
      n,
      priorGames,
    );
    const intPerAttempt = shrinkRate(player.intPerAttempt, league.intPerAttempt, n, priorGames);

    let passCmp: number | null = null;
    if (completionRate !== null) {
      const cmp = safe(passAttempts * completionRate);
      if (cmp !== null) {
        line.pass_cmp = cmp;
        passCmp = cmp;
      }
    }

    if (passCmp !== null) {
      const inc = safe(passAttempts - passCmp);
      if (inc !== null) line.pass_inc = inc;
    }

    if (yardsPerAttempt !== null) {
      const passYd = safe(passAttempts * yardsPerAttempt);
      if (passYd !== null) line.pass_yd = passYd;
    }

    if (passTdPerAttempt !== null) {
      const passTd = safe(passAttempts * passTdPerAttempt * multiplier);
      if (passTd !== null) line.pass_td = passTd;
    }

    if (intPerAttempt !== null) {
      const passInt = safe(passAttempts * intPerAttempt);
      if (passInt !== null) line.pass_int = passInt;
    }
  }

  // Fumbles lost per touch, where a touch is a carry or a reception. Sacks
  // are a real third touch type but this module has no sack opportunity to
  // work with (ConversionInput.opportunity carries only targets, carries and
  // passAttempts), so a quarterback's fumble rate here is driven by his
  // rushing touches only. That is a known, deliberate simplification.
  const fumbleLostPerTouch = shrinkRate(
    player.fumbleLostPerTouch,
    league.fumbleLostPerTouch,
    n,
    priorGames,
  );
  if (fumbleLostPerTouch !== null) {
    let touches = 0;
    if (hasRushing) touches += rushingTouches;
    if (hasReceiving && receptions !== null) touches += receptions;
    const fumLost = safe(touches * fumbleLostPerTouch);
    if (fumLost !== null) line.fum_lost = fumLost;
  }

  return line;
}
