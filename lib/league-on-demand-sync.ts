import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  isLeaguePulseFresh,
  pulseLeagueCore,
  pulseLeagueDerived,
} from "@/lib/league-pulse";

/**
 * Sync one league on demand, from wherever the reader happens to be.
 *
 * A league nobody has opened has no rosters stored, which used to make it a
 * dead end in every tool that asks you to pick one: the FAAB calculator greyed
 * it out, the Beacon Breakdown refused to compare against it. Picking it now
 * runs exactly the sync opening the league would have run, and the tool carries
 * on with the answer.
 *
 * ONE BUDGET FOR EVERY CALLER. The claim below is the same per-visitor slot
 * /api/leagues/[league_id]/sync holds, so a reader alternating between the
 * League Pulse list, the FAAB calculator, and the Breakdown cannot buy three
 * sync budgets. The claim is atomic (a SECURITY DEFINER RPC behind a row lock),
 * so two picks landing together collapse into one sync.
 *
 * The slot is released in a finally, so a sync that throws costs a cooldown
 * rather than locking the visitor out until the lease expires.
 */

type ServiceClient = SupabaseClient<Database>;

/** Gap between the end of one sync and the start of the next. Matches the
 *  p_cooldown_seconds default on try_claim_league_sync, and COOLDOWN_SECONDS in
 *  lib/league-sync-queue.tsx. */
export const LEAGUE_SYNC_COOLDOWN_SECONDS = 5;

/**
 * How long a claim may sit unreleased before another request may take it over.
 * Only reached when a process dies mid-sync; a normal run releases in a finally.
 */
export const LEAGUE_SYNC_LEASE_SECONDS = 180;

/**
 * What we tell a caller blocked by their own in-flight sync. The RPC reports the
 * remaining lease, which is a crash guard and not a real wait, so quoting it
 * back would tell someone to wait three minutes for work that is seconds away.
 */
const IN_FLIGHT_RETRY_SECONDS = 5;

export type LeagueSyncFailure =
  /** Another sync by this visitor is running right now. */
  | "in_flight"
  /** This visitor synced something moments ago. */
  | "cooldown"
  /** Sleeper does not know about this league. */
  | "not_found"
  /** The claim itself could not be evaluated, or the sync threw. */
  | "failed";

export type LeagueSyncOutcome =
  | { ok: true; cached: boolean }
  | { ok: false; reason: LeagueSyncFailure; error: string; retryInSeconds: number };

/**
 * Bring the leagues a many-league tool is about to read back inside the
 * 60-minute cache, before it reads them.
 *
 * The cross-league tools (every-league FAAB bids, the portfolio Trade Finder,
 * the Free Agent Finder) answered straight from stored rosters, so a league
 * synced once was read as it stood that day for as long as nobody opened it.
 * This is the same freshness rule League Pulse runs on, applied up front.
 *
 * Only leagues we ALREADY HOLD are refreshed. A league never synced stays the
 * caller's "we hold nothing for this league" case, as before: pulling a whole
 * portfolio of new leagues from Sleeper is the Sync all button's job, not a
 * side effect of one search.
 *
 * Deliberately not behind the per-visitor claim in syncLeagueOnDemand, whose
 * five-second cooldown would let one league in a batch through and refuse the
 * rest. Each caller holds its own per-minute limit, every Sleeper call still
 * draws on the site-wide budget in lib/sleeper-budget.ts, and a league refreshed
 * here is fresh for an hour, so it cannot be charged twice inside that window.
 *
 * `max` takes the STALEST leagues first, so repeated runs work through a large
 * portfolio rather than refreshing the same few each time. Never throws: a
 * failed refresh leaves the stored rows in place, which is what the caller
 * would have read anyway.
 */
export async function refreshStaleLeagues(
  admin: ServiceClient,
  sleeperLeagueIds: string[],
  options: {
    /** Also run the transaction and derived pass. Off when only rosters are read. */
    derived: boolean;
    max: number;
    concurrency: number;
  },
): Promise<{ refreshed: number; failed: number }> {
  const ids = [...new Set(sleeperLeagueIds)];
  if (ids.length === 0 || options.max <= 0) return { refreshed: 0, failed: 0 };

  const { data: rows, error } = await admin
    .from("leagues")
    .select("sleeper_league_id, last_pulsed_at, pulse_status")
    .in("sleeper_league_id", ids);
  if (error) {
    console.warn("[league-sync] stale check failed", error);
    return { refreshed: 0, failed: 0 };
  }

  const now = Date.now();
  const stale = (rows ?? [])
    .filter((r) => !isLeaguePulseFresh(r, now))
    .sort(
      (a, b) =>
        (a.last_pulsed_at ? new Date(a.last_pulsed_at).getTime() : 0) -
        (b.last_pulsed_at ? new Date(b.last_pulsed_at).getTime() : 0),
    )
    .slice(0, options.max)
    .map((r) => r.sleeper_league_id);

  let refreshed = 0;
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < stale.length) {
      const sleeperLeagueId = stale[next];
      next += 1;
      try {
        const core = await pulseLeagueCore(admin, sleeperLeagueId);
        if (!core.ok) {
          failed += 1;
          continue;
        }
        if (options.derived) {
          await pulseLeagueDerived(admin, core.leagueRowId, {
            resynced: !core.cached,
          });
        }
        refreshed += 1;
      } catch (err) {
        failed += 1;
        console.error(
          `[league-sync] refresh failed for ${sleeperLeagueId}:`,
          (err as Error).message,
        );
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.min(options.concurrency, stale.length)) },
      worker,
    ),
  );
  return { refreshed, failed };
}

export async function syncLeagueOnDemand(
  admin: ServiceClient,
  sleeperLeagueId: string,
  actorKey: string,
): Promise<LeagueSyncOutcome> {
  // A league synced inside the last hour is answered without the claim. The
  // pulse below would make no Sleeper call for it anyway, and charging the slot
  // would put a five-second cooldown between two picks of fresh leagues. This
  // is what lets the tools call this on EVERY pick rather than only the first,
  // which is how a league synced once used to be priced off day-old rosters.
  const { data: stored } = await admin
    .from("leagues")
    .select("last_pulsed_at, pulse_status")
    .eq("sleeper_league_id", sleeperLeagueId)
    .maybeSingle();
  if (isLeaguePulseFresh(stored)) return { ok: true, cached: true };

  const { data: claim, error: claimErr } = await admin.rpc(
    "try_claim_league_sync" as never,
    {
      p_actor_key: actorKey,
      p_sleeper_league_id: sleeperLeagueId,
      p_cooldown_seconds: LEAGUE_SYNC_COOLDOWN_SECONDS,
      p_lease_seconds: LEAGUE_SYNC_LEASE_SECONDS,
    } as never,
  );
  if (claimErr) {
    console.error("[league-sync] claim rpc failed", claimErr);
    return {
      ok: false,
      reason: "failed",
      error: "We could not start that sync. Try again shortly.",
      retryInSeconds: LEAGUE_SYNC_COOLDOWN_SECONDS,
    };
  }

  const result = (claim ?? {}) as {
    claimed?: boolean;
    retry_after_seconds?: number;
    in_flight?: boolean;
  };
  if (result.claimed !== true) {
    const inFlight = result.in_flight === true;
    return {
      ok: false,
      reason: inFlight ? "in_flight" : "cooldown",
      error: inFlight
        ? "One league syncs at a time. Wait for the current one to finish."
        : `Only one sync every ${LEAGUE_SYNC_COOLDOWN_SECONDS} seconds.`,
      retryInSeconds: inFlight
        ? IN_FLIGHT_RETRY_SECONDS
        : (result.retry_after_seconds ?? LEAGUE_SYNC_COOLDOWN_SECONDS),
    };
  }

  try {
    // Exactly what the deep view does, in the same order. Core first, so a
    // league Sleeper does not know about fails before any derived work starts.
    const core = await pulseLeagueCore(admin, sleeperLeagueId);
    if (!core.ok) {
      return {
        ok: false,
        reason: "not_found",
        error: "We could not find that league on Sleeper.",
        retryInSeconds: 0,
      };
    }

    // Awaited rather than backgrounded: the caller is about to read rosters,
    // transactions, and the schedule this half writes.
    await pulseLeagueDerived(admin, core.leagueRowId, { resynced: !core.cached });

    return { ok: true, cached: core.cached };
  } catch (err) {
    console.error(
      `[league-sync] sync failed for ${sleeperLeagueId}:`,
      (err as Error).message,
    );
    // Deliberately not the underlying message: it can carry connection strings
    // and upstream detail a public caller has no business seeing.
    return {
      ok: false,
      reason: "failed",
      error: "That sync did not finish. It usually works on a second try.",
      retryInSeconds: LEAGUE_SYNC_COOLDOWN_SECONDS,
    };
  } finally {
    // Frees the slot and starts the cooldown, on every path including a throw.
    const { error: releaseErr } = await admin.rpc(
      "release_league_sync" as never,
      { p_actor_key: actorKey } as never,
    );
    if (releaseErr) {
      // The lease expiry covers this; the visitor waits it out rather than
      // being locked out for good.
      console.warn("[league-sync] release failed", releaseErr);
    }
  }
}
