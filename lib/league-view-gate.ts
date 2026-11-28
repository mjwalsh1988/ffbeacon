import { getTrustedClientIp } from "@/lib/client-ip";

/**
 * The budget in front of every league page.
 *
 * WHY THIS EXISTS
 *   A league page is the most expensive thing the site renders: about fifty
 *   database reads, a few writes, and on a cold league four Sleeper calls. It is
 *   also reachable by anyone with a league id, signed in or not. On 2026-11-26
 *   and 27 two crawls found that out. One walked the matchup pages of about 130
 *   leagues at hundreds of requests a second from rotating addresses. The other
 *   was a search crawler that loaded one league 3,300 times in 25 minutes. The
 *   database stopped answering and stayed down for six hours.
 *
 *   A firewall rule keyed on an address or a browser fingerprint does not hold
 *   against a caller that rotates both, and the first crawl did. So the budgets
 *   here are counted against things a caller cannot rotate: the league being
 *   asked for, and league traffic as a whole.
 *
 * THE BUDGETS, all per LEAGUE_VIEW_WINDOW_SECONDS
 *   - A signed-in member: MEMBER_MAX page loads, counted against the account.
 *     Members never touch the three anonymous budgets, so a crawl cannot lock a
 *     member out of their own league. All members together share
 *     MEMBER_SITE_MAX, so a stack of throwaway accounts is bounded too.
 *   - An anonymous address: ANON_PER_IP_MAX. Checked first, so one noisy address
 *     is stopped before it spends anything shared.
 *   - One league, all anonymous readers together: ANON_PER_LEAGUE_MAX. Checked
 *     second, so a crawl of one league cannot spend the site budget.
 *   - Every league, all anonymous readers together: ANON_SITE_MAX. The backstop
 *     for a crawl spread across many leagues and many addresses.
 *
 *   The order matters and the claims are made one after another for that
 *   reason: a request refused by an earlier budget never counts against a later
 *   one.
 *
 * WHERE IT IS ENFORCED, AND WHY THERE
 *   At the top of every league page body (refuseLeagueView in
 *   components/league-view-refused.tsx), before the page reads anything. Not in
 *   middleware and not in the league layout, for three reasons that were each
 *   checked against the installed Next:
 *   - A router prefetch must not be counted, or one page view full of league
 *     links spends a reader's whole budget. Next strips the prefetch headers
 *     before middleware and before headers() can see them, so neither place can
 *     tell a prefetch apart. But a prefetch never renders a page body, so a
 *     check that lives in the body is skipped by one for free.
 *   - Middleware matches on the raw path, which a caller can dress up (an
 *     encoded id, an image suffix, a POST). The page body runs for every one of
 *     those, with the id already decoded.
 *   - A layout is not rendered again on a client navigation, and a caller can
 *     claim to already hold it. The page body always renders.
 *
 * WHAT A REFUSED READER SEES
 *   A short page that says to wait or sign in, in place of the league. The
 *   refused request costs the counter updates and whatever generateMetadata
 *   reads (one row for a synced league), and none of the page.
 *
 * FAILS CLOSED FOR ANONYMOUS READERS
 *   If the counter cannot be reached, the database is the thing that is down,
 *   and the page behind this gate could not have loaded either. Saying so in a
 *   few hundred milliseconds is better than a function that waits five minutes
 *   on a dead database, which is what happened on 2026-11-27. A signed-in
 *   member is let through in that case and gets the page's own retry state.
 *
 * The claims go out with plain fetch and a short timeout, not the shared
 * Supabase client: that client has no deadline, and a limiter that can hang is
 * the failure this file exists to prevent.
 */

/** Every budget below is a count per this many seconds. */
export const LEAGUE_VIEW_WINDOW_SECONDS = 300;
/** League page loads one signed-in member may make per window. */
export const MEMBER_MAX = 150;
/** League page loads all signed-in members may make per window, together. */
export const MEMBER_SITE_MAX = 900;
/** League page loads one anonymous address may make per window. */
export const ANON_PER_IP_MAX = 20;
/** Anonymous loads of any one league per window, all readers together. */
export const ANON_PER_LEAGUE_MAX = 30;
/** Anonymous loads of every league per window, all readers together. */
export const ANON_SITE_MAX = 50;

/** How long one counter update may take before the gate gives up. */
const CLAIM_TIMEOUT_MS = 2_000;

export type LeagueViewRefusalReason =
  | "member"
  | "address"
  | "league"
  | "site"
  /** The counter did not answer. */
  | "unavailable";

export type LeagueViewVerdict =
  | { allowed: true }
  | { allowed: false; reason: LeagueViewRefusalReason };

async function claim(bucket: string, key: string, max: number): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error("league view gate is not configured");
  const response = await fetch(`${url}/rest/v1/rpc/try_claim_rate_limit`, {
    method: "POST",
    headers: {
      apikey: secret,
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      p_bucket: bucket,
      p_key: key,
      p_max_requests: max,
      p_window_seconds: LEAGUE_VIEW_WINDOW_SECONDS,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(CLAIM_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`rate limit claim answered ${response.status}`);
  return (await response.json()) === true;
}

/**
 * A salted hash of the address, never the address itself: the counter row
 * outlives the request and an IP is personal data. Same salt as
 * lib/rate-limit-actor.ts.
 */
async function addressKey(requestHeaders: Headers): Promise<string> {
  const salt =
    process.env.LEAGUE_SYNC_IP_SALT ?? process.env.SIGNAL_SCOUT_IP_SALT ?? "";
  if (!salt.trim() && process.env.NODE_ENV === "production") {
    throw new Error("league view gate has no IP salt");
  }
  const ip = getTrustedClientIp(
    new Request("https://ffbeacon.internal/league-view", { headers: requestHeaders }),
  );
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${salt}:${ip}`),
  );
  const hex = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return `ip:${hex}`;
}

/**
 * Claim one league page load for this reader.
 *
 * `userId` must be an identity the server verified (signed claims), never
 * something read from the request. `requestHeaders` are the platform's own
 * headers, which is where the trusted address comes from.
 */
export async function claimLeagueView(
  requestHeaders: Headers,
  sleeperLeagueId: string,
  userId: string | null,
): Promise<LeagueViewVerdict> {
  if (userId) {
    try {
      if (!(await claim("league-view:member", `user:${userId}`, MEMBER_MAX))) {
        return { allowed: false, reason: "member" };
      }
      if (!(await claim("league-view:members", "all", MEMBER_SITE_MAX))) {
        return { allowed: false, reason: "site" };
      }
      return { allowed: true };
    } catch (err) {
      // The page's own retry state is the right answer for a member when the
      // counter is unreachable. See FAILS CLOSED above.
      console.error("[league-view-gate] member claim failed", err);
      return { allowed: true };
    }
  }

  try {
    if (!(await claim("league-view:ip", await addressKey(requestHeaders), ANON_PER_IP_MAX))) {
      return { allowed: false, reason: "address" };
    }
    if (!(await claim("league-view:league", sleeperLeagueId, ANON_PER_LEAGUE_MAX))) {
      return { allowed: false, reason: "league" };
    }
    if (!(await claim("league-view:site", "all", ANON_SITE_MAX))) {
      return { allowed: false, reason: "site" };
    }
    return { allowed: true };
  } catch (err) {
    console.error("[league-view-gate] anonymous claim failed", err);
    return { allowed: false, reason: "unavailable" };
  }
}
