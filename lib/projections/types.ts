/**
 * The shapes the FF Beacon projection engine passes between its halves.
 *
 * Everything here is plain data. No Supabase client, no Date, no fetch. The
 * pure modules (usage, volume, convert, calibrate, blend, engine) speak only
 * these types, and lib/build-beacon-projections.ts is the one place that turns
 * database rows into them and the result back into rows.
 *
 * WHY A COMPONENT STAT LINE AND NOT A POINT TOTAL
 *
 * Sleeper publishes its weekly projection as a stat map whose keys are the same
 * keys a league's `scoring_settings` uses: `pass_yd`, `rec`, `bonus_rec_te` and
 * so on. That is the single reason `lib/league-scoring.ts scoreStatMap()` can
 * price a projection EXACTLY under any league's rules, TE premium and 6 point
 * passing touchdowns included, instead of approximating from a PPR column.
 *
 * Our own projections therefore produce the same vocabulary. Anything that
 * emitted a point total would be unable to answer a TE premium league, and the
 * failure would be silent: the number would look reasonable and be wrong by the
 * exact size of the premium.
 */

/**
 * The positions we project ourselves.
 *
 * Kickers and defenses are deliberately absent. Their production is a function
 * of team scoring and opponent turnovers rather than individual usage, so a
 * usage model would be worse than Sleeper's number rather than better, and
 * shipping a worse number under our own name is the one outcome this whole
 * build exists to avoid. Their blend weight is zero and they stay on Sleeper.
 */
export const PROJECTABLE_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export type ProjectionPosition = (typeof PROJECTABLE_POSITIONS)[number];

export function isProjectablePosition(
  position: string | null | undefined,
): position is ProjectionPosition {
  return (PROJECTABLE_POSITIONS as readonly string[]).includes(
    (position ?? "").toUpperCase(),
  );
}

/**
 * A component stat line, keyed the way Sleeper keys one.
 *
 * Values are expected counts rather than integers: a receiver projected for
 * 7.06 receptions and 0.65 touchdowns is the normal case, and rounding either
 * of those would throw away most of the information in a touchdown rate.
 */
export type StatLine = Record<string, number>;

/**
 * How much of his team's work a player does.
 *
 * Shares rather than counts, because a share is the part that persists. A
 * receiver's target COUNT moves with his team's pass volume, which moves with
 * game script, opponent and injuries to other people. His target SHARE is his
 * job, and the published stabilisation work puts that at four to six games,
 * which is why the recency half life defaults to four weeks.
 */
export type UsageShares = {
  playerId: string;
  position: ProjectionPosition;
  /** The team the shares were measured on. Null when the player has no team. */
  team: string | null;
  /** Offensive snaps over team offensive snaps. */
  snapShare: number | null;
  /** Targets over team targets. */
  targetShare: number | null;
  /** Carries over team carries. */
  carryShare: number | null;
  /** Red zone carries over team red zone carries. Rushing only. */
  rushRedZoneShare: number | null;
  /** Pass attempts over team pass attempts. Quarterbacks only. */
  passAttemptShare: number | null;
  /** Sum of the recency weights behind these shares. */
  weightedGames: number;
  /** Unweighted count of games behind these shares. */
  games: number;
  /**
   * Games in the CURRENT season only. This is what drives the blend weight, so
   * a player with four seasons of history and no 2026 games still contributes
   * nothing until he has played, which is correct: his role this year is the
   * thing we do not yet know.
   */
  currentSeasonGames: number;
};

/**
 * Per-opportunity conversion rates.
 *
 * These are the part that regresses. Touchdown rate, yards per carry and yards
 * per target all revert hard toward the positional mean, which is why every one
 * of them is shrunk toward the league average with a LARGE prior, while the
 * shares above are shrunk with a small one. That asymmetry is the model: trust
 * a player's role quickly and his efficiency slowly.
 *
 * A null means we have no measurement and the league average is used whole.
 */
export type EfficiencyRates = {
  catchRate: number | null;
  yardsPerReception: number | null;
  recTdPerTarget: number | null;
  yardsPerCarry: number | null;
  rushTdPerCarry: number | null;
  completionRate: number | null;
  yardsPerAttempt: number | null;
  passTdPerAttempt: number | null;
  intPerAttempt: number | null;
  /** Fumbles lost per touch, where a touch is a carry, reception or sack. */
  fumbleLostPerTouch: number | null;
  /** Sum of the recency weights behind these rates. */
  weightedGames: number;
};

/** What one team is expected to do on offense in one week. */
export type TeamVolume = {
  team: string;
  passAttempts: number;
  rushAttempts: number;
  /** Total offensive snaps, used as the denominator for snap share. */
  offensiveSnaps: number;
};

/**
 * The game a projection sits inside.
 *
 * `impliedTotal` and `spread` are BOTH nullable and a null is never a zero. A
 * game with no published line is a game we made no environment adjustment for,
 * which is a different thing from a game we decided was neutral.
 */
export type GameEnvironment = {
  team: string;
  opponent: string | null;
  /** Points this team is implied to score. Null when no line exists. */
  impliedTotal: number | null;
  /** This team's spread. NEGATIVE means this team is favoured. */
  spread: number | null;
};

/** One player, one week, as this engine produces it. */
export type BeaconProjection = {
  playerId: string;
  sleeperPlayerId: string;
  /**
   * The player's real position, verbatim, INCLUDING the ones we do not model.
   *
   * Deliberately a plain string rather than ProjectionPosition. The engine
   * mirrors every Sleeper row, kickers and defenses included, and narrowing
   * this to the four modelled positions would force a mirrored kicker to be
   * recorded as something he is not. It is informational either way:
   * player_weekly_projections has no position column, and the position is read
   * from `players` on every path that needs it.
   */
  position: string;
  season: number;
  week: number;
  team: string | null;
  opponent: string | null;
  /**
   * The component stat line, in Sleeper's key vocabulary.
   *
   * NULL is a real and distinct state, and it is not an empty object. An empty
   * line scores to a definite zero; a null line scores to no opinion at all,
   * which is exactly the difference between a player Sleeper says cannot play
   * and a player Sleeper simply does not cover. `lib/sync-weekly-projections.ts`
   * stores that distinction and this type has to carry it, or a mirrored
   * "unprojected" week would come back as a confident zero and bury a real
   * player at the bottom of every lineup.
   */
  statLine: StatLine | null;
  /** Points in each canonical base, computed from statLine. Null when it is. */
  pointsPpr: number | null;
  pointsHalfPpr: number | null;
  pointsStd: number | null;
  /**
   * How much of the stored row is ours rather than Sleeper's, 0 to 1. Stored on
   * the row so a reader can always tell how much of a number we are actually
   * claiming, and so a mirrored row is visibly a mirrored row.
   */
  blendWeight: number;
  /**
   * Whether OUR model produced this number, or the row is a mirrored Sleeper
   * one carried through unchanged.
   *
   * Distinct from `blendWeight`, and the difference matters. A modelled player
   * in week 1 has a blend weight of 0 because he has no current-season games
   * yet, so weight alone cannot tell "we ran the model and it contributed
   * nothing yet" apart from "we had nothing to run". The backtest needs exactly
   * that distinction to grade our model rather than grading Sleeper's numbers
   * wearing our name.
   */
  modelled: boolean;
  /**
   * Why this row holds what it holds, matching
   * lib/sync-weekly-projections.ts classifyRow().
   *
   * CARRIED THROUGH FROM SLEEPER, never asserted by us. Sleeper's verdict about
   * whether a player suits up is better than anything a usage model can say,
   * because a usage model has no idea he is hurt. An "out" week keeps its real
   * zero and an "unprojected" week keeps its nulls, so switching a reader to
   * the ffbeacon source can change what a number IS but can never change what
   * kind of claim the row is making.
   */
  availability: string;
};
