import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { runSeedRankings } from "@/lib/seed-rankings";
import { runCalculateTrends } from "@/lib/calculate-trends";
import { recordCronRun } from "@/lib/cron-runs";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { loadBeamSettings } from "@/lib/beam/settings";
import { loadOnTheClockSettings } from "@/lib/on-the-clock/settings";

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
 * It also carries the global, deletion-only retention prunes that have nowhere
 * better to live: the rate-limit ledgers, the BEAM question log, and the On The
 * Clock caches. Each is non-fatal and none of them recompute anything.
 *
 * These are global, player-level tables, not per-league. League Pulse power
 * rankings are NOT recomputed here: that is done on demand when a league deep
 * view loads, via pulseLeague() -> calculateLeaguePowerRankings() in
 * lib/league-pulse.ts. Recomputing every stored league nightly does not scale
 * to tens of thousands of leagues, and unviewed leagues never need a cache row.
 * For a manual one-off recompute use `npm run calculate:power-rankings`. The
 * same holds for Power Pulse and Positional WAR. The only Positional WAR work
 * here is a single deletion against the fingerprint-keyed sharing table, which
 * iterates no leagues.
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

      // Fresh values/trends -> bust the profile value caches.
      revalidateTag(CACHE_TAGS.playerValues);

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

      // Bounded retention prune for the On The Clock caches. Deletion only, and it
      // never touches a draft: drafts and their picks are what this tool observed
      // happening and are kept permanently (see migration 0205). What it clears is
      // the projection cache, which is a recomputable sweep of weekly projections
      // keyed on a league's scoring shape rather than on any draft, plus pulse rows
      // orphaned by a manual deletion. It recomputes nothing per draft or per
      // league, which is what keeps it on this global cron.
      //
      // Migrations 0113 and 0185 both built this function and both deliberately
      // left the wiring for later. Later is now: without a caller, the projection
      // cache grows about a megabyte per distinct league scoring shape, and that
      // signature comes from user-controlled scoring settings, so it is unbounded.
      //
      // Non-fatal, like the prunes around it.
      let onTheClockCacheRowsDeleted: {
        drafts?: number;
        projections?: number;
        pulses?: number;
      } | null = null;
      try {
        const otcSettings = await loadOnTheClockSettings(supabase);
        const { data, error } = await supabase.rpc("cleanup_on_the_clock_cache", {
          p_projection_retention_hours: otcSettings.cache.projectionRetentionHours,
        });
        // Logged rather than swallowed. A prune that quietly reports nothing is
        // indistinguishable from a prune that found nothing to do, and telling
        // those two apart is the whole reason this runs.
        if (error) throw new Error(error.message);
        onTheClockCacheRowsDeleted =
          (data as { drafts?: number; projections?: number; pulses?: number } | null) ?? null;
      } catch (pruneErr) {
        console.error("[cron/recalculate-derived] On The Clock cache prune failed", pruneErr);
      }

      // Bounded retention prune for the BEAM question log. Same reasoning as the
      // ledgers above: global, deletion-only, and non-fatal. The window comes
      // from beam_settings so the admin control over it is real rather than
      // decorative; a settings read failure falls back to the code default.
      let beamQueryRowsDeleted: number | null = null;
      try {
        const beamSettings = await loadBeamSettings(supabase);
        const { data } = await supabase.rpc("cleanup_beam_queries" as never, {
          p_max_age_days: beamSettings.logging.retentionDays,
        } as never);
        beamQueryRowsDeleted = typeof data === "number" ? data : null;
      } catch (pruneErr) {
        console.error("[cron/recalculate-derived] BEAM query log prune failed", pruneErr);
      }

      // Bounded retention prune for the shared Positional WAR curves.
      //
      // positional_war_curves is keyed by an input fingerprint that includes the
      // projections snapshot hour, so every row becomes dead the morning after
      // the nightly projections sync writes new numbers. Seven days rather than
      // one, so a week-old fingerprint that somehow recurs still hits.
      //
      // ONE STATEMENT, and it iterates no leagues. That is what keeps it on this
      // global cron without breaking the standing rule that the nightly job must
      // not do per-league work. It prunes only the write-path sharing table; the
      // per-league league_positional_war_cache is never touched here, and
      // Positional WAR itself is recomputed only on demand through pulseLeague.
      //
      // Non-fatal, like the prunes above.
      let positionalWarCurveRowsDeleted: number | null = null;
      try {
        const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { data, error } = await supabase
          .from("positional_war_curves")
          .delete()
          .lt("computed_at", cutoff)
          .select("fingerprint");
        if (error) throw new Error(error.message);
        positionalWarCurveRowsDeleted = data?.length ?? 0;
      } catch (pruneErr) {
        console.error("[cron/recalculate-derived] Positional WAR curve prune failed", pruneErr);
      }

      return {
        ok: true as const,
        rankings,
        trends,
        rateLimitLedgerRowsDeleted,
        onTheClockCacheRowsDeleted,
        beamQueryRowsDeleted,
        positionalWarCurveRowsDeleted,
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
