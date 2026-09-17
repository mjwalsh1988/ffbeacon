import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Bearer verification for the two desk routes, modelled on lib/cron-auth.ts.
 *
 * BRIEF_DESK_TOKEN is distinct from CRON_SECRET so revoking the desk's access
 * affects nothing else. Constant-time comparison; fails closed with 500 when
 * the variable is unset and 401 otherwise. The supplied value is never logged.
 */
export type BriefDeskAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 500; error: string };

export function verifyBriefDeskRequest(req: Request): BriefDeskAuthResult {
  const token = process.env.BRIEF_DESK_TOKEN;
  if (!token) {
    return { ok: false, status: 500, error: "BRIEF_DESK_TOKEN not configured" };
  }
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${token}`;
  const a = Buffer.from(auth);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b)
    ? { ok: true }
    : { ok: false, status: 401, error: "Unauthorized" };
}

/** Whether the token is configured at all, for the admin settings page. Never the value. */
export function briefDeskTokenPresent(): boolean {
  return Boolean(process.env.BRIEF_DESK_TOKEN);
}
