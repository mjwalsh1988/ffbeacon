import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { runSeedRankings } from "@/lib/seed-rankings";
import { runCalculateTrends } from "@/lib/calculate-trends";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/recalculate-derived
 *
 * Vercel Cron entry point for the global derived recalculation that follows
 * the two value syncs. Runs:
 *   1. seed-rankings (rebuild rankings table from latest player_value_history)
 *   2. calculate-trends (rebuild player_value_trends pre-calc)
 *
 * These are global, player-level tables, not per-league. League Pulse power
 * rankings are NOT recomputed here: that is done on demand when a league deep
 * view loads, via pulseLeague() -> calculateLeaguePowerRankings() in
 * lib/league-pulse.ts. Recomputing every stored league nightly does not scale
 * to tens of thousands of leagues, and unviewed leagues never need a cache row.
 * For a manual one-off recompute use `npm run calculate:power-rankings`.
 *
 * Scheduled in vercel.json to fire AFTER both sync-ktc (03:00 ET) and
 * sync-fantasycalc (04:00 ET) so derived tables reflect the freshest values.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` only.
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

  const started = Date.now();
  const supabase = createAdminClient();
  try {
    const rankings = await runSeedRankings(supabase);
    const trends = await runCalculateTrends(supabase);

    const finished = Date.now();
    return NextResponse.json({
      ok: true,
      rankings,
      trends,
      durationMs: finished - started,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/recalculate-derived] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
