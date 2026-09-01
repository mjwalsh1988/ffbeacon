import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getAllSleeperTransactions,
  getSleeperDraft,
  getSleeperLeague,
  getSleeperLeagueDrafts,
  getSleeperLeagueUsers,
  getSleeperRosters,
  getSleeperTradedPicks,
  type SleeperDraft,
  type SleeperLeague,
  type SleeperRoster,
  type SleeperLeagueUser,
  type SleeperTransaction,
  type SleeperTradedPick,
} from "@/lib/sleeper";
import { deriveFormatSlug } from "@/lib/sleeper-to-format";
import { calculateLeaguePowerRankings } from "@/lib/league-power-rankings";
import { refreshPowerPulse } from "@/lib/league-power-pulse";
import { refreshPositionalWar } from "@/lib/league-positional-war";
import { captureLeagueDraftSelections } from "@/lib/league-draft-selections";
import { normalizeDraftPicks } from "@/lib/sleeper-draft-picks";
import {
  captureLeagueSnapshot,
  recordLeagueChanges,
  snapshotFromSleeper,
} from "@/lib/league-activity/record";
import { projectLeagueActivity } from "@/lib/league-activity/project";
import type { Database } from "@/lib/database.types";

export const LEAGUE_PULSE_TTL_MS = 60 * 60 * 1000; // 60 minutes

// Power rankings depend on player values that sync once nightly, so there is no
// benefit to recomputing them more than once a day per league. We recompute on
// the first league load after this window elapses (or when there are no cache
// rows yet); reloads within the window serve the existing cache untouched. A
// force refresh bypasses this gate.
export const LEAGUE_POWER_RANKINGS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export type LeaguePulseResult =
  | {
      ok: true;
      leagueRowId: string;
      sleeperLeagueId: string;
      cached: boolean;
      counts: { rosters: number; users: number; transactions: number };
    }
  | { ok: false; error: string; sleeperLeagueId: string };

/**
 * What the deep view needs before it can draw anything: the league itself, its
 * rosters, and its members. Everything else (transaction history, rankings,
 * Power Pulse) hangs off this and can arrive afterwards.
 */
export type LeaguePulseCoreResult =
  | {
      ok: true;
      leagueRowId: string;
      sleeperLeagueId: string;
      season: number;
      /** True when the 60-minute cache answered and Sleeper was not contacted. */
      cached: boolean;
      counts: { rosters: number; users: number };
    }
  | { ok: false; error: string; sleeperLeagueId: string };

type ServiceClient = SupabaseClient<Database>;

/**
 * In-flight sync deduplication.
 *
 * A single page render fans out into several server components, and a user
 * hitting reload on a slow cold load starts a second render before the first
 * finishes. Without this, each of those repeats the whole Sleeper sync against
 * the same league. Keyed work shares one promise; the entry is dropped as soon
 * as it settles, so this is a request coalescer and not a cache.
 */
const inFlight = new Map<string, Promise<unknown>>();

function coalesce<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const started = run();
  inFlight.set(key, started);
  void started.then(
    () => inFlight.delete(key),
    () => inFlight.delete(key),
  );
  return started;
}

/**
 * Decide whether this league's power rankings need recomputing. Returns true
 * when there are no cache rows yet, or the freshest cache row is older than
 * LEAGUE_POWER_RANKINGS_TTL_MS. On any query error we return true (recompute
 * rather than silently serve stale rankings). Reads a single indexed row.
 */
async function powerRankingsAreStale(
  supabase: ServiceClient,
  leagueRowId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("league_power_rankings_cache")
    .select("generated_at")
    .eq("league_id", leagueRowId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.generated_at) return true;
  return Date.now() - new Date(data.generated_at).getTime() >= LEAGUE_POWER_RANKINGS_TTL_MS;
}

/**
 * Pulse one Sleeper league end-to-end (fetch + persist). Idempotent,
 * re-running upserts every table by its natural key. Returns the
 * leagues.id (uuid) on success.
 *
 * Cache: refuses to refetch from Sleeper if last_pulsed_at is within
 * LEAGUE_PULSE_TTL_MS (60 minutes), unless force=true.
 *
 * Power rankings are recomputed at most once per LEAGUE_POWER_RANKINGS_TTL_MS
 * (24 hours) per league, on whichever load first crosses that window, on both
 * the cached and full-sync paths. force=true always recomputes them.
 *
 * This is the whole-league entry point, kept for scripts, the refresh endpoint,
 * and any page that wants one await. The deep view instead calls the two halves
 * below directly so it can paint the league before the derived work finishes.
 *
 * Caller supplies the service-role supabase client (scripts use
 * scripts/_supabase.ts getServiceClient(); the server action uses
 * lib/supabase/server.ts createAdminClient()).
 */
export async function pulseLeague(
  supabase: ServiceClient,
  sleeperLeagueId: string,
  options: { force?: boolean } = {},
): Promise<LeaguePulseResult> {
  const core = await pulseLeagueCore(supabase, sleeperLeagueId, options);
  if (!core.ok) return core;

  const derived = await pulseLeagueDerived(supabase, core.leagueRowId, {
    force: options.force,
    resynced: !core.cached,
  });

  return {
    ok: true,
    leagueRowId: core.leagueRowId,
    sleeperLeagueId,
    cached: core.cached,
    counts: { ...core.counts, transactions: derived.transactions },
  };
}

/**
 * The half a league page cannot render without: the league row, its rosters,
 * and its members. Four Sleeper endpoints, all fetched together.
 *
 * Freshness is stamped at the END, once the child rows are actually persisted.
 * Marking the league complete before that meant any interruption in the slow
 * tail (a timed-out function, a thrown calculation) left a row that looked
 * fresh with data underneath it that was not, and the 60-minute cache then
 * served that state back on the next load instead of retrying.
 */
export async function pulseLeagueCore(
  supabase: ServiceClient,
  sleeperLeagueId: string,
  options: { force?: boolean } = {},
): Promise<LeaguePulseCoreResult> {
  const { force = false } = options;
  return coalesce(`core:${sleeperLeagueId}:${force}`, async () => {
    const startedAt = Date.now();

    // Widened past what the cache check needs so the activity snapshot below can
    // be built from this row instead of reading the same one again. The extra
    // columns are a few kilobytes on a query that was happening anyway, against
    // a whole round trip saved on the critical path of every full sync.
    const { data: existing } = await supabase
      .from("leagues")
      .select(
        "id, name, season, status, total_rosters, scoring_settings, roster_positions, metadata, last_pulsed_at, pulse_status",
      )
      .eq("sleeper_league_id", sleeperLeagueId)
      .maybeSingle();

    if (
      !force &&
      existing &&
      existing.last_pulsed_at &&
      existing.pulse_status === "complete" &&
      Date.now() - new Date(existing.last_pulsed_at).getTime() < LEAGUE_PULSE_TTL_MS
    ) {
      // Cache hit: league, roster, and member rows are fresh enough that we do
      // not re-hit Sleeper at all.
      const [{ count: rosterCount }, { count: userCount }] = await Promise.all([
        supabase
          .from("rosters")
          .select("id", { count: "exact", head: true })
          .eq("league_id", existing.id),
        supabase
          .from("league_users")
          .select("id", { count: "exact", head: true })
          .eq("league_id", existing.id),
      ]);
      return {
        ok: true as const,
        leagueRowId: existing.id,
        sleeperLeagueId,
        season: Number(existing.season ?? 0),
        cached: true,
        counts: { rosters: rosterCount ?? 0, users: userCount ?? 0 },
      };
    }

    if (existing) {
      const { error: markErr } = await supabase
        .from("leagues")
        .update({ pulse_status: "syncing", pulse_error: null, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      // This marker is how an interrupted sync gets retried instead of being
      // served from cache, so a failure to write it is worth hearing about.
      if (markErr) {
        console.warn(
          `[pulseLeague] could not mark league ${existing.id} syncing: ${markErr.message}`,
        );
      }
    }

    // THE SNAPSHOT HAS TO BE TAKEN HERE, before the upserts below write over
    // the values it is made of. Everything the activity log reports about
    // lineups, scoring, roster slots and managers is a DIFFERENCE between two
    // syncs, and until this line existed the sync destroyed its own evidence:
    // the upsert replaced the old row and nothing had read it.
    //
    // It costs nothing on the clock. The read runs against our own database
    // while the Sleeper round trip beside it is the slow half of this function,
    // so the pair finishes when `getSleeperLeague` does.
    const [league, priorSnapshot] = await Promise.all([
      getSleeperLeague(sleeperLeagueId),
      captureLeagueSnapshot(supabase, existing),
    ]);
    if (!league) {
      if (existing) {
        await supabase
          .from("leagues")
          .update({
            pulse_status: "error",
            pulse_error: "Sleeper league fetch returned null",
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      }
      return { ok: false as const, error: "Sleeper league not found", sleeperLeagueId };
    }

    const formatSlug = deriveFormatSlug(league);
    let formatConfigId: string | null = null;
    if (formatSlug) {
      const { data: fc } = await supabase
        .from("format_configs")
        .select("id")
        .eq("slug", formatSlug)
        .maybeSingle();
      formatConfigId = fc?.id ?? null;
    }

    const season = Number(league.season);
    const leagueRow = {
      sleeper_league_id: league.league_id,
      name: league.name,
      season,
      sport: league.sport ?? "nfl",
      status: league.status ?? null,
      total_rosters: league.total_rosters ?? null,
      scoring_settings: (league.scoring_settings ?? {}) as Database["public"]["Tables"]["leagues"]["Insert"]["scoring_settings"],
      roster_positions: (league.roster_positions ?? []) as Database["public"]["Tables"]["leagues"]["Insert"]["roster_positions"],
      format_config_id: formatConfigId,
      metadata: league as unknown as Database["public"]["Tables"]["leagues"]["Insert"]["metadata"],
      // Deliberately NOT marked complete here. See the doc comment above.
      // "syncing" is one of the four values leagues_sync_status_check allows;
      // the string "pulsing" this code used to write was rejected by that
      // constraint every time, and the failure went unread.
      pulse_status: "syncing" as const,
      pulse_error: null,
      updated_at: new Date().toISOString(),
    };

    const { data: upserted, error: upsertErr } = await supabase
      .from("leagues")
      .upsert(leagueRow, { onConflict: "sleeper_league_id" })
      .select("id")
      .single();

    if (upsertErr || !upserted) {
      return {
        ok: false as const,
        error: `Failed to upsert league: ${upsertErr?.message ?? "unknown"}`,
        sleeperLeagueId,
      };
    }
    const leagueRowId = upserted.id;

    const [rosters, users, tradedPicks, draftSummaries] = await Promise.all([
      getSleeperRosters(sleeperLeagueId),
      getSleeperLeagueUsers(sleeperLeagueId),
      getSleeperTradedPicks(sleeperLeagueId),
      getSleeperLeagueDrafts(sleeperLeagueId),
    ]);

    // Fan out one /draft/{id} fetch per league draft. Sleeper's /league/{id}/drafts
    // summary does NOT include `slot_to_roster_id`, that lives on the per-draft
    // endpoint. We need it to render slot labels like "1.04" on rosters and trades.
    const draftDetails = (
      await Promise.all(
        (draftSummaries ?? [])
          .filter((d): d is SleeperDraft => !!d?.draft_id)
          .map(async (d) => {
            const detail = await getSleeperDraft(d.draft_id);
            return detail ?? d;
          }),
      )
    ).filter((d): d is SleeperDraft => !!d?.draft_id);

    await Promise.all([
      upsertRosters(supabase, leagueRowId, rosters, tradedPicks, draftDetails),
      upsertLeagueUsers(supabase, leagueRowId, users),
      upsertLeagueDrafts(supabase, leagueRowId, draftDetails),
    ]);

    // Everything the page needs is on disk. Now the league counts as pulsed.
    const { error: stampErr } = await supabase
      .from("leagues")
      .update({
        last_pulsed_at: new Date().toISOString(),
        pulse_status: "complete",
        pulse_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", leagueRowId);
    if (stampErr) {
      return {
        ok: false as const,
        error: `Failed to mark league pulsed: ${stampErr.message}`,
        sleeperLeagueId,
      };
    }

    // What changed since the snapshot above. Awaited rather than fired and
    // forgotten, because an unawaited promise in a serverless request is killed
    // when the response is sent; but the common case is a sync where nothing
    // changed, and that path writes nothing and returns immediately.
    //
    // `settings.leg` is Sleeper's own current week for this league, already in
    // the payload we just fetched, so a lineup card gets its week badge without
    // an extra request for the NFL state.
    const nextSnapshot = snapshotFromSleeper(
      league,
      rosters,
      users,
      draftDetails,
      priorSnapshot?.snapshot ?? null,
    );
    const currentLeg = Number((league.settings ?? {}).leg);
    await recordLeagueChanges(supabase, leagueRowId, priorSnapshot, nextSnapshot, {
      week: Number.isFinite(currentLeg) && currentLeg > 0 ? currentLeg : null,
    });

    console.log(
      `[pulseLeague] core ${sleeperLeagueId} in ${Date.now() - startedAt}ms (rosters=${rosters.length}, users=${users.length})`,
    );

    return {
      ok: true as const,
      leagueRowId,
      sleeperLeagueId,
      season,
      cached: false,
      counts: { rosters: rosters.length, users: users.length },
    };
  });
}

/**
 * Everything downstream of the league itself: transaction history, trade-value
 * power rankings, and Power Pulse. None of it blocks the page header, and none
 * of it is allowed to fail the load.
 *
 * `resynced` says the core actually contacted Sleeper, which is the signal to
 * pull transactions again. Within the cache window we leave the stored history
 * alone, matching what the single-pass version did.
 */
export async function pulseLeagueDerived(
  supabase: ServiceClient,
  leagueRowId: string,
  options: { force?: boolean; resynced?: boolean; includePositionalWar?: boolean } = {},
): Promise<{ transactions: number }> {
  const { force = false, resynced = false, includePositionalWar = true } = options;
  return coalesce(`derived:${leagueRowId}:${force}:${includePositionalWar}`, async () => {
    const startedAt = Date.now();

    const { data: league } = await supabase
      .from("leagues")
      .select(
        // `leg` is Sleeper's own current week for this league. Projected out of
        // the stored raw object rather than selecting the whole of it, and
        // needed here because whether a game has been played is what decides
        // whether it is a result.
        "id, sleeper_league_id, season, leg:metadata->settings->leg",
      )
      .eq("id", leagueRowId)
      .maybeSingle();
    if (!league) return { transactions: 0 };

    const season = Number(league.season ?? 0);
    const legValue = Number(league.leg);
    const currentLeg = Number.isFinite(legValue) && legValue > 0 ? legValue : null;
    // Per-stage timings. Cheap, and the only way to aim the next round of
    // tuning at what is actually slow rather than at what looks slow.
    const timings: string[] = [];
    const timed = async <T>(label: string, run: () => Promise<T>): Promise<T> => {
      const at = Date.now();
      try {
        return await run();
      } finally {
        timings.push(`${label}=${Date.now() - at}ms`);
      }
    };

    // The stages touch different tables and, with one exception, none reads
    // another's output, so they run together rather than in a queue. Each owns
    // its own failure: a thrown calculation must not take the others down, and
    // none of them may fail the page.
    //
    // THE ONE EXCEPTION IS THE PAIR BELOW. The activity projector reads the
    // transactions the sync above it writes, so those two are sequential inside
    // a single member of this list rather than two siblings of it. As siblings
    // they raced, and the race had a visible symptom: a reader opening a cold
    // league saw a log with no moves in it, because the projector read the
    // table while the sync was still filling it.
    await Promise.all([
      (async () => {
        if (force || resynced) {
          try {
            await timed("transactions", () =>
              syncTransactions(supabase, leagueRowId, league.sleeper_league_id, season, force),
            );
          } catch (err) {
            console.warn(
              `[pulseLeague] transaction sync failed for league ${leagueRowId}:`,
              (err as Error).message,
            );
          }
        }

        // Turning transactions and played matchups into feed entries.
        //
        // Deliberately NOT gated on `force || resynced` like the sync above it,
        // because this reads OUR tables rather than Sleeper's: a league whose
        // 60-minute cache is warm still needs its back history projected the
        // first time anyone opens it after this shipped. The gates inside make
        // a repeat run a pair of indexed reads that write nothing.
        try {
          const projected = await timed("activity", () =>
            projectLeagueActivity(supabase, leagueRowId, season, currentLeg),
          );
          if (projected.transactions > 0 || projected.results > 0) {
            console.log(
              `[pulseLeague] activity projected for ${leagueRowId} (transactions=${projected.transactions}, results=${projected.results})`,
            );
          }
        } catch (err) {
          console.warn(
            `[pulseLeague] activity projection threw for league ${leagueRowId}:`,
            (err as Error).message,
          );
        }
      })(),

      // Power rankings track the nightly player-value sync, not the league TTL,
      // so they recompute at most once per 24h. A failure is non-fatal; the
      // cache row can be backfilled by npm run calculate:power-rankings.
      (async () => {
        if (!force && !(await powerRankingsAreStale(supabase, leagueRowId))) return;
        try {
          const calcResult = await timed("rankings", () =>
            calculateLeaguePowerRankings(supabase, leagueRowId),
          );
          if (!calcResult.ok) {
            console.warn(
              `[pulseLeague] power-rankings calc failed for league ${leagueRowId}: ${calcResult.error}`,
            );
          }
        } catch (err) {
          console.warn(
            `[pulseLeague] power-rankings calc threw for league ${leagueRowId}:`,
            (err as Error).message,
          );
        }
      })(),

      // Power Pulse: expected competitive performance under the league's own
      // scoring. Independent of the value source, so no format/source loop.
      timed("power-pulse", () => refreshPowerPulse(supabase, leagueRowId, { force })),

      // Positional WAR: league-wide positional scarcity. Deliberately NOT
      // sequenced after Power Pulse above; it reads no Power Pulse output (it
      // reads no roster at all), and each stage already owns its own
      // failure, so there is no ordering constraint between them.
      //
      // `includePositionalWar: false` exists because of WHO AWAITS THIS. A page
      // does not call pulseLeagueDerived from the Suspense boundary that shows
      // the curve; it calls it from the one that shows the RANKINGS TABLE. So
      // every millisecond this stage takes was being spent holding up the
      // page's primary content, and a cold fingerprint costs about ten seconds
      // of universe read. The stage itself is correctly parallel with the other
      // three; the coupling was at the call site, one boundary up.
      //
      // Pages therefore pass false here and let the curve's OWN boundary
      // (components/league-war/positional-war-section.tsx) await the compute,
      // which is what its skeleton was always for. Scripts and the refresh
      // endpoint keep the default, because they have no boundaries to protect
      // and want one call that does everything.
      includePositionalWar
        ? timed("positional-war", () => refreshPositionalWar(supabase, leagueRowId, { force }))
        : Promise.resolve(),

      // Completed drafts into the pick ledger. A finished draft never changes,
      // so its picks are worth exactly one Sleeper request ever; the capture
      // skips anything already stored and caps itself per run. Gated on an
      // actual resync so a cached load never touches Sleeper for this.
      (async () => {
        if (!force && !resynced) return;
        try {
          const captured = await timed("draft-picks", () =>
            captureLeagueDraftSelections(supabase, leagueRowId),
          );
          if (captured.draftsCaptured > 0) {
            console.log(
              `[pulseLeague] captured ${captured.picksWritten} picks from ${captured.draftsCaptured} completed drafts for league ${leagueRowId}`,
            );
          }
        } catch (err) {
          console.warn(
            `[pulseLeague] draft-pick capture failed for league ${leagueRowId}:`,
            (err as Error).message,
          );
        }
      })(),
    ]);

    const { count } = await supabase
      .from("league_transactions")
      .select("id", { count: "exact", head: true })
      .eq("league_id", leagueRowId);

    console.log(
      `[pulseLeague] derived ${league.sleeper_league_id} in ${Date.now() - startedAt}ms (${
        timings.join(", ") || "nothing to do"
      })`,
    );

    return { transactions: count ?? 0 };
  });
}

/**
 * Pull transaction history and persist it.
 *
 * Past weeks are settled: a week 3 waiver claim from last season is not going to
 * change. So a league that already has history only asks Sleeper about the last
 * stored week onward, instead of walking from week 0 every single sync. A force
 * refresh still walks the whole thing, because that is what a user pressing
 * refresh is asking for.
 */
async function syncTransactions(
  supabase: ServiceClient,
  leagueRowId: string,
  sleeperLeagueId: string,
  season: number,
  force: boolean,
): Promise<void> {
  let fromWeek = 0;
  if (!force) {
    const { data: latest } = await supabase
      .from("league_transactions")
      .select("week")
      .eq("league_id", leagueRowId)
      .eq("season", season)
      .not("week", "is", null)
      .order("week", { ascending: false })
      .limit(1)
      .maybeSingle();
    const storedMax = latest?.week == null ? null : Number(latest.week);
    // Step back one week so a partially-played week gets completed rather than
    // frozen at whatever we happened to catch mid-week.
    if (storedMax !== null && Number.isFinite(storedMax)) fromWeek = Math.max(0, storedMax - 1);
  }

  const transactions = await getAllSleeperTransactions(sleeperLeagueId, 25, 3, fromWeek);
  await upsertTransactions(supabase, leagueRowId, transactions, season);
}

/**
 * The stored rows whose Sleeper key is absent from the latest payload.
 *
 * Split out and pure because the rule is one line and the reason for it is not.
 * See pruneStaleRosters below.
 */
export function orphanRowIds(
  stored: Array<{ id: string; key: string | number | null }>,
  keptKeys: Array<string | number>,
): string[] {
  const kept = new Set(keptKeys.map((k) => String(k)));
  return stored.filter((row) => !kept.has(String(row.key))).map((row) => row.id);
}

/**
 * Drop roster rows Sleeper no longer returns.
 *
 * Every child write in this file is an upsert, which adds and updates the rows
 * the payload names and leaves everything else exactly where it was. That is
 * correct for a league whose shape never changes and wrong the moment one does.
 * A 16-team league cut to 12 kept four ownerless roster rows indefinitely, and
 * every reader that counts teams by reading this table (the deep view, the
 * trade-value ranking, Power Pulse's season simulation) went on believing there
 * were sixteen. Power Pulse simulated a 16-team bracket against a 12-team
 * schedule and stored playoff odds for every real manager off the back of it.
 *
 * ABSOLUTE RULE: an empty payload is never evidence about a league. lib/sleeper.ts
 * collapses a failed request into `[]`, so "Sleeper has no rosters" and "Sleeper
 * did not answer" arrive here as the same value, and pruning against an empty
 * payload would empty a healthy league on one timeout. The caller already
 * returns early on a zero-length payload; the length check below is the second
 * lock on that same door and must not be removed.
 *
 * A failed prune is logged, not thrown. A stale row is a wrong number on a page;
 * a thrown sync is no page at all.
 */
async function pruneStaleRosters(
  supabase: ServiceClient,
  leagueRowId: string,
  keptRosterIds: number[],
): Promise<void> {
  if (keptRosterIds.length === 0) return;
  const { data, error } = await supabase
    .from("rosters")
    .select("id, sleeper_roster_id")
    .eq("league_id", leagueRowId);
  if (error) {
    console.warn(`[pulseLeague] roster prune read failed: ${error.message}`);
    return;
  }
  const orphans = orphanRowIds(
    (data ?? []).map((r) => ({ id: r.id, key: r.sleeper_roster_id })),
    keptRosterIds,
  );
  if (orphans.length === 0) return;
  // league_power_rankings_cache and league_power_pulse_cache both cascade off
  // rosters.id, so the derived rows for a removed team go with it.
  const { error: delErr } = await supabase.from("rosters").delete().in("id", orphans);
  if (delErr) {
    console.warn(`[pulseLeague] roster prune delete failed: ${delErr.message}`);
    return;
  }
  console.log(
    `[pulseLeague] removed ${orphans.length} roster row(s) league ${leagueRowId} no longer has`,
  );
}

/** Drop member rows Sleeper no longer returns. Same contract as pruneStaleRosters. */
async function pruneStaleLeagueUsers(
  supabase: ServiceClient,
  leagueRowId: string,
  keptUserIds: string[],
): Promise<void> {
  if (keptUserIds.length === 0) return;
  const { data, error } = await supabase
    .from("league_users")
    .select("id, sleeper_user_id")
    .eq("league_id", leagueRowId);
  if (error) {
    console.warn(`[pulseLeague] member prune read failed: ${error.message}`);
    return;
  }
  const orphans = orphanRowIds(
    (data ?? []).map((u) => ({ id: u.id, key: u.sleeper_user_id })),
    keptUserIds,
  );
  if (orphans.length === 0) return;
  const { error: delErr } = await supabase.from("league_users").delete().in("id", orphans);
  if (delErr) {
    console.warn(`[pulseLeague] member prune delete failed: ${delErr.message}`);
    return;
  }
  console.log(
    `[pulseLeague] removed ${orphans.length} member row(s) league ${leagueRowId} no longer has`,
  );
}

/**
 * Drop draft rows Sleeper no longer returns. Same contract as pruneStaleRosters.
 *
 * A commissioner who deletes and recreates a draft gets a new draft_id, and the
 * abandoned one stays in our copy forever otherwise, which puts a draft board
 * on screen for a draft that no longer exists.
 */
async function pruneStaleLeagueDrafts(
  supabase: ServiceClient,
  leagueRowId: string,
  keptDraftIds: string[],
): Promise<void> {
  if (keptDraftIds.length === 0) return;
  const { data, error } = await supabase
    .from("league_drafts")
    .select("id, sleeper_draft_id")
    .eq("league_id", leagueRowId);
  if (error) {
    console.warn(`[pulseLeague] draft prune read failed: ${error.message}`);
    return;
  }
  const orphans = orphanRowIds(
    (data ?? []).map((d) => ({ id: d.id, key: d.sleeper_draft_id })),
    keptDraftIds,
  );
  if (orphans.length === 0) return;
  const { error: delErr } = await supabase.from("league_drafts").delete().in("id", orphans);
  if (delErr) {
    console.warn(`[pulseLeague] draft prune delete failed: ${delErr.message}`);
    return;
  }
  console.log(
    `[pulseLeague] removed ${orphans.length} draft row(s) league ${leagueRowId} no longer has`,
  );
}

async function upsertRosters(
  supabase: ServiceClient,
  leagueRowId: string,
  rosters: SleeperRoster[],
  tradedPicks: SleeperTradedPick[],
  draftDetails: SleeperDraft[],
): Promise<void> {
  if (rosters.length === 0) return;

  // Build a map of current pick ownership by (season, round, original_roster_id).
  // Sleeper's /traded_picks returns the CURRENT state per traded pick (one row
  // per pick, not one per hop). The `roster_id` field is the IMMUTABLE original
  // owner. Index baseline by original_roster_id, and update only by that key,
  // using `previous_owner_id` would mis-attribute multi-hop trades (A→B→C would
  // leave the pick on A's roster AND add a phantom entry on B's roster).
  const baselinePicks = buildBaselinePicks(rosters);
  for (const traded of tradedPicks) {
    const key = pickKey(Number(traded.season), traded.round, traded.roster_id);
    baselinePicks.set(key, {
      season: Number(traded.season),
      round: traded.round,
      original_roster_id: traded.roster_id,
      current_roster_id: traded.owner_id,
    });
  }

  // Build season → rosterId → slot map from each season's draft detail so we
  // can stamp `pick_label` (e.g. "1.04") onto picks for completed/scheduled drafts.
  const rosterSlotBySeason = buildRosterSlotMap(draftDetails);

  const picksByOwner = new Map<number, PickAsset[]>();
  for (const pick of baselinePicks.values()) {
    const slot = rosterSlotBySeason.get(pick.season)?.get(pick.original_roster_id) ?? null;
    const pickLabel = slot != null ? `${pick.round}.${String(slot).padStart(2, "0")}` : null;
    const arr = picksByOwner.get(pick.current_roster_id) ?? [];
    arr.push({ ...pick, slot, pick_label: pickLabel });
    picksByOwner.set(pick.current_roster_id, arr);
  }

  const rows = rosters.map((r) => {
    const sleeperPlayers = (r.players ?? []).filter(validPlayerId);
    const sleeperStarters = (r.starters ?? []).filter(validPlayerId);
    const sleeperReserve = (r.reserve ?? []).filter(validPlayerId);
    const sleeperTaxi = (r.taxi ?? []).filter(validPlayerId);
    const settings = r.settings ?? {};
    return {
      league_id: leagueRowId,
      sleeper_roster_id: r.roster_id,
      owner_user_id: r.owner_id,
      co_owners: (r.co_owners ?? []) as unknown as Database["public"]["Tables"]["rosters"]["Insert"]["co_owners"],
      player_ids: sleeperPlayers as unknown as Database["public"]["Tables"]["rosters"]["Insert"]["player_ids"],
      starter_ids: sleeperStarters as unknown as Database["public"]["Tables"]["rosters"]["Insert"]["starter_ids"],
      reserve_ids: sleeperReserve as unknown as Database["public"]["Tables"]["rosters"]["Insert"]["reserve_ids"],
      taxi_ids: sleeperTaxi as unknown as Database["public"]["Tables"]["rosters"]["Insert"]["taxi_ids"],
      draft_pick_assets: (picksByOwner.get(r.roster_id) ?? []) as unknown as Database["public"]["Tables"]["rosters"]["Insert"]["draft_pick_assets"],
      wins: Number(settings.wins ?? 0),
      losses: Number(settings.losses ?? 0),
      ties: Number(settings.ties ?? 0),
      points_for: scaledPoints(settings.fpts, settings.fpts_decimal),
      points_against: scaledPoints(settings.fpts_against, settings.fpts_against_decimal),
      waiver_position: Number(settings.waiver_position ?? 0) || null,
      waiver_budget: Number(settings.waiver_budget_used ?? 0) || null,
      metadata: r as unknown as Database["public"]["Tables"]["rosters"]["Insert"]["metadata"],
      updated_at: new Date().toISOString(),
    };
  });

  const { error } = await supabase
    .from("rosters")
    .upsert(rows, { onConflict: "league_id,sleeper_roster_id" });
  if (error) throw new Error(`rosters upsert failed: ${error.message}`);

  await pruneStaleRosters(
    supabase,
    leagueRowId,
    rosters.map((r) => r.roster_id),
  );
}

async function upsertLeagueUsers(
  supabase: ServiceClient,
  leagueRowId: string,
  users: SleeperLeagueUser[],
): Promise<void> {
  if (users.length === 0) return;
  const rows = users.map((u) => {
    const meta = (u.metadata ?? {}) as Record<string, unknown>;
    // Sleeper's `is_owner` on the /users response means "active league
    // member" (not a placeholder), which can include every co-owner of a
    // roster. It is NOT a reliable commissioner signal, overloading it as
    // such would grant force-refresh to every co-owner. Until we have a
    // verified commissioner signal (league.metadata.commissioner_id, or
    // a service-role flip), default is_commissioner to false. Admins (via
    // user_preferences.is_admin) can still force refresh.
    return {
      league_id: leagueRowId,
      sleeper_user_id: u.user_id,
      display_name: u.display_name ?? null,
      avatar: u.avatar ?? null,
      team_name: typeof meta.team_name === "string" ? (meta.team_name as string) : null,
      is_owner: Boolean(u.is_owner),
      is_commissioner: false,
      metadata: u as unknown as Database["public"]["Tables"]["league_users"]["Insert"]["metadata"],
      updated_at: new Date().toISOString(),
    };
  });
  const { error } = await supabase
    .from("league_users")
    .upsert(rows, { onConflict: "league_id,sleeper_user_id" });
  if (error) throw new Error(`league_users upsert failed: ${error.message}`);

  await pruneStaleLeagueUsers(
    supabase,
    leagueRowId,
    users.map((u) => u.user_id),
  );
}

async function upsertTransactions(
  supabase: ServiceClient,
  leagueRowId: string,
  transactions: SleeperTransaction[],
  season: number,
): Promise<void> {
  if (transactions.length === 0) return;
  const rows = transactions.map((t) => {
    const draftPicks = normalizeDraftPicks(t.draft_picks);
    const rosterIds = collectRosterIds(t.adds, t.drops, t.roster_ids, draftPicks);
    return {
      league_id: leagueRowId,
      sleeper_transaction_id: t.transaction_id,
      type: t.type,
      status: t.status ?? null,
      week: t.week ?? null,
      season,
      adds: (t.adds ?? {}) as unknown as Database["public"]["Tables"]["league_transactions"]["Insert"]["adds"],
      drops: (t.drops ?? {}) as unknown as Database["public"]["Tables"]["league_transactions"]["Insert"]["drops"],
      draft_picks: draftPicks as unknown as Database["public"]["Tables"]["league_transactions"]["Insert"]["draft_picks"],
      waiver_budget: (Array.isArray(t.waiver_budget) ? t.waiver_budget : []) as unknown as Database["public"]["Tables"]["league_transactions"]["Insert"]["waiver_budget"],
      roster_ids: rosterIds as unknown as Database["public"]["Tables"]["league_transactions"]["Insert"]["roster_ids"],
      created_at_sleeper: t.created ? new Date(t.created).toISOString() : null,
      metadata: t as unknown as Database["public"]["Tables"]["league_transactions"]["Insert"]["metadata"],
    };
  });

  // Chunk in case of giant transaction histories
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const slice = rows.slice(i, i + chunkSize);
    const { error } = await supabase
      .from("league_transactions")
      .upsert(slice, { onConflict: "league_id,sleeper_transaction_id" });
    if (error) throw new Error(`league_transactions upsert failed: ${error.message}`);
  }
}

// ---------- helpers ----------

type PickAsset = {
  season: number;
  round: number;
  original_roster_id: number;
  current_roster_id: number;
  /** Draft slot (1..N) that this pick maps to. Null until the season's
   * draft is scheduled and `slot_to_roster_id` is published. */
  slot?: number | null;
  /** Pre-formatted "R.SS" label (e.g. "1.04"). Null when slot is unknown. */
  pick_label?: string | null;
};

function pickKey(season: number, round: number, originalRosterId: number): string {
  return `${season}:${round}:${originalRosterId}`;
}

/**
 * Index draft details by season → originalRosterId → slot. Sleeper's
 * `slot_to_roster_id` maps slot number → roster_id; we invert it so the
 * read path can look up a slot from the pick's original owner.
 */
function buildRosterSlotMap(
  details: SleeperDraft[],
): Map<number, Map<number, number>> {
  const out = new Map<number, Map<number, number>>();
  for (const d of details) {
    const season =
      typeof d.season === "string" ? parseInt(d.season, 10) : Number(d.season);
    if (!Number.isFinite(season)) continue;
    const mapping = d.slot_to_roster_id;
    if (!mapping || typeof mapping !== "object") continue;
    const rosterToSlot = new Map<number, number>();
    for (const [slotStr, rosterId] of Object.entries(mapping)) {
      const slot = parseInt(slotStr, 10);
      const rid = Number(rosterId);
      if (!Number.isFinite(slot) || !Number.isFinite(rid)) continue;
      rosterToSlot.set(rid, slot);
    }
    if (rosterToSlot.size > 0) out.set(season, rosterToSlot);
  }
  return out;
}

async function upsertLeagueDrafts(
  supabase: ServiceClient,
  leagueRowId: string,
  drafts: SleeperDraft[],
): Promise<void> {
  if (drafts.length === 0) return;
  const rows = drafts
    .map((d) => {
      const season =
        typeof d.season === "string" ? parseInt(d.season, 10) : Number(d.season);
      if (!Number.isFinite(season)) return null;
      const startTime =
        typeof d.start_time === "number" && d.start_time > 0
          ? new Date(d.start_time).toISOString()
          : null;
      return {
        league_id: leagueRowId,
        sleeper_draft_id: d.draft_id,
        season,
        status: d.status ?? null,
        type: d.type ?? null,
        start_time: startTime,
        slot_to_roster_id: (d.slot_to_roster_id ?? {}) as unknown as Database["public"]["Tables"]["league_drafts"]["Insert"]["slot_to_roster_id"],
        draft_order: ((d as unknown as { draft_order?: unknown }).draft_order ?? null) as Database["public"]["Tables"]["league_drafts"]["Insert"]["draft_order"],
        settings: (d.settings ?? null) as Database["public"]["Tables"]["league_drafts"]["Insert"]["settings"],
        metadata: d as unknown as Database["public"]["Tables"]["league_drafts"]["Insert"]["metadata"],
        updated_at: new Date().toISOString(),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (rows.length === 0) return;
  // Dedupe by sleeper_draft_id so one upsert batch never targets the same
  // conflict row twice (Postgres rejects "affect a row a second time").
  const seen = new Set<string>();
  const deduped = rows.filter((r) => {
    if (seen.has(r.sleeper_draft_id)) return false;
    seen.add(r.sleeper_draft_id);
    return true;
  });
  const { error } = await supabase
    .from("league_drafts")
    .upsert(deduped, { onConflict: "sleeper_draft_id" });
  if (error) throw new Error(`league_drafts upsert failed: ${error.message}`);

  await pruneStaleLeagueDrafts(
    supabase,
    leagueRowId,
    deduped.map((d) => d.sleeper_draft_id),
  );
}

/**
 * For each (season, round, roster) baseline, default current owner = original.
 * We use the current league rosters as the set of roster_ids and assume 4
 * future seasons starting from the league's season+0..+3. Sleeper doesn't
 * publish "all my picks", we synthesize the baseline and traded_picks
 * mutates ownership.
 */
function buildBaselinePicks(rosters: SleeperRoster[]): Map<string, PickAsset> {
  const map = new Map<string, PickAsset>();
  // Use current calendar year +0..+3 as the pick horizon (Sleeper traded_picks
  // returns seasons beyond the current one; we plant a baseline for each).
  // Round count = 4 (Sleeper rookie drafts are typically 3-5 rounds; 4 is a
  // safe middle ground for dynasty pick visualization).
  const currentYear = new Date().getFullYear();
  const seasons = [currentYear, currentYear + 1, currentYear + 2, currentYear + 3];
  const rounds = [1, 2, 3, 4];
  for (const season of seasons) {
    for (const round of rounds) {
      for (const r of rosters) {
        const key = pickKey(season, round, r.roster_id);
        map.set(key, {
          season,
          round,
          original_roster_id: r.roster_id,
          current_roster_id: r.roster_id,
        });
      }
    }
  }
  return map;
}

function validPlayerId(id: string | null | undefined): id is string {
  if (id === null || id === undefined) return false;
  if (id === "" || id === "0") return false;
  return true;
}

function scaledPoints(whole: number | undefined, decimal: number | undefined): number {
  const w = Number(whole ?? 0);
  const d = Number(decimal ?? 0);
  return w + d / 100;
}

/**
 * Re-exported so every existing importer keeps working.
 *
 * The implementation moved to `lib/sleeper-draft-picks.ts` because this module
 * now imports the activity projector, which needs the same normaliser while
 * reading transactions back. Leaving it here made that pair an import cycle.
 */
export { normalizeDraftPicks };

function collectRosterIds(
  adds: Record<string, number> | null | undefined,
  drops: Record<string, number> | null | undefined,
  topLevel: number[] | undefined,
  draftPicks: unknown[],
): number[] {
  const set = new Set<number>();
  for (const v of Object.values(adds ?? {})) if (typeof v === "number") set.add(v);
  for (const v of Object.values(drops ?? {})) if (typeof v === "number") set.add(v);
  for (const id of topLevel ?? []) set.add(id);
  for (const pick of draftPicks) {
    if (pick && typeof pick === "object") {
      const p = pick as Record<string, unknown>;
      if (typeof p.owner_id === "number") set.add(p.owner_id);
      if (typeof p.previous_owner_id === "number") set.add(p.previous_owner_id);
      if (typeof p.roster_id === "number") set.add(p.roster_id);
    }
  }
  return Array.from(set).sort((a, b) => a - b);
}

export type { SleeperLeague };
