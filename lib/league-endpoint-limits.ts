/**
 * Per-caller budgets for the two public league endpoints that can reach
 * Sleeper on a visitor's say-so: /api/leagues/[id]/refresh and
 * /api/leagues/[id]/warm.
 *
 * Both are public on purpose (see the header of each route). Each already had a
 * per-LEAGUE guard: refresh a 60-second cooldown, warm the 60-minute pulse
 * cache. Neither said anything about the CALLER, so one visitor could walk a
 * list of league ids and have each one force a full Sleeper sync. These are the
 * per-actor limits that close that, claimed through
 * lib/rate-limit-claim.ts claimRateLimitSlot (a signed-in user id, or a salted
 * hash of the trusted client IP, and never a key the caller supplies).
 *
 * Pure: no server imports, so the decision below is testable on its own. The
 * pulse cache window is passed in (the route passes LEAGUE_PULSE_TTL_MS) rather
 * than imported, because lib/league-pulse.ts is a server module.
 */

/** Force refresh: a person pressing a button, so a few a minute is plenty. */
export const REFRESH_ACTOR_BUDGET = {
  bucket: "league-refresh",
  max: 4,
  windowSeconds: 60,
} as const;

/**
 * Warm on a league we already store but whose pulse is stale. Fired by hover
 * (after a 200 ms dwell) and keyboard focus, at most once per league per mount,
 * so sixty a minute covers tabbing down a long league list without stalling.
 */
export const WARM_STALE_ACTOR_BUDGET = {
  bucket: "league-warm",
  max: 60,
  windowSeconds: 60,
} as const;

/**
 * Warm on a league id we have never stored. This is the expensive case (a full
 * Sleeper fetch plus the first write of every child row) and the one an
 * arbitrary id reaches, so it is tighter and measured over a longer window.
 * Thirty in ten minutes still covers a reader hovering their own list on
 * /tools/league-pulse, whose leagues come straight from Sleeper and are often
 * not stored yet.
 */
export const WARM_UNKNOWN_ACTOR_BUDGET = {
  bucket: "league-warm-new",
  max: 30,
  windowSeconds: 600,
} as const;

export type WarmLeagueRow = {
  last_pulsed_at: string | null;
  pulse_status: string | null;
} | null;

/**
 * Which budget a warm request must claim before it runs, or null when it needs
 * none.
 *
 * A stored league whose pulse completed inside the cache window costs one
 * indexed read, the same read this decision was made from, and cannot reach
 * Sleeper, so it claims nothing: metering it would only make hovering a list
 * of fresh leagues run out of budget for no protection.
 */
export function warmBudgetFor(
  row: WarmLeagueRow,
  nowMs: number,
  pulseTtlMs: number,
): typeof WARM_STALE_ACTOR_BUDGET | typeof WARM_UNKNOWN_ACTOR_BUDGET | null {
  if (!row) return WARM_UNKNOWN_ACTOR_BUDGET;
  const pulsedMs = row.last_pulsed_at ? Date.parse(row.last_pulsed_at) : Number.NaN;
  const fresh =
    row.pulse_status === "complete" &&
    Number.isFinite(pulsedMs) &&
    nowMs - pulsedMs < pulseTtlMs;
  return fresh ? null : WARM_STALE_ACTOR_BUDGET;
}
