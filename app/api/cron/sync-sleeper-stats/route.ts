import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { runSleeperStatsSync } from "@/lib/sync-sleeper-stats";
import { runCalculatePositionalFinishes } from "@/lib/calculate-positional-finishes";
import { runCalculateDefenseSplits } from "@/lib/calculate-defense-splits";
import { runCalculateProjectionAccuracy } from "@/lib/calculate-projection-accuracy";
import { runCalculateIdpSeasons } from "@/lib/calculate-idp-seasons";
import { recordCronRun } from "@/lib/cron-runs";
import { CACHE_TAGS } from "@/lib/cache-tags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Record the run before the platform limit can kill it (see lib/cron-runs.ts). */
const RUN_BUDGET_MS = 285_000;
/**
 * A derived calc does not START past this point. Projection accuracy alone has
 * measured 140 seconds, so starting one at 200 seconds would only be killed.
 */
const DERIVED_START_BUDGET_MS = 150_000;

/**
 * GET /api/cron/sync-sleeper-stats
 *
 * Vercel Cron entry point for the nightly current-season stats refresh, plus
 * everything derived from stats.
 *
 * Scheduled in vercel.json with a month-restricted expression so it never fires
 * in the dead months; the handler also short-circuits via Sleeper's live state
 * when season_type is "off", returning `skipped: true` (HTTP 200, not an error).
 *
 * WHY THREE DERIVED CALCS HANG OFF THIS ONE JOB
 * All three read player_stats and nothing else new, so this is the moment their
 * inputs change and the only moment they need to run. Positional finishes was
 * already chained here. Defense splits and projection accuracy were not chained
 * anywhere at all: both existed only as npm scripts, and a search of every cron
 * route found zero references to either. They had last been computed by hand on
 * 2026-08-01.
 *
 * That was not yet visible in the data, and the audit that found it first said
 * otherwise. Both tables hold no 2026 rows, but both filter season_type
 * 'regular' and the 2026 regular season has not started: on 2026-08-25 Sleeper
 * reported `season_type: "pre", week: 3` and player_stats held only 2026
 * preseason weeks 1 and 2. Having no 2026 row was correct.
 *
 * The failure is dated rather than present, and it lands the week the season
 * does. Both calcs pick their seasons from the data, so both would take up 2026
 * on their own the first time anything ran them, and nothing would have. The
 * consequence would be strength of schedule frozen on 2024 and 2025 for the
 * whole year, and, more sharply, `player_projection_accuracy` never learning
 * anything about the current season. CLAUDE.md states as a product requirement
 * that the current season's beat-rate and reliability MUST outweigh prior
 * seasons; unscheduled, that requirement was unmeetable by construction.
 *
 * Each derived calc runs on its own error boundary, one after another. A
 * failure in one never undoes the stats sync or stops the others: the stats
 * themselves are the irreplaceable part, and a derived table can be rebuilt on
 * the next run. It IS reported as a failed step, which records the run as an
 * error and emails the owner.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` only. Calls the same
 * runSleeperStatsSync() the CLI uses and returns its JSON summary.
 */
export async function GET(req: Request) {
  const cronAuth = verifyCronRequest(req);
  if (!cronAuth.ok) {
    return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  }

  const supabase = createAdminClient();
  try {
    const result = await recordCronRun(supabase, "sync-sleeper-stats", async () => {
      const started = Date.now();
      const sync = await runSleeperStatsSync(supabase);
      // A skipped run (offseason) touched no stats, so nothing derived from them
      // has changed either.
      if (sync.skipped) return sync;

      // Each on its own boundary: the stats are the irreplaceable part, and a
      // derived table that fails here rebuilds on the next run.
      //
      // ONE AT A TIME. These ran under Promise.all until 2026-09-29, which put
      // four heavy readers of player_stats and player_weekly_projections on the
      // database at once, each paging several streams of its own. Pages that
      // take half a second alone crossed the 8-second statement timeout
      // together: defense splits failed every night from 2026-09-26 and
      // projection accuracy from 2026-09-28. Sequential is slower in wall time
      // and it is what finishes.
      //
      // A failed calc is a FAILED STEP. It used to be folded into the result of
      // a run the ledger recorded as a success, which is why nobody heard about
      // four nights of timeouts; `failedSteps` now records the run as an error
      // and emails (lib/cron-runs.ts).
      const steps = [
        ["finishes", () => runCalculatePositionalFinishes(supabase)],
        // The current season's defender totals (plan IDP-117). Reads only
        // the typed player_stats columns this sync just wrote.
        ["idpSeasons", () => runCalculateIdpSeasons(supabase)],
        ["defenseSplits", () => runCalculateDefenseSplits(supabase)],
        ["projectionAccuracy", () => runCalculateProjectionAccuracy(supabase)],
      ] as const;

      const derived: Record<string, { ok: true; result: unknown } | { ok: false; error: string }> = {};
      const failedSteps: string[] = [];
      for (const [name, run] of steps) {
        // Leave room to record the run. A calc that would start past the
        // budget is reported as not run rather than killed halfway.
        if (Date.now() - started > DERIVED_START_BUDGET_MS) {
          const message = "not started: the run was out of time";
          derived[name] = { ok: false, error: message };
          failedSteps.push(`${name}: ${message}`);
          continue;
        }
        try {
          derived[name] = { ok: true, result: await run() };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[cron/sync-sleeper-stats] ${name} failed`, message);
          derived[name] = { ok: false, error: message };
          failedSteps.push(`${name}: ${message}`);
        }
      }

      revalidateTag(CACHE_TAGS.playerStats);
      revalidateTag(CACHE_TAGS.playerFinishes);
      return { ...sync, ...derived, failedSteps };
    }, { timeoutMs: RUN_BUDGET_MS });
    const failed = (result as { failedSteps?: string[] }).failedSteps ?? [];
    return NextResponse.json(result, { status: failed.length > 0 ? 500 : 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/sync-sleeper-stats] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
