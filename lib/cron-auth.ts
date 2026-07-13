import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Shared cron / trusted server-to-server bearer verification (FFB-SEC-009).
 *
 * Verifies `Authorization: Bearer <CRON_SECRET>` with a CONSTANT-TIME comparison so the
 * secret cannot be recovered by a timing oracle. Fails closed when CRON_SECRET is unset
 * (500) and rejects missing, malformed, or incorrect bearers (401). Never logs the
 * supplied value.
 *
 * CRON_SECRET is for Vercel Cron and other trusted server-to-server calls only. It must
 * never be sent from the browser, placed in a public request body/URL/HTML/bundle, or
 * returned in a public response.
 */
export type CronAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 500; error: string };

export function verifyCronRequest(req: Request): CronAuthResult {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return { ok: false, status: 500, error: "CRON_SECRET not configured" };
  }
  const auth = req.headers.get("authorization") ?? "";
  return bearerMatches(auth, secret)
    ? { ok: true }
    : { ok: false, status: 401, error: "Unauthorized" };
}

function bearerMatches(auth: string, secret: string): boolean {
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(auth);
  const b = Buffer.from(expected);
  // Length check first: timingSafeEqual throws on unequal-length buffers.
  return a.length === b.length && timingSafeEqual(a, b);
}
