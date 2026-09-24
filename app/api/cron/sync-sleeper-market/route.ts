import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyCronRequest } from "@/lib/cron-auth";
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
 *   1. Sleeper ADP (every format Sleeper publishes) + season projection points,
 *      for every position Sleeper projects: QB, RB, WR, TE, K, DEF and the
 *      individual defensive players (DL, LB, DB).
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
  const cronAuth = verifyCronRequest(req);
  if (!cronAuth.ok) {
    return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  }

  const supabase = createAdminClient();
  try {
    const result = await recordCronRun(supabase, "sync-sleeper-market", () =>
      runSleeperMarketSync(supabase),
    );
    // The IDP guide's draft-round figures read player_market_latest through a
    // day-long cache on this tag; bust it so each morning's ADP shows up the
    // same day rather than up to a day late.
    revalidateTag(CACHE_TAGS.marketAdp);

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
