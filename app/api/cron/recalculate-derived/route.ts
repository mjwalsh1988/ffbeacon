import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { runSeedRankings } from "@/lib/seed-rankings";
import { runCalculateTrends } from "@/lib/calculate-trends";
import { recordCronRun } from "@/lib/cron-runs";

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
  const cronAuth = verifyCronRequest(req);
  if (!cronAuth.ok) {
    return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  }

  const supabase = createAdminClient();
  try {
    const result = await recordCronRun(supabase, "recalculate-derived", async () => {
      const started = Date.now();
      const rankings = await runSeedRankings(supabase);
      const trends = await runCalculateTrends(supabase);

      // Bounded retention prune for the On The Clock rate-limit ledgers (FFB-SEC-002).
      // Global and deletion-only (never per-league), so it belongs on this global cron.
      // Non-fatal: a prune failure must never fail the derived recalc.
      let rateLimitLedgerRowsDeleted: number | null = null;
      try {
        const { data } = await supabase.rpc(
          "cleanup_on_the_clock_rate_limits" as never,
          { p_max_age_hours: 24 } as never,
        );
        rateLimitLedgerRowsDeleted = typeof data === "number" ? data : null;
        const { data: genericDeleted } = await supabase.rpc(
          "cleanup_rate_limit_hits" as never,
          { p_max_age_hours: 24 } as never,
        );
        if (typeof genericDeleted === "number") {
          rateLimitLedgerRowsDeleted = (rateLimitLedgerRowsDeleted ?? 0) + genericDeleted;
        }
      } catch (pruneErr) {
        console.error("[cron/recalculate-derived] rate-limit ledger prune failed", pruneErr);
      }

      return {
        ok: true as const,
        rankings,
        trends,
        rateLimitLedgerRowsDeleted,
        durationMs: Date.now() - started,
      };
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/recalculate-derived] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
