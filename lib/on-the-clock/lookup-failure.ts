/**
 * What a failed AUTO-RUN of the league lookup means, and what to say about it.
 *
 * Only the auto-run needs this. A lookup a reader started by pressing a button
 * reports its failure in the form they just used; a lookup the page started for
 * them, off a saved handle, has no form on screen to report into, so the
 * identity card has to say something and the two cases are not the same
 * sentence.
 *
 * The one that matters is 429. `/api/on-the-clock/leagues` holds a
 * per-(ip, username) cooldown of ten seconds, so a reader who reloads the page
 * twice in quick succession WILL be refused on the second load. Nothing is
 * wrong with their handle, nothing is wrong with the site, and dropping them
 * back to a username form over it would be telling them to fix something that
 * is not broken. The card stays, with Retry.
 *
 * Everything else is a reason to open the form: a 404 means the saved handle no
 * longer resolves on Sleeper (they renamed themselves), and a 5xx or a network
 * failure is not something a reader can wait out, so offering the manual path
 * is the honest answer.
 */

export type LookupFailure = "throttled" | "failed";

/** 429 is the cooldown and nothing else is. */
export function classifyLookupFailure(status: number): LookupFailure {
  return status === 429 ? "throttled" : "failed";
}

/** Shown on the identity card while `classifyLookupFailure` says "throttled". */
export const LOOKUP_THROTTLED_MESSAGE =
  "That was a moment too soon. Give it a few seconds and press Retry.";

/**
 * Shown on the identity card while `classifyLookupFailure` says "failed".
 *
 * The route's own message (the 404 names the handle Sleeper could not find)
 * still renders inside the form the card opens, so this line is the
 * instruction rather than the diagnosis.
 */
export const LOOKUP_FAILED_MESSAGE =
  "We could not load your leagues with your saved username. Check it below and try again.";
