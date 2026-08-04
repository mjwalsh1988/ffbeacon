import "server-only";
import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { getTrustedClientIp } from "@/lib/client-ip";

/**
 * Who a rate limit is counted against, on an endpoint that is open to guests.
 *
 * Signed in, the key is the auth user id, so the limit follows the person across
 * devices and networks. Signed out, it is a salted hash of the trusted client IP
 * (lib/client-ip.ts, which refuses the client-controlled leftmost
 * x-forwarded-for entry precisely so this key cannot be rotated at will).
 *
 * The key is derived here, on the server, from the session cookie and the
 * platform's own headers. It is never read from the request body, because a
 * caller who picks their own limit key has no limit.
 *
 * The IP is hashed rather than stored: an IP is personal data, the ledger it
 * lands in outlives the request, and nothing downstream needs to reverse it. The
 * salt is what makes the hash non-precomputable, since the IP space is small
 * enough to enumerate.
 */

const DEV_ONLY_IP_SALT = "ffbeacon-rate-limit-dev-only-not-for-production";

function resolveIpSalt(): string {
  const salt =
    process.env.LEAGUE_SYNC_IP_SALT ?? process.env.SIGNAL_SCOUT_IP_SALT;
  if (salt && salt.trim()) return salt;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "LEAGUE_SYNC_IP_SALT or SIGNAL_SCOUT_IP_SALT is required in production (guest rate limits refuse to run without one).",
    );
  }
  return DEV_ONLY_IP_SALT;
}

/**
 * `user:<auth uid>` for a signed-in caller, `ip:<sha256 hex>` otherwise.
 *
 * Fails closed by construction: getTrustedClientIp returns a stable sentinel
 * when nothing trustworthy resolves, so unattributable traffic shares one
 * bucket rather than escaping the limit.
 */
export async function resolveRateLimitActorKey(req: Request): Promise<string> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) return `user:${user.id}`;
  } catch {
    // A broken session read is not a reason to hand out an unlimited slot.
    // Fall through to the IP key.
  }

  const ip = getTrustedClientIp(req);
  const hash = createHash("sha256")
    .update(`${resolveIpSalt()}:${ip}`)
    .digest("hex");
  return `ip:${hash}`;
}
