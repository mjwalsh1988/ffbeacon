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
 * size instead: one team leaves per week in most leagues (two in the 32 team
 * leagues; see chopsPerWeek), so aliveCount teams need aliveCount - 1 more
 * chops to reach a single survivor, and the answer is
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
 * `disable_elimination` reads like the commissioner switch that turns a
 * chopped league into an ordinary scoring league with chopped's UI, and a
 * league where nobody can be eliminated must never be told it is in danger of
 * elimination. But the flag does NOT mean that on its own. Measured on
 * 2026-09-25: of the eight 2026 chopped leagues carrying disable_elimination 1,
 * SEVEN had already eliminated rosters, including both 32 team leagues, which
 * chop two a week. Reading the flag alone filed those as ordinary leagues and
 * ran a head to head model over a league with no head to head games, which
 * printed 0.00 expected wins for every team.
 *
 * So the elimination record wins. A chopped-type league is chopped when the
 * flag is off OR when Sleeper has recorded an elimination on any roster
 * (`eliminatedWeeks`, one entry per roster, from `eliminatedWeek`). A league
 * with the flag on and nobody out yet is treated as not chopping: before its
 * first chop there is no way to tell, and "ordinary league" is the answer that
 * frightens nobody. Callers without roster data may omit the second argument
 * and get the flag-only reading.
 */
export function isChoppedLeague(
  settings: Record<string, unknown> | null | undefined,
  eliminatedWeeks: ReadonlyArray<number | null> = [],
): boolean {
  if (!settings) return false;
  if (Number(settings.type) !== SLEEPER_TYPE_CHOPPED) return false;
  if (Number(settings.disable_elimination ?? 0) !== 1) return true;
  return eliminatedWeeks.some((week) => week !== null);
}

/**
 * How many rosters this league chops per week, read off what it has actually
 * done. Sleeper publishes no setting for it: most leagues chop one, the 32
 * team leagues we hold chop two. The busiest week so far is the answer, and 1
 * before anyone has gone. The busiest rather than the latest, because a week
 * in which a league chops fewer (it has run out of teams) says nothing about
 * the weeks before.
 */
export function chopsPerWeek(eliminatedWeeks: ReadonlyArray<number | null>): number {
  const byWeek = new Map<number, number>();
  for (const week of eliminatedWeeks) {
    if (week === null) continue;
    byWeek.set(week, (byWeek.get(week) ?? 0) + 1);
  }
  let most = 1;
  for (const count of byWeek.values()) most = Math.max(most, count);
  return most;
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
 * When the last chop lands, derived from how many teams are left and how many
 * go each week (`perWeek`, from `chopsPerWeek`; 1 when omitted).
 *
 * Reaching one survivor takes ceil((aliveCount - 1) / perWeek) chop weeks,
 * the first of them the current week, so the final week is the current week
 * plus that count minus one. With one chop a week that is
 * `currentWeek + aliveCount - 2`, exactly as before. Capped at week 17.
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
  perWeek = 1,
): FinalWeekRead {
  const week = Number.isFinite(currentWeek) ? Math.floor(currentWeek) : 1;
  const alive = Number.isFinite(aliveCount) ? Math.floor(aliveCount) : 0;
  const chops = Number.isFinite(perWeek) && perWeek >= 1 ? Math.floor(perWeek) : 1;
  const chopWeeks = Math.ceil((Math.max(0, alive) - 1) / chops);
  return {
    finalWeek: Math.min(LAST_FANTASY_WEEK, week + chopWeeks - 1),
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
