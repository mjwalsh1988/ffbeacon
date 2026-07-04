import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { runSleeperMarketSync } from "@/lib/sync-sleeper-market";
import { recordCronRun } from "@/lib/cron-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/sync-sleeper-market
 *
 * Vercel Cron entry point for the nightly Sleeper draft-market refresh (ADP for
 * every format Sleeper publishes + season projection points). Runs year-round:
 * ADP is most alive in the off-season, which is draft season, so there is no
 * off-season skip here (unlike the stats sync).
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` only. Calls the same
 * runSleeperMarketSync() the CLI uses and returns its JSON summary.
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
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/sync-sleeper-market] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
