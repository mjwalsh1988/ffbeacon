/**
 * Shared route-layer helpers for Signal Scout (Phase 3, plan section 20).
 *
 * Every route under app/api/games/signal-scout/** reuses these primitives so
 * the anti-cheat and abuse-guard rules (plan section 15) are enforced
 * identically everywhere: the x-requested-with header guard, the private
 * response headers, guest identity resolution (session first, then a
 * cookie, then a freshly minted one), the salted guest IP hash, the
 * engine-error-to-HTTP-status mapping, and the windowed abuse-guard claim.
 *
 * Route handlers accept a plain Request (matching the house pattern in
 * app/api/on-the-clock/**), so cookie reads here are done by hand against
 * the raw "cookie" header rather than relying on NextRequest.cookies.
 * Cookie WRITES happen on the NextResponse the route returns; this module
 * never uses next/headers cookies().set, since that only affects Server
 * Component/Server Action responses, not Route Handler responses.
 */

import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { getTrustedClientIp } from "@/lib/client-ip";
import { currentEasternGameDate } from "./streaks";
import type { RoundIdentity, EngineError } from "./round-engine";

type Client = SupabaseClient<Database>;

// ---------------------------------------------------------------------------
// Header guard
// ---------------------------------------------------------------------------

export function requireFfBeaconHeader(req: Request): boolean {
  return req.headers.get("x-requested-with") === "ff-beacon";
}

// ---------------------------------------------------------------------------
// Private JSON responses
// ---------------------------------------------------------------------------

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
} as const;

export function privateJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

// ---------------------------------------------------------------------------
// Guest cookie
// ---------------------------------------------------------------------------

export const SCOUT_GUEST_COOKIE = "ffbeacon.scout_guest";
export const SCOUT_GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const SCOUT_GUEST_COOKIE_OPTIONS = {
  path: "/" as const,
  maxAge: SCOUT_GUEST_COOKIE_MAX_AGE,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  httpOnly: true,
};

/** Hand-rolled cookie read: routes here take a plain Request, which has no .cookies accessor. */
function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Client IP
// ---------------------------------------------------------------------------

/**
 * Trusted client IP for the guest IP hash. Delegates to the single shared helper
 * (FFB-SEC-008) so spoofed x-forwarded-for cannot rotate the guest rate-limit key
 * and a missing IP fails closed to a stable sentinel rather than opening a bypass.
 */
export function clientIp(req: Request): string {
  return getTrustedClientIp(req);
}

// ---------------------------------------------------------------------------
// Guest IP hashing
// ---------------------------------------------------------------------------

/**
 * Resolve the guest-IP hashing salt (FFB-SEC-010). IPs are low-entropy, so the secret
 * salt is what makes the stored hash non-reversible and the guest daily cap
 * non-precomputable.
 *
 * Fails CLOSED in production: a missing SIGNAL_SCOUT_IP_SALT throws rather than falling
 * back to a repository-known value (which would make prod hashes reversible). Outside
 * production an explicit, clearly-labelled dev/test value is used so local development
 * and tests work with zero setup. This value is NEVER used in production.
 */
const DEV_ONLY_IP_SALT = "ffbeacon-signal-scout-dev-only-not-for-production";

function resolveIpSalt(): string {
  const salt = process.env.SIGNAL_SCOUT_IP_SALT;
  if (salt && salt.trim()) return salt;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SIGNAL_SCOUT_IP_SALT is required in production (guest rounds refused without it).",
    );
  }
  return DEV_ONLY_IP_SALT;
}

/** sha256 hex of `${salt}:${ip}`. Never returns empty; input coalesces to "unknown" first. */
export function hashGuestIp(ip: string): string {
  const value = ip && ip.trim() ? ip : "unknown";
  return createHash("sha256").update(`${resolveIpSalt()}:${value}`).digest("hex");
}

// ---------------------------------------------------------------------------
// Zod schemas shared by every route
// ---------------------------------------------------------------------------

export const uuidSchema = z.string().uuid();
export const tierSchema = z.enum(["weak", "clear", "ping", "scan"]);
export const confirmBurnSchema = z.boolean();

// ---------------------------------------------------------------------------
// Identity resolution
// ---------------------------------------------------------------------------

/**
 * Logged-in check first via the SSR client's auth.getUser(); otherwise read
 * the guest cookie off the request, or mint a fresh uuid when it is absent
 * or malformed. mintedGuestId is non-null only when a new id was minted, so
 * the calling route knows to set the cookie on ITS response.
 */
export async function resolveRoundIdentity(
  req: Request,
): Promise<{ identity: RoundIdentity; mintedGuestId: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    return { identity: { kind: "user", userId: user.id }, mintedGuestId: null };
  }

  const ipHash = hashGuestIp(clientIp(req));
  const cookieGuestId = readCookie(req, SCOUT_GUEST_COOKIE);
  if (cookieGuestId && uuidSchema.safeParse(cookieGuestId).success) {
    return { identity: { kind: "guest", guestId: cookieGuestId, ipHash }, mintedGuestId: null };
  }

  const mintedGuestId = randomUUID();
  return { identity: { kind: "guest", guestId: mintedGuestId, ipHash }, mintedGuestId };
}

/** Namespaced abuse-guard key: "user:<uuid>" or "guest:<uuid>". */
export function identityKeyFor(identity: RoundIdentity): string {
  return identity.kind === "user" ? `user:${identity.userId}` : `guest:${identity.guestId}`;
}

// ---------------------------------------------------------------------------
// Engine error -> HTTP status
// ---------------------------------------------------------------------------

const ENGINE_ERROR_STATUS: Record<string, number> = {
  not_found: 404,
  round_not_active: 409,
  active_round_exists: 409,
  game_disabled: 503,
  pool_empty: 503,
  guess_duplicate: 409,
  guess_out_of_pool: 400,
  invalid_tier: 400,
  signal_burned: 409,
  tier_disabled: 400,
  tier_limit_reached: 409,
  tier_exhausted: 409,
  burn_confirmation_required: 409,
  guest_limit_reached: 429,
  guest_play_disabled: 403,
  rate_limited: 429,
};

export function engineErrorStatus(
  code: EngineError | "guest_limit_reached" | "guest_play_disabled" | "rate_limited",
): number {
  return ENGINE_ERROR_STATUS[code] ?? 500;
}

// ---------------------------------------------------------------------------
// Windowed abuse-guard claim
// ---------------------------------------------------------------------------

/**
 * Wraps try_claim_signal_scout_action. identityKey should come from
 * identityKeyFor() so every route shares one namespacing scheme; game_date
 * is always the current ET day, matching the RPC's ledger key.
 */
export async function claimAction(
  admin: Client,
  identityKey: string,
  action: string,
  windowSeconds: number,
): Promise<boolean> {
  const { data, error } = await admin.rpc("try_claim_signal_scout_action", {
    p_identity_key: identityKey,
    p_action: action,
    p_game_date: currentEasternGameDate(),
    p_window_seconds: windowSeconds,
  });
  if (error) throw new Error(`try_claim_signal_scout_action failed: ${error.message}`);
  return Boolean(data);
}
