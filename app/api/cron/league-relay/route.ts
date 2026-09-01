import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-runs";
import { runLeagueRelay } from "@/lib/league-relay/relay";
import { loadLeagueRelaySettings, liveMessageTypes } from "@/lib/league-relay/settings";
import {
  describePreviewSchedule,
  describeRecapSchedule,
  easternMoment,
} from "@/lib/league-relay/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/league-relay
 *
 * Every fifteen minutes: resync each community league, then say what changed.
 *
 * THE FIFTEEN MINUTES IS THE RESYNC, NOT THE POSTING RATE. Most ticks find one
 * or two leagues with nothing new and post nothing at all. What actually goes
 * out is decided by which message types an admin switched on, and by the
 * windows in the settings: previews on the preview weekday and hour, recaps one
 * an hour through the recap window, transactions whenever there are any.
 *
 * WHY THE SCHEDULE IS SETTINGS AND NOT CRON ENTRIES. The same reason the Would
 * You Rather poll's is. A cron expression cannot express a weekday and hour an
 * admin picks without a deploy, and a UTC hour silently shifts by one twice a
 * year: a job pinned to 15:00 UTC is 11am Eastern for seven months and 10am for
 * five, with nobody told. The windows are resolved through Intl in
 * America/New_York, which is right on both sides of the boundary.
 *
 * WHY THIS DOES NOT SHARE THE LEAGUE SYNC WORKER. That worker drains a queue a
 * reader filled by pressing "Sync all", once every twelve hours, and its whole
 * design is a one-off burst paced out over minutes. This is a small, fixed set
 * of leagues on a fixed cadence with a message to write afterwards. Putting
 * both through one queue would mean a reader's bulk sync could delay a
 * community league's trade post by half an hour.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` only.
 */
export async function GET(req: Request) {
  const cronAuth = verifyCronRequest(req);
  if (!cronAuth.ok) {
    return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  }

  const admin = createAdminClient();

  try {
    const result = await recordCronRun(admin, "league-relay", async () => {
      const now = new Date();
      const settings = await loadLeagueRelaySettings(admin);
      const run = await runLeagueRelay(admin, { now });

      return {
        easternHour: easternMoment(now).hourKey,
        relayEnabled: settings.enabled,
        liveMessageTypes: liveMessageTypes(settings),
        previewSchedule: describePreviewSchedule(settings.matchups),
        recapSchedule: describeRecapSchedule(settings.matchups),
        ...run,
        // A tick that synced leagues and posted nothing is the normal case, and
        // saying so plainly is what stops the run log from reading like a
        // string of failures.
        quiet: run.posted === 0 && run.errors === 0,
      };
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/league-relay] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
