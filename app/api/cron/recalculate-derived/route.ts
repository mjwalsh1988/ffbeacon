import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { runSeedRankings } from "@/lib/seed-rankings";
import { runCalculateTrends } from "@/lib/calculate-trends";
import { calculateLeaguePowerRankings } from "@/lib/league-power-rankings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/recalculate-derived
 *
 * Vercel Cron entry point for the derived recalculation step that follows
 * the two value syncs. Runs:
 *   1. seed-rankings (rebuild rankings table from latest player_value_history)
 *   2. calculate-trends (rebuild player_value_trends pre-calc)
 *   3. calculate-league-power-rankings for every synced league
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

    const { data: leagues, error: leaguesErr } = await supabase
      .from("leagues")
      .select("id");
    if (leaguesErr) throw leaguesErr;

    let totalCombos = 0;
    let failed = 0;
    const leagueResults: Array<{ leagueId: string; combos: number; ok: boolean }> = [];
    for (const league of leagues ?? []) {
      const result = await calculateLeaguePowerRankings(supabase, league.id);
      if (!result.ok) {
        failed++;
        leagueResults.push({ leagueId: league.id, combos: 0, ok: false });
        continue;
      }
      totalCombos += result.combosWritten;
      leagueResults.push({ leagueId: league.id, combos: result.combosWritten, ok: true });
    }

    const finished = Date.now();
    return NextResponse.json({
      ok: true,
      rankings,
      trends,
      powerRankings: {
        leagues: leagues?.length ?? 0,
        totalCombos,
        failed,
        leagueResults,
      },
      durationMs: finished - started,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/recalculate-derived] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
