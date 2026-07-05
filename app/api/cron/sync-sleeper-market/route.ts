import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { runSleeperMarketSync } from "@/lib/sync-sleeper-market";
import { runRookieAdpSync } from "@/lib/sync-rookie-adp";
import { recordCronRun } from "@/lib/cron-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/sync-sleeper-market
 *
 * Vercel Cron entry point for the nightly draft-market ADP refresh. Two syncs
 * feed the same player_market_snapshots table so one job produces all ADP:
 *   1. Sleeper ADP (every format Sleeper publishes) + season projection points.
 *   2. Rookie ADP (FantasyPros dynasty rookie rankings via DynastyProcess),
 *      stored under source='dynastyprocess' + the adp "rookie" key. Sleeper's own
 *      adp_rookie field is a permanent 999 sentinel, so rookie order must come
 *      from here (see lib/sync-rookie-adp.ts).
 * Runs year-round: ADP is most alive in the off-season, which is draft season,
 * so there is no off-season skip here (unlike the stats sync).
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` only. The rookie step is
 * best-effort: its failure is logged and reported but never fails the Sleeper
 * sync (the two feeds are independent).
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  try {
    const result = await recordCronRun(supabase, "sync-sleeper-market", () =>
      runSleeperMarketSync(supabase),
    );

    // Best-effort rookie ADP: never let it fail the primary Sleeper market sync.
    let rookie: unknown;
    try {
      rookie = await runRookieAdpSync(supabase);
    } catch (rookieErr) {
      const message = rookieErr instanceof Error ? rookieErr.message : String(rookieErr);
      console.error("[cron/sync-sleeper-market] rookie ADP step failed", message);
      rookie = { ok: false, error: message };
    }

    return NextResponse.json({ ...result, rookie });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/sync-sleeper-market] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
