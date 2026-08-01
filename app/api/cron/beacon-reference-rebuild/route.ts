import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-runs";
import { rebuildReferences } from "@/lib/beacon/reference";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/beacon-reference-rebuild
 *
 * The scheduled half of the reference lifecycle. Safe to run daily: a format
 * whose active reference is younger than calibration_rebuild_days is skipped, so
 * in practice each format rebuilds about once a month.
 *
 * Every safety check still applies on this path. A rebuild is refused when an
 * expected source is missing or stale, or when the sources share fewer than
 * calibration_min_shared_players players. A refusal leaves the current reference
 * live, which is the right outcome: an old good scale beats a new bad one.
 * Activation is two-phase and verified in the database, so a partly written
 * candidate can never go live.
 *
 * This route does NOT bootstrap silently in the sense that matters: a format
 * with no reference yet is built here, but only after passing the same
 * completeness and shared-player gates, and the build is logged loudly.
 *
 * NOT YET SCHEDULED. No entry in vercel.json; add one when the calibrated
 * method is enabled for a format.
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
    const result = await recordCronRun(supabase, "beacon-reference-rebuild", async () => {
      const outcomes = await rebuildReferences(supabase, { nowMs: Date.now() });
      const rebuilt = outcomes.filter((o) => o.status === "rebuilt");
      const refused = outcomes.filter((o) => o.status === "refused");
      return {
        ok: true as const,
        // Nothing due today is the normal result on 29 nights out of 30.
        skipped: rebuilt.length === 0 && refused.length === 0,
        reason:
          rebuilt.length === 0 && refused.length === 0
            ? "No reference is old enough to rebuild."
            : undefined,
        rebuilt: rebuilt.length,
        refused: refused.length,
        outcomes,
      };
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/beacon-reference-rebuild] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
