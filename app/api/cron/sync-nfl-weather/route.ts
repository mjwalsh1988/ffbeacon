import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { runNflWeatherSync, type NflWeatherSyncScope } from "@/lib/sync-nfl-weather";
import { recordCronRun } from "@/lib/cron-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * 300, and a normal night uses a tenth of it.
 *
 * A full week is at most sixteen games, about thirteen of them open air, and
 * each of those is two requests to the National Weather Service or one to MET
 * Norway, run one game at a time with a short pause between games. Healthy
 * providers answer in well under a second, so the run is about twenty seconds.
 *
 * The ceiling is for the bad night. lib/nfl-weather.ts gives every request 20
 * seconds and retries a 429 or a 5xx once after five, so a provider that is
 * slow rather than down can hold one game for most of a minute. Two guards
 * keep that from ending in a platform kill, which skips the finalize in
 * lib/cron-runs.ts and leaves a "running" row behind: the sync stops starting
 * provider requests 60 seconds before the limit and reports the games it did
 * not reach, and recordCronRun records the run as failed 15 seconds before it.
 */
export const maxDuration = 300;

/**
 * GET /api/cron/sync-nfl-weather
 * GET /api/cron/sync-nfl-weather?scope=gameday
 *
 * Vercel Cron entry point for the game weather forecasts. `scope` is nightly
 * unless it is exactly "gameday":
 *
 *   nightly   every regular-season game kicking off in the next seven days.
 *   gameday   only games kicking off in the next 24 hours. Fires three times a
 *             day in season and returns `skipped: true` on any day without a
 *             game, before a single provider request.
 *
 * Both append to nfl_game_weather. A run that wrote a row busts the nflWeather
 * cache tag, so a page reading forecasts under it shows the new one at once.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` only. Calls the same
 * runNflWeatherSync() the CLI uses and returns its JSON summary.
 */
export async function GET(req: Request) {
  const cronAuth = verifyCronRequest(req);
  if (!cronAuth.ok) {
    return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  }

  const scope: NflWeatherSyncScope =
    new URL(req.url).searchParams.get("scope") === "gameday" ? "gameday" : "nightly";

  const supabase = createAdminClient();
  const deadlineMs = Date.now() + (maxDuration - 60) * 1000;
  try {
    const result = await recordCronRun(
      supabase,
      "sync-nfl-weather",
      async () => {
        const sync = await runNflWeatherSync(supabase, { scope, deadlineMs });
        if (sync.indoorRowsWritten + sync.snapshotsWritten > 0) {
          revalidateTag(CACHE_TAGS.nflWeather);
        }
        return sync;
      },
      { timeoutMs: (maxDuration - 15) * 1000 },
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/sync-nfl-weather] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
