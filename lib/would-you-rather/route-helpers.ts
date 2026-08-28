import "server-only";

/**
 * Shared route-layer plumbing for /api/games/would-you-rather/**.
 *
 * The same guards on every route, so the abuse rules cannot drift apart
 * between the one that serves a round and the one that records a vote:
 * the `x-requested-with` header check, private no-store response headers, the
 * durable per-actor rate limit, and the error-to-status mapping.
 *
 * Mirrors lib/signal-scout/route-helpers.ts, which is the house pattern for a
 * public game endpoint. The rate limiter is the shared
 * `claimRateLimitSlot`, so the actor is derived on the server from the session
 * cookie and the platform's own forwarding headers. A caller who picks their
 * own limit key has no limit, so no key is ever read from the request.
 */

import { NextResponse } from "next/server";
import { claimRateLimitSlot } from "@/lib/rate-limit-claim";
import type { WyrErrorCode } from "./types";

/**
 * A same-origin marker the browser will not attach cross-site without CORS,
 * which the site never grants. Not a CSRF defence on its own; it is the cheap
 * first filter, and every state change behind it is additionally keyed to a
 * server-derived identity.
 */
export function requireFfBeaconHeader(req: Request): boolean {
  return req.headers.get("x-requested-with") === "ff-beacon";
}

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
} as const;

/**
 * Every response from these routes is per-person: it carries the reader's own
 * vote, their remaining free plays, and, after a vote, the answer. None of it
 * may be cached by a shared cache.
 */
export function privateJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

const ERROR_STATUS: Record<WyrErrorCode, number> = {
  game_disabled: 503,
  guest_play_disabled: 403,
  // 403, not 401. A guest who has spent their free votes is not unauthenticated
  // in a way a WWW-Authenticate challenge could fix, and a global fetch handler
  // keyed on 401 would bounce them to a login page mid-round rather than let the
  // game show them its own sign-in state.
  guest_limit_reached: 403,
  rate_limited: 429,
  not_found: 404,
  bad_request: 400,
  pool_empty: 503,
  server_error: 500,
};

export function errorStatus(code: WyrErrorCode): number {
  return ERROR_STATUS[code] ?? 500;
}

/**
 * Rate limits, one bucket per kind of work.
 *
 * A round is one `next` plus one `vote`, and a fast reader genuinely gets
 * through one every few seconds, so these are set well above real play and are
 * there to bound a script rather than to pace a person. `vote` is the tighter
 * of the two because it writes.
 */
export const WYR_NEXT_BUCKET = "would-you-rather-next";
export const WYR_NEXT_MAX = 60;
export const WYR_VOTE_BUCKET = "would-you-rather-vote";
export const WYR_VOTE_MAX = 30;
export const WYR_WINDOW_SECONDS = 60;

export function claimNextSlot(): Promise<boolean> {
  return claimRateLimitSlot({
    bucket: WYR_NEXT_BUCKET,
    max: WYR_NEXT_MAX,
    windowSeconds: WYR_WINDOW_SECONDS,
  });
}

export function claimVoteSlot(): Promise<boolean> {
  return claimRateLimitSlot({
    bucket: WYR_VOTE_BUCKET,
    max: WYR_VOTE_MAX,
    windowSeconds: WYR_WINDOW_SECONDS,
  });
}
