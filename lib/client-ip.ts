import "server-only";

/**
 * Single trusted client-IP derivation for rate-limit keys (FFB-SEC-008).
 *
 * Threat: the leftmost `x-forwarded-for` entry is client-controlled under a generic
 * proxy, so keying limits on it lets an attacker rotate a self-chosen IP and defeat
 * every IP throttle. The previous per-route helpers all read that leftmost entry and
 * one even skipped its limit entirely when no IP resolved (fail-open).
 *
 * Derivation order (most-trusted first):
 *   1. `x-vercel-forwarded-for` - set by Vercel's edge to the real client IP and
 *      overwritten on ingress, so a client cannot spoof it. This is the deployed
 *      platform's trusted header.
 *   2. `x-real-ip` - also set by Vercel to the client IP.
 *   3. The RIGHTMOST `x-forwarded-for` hop - the hop added by the closest trusted
 *      proxy. Never the leftmost (client-controlled) entry.
 *
 * Fails CLOSED: when nothing trusted resolves, returns a stable sentinel. Callers MUST
 * still enforce the limit against that sentinel; they must never treat a missing IP as
 * "skip the limit". A shared sentinel means unattributable traffic all shares one
 * bucket, which throttles conservatively rather than opening a bypass.
 */

export const UNKNOWN_IP = "unknown-ip";

export function getTrustedClientIp(req: Request): string {
  const vercel = firstEntry(req.headers.get("x-vercel-forwarded-for"));
  if (vercel) return vercel;

  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;

  // Fall back to the rightmost x-forwarded-for hop (closest trusted proxy), never the
  // client-controlled leftmost entry.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const rightmost = parts[parts.length - 1];
    if (rightmost) return rightmost;
  }

  return UNKNOWN_IP;
}

function firstEntry(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(",")[0]?.trim();
  return first || null;
}
