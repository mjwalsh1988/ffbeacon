import "server-only";
import { claimRateLimitSlot } from "@/lib/rate-limit-claim";

/**
 * The limit on evaluating a trade.
 *
 * An evaluation is the most expensive thing a guest can ask this codebase to do:
 * two Monte Carlo seasons plus forty to eighty exact lineup fills, per press. It
 * has to be limited on EVERY path that can start one, and there are three.
 *
 *   1. The server action, pressed by the builder.
 *   2. The SERVER RENDERED page path. `?mode=build&in=...&out=...` is decoded
 *      and evaluated during render, so a loop over GET requests runs the same
 *      work without ever touching the action. A limit that only guards the
 *      action is not a limit.
 *   3. The streamed evaluation under the on-screen suggestion, which is server
 *      rendered inside a Suspense boundary.
 *
 * ONE BUCKET FOR ALL THREE. Separate buckets would let a caller alternate
 * between the page and the action and spend three budgets instead of one.
 *
 * TEN PER MINUTE, below the finder's twelve, because one evaluation costs more
 * than one search. A person using the builder by hand cannot reach it: they have
 * to pick players between presses. A script reaches it immediately.
 *
 * VALIDATE BEFORE YOU CLAIM. Callers reject a malformed proposal, a player who
 * is not on the roster he is claimed to be on, and an over-length asset list
 * BEFORE calling this. A reader must not lose their budget to a stale link, and
 * an attacker must gain nothing by sending garbage.
 *
 * Fails closed, in lib/rate-limit-claim.ts.
 */
export const TRADE_EVAL_BUCKET = "trade-impact-evaluate";
export const TRADE_EVAL_WINDOW_SECONDS = 60;
export const TRADE_EVAL_MAX = 10;

/**
 * The cheap outer meter.
 *
 * The evaluation bucket below only fires once a proposal has been checked
 * against the league, which is correct for a reader who clicked a stale link and
 * wrong as the only defence. A security review found the hole: send a
 * syntactically valid proposal naming a player who is not on the roster, and it
 * fails validation, so it never reaches the expensive claim, so it costs an
 * attacker nothing and costs us a database read every time. Garbage was the
 * cheapest way to spend our database, because garbage was the one input that
 * skipped the meter.
 *
 * So there are two meters. This one is claimed FIRST, unconditionally, before
 * any read at all, and it is loose enough that no real reader will reach it.
 * The evaluation meter below still guards the expensive half and still runs
 * after validation, so a stale link still costs a reader nothing from the
 * budget that matters.
 */
export const TRADE_ENTRY_BUCKET = "trade-impact-entry";
export const TRADE_ENTRY_MAX = 60;

/**
 * The suggestion engine, which renders on a plain GET.
 *
 * `mode=suggested` is the default, so loading the page runs `findTrades` (a
 * combinatorial search over every counterparty) and grades the shortlist through
 * the Signal Check pipeline. The server action that produces the SAME
 * suggestions from the SAME engine has claimed a slot since it was written, so
 * an attacker who never pressed Search got the engine for free. `force-dynamic`
 * means no CDN absorbs it either.
 *
 * Matched to LEAGUE_RATE_MAX in app/actions/trade-finder.ts, because it is the
 * same work; a reader who can press Search twelve times a minute can reload the
 * page twelve times a minute, and neither is a path to more than the other.
 */
export const TRADE_SUGGEST_BUCKET = "trade-impact-suggest";
export const TRADE_SUGGEST_MAX = 12;

/** The outer meter. Claim before ANY read, on every entry to either mode. */
export async function claimTradeEntrySlot(): Promise<boolean> {
  return claimRateLimitSlot({
    bucket: TRADE_ENTRY_BUCKET,
    max: TRADE_ENTRY_MAX,
    windowSeconds: TRADE_EVAL_WINDOW_SECONDS,
  });
}

/** The suggestion engine's meter. Claim before findTrades runs. */
export async function claimTradeSuggestionSlot(): Promise<boolean> {
  return claimRateLimitSlot({
    bucket: TRADE_SUGGEST_BUCKET,
    max: TRADE_SUGGEST_MAX,
    windowSeconds: TRADE_EVAL_WINDOW_SECONDS,
  });
}

/** The evaluation meter. Claim after validation, before the expensive half. */
export async function claimTradeEvaluationSlot(): Promise<boolean> {
  return claimRateLimitSlot({
    bucket: TRADE_EVAL_BUCKET,
    max: TRADE_EVAL_MAX,
    windowSeconds: TRADE_EVAL_WINDOW_SECONDS,
  });
}
