/**
 * Sleeper head-to-head schedule sync.
 *
 * Sleeper generates a league's full season schedule at creation time, so weeks
 * far in the future already return populated pairings during the preseason.
 * That is what lets Power Pulse compute strength of schedule and playoff odds
 * before a single game is played.
 *
 * Fetch policy matters here, because a naive implementation costs 18 HTTP calls
 * per league load. The schedule itself never changes once created, so:
 *   - A league with no stored weeks gets the full slate fetched once, in
 *     parallel batches rather than one blocking request at a time.
 *   - Before that full slate, one probe week decides whether there is anything
 *     to fetch at all. Sleeper publishes the whole schedule at once, so a probe
 *     that answers "no games" means the league has no slate yet and the other
 *     17 requests would all come back empty.
 *   - After that we refresh only the weeks that can still move: the current
 *     week and the next two (lineups change), plus any week that is missing.
 *   - `force` refetches everything.
 *
 * A week whose games are done is marked `is_final` so the engine can treat it as
 * a settled result rather than something to project.
 *
 * Failures are reported, never swallowed. `failedWeeks` lists weeks whose
 * request did not come back, which means the stored slate is incomplete and a
 * caller must not conclude anything from its shape.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { getSleeperMatchups, mapLimit, SLEEPER_BATCH_SIZE, type SleeperMatchup } from "@/lib/sleeper";

type ServiceClient = SupabaseClient<Database>;

/** Regular season plus the deepest playoff week any league runs. */
export const MAX_MATCHUP_WEEK = 18;

/** How many upcoming weeks past the current one get their lineups refreshed. */
const LOOKAHEAD_WEEKS = 2;

export type MatchupSyncResult = {
  ok: boolean;
  weeksFetched: number[];
  rowsWritten: number;
  /**
   * Weeks whose Sleeper request failed outright. Non-empty means the stored
   * schedule may be missing games that do exist, so "this league has no
   * schedule" is not a conclusion anyone may draw from it.
   */
  failedWeeks: number[];
  /** True when Sleeper answered for the probe week and published no games. */
  noScheduleYet: boolean;
  error?: string;
};

function validPlayerId(id: string | null | undefined): id is string {
  return typeof id === "string" && id.length > 0 && id !== "0";
}

/**
 * Which weeks need a Sleeper call. Returns every week when the league has no
 * stored schedule, otherwise just the volatile window plus any gaps.
 */
function weeksToFetch(
  storedWeeks: Set<number>,
  currentWeek: number,
  force: boolean,
): number[] {
  const all = Array.from({ length: MAX_MATCHUP_WEEK }, (_, i) => i + 1);
  if (force || storedWeeks.size === 0) return all;

  const wanted = new Set<number>();
  for (let w = currentWeek; w <= Math.min(MAX_MATCHUP_WEEK, currentWeek + LOOKAHEAD_WEEKS); w += 1) {
    wanted.add(w);
  }
  for (const w of all) {
    if (!storedWeeks.has(w)) wanted.add(w);
  }
  return [...wanted].sort((a, b) => a - b);
}

export async function syncLeagueMatchups(
  supabase: ServiceClient,
  leagueRowId: string,
  sleeperLeagueId: string,
  season: number,
  currentWeek: number,
  options: { force?: boolean } = {},
): Promise<MatchupSyncResult> {
  const { force = false } = options;

  const { data: existing, error: existingErr } = await supabase
    .from("league_matchups")
    .select("week")
    .eq("league_id", leagueRowId)
    .eq("season", season);
  if (existingErr) {
    return {
      ok: false,
      weeksFetched: [],
      rowsWritten: 0,
      failedWeeks: [],
      noScheduleYet: false,
      error: existingErr.message,
    };
  }

  const storedWeeks = new Set((existing ?? []).map((r) => Number(r.week)));
  let targets = weeksToFetch(storedWeeks, currentWeek, force);
  if (targets.length === 0) {
    return { ok: true, weeksFetched: [], rowsWritten: 0, failedWeeks: [], noScheduleYet: false };
  }

  const nowIso = new Date().toISOString();
  const rows: Database["public"]["Tables"]["league_matchups"]["Insert"][] = [];
  const fetched: number[] = [];
  const failed: number[] = [];
  const collected = new Map<number, SleeperMatchup[]>();

  // Probe before committing to the full slate. Only worth it when we are about
  // to ask for every week; a targeted refresh is already cheap.
  let noScheduleYet = false;
  if (targets.length > SLEEPER_BATCH_SIZE) {
    const probeWeek = targets[0];
    const probe = await getSleeperMatchups(sleeperLeagueId, probeWeek);
    if (probe === null) {
      failed.push(probeWeek);
    } else if (probe.length === 0) {
      // Sleeper answered and has nothing. The rest of the season is the same
      // answer, so stop here instead of spending 17 more requests on it.
      noScheduleYet = true;
      targets = [];
    } else {
      collected.set(probeWeek, probe);
      fetched.push(probeWeek);
    }
    targets = targets.filter((w) => w !== probeWeek);
  }

  const results = await mapLimit(targets, SLEEPER_BATCH_SIZE, (week) =>
    getSleeperMatchups(sleeperLeagueId, week),
  );
  targets.forEach((week, i) => {
    const matchups = results[i];
    if (matchups === null) {
      failed.push(week);
      return;
    }
    if (matchups.length === 0) return;
    collected.set(week, matchups);
    fetched.push(week);
  });

  for (const [week, matchups] of [...collected.entries()].sort((a, b) => a[0] - b[0])) {
    for (const m of matchups) {
      const rosterId = Number(m.roster_id);
      if (!Number.isFinite(rosterId)) continue;
      const points = Number(m.points ?? 0);
      rows.push({
        league_id: leagueRowId,
        season,
        week,
        sleeper_roster_id: rosterId,
        matchup_id:
          m.matchup_id === null || m.matchup_id === undefined ? null : Number(m.matchup_id),
        points: Number.isFinite(points) ? points : 0,
        starter_ids: (m.starters ?? []).filter(validPlayerId) as unknown as Json,
        starter_points: (m.starters_points ?? []) as unknown as Json,
        player_ids: (m.players ?? []).filter(validPlayerId) as unknown as Json,
        player_points: (m.players_points ?? {}) as unknown as Json,
        // A past week with points on the board is settled. A past week with no
        // points is a league that has not started yet, which stays projectable.
        is_final: week < currentWeek && points > 0,
        metadata: m as unknown as Json,
        synced_at: nowIso,
      });
    }
  }

  fetched.sort((a, b) => a - b);
  failed.sort((a, b) => a - b);

  if (rows.length === 0) {
    return {
      ok: failed.length === 0,
      weeksFetched: fetched,
      rowsWritten: 0,
      failedWeeks: failed,
      noScheduleYet,
      error: failed.length > 0 ? `Sleeper did not answer for weeks ${failed.join(", ")}` : undefined,
    };
  }

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase
      .from("league_matchups")
      .upsert(rows.slice(i, i + CHUNK), { onConflict: "league_id,week,sleeper_roster_id" });
    if (error) {
      return {
        ok: false,
        weeksFetched: fetched,
        rowsWritten: i,
        failedWeeks: failed,
        noScheduleYet,
        error: error.message,
      };
    }
  }

  return {
    ok: failed.length === 0,
    weeksFetched: fetched,
    rowsWritten: rows.length,
    failedWeeks: failed,
    noScheduleYet,
    error: failed.length > 0 ? `Sleeper did not answer for weeks ${failed.join(", ")}` : undefined,
  };
}

/**
 * The first week that has not been played yet.
 *
 * Sleeper's NFL state reports week 0 during the preseason, which would make
 * every projection loop empty, so the preseason and offseason both resolve to
 * week 1. In the postseason we clamp to the league's playoff start so the
 * remaining slate is empty rather than negative.
 */
export function resolveCurrentWeek(
  state: { week?: number; season_type?: string; season?: string } | null,
  season: number,
  playoffWeekStart: number,
): number {
  if (!state) return 1;
  const stateSeason = Number(state.season);
  if (Number.isFinite(stateSeason) && stateSeason !== season) {
    // Looking at a past season: everything is played.
    return stateSeason > season ? MAX_MATCHUP_WEEK + 1 : 1;
  }
  if (state.season_type === "regular") {
    return Math.max(1, Math.min(MAX_MATCHUP_WEEK, Number(state.week) || 1));
  }
  if (state.season_type === "post") return Math.max(1, playoffWeekStart);
  // "pre" and "off" both mean nothing has been played.
  return 1;
}
