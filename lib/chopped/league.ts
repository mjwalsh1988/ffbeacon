/**
 * Chopped league detection and season shape. Pure: no I/O, no clock.
 *
 * A chopped (guillotine) league has no playoff bracket and no head to head
 * record that matters. Every week the lowest scoring roster is eliminated and
 * its players go back into the pool, so the only question a manager has is
 * whether they outscore the worst team in the league this Sunday. Every helper
 * here exists so the rest of the FAAB model can ask that question instead of
 * the standard one, which would price a player on playoff odds a chopped
 * league does not have.
 *
 * WHY settings.last_chopped_leg IS IGNORED
 *
 * The obvious reading of `settings.last_chopped_leg` is "the week the final
 * chop happens", which would give us the season length for free. It is not
 * that, and we checked before building on it. In the one COMPLETED chopped
 * league in our data (2025, 18 teams, 17 eliminations) the field reads 17,
 * which is exactly the LAST COMPLETED chop rather than a scheduled end. In
 * 2026 leagues that have chopped exactly once so far it reads 1. Two 32 team
 * leagues that have chopped twice carry null. One 18 team league sitting at
 * week 1 carries 18. Those four shapes cannot all be a final week, and three
 * of the four are consistent with "the most recently completed leg", with the
 * 18 looking like a leftover from league creation.
 *
 * A field that means "last completed chop" would tell us the season ends this
 * week, every week, which would collapse the survival simulation to a single
 * week and report a title chance of roughly 1/aliveCount to everyone still in.
 * So we ignore the field entirely and derive the final week from the field
 * size instead: one team leaves per week, so aliveCount teams need
 * aliveCount - 1 more weeks to reach a single survivor, and the answer is
 * capped at week 17 because Sleeper's fantasy regular season does not run past
 * it. `finalWeekVerified` is false, and it is surfaced in the report so the UI
 * can hedge the wording rather than state a date we do not actually know.
 *
 * Do not re-derive this. If Sleeper ever documents the field, replace the
 * fallback and flip FINAL_WEEK_VERIFIED in one place.
 */

/** The last fantasy week a Sleeper chopped league can run a chop in. */
export const LAST_FANTASY_WEEK = 17;

/**
 * False until someone confirms a Sleeper field that states the final chop
 * week. See the header: `last_chopped_leg` is not it.
 */
export const FINAL_WEEK_VERIFIED = false;

/**
 * The elimination fields we read off a stored roster's Sleeper settings.
 *
 * Typed loosely on purpose. These come out of `rosters.metadata.settings`,
 * which is whatever Sleeper handed us at capture time, so a caller may hold a
 * `Record<string, number>`, a parsed jsonb blob, or a narrower typed object.
 * All three should be able to ask this module a question without a cast.
 */
export type ChoppedRosterSettings = {
  /** The week this roster was chopped. 0, null or absent means still alive. */
  eliminated?: unknown;
  /** Sleeper sets this on an eliminated roster. Read for documentation only. */
  locked?: unknown;
};

/**
 * Sleeper's `settings.type`: 0 redraft, 1 keeper, 2 dynasty, 3 chopped.
 */
const SLEEPER_TYPE_CHOPPED = 3;

/**
 * Is this a chopped league that actually chops?
 *
 * `disable_elimination` is the commissioner switch that turns a chopped league
 * into an ordinary scoring league with chopped's UI. Treating one of those as
 * chopped would tell every manager they are in danger of elimination in a
 * league where nobody can be eliminated, which is the loudest possible wrong
 * answer, so the switch is checked rather than the type alone.
 */
export function isChoppedLeague(
  settings: Record<string, unknown> | null | undefined,
): boolean {
  if (!settings) return false;
  if (Number(settings.type) !== SLEEPER_TYPE_CHOPPED) return false;
  return Number(settings.disable_elimination ?? 0) !== 1;
}

/**
 * The week a roster was chopped, or null if it is still alive.
 *
 * Zero is alive, not week zero. Sleeper writes 0 into the field on every
 * roster at league creation, so reading a falsy zero as a real elimination
 * week would report an entire league as dead before a snap is played.
 */
export function eliminatedWeek(
  settings: ChoppedRosterSettings | null | undefined,
): number | null {
  if (!settings) return null;
  const raw = settings.eliminated;
  if (raw === null || raw === undefined || raw === "") return null;
  const week = Number(raw);
  if (!Number.isFinite(week) || week <= 0) return null;
  return week;
}

/** A roster is alive when it has no elimination week recorded against it. */
export function isAliveRoster(
  settings: ChoppedRosterSettings | null | undefined,
): boolean {
  return eliminatedWeek(settings) === null;
}

export type FinalWeekRead = {
  finalWeek: number;
  /** Always false today. See the module header. */
  finalWeekVerified: boolean;
};

/**
 * When the last chop lands, derived from how many teams are left.
 *
 * `currentWeek + aliveCount - 2` is the week that leaves one survivor: the
 * current week chops one (hence the minus one for it) and each later week
 * chops one more. Capped at week 17.
 *
 * With one team left the result sits BEFORE the current week, and that is
 * deliberate rather than clamped away: the league is over, there is nothing
 * left to simulate, and `choppedWeeks` returning an empty list is the honest
 * way to say so. Clamping it up to the current week would hand the simulation
 * a week in which the last survivor can still be chopped.
 */
export function resolveFinalWeek(
  currentWeek: number,
  aliveCount: number,
): FinalWeekRead {
  const week = Number.isFinite(currentWeek) ? Math.floor(currentWeek) : 1;
  const alive = Number.isFinite(aliveCount) ? Math.floor(aliveCount) : 0;
  return {
    finalWeek: Math.min(LAST_FANTASY_WEEK, week + Math.max(0, alive) - 2),
    finalWeekVerified: FINAL_WEEK_VERIFIED,
  };
}

/**
 * The weeks the survival simulation plays, current week through final week.
 * Empty when the season has nothing left to decide, which every caller must
 * handle rather than assuming at least one week.
 */
export function choppedWeeks(currentWeek: number, finalWeek: number): number[] {
  const first = Number.isFinite(currentWeek) ? Math.floor(currentWeek) : 1;
  const last = Number.isFinite(finalWeek) ? Math.floor(finalWeek) : first - 1;
  const out: number[] = [];
  for (let w = first; w <= last; w += 1) out.push(w);
  return out;
}

/**
 * How full the league still is. Money is worth less as the field shrinks,
 * because every chop dumps a full roster of startable players into the pool,
 * so the rest of the model scales prices by this.
 */
export function aliveFraction(aliveCount: number, startCount: number): number {
  if (!Number.isFinite(aliveCount) || !Number.isFinite(startCount)) return 0;
  if (startCount <= 0) return 0;
  return Math.max(0, Math.min(1, aliveCount / startCount));
}
