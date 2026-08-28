/**
 * Browser-side calls into the Would You Rather routes.
 *
 * Thin on purpose. Every rule the game has (the feature gate, the free-trial
 * allowance, one vote per person, the rate limits) is enforced on the server,
 * and this file exists so the component does not have to remember the header
 * or the error shape. It decides nothing.
 *
 * A network failure and a rejected request are collapsed into the same
 * `{ ok: false, error }` shape the routes return, so the caller has one thing
 * to handle rather than two.
 */

import type { WyrNextResponse, WyrSide, WyrVoteResponse } from "./types";

const HEADERS = {
  "Content-Type": "application/json",
  // Matched by requireFfBeaconHeader on every route. The browser will not
  // attach it cross-site without a CORS grant the site never gives.
  "x-requested-with": "ff-beacon",
} as const;

export async function fetchNextRound(signal?: AbortSignal): Promise<WyrNextResponse> {
  try {
    const res = await fetch("/api/games/would-you-rather/next", {
      method: "GET",
      headers: HEADERS,
      signal,
    });
    const json = (await res.json()) as WyrNextResponse;
    return json;
  } catch (err) {
    // An aborted request is the component unmounting or moving on, not a
    // failure to report. It is rethrown so the caller can ignore it.
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return { ok: false, error: "server_error" };
  }
}

export async function submitVote(
  tradeId: string,
  side: WyrSide,
  signal?: AbortSignal,
): Promise<WyrVoteResponse> {
  try {
    const res = await fetch("/api/games/would-you-rather/vote", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ tradeId, side }),
      signal,
    });
    const json = (await res.json()) as WyrVoteResponse;
    return json;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return { ok: false, error: "server_error" };
  }
}
