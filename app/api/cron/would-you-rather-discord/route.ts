import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-runs";
import { loadWouldYouRatherSettings } from "@/lib/would-you-rather/settings";
import { ingestClosedPolls, postScheduledPoll } from "@/lib/would-you-rather/discord";
import { describeSchedule, easternSlot } from "@/lib/would-you-rather/schedule";
import { describeRouting } from "@/lib/would-you-rather/routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET /api/cron/would-you-rather-discord
 *
 * The Would You Rather Discord poll, both halves of it.
 *
 * THE JOB TICKS HOURLY. THE ADMIN PANEL DECIDES WHAT HAPPENS.
 *   Twenty three or so ticks a day do nothing but read one settings row and
 *   return. Whether a tick actually posts is decided by the hours an admin
 *   chose at /admin/would-you-rather, in America/New_York, so "three times a
 *   day at 8am, 3pm and 8pm" is a default rather than a hard-coded schedule and
 *   "once a day at 6pm" is a setting rather than a redeploy.
 *
 *   The alternative, three cron entries at fixed UTC hours, was rejected for
 *   two reasons. It cannot express a time an admin picks without a deploy, and
 *   it silently shifts by an hour twice a year: a job pinned to 12:00 UTC is
 *   8am Eastern for seven months and 7am for five, and nobody would be told.
 *
 * TWO JOBS, AND THE SECOND MUST NOT DEPEND ON THE FIRST.
 *   Posting talks to Discord and can fail. Ingestion folds finished polls into
 *   the site's tally and has to keep working while it does, or a Discord outage
 *   during one morning would strand every poll that closed that week. So the
 *   post outcome is recorded and ingestion runs regardless.
 *
 * ONE POST PER SCHEDULED HOUR, ROUTED BY THE TRADE.
 *   Each league type can be pointed at its own webhook. The tick picks ONE
 *   trade on its own merits and then posts it to whichever channel that trade's
 *   league type is pointed at. The channels are not a quota, so a run of
 *   dynasty trades is a run of posts in the dynasty room.
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
    const result = await recordCronRun(admin, "would-you-rather-discord", async () => {
      const now = new Date();
      const settings = await loadWouldYouRatherSettings(admin);
      const slot = easternSlot(now);

      const post = await postScheduledPoll(admin, settings, now);
      const ingest = await ingestClosedPolls(admin, settings, now);

      return {
        easternHour: slot.key,
        schedule: describeSchedule(settings.discord.post_hours),
        routing: describeRouting(settings),
        discordEnabled: settings.discord.enabled,
        post,
        ingest,
        // A tick that neither posted nor ingested is the normal case, and
        // saying so plainly is what stops the admin panel's run log from
        // reading like a string of failures.
        quiet: post.status === "skipped" && ingest.ingested === 0,
      };
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/would-you-rather-discord] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
