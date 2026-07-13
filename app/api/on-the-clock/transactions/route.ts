import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getAllSleeperTransactions } from "@/lib/sleeper";
import { loadOnTheClockSettings } from "@/lib/on-the-clock/settings";
import { claimLookup, claimIpBudget } from "@/lib/on-the-clock/cache";
import { isValidLeagueId } from "@/lib/on-the-clock/validation";
import { shapeLeagueTrades } from "@/lib/on-the-clock/transactions-shape";
import { getTrustedClientIp } from "@/lib/client-ip";

export const dynamic = "force-dynamic";

/**
 * GET /api/on-the-clock/transactions?league_id=
 *
 * Returns every completed TRADE in a league, shaped to the asset references the
 * cockpit Trade History tab values against the FF Beacon board (the client never
 * calls Sleeper directly). Non-trade moves (waivers, free agents, commissioner
 * actions) are filtered out: this surface is trade-only.
 *
 * Guarded the same way as the rest of On The Clock: the x-requested-with header,
 * strict league-id validation, and the feature-enabled gate. Sleeper's transaction
 * feed is per-week, so we walk weeks 0..N once (getAllSleeperTransactions) and the
 * client caches the result for the session, lazy-loading only when the tab opens.
 *
 * Response: private, no-store.
 */

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
} as const;

/** Hard cap so a pathological league can't return an unbounded payload. */
const MAX_TRADES = 250;

/** Per-(ip, league) throttle window guarding the Sleeper transaction fan-out. */
const LOOKUP_WINDOW_SECONDS = 10;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

export async function GET(req: Request) {
  if (req.headers.get("x-requested-with") !== "ff-beacon") {
    return json({ error: "Invalid request" }, 403);
  }

  const url = new URL(req.url);
  const leagueId = url.searchParams.get("league_id") ?? "";
  if (!isValidLeagueId(leagueId)) {
    return json({ error: "Invalid league id." }, 400);
  }

  const admin = createAdminClient();
  const settings = await loadOnTheClockSettings(admin);
  if (!settings.feature.enabled) {
    return json({ error: "On The Clock is not available yet." }, 503);
  }

  // Durable abuse guards BEFORE the Sleeper fan-out (this walks the league's weekly
  // transaction feed). First the identifier-independent per-IP budget (FFB-SEC-002),
  // then the per-(ip, league) cooldown. Short-circuits so a globally throttled caller
  // never consumes the per-league slot. Fail closed if either cannot evaluate.
  const ip = getTrustedClientIp(req);
  let allowed: boolean;
  try {
    allowed =
      (await claimIpBudget(admin, ip)) &&
      (await claimLookup(admin, {
        ip,
        username: `txns:${leagueId}`,
        windowSeconds: LOOKUP_WINDOW_SECONDS,
      }));
  } catch (err) {
    console.error("[on-the-clock/transactions] rate-limit guard failed", err);
    return json({ error: "Try again in a moment." }, 503);
  }
  if (!allowed) {
    return json({ error: "Too many lookups. Try again in a few seconds." }, 429);
  }

  const all = await getAllSleeperTransactions(leagueId);
  // Shared shaping (lib/on-the-clock/transactions-shape.ts): completed trades
  // only, newest first. The snapshot finalizer freezes trades through the same
  // path so live and snapshot renders can never diverge.
  const trades = shapeLeagueTrades(all);

  const truncated = trades.length > MAX_TRADES;

  return json({ ok: true, transactions: trades.slice(0, MAX_TRADES), truncated });
}
