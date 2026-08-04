import { NextResponse, after } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { parseSleeperLeagueSettings } from "@/lib/sleeper-league-settings";
import {
  currentNflSeason,
  getSleeperLeagues,
  getSleeperUser,
} from "@/lib/sleeper";
import {
  BULK_SYNC_COOLDOWN_SECONDS,
  enqueueBulkLeagueSync,
  loadBulkSyncState,
  runLeagueSyncWorker,
} from "@/lib/league-bulk-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The response goes out in a second or two; the head-start worker pass below is
// what needs the room.
export const maxDuration = 300;

/**
 * The Sync all endpoint behind /my-beacon/sleeper-leagues.
 *
 *   POST  queue every league this user has, once per 12 hours
 *   GET   how far the newest request got
 *
 * SIGNED IN ONLY, unlike every other league endpoint in this folder. /warm,
 * /refresh, and /[id]/sync are all public because each one can only cause the
 * work that opening a single league would cause. This one multiplies by however
 * many leagues the caller has, which is not a thing to hand to an anonymous
 * visitor. The public League Pulse tool keeps its one-at-a-time button and does
 * not link here.
 *
 * WHOSE LEAGUES GET QUEUED
 *   The ones Sleeper returns for the handle saved on this account, resolved here
 *   from the session. The request body is not read at all. A caller who could
 *   name the leagues to queue could spend someone else's twelve-hour slot, or
 *   point our sync at leagues chosen for how expensive they are.
 */

type LeagueToQueue = { sleeperLeagueId: string; leagueName: string | null };

export async function POST(req: Request) {
  // Same-origin defense used by every write endpoint here: a header a
  // cross-origin form post cannot set without a preflight we never grant.
  if (req.headers.get("x-requested-with") !== "ff-beacon") {
    return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "Sign in to sync all of your leagues." },
      { status: 401 },
    );
  }

  const { data: prefs } = await supabase
    .from("user_preferences")
    .select("sleeper_league_settings")
    .eq("user_id", user.id)
    .maybeSingle();
  const settings = parseSleeperLeagueSettings(prefs?.sleeper_league_settings);
  const username = settings.username?.trim();
  if (!username) {
    return NextResponse.json(
      { error: "Save your Sleeper username first, then Sync all has something to sync." },
      { status: 400 },
    );
  }

  // Cheap pre-check before we spend two Sleeper calls resolving the league list.
  // The RPC below re-checks the same window under a lock and is the real gate;
  // this only stops a caller in cooldown from making us do the lookup anyway.
  const state = await loadBulkSyncState(supabase, user.id);
  if (!state.canStart) {
    return NextResponse.json(
      {
        error: "Sync all runs once every 12 hours.",
        reason: "cooldown",
        nextAllowedAt: state.nextAllowedAt,
        state,
      },
      { status: 429 },
    );
  }

  const sleeperUser = await getSleeperUser(username);
  if (!sleeperUser) {
    return NextResponse.json(
      { error: `We could not load Sleeper user "${username}".` },
      { status: 404 },
    );
  }

  const season = currentNflSeason();
  const leagues = await getSleeperLeagues(sleeperUser.user_id, season);
  const toQueue: LeagueToQueue[] = (leagues ?? [])
    .filter((l) => l.league_id)
    .map((l) => ({ sleeperLeagueId: l.league_id, leagueName: l.name ?? null }));

  if (toQueue.length === 0) {
    return NextResponse.json(
      { error: `No active leagues found for ${season}.` },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const result = await enqueueBulkLeagueSync(admin, user.id, toQueue);

  if (!result.ok) {
    const status =
      result.reason === "cooldown" ? 429 : result.reason === "error" ? 500 : 409;
    return NextResponse.json(
      {
        error: result.message,
        reason: result.reason,
        retryInSeconds: result.retryInSeconds,
        nextAllowedAt: result.nextAllowedAt ?? null,
        state: await loadBulkSyncState(supabase, user.id),
      },
      { status },
    );
  }

  // A head start, not the mechanism. The cron worker owns the queue and would
  // reach these rows on its own within the minute; running one pass after the
  // response means the first few leagues are usually already done by the time
  // the reader has finished reading the notice. The claim is atomic, so this
  // racing the cron costs nothing worse than one of them finding no work.
  after(async () => {
    try {
      await runLeagueSyncWorker(admin);
    } catch (err) {
      console.error(
        "[bulk-sync] head-start worker pass failed:",
        err instanceof Error ? err.message : err,
      );
    }
  });

  return NextResponse.json({
    ok: true,
    queued: result.queued,
    cooldownSeconds: BULK_SYNC_COOLDOWN_SECONDS,
    state: await loadBulkSyncState(supabase, user.id),
  });
}

/**
 * Progress for the signed-in caller. Read through the caller's own client, so
 * the owner-select policy on both tables is what scopes it, not a filter we
 * remembered to write.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const state = await loadBulkSyncState(supabase, user.id);
  return NextResponse.json({ ok: true, state });
}
