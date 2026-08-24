import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-runs";
import {
  previewReferenceDrift,
  loadDriftAlertHistory,
  driftAlertStreak,
} from "@/lib/beacon/reference";
import { loadBeaconSettings } from "@/lib/beacon/settings";
import { sendReferenceDriftEmail } from "@/lib/email/beacon-reference-emails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/beacon-reference-drift
 *
 * Builds a candidate calibration reference in memory, compares the board it
 * would produce against the board the stored reference produces on the same
 * source data, and emails a human when a board has crossed a threshold on
 * enough checks in a row to mean something.
 *
 * It NEVER persists or activates the candidate, and it never rebuilds after an
 * alert. Drift is a signal to look, not a trigger to act: a spike is more often
 * a source publishing something odd than the stored reference going bad, and
 * auto-rebuilding on a bad night would bake that odd data into the scale every
 * later run is measured against.
 *
 * WHY THE EMAIL WAITS FOR A STREAK
 * It did not, and it emailed on 13 of its first 24 nights. Every isolated spike
 * turned out to be a source having an ordinary preseason day, and an alarm that
 * fires most days stops being read. The metrics are still computed and recorded
 * on EVERY run, and /admin/beacon/calibration still shows the latest ones on
 * demand; only the email waits for the same board to trip
 * calibration_drift_alert_streak checks running. Replayed over that history the
 * change turns 13 emails into 1, and the 1 is a real three-night run.
 *
 * A refused candidate emails immediately regardless. That is not drift, it is
 * "we could not have rebuilt today even if we wanted to", and it does not get
 * better by waiting to see whether it happens again tomorrow.
 *
 * Scheduled daily at 14:00 UTC in vercel.json, an hour after the rebuild job,
 * so on a rebuild night it confirms the result and on every other night it is
 * the early warning.
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
      const settings = await loadBeaconSettings(supabase);
      const required = settings.calibrationDriftAlertStreak;

      const previews = await previewReferenceDrift(supabase, { nowMs: Date.now() });

      // One fewer run than the streak needs, because tonight is the run we are
      // in. recordCronRun has already inserted tonight's row, but it is still
      // marked 'running' and the history read takes successful runs only, so
      // this cannot count tonight twice.
      const history = await loadDriftAlertHistory(supabase, Math.max(0, required - 1));
      for (const p of previews) {
        p.streak = driftAlertStreak(p.formatSlug, p.alerts.length > 0, history);
      }

      const compared = previews.filter((p) => p.status === "compared");
      const tripped = previews.filter((p) => p.alerts.length > 0);
      const persistent = tripped.filter((p) => (p.streak ?? 0) >= required);
      const refused = previews.filter((p) => p.status === "candidate_refused");

      // A refused candidate is itself worth knowing about: it means a source was
      // missing or the shared set collapsed, so today we could not have rebuilt
      // even if we wanted to. That one does not wait for a streak.
      const alerting = [
        ...persistent,
        ...refused.filter((p) => !persistent.includes(p)),
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
            streak: p.streak,
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
        // Boards over a limit tonight, whether or not that was enough to email.
        tripped: tripped.length,
        alerting: alerting.length,
        streakRequired: required,
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
