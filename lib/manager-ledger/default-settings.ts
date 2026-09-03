/**
 * Manager Ledger constants.
 *
 * There is no admin settings row for this model and there should not be one.
 * Power Pulse and Positional WAR both carry settings because both make
 * modelling choices a reasonable person could argue about: how much to trust a
 * projection, how to weight a season, where to put a cliff. This model makes no
 * such choice. It reads settled results and does arithmetic on them. The only
 * numbers here are cache policy and display caps, which are not opinions about
 * football.
 */

/** How long a computed ledger is served before it is rebuilt. */
export const MANAGER_LEDGER_TTL_MS = 12 * 60 * 60 * 1000;

/** How long a failed or skipped run waits before it is attempted again. */
export const MANAGER_LEDGER_RETRY_MS = 15 * 60 * 1000;

/**
 * Bumped when the arithmetic changes in a way that makes stored rows wrong.
 * A stored row whose model_version differs is recomputed on the next view.
 *
 * The fingerprint cannot do this job: it is a function of the INPUTS, and an
 * arithmetic change leaves every input identical, so the version is the only
 * thing that invalidates a stored row.
 *
 * ledger-3: three corrections, all of which move published figures.
 *   - Injured reserve and the taxi squad are excluded from the best legal
 *     lineup. `player_points` scores every player ON a roster, so the optimum
 *     could previously seat a taxi rookie and tell a manager they left a win on
 *     the bench by not starting someone Sleeper would not let them start. On
 *     the first league remeasured it deleted one such claim outright.
 *   - The set lineup is scored from the same candidate pool as the optimum, so
 *     a starter our players table has not caught up with sits in neither side
 *     rather than inflating the numerator alone.
 *   - Draft baselines are keyed on (draft, round) rather than round, so a
 *     startup and a rookie draft in one season stop averaging together.
 *
 * ledger-2: points figures snapped to two decimals where they are produced.
 * Before that, a week whose set lineup already WAS the best legal lineup came
 * out with a deficit of 1.4e-14 rather than zero, so it reported points left on
 * the bench and a perfect season graded at 0.9999999999.
 */
// ledger-4 (2026-09-02): LedgerWeek now stores setPoints, optimalPoints and
// ungradedSlots. Rows written under ledger-3 have weeks without them, and a
// chart built from those would silently plot nothing, so the version moves and
// every league rebuilds on its next view.
export const MANAGER_LEDGER_MODEL_VERSION = "ledger-4";

/** How many waiver moves are kept per roster in the stored detail. */
export const MAX_STORED_WAIVER_MOVES = 12;

/** How many trades are kept per roster in the stored detail. */
export const MAX_STORED_TRADE_MOVES = 12;

/** How many draft picks are kept at each end of the stored detail. */
export const MAX_STORED_DRAFT_MOVES = 6;

/**
 * How many weeks of a season a roster must have graded before its efficiency
 * is ranked against the rest of the league.
 *
 * One good week is not evidence about a manager, and a leaderboard built on it
 * puts whoever happened to have a clean week one at the top with a 100% figure
 * next to their name. Below the threshold the ledger is still computed and
 * still shown, because the reader is entitled to their own numbers; it is the
 * RANK that is withheld, and the UI says why.
 */
export const MIN_WEEKS_FOR_RANK = 3;
