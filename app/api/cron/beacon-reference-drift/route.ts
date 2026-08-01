import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-runs";
import { previewReferenceDrift } from "@/lib/beacon/reference";
import { sendReferenceDriftEmail } from "@/lib/email/beacon-reference-emails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/beacon-reference-drift
 *
 * Builds a candidate calibration reference in memory, compares the board it
 * would produce against the board the stored reference produces on the same
 * source data, and emails a human if anything crosses a threshold.
 *
 * It NEVER persists or activates the candidate, and it never rebuilds after an
 * alert. Drift is a signal to look, not a trigger to act: a spike is more often
 * a source publishing something odd than the stored reference going bad, and
 * auto-rebuilding on a bad night would bake that odd data into the scale every
 * later run is measured against.
 *
 * NOT YET SCHEDULED. This route exists but has no entry in vercel.json, so it
 * only runs when called by hand. Add the schedule when the calibrated method is
 * actually enabled for a format; until then there is nothing to watch.
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
    const result = await recordCronRun(supabase, "beacon-reference-drift", async () => {
      const previews = await previewReferenceDrift(supabase, { nowMs: Date.now() });
      const compared = previews.filter((p) => p.status === "compared");
      const tripped = previews.filter((p) => p.alerts.length > 0);
      const refused = previews.filter((p) => p.status === "candidate_refused");

      // A refused candidate is itself worth knowing about: it means a source was
      // missing or the shared set collapsed, so today we could not have rebuilt
      // even if we wanted to.
      const alerting = [
        ...tripped,
        ...refused.filter((p) => !tripped.includes(p)),
      ];
      if (alerting.length > 0) {
        await sendReferenceDriftEmail(
          alerting.map((p) => ({
            formatSlug: p.formatSlug,
            alerts:
              p.alerts.length > 0
                ? p.alerts
                : [p.reason ?? "A fresh reference could not be built today."],
            activeVersion: p.activeVersion,
            ageDays: p.ageDays,
            meanAbs: p.metrics?.meanAbs,
            maxMove: p.metrics?.maxMove,
            over250: p.metrics?.over250,
            over500: p.metrics?.over500,
            spearman: p.metrics?.spearman,
            players: p.metrics?.players,
          })),
        );
      }

      return {
        ok: true as const,
        formats: previews.length,
        compared: compared.length,
        alerting: alerting.length,
        emailed: alerting.length > 0,
        previews,
      };
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/beacon-reference-drift] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
