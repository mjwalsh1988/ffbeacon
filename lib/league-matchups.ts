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
 *     week and the next two (lineups change), plus any week that is missing,
 *     plus any PAST week that has not settled yet. See `weeksToFetch`.
 *   - `force` refetches everything.
 *
 * A week whose games are done is marked `is_final` so the engine can treat it as
 * a settled result rather than something to project.
 *
 * WHY PAST WEEKS ARE REFETCHED AT ALL
 *   The window used to run forward only, from the current week to two ahead. A
 *   week was therefore last written while it WAS the current week, which for a
 *   league last opened on Sunday afternoon means a row full of half-played
 *   scores, is_final false, and no further chance to correct itself: once
 *   Sleeper advanced the week it fell out of the window forever. Everything
 *   built on settled results (the retrospective on the Schedule page, the
 *   Manager Ledger) would then be reading a Sunday-afternoon snapshot and
 *   calling it a final score.
 *
 *   So an unsettled past week is refetched until it settles. The cost is
 *   bounded on both sides: a week that HAS points refetches until is_final
 *   flips, which happens on the first sync after Sleeper advances; a week with
 *   no points at all (a league that never played it) is chased only inside
 *   SETTLE_LOOKBACK_WEEKS and then left alone, so an abandoned league does not
 *   pay for eighteen requests on every load forever.
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

/**
 * How far back an unsettled, never-scored week is chased before we accept that
 * it is never going to settle. A week that DID score is chased regardless of
 * age, because that one is a real result waiting to be finalised.
 */
const SETTLE_LOOKBACK_WEEKS = 3;

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

/**
 * Sleeper's starters array is POSITIONAL, and it is stored that way.
 *
 * `starters[i]` is the player in the i-th startable slot of the league's
 * `roster_positions`, and an unfilled slot is the string "0". This used to be
 * filtered on the way in, which removed the placeholder and shifted every slot
 * below it up by one.
 *
 * The reason that matters is `starters_points`, which was never filtered. The
 * two arrays are only meaningful paired, and filtering one of them made them
 * disagree with each other about which slot every entry after the first gap
 * belongs to. Storing both verbatim is what puts them back in step.
 *
 * The Schedule page is NOT the reason. It reads `metadata.starters`, the
 * verbatim Sleeper object, and falls back to this column only for rows written
 * while the filter was live: see lib/league-schedule/lineups.ts, which explains
 * why it prefers the metadata copy. On anything synced since, that fallback
 * never fires.
 *
 * So both go in verbatim, and every reader filters. `asStringArray` in
 * lib/power-pulse/load.ts already does, which is why this change moves no Power
 * Pulse number; lib/power-pulse/load.test.ts holds that line.
 */
export function normalizeIdList(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return ids.map((id) => (typeof id === "string" ? id : ""));
}

/** What we already hold for one week, as the fetch window reads it. */
export type StoredWeekState = {
  week: number;
  /** True when every stored row for the week is marked final. */
  settled: boolean;
  /** True when at least one roster has a non-zero score stored for the week. */
  scored: boolean;
};

/**
 * Which weeks need a Sleeper call. Returns every week when the league has no
 * stored schedule, otherwise the volatile window, any gap, and any past week
 * that has not settled yet.
 *
 * Exported so the policy can be tested without a database or a network. The
 * three rules, in order:
 *
 *   1. The volatile window. currentWeek through currentWeek + LOOKAHEAD_WEEKS,
 *      because lineups still move there.
 *   2. Gaps. Any week of the season we hold no row for at all.
 *   3. The settle pass. Any week before currentWeek whose stored rows are not
 *      all final. Chased indefinitely when the week has points on the board
 *      (a real result caught mid-play), and only within SETTLE_LOOKBACK_WEEKS
 *      when it has none (a week that was never played).
 */
export function weeksToFetch(
  stored: StoredWeekState[],
  currentWeek: number,
  force: boolean,
): number[] {
  const all = Array.from({ length: MAX_MATCHUP_WEEK }, (_, i) => i + 1);
  if (force || stored.length === 0) return all;

  const byWeek = new Map(stored.map((s) => [s.week, s]));
  const wanted = new Set<number>();

  for (let w = currentWeek; w <= Math.min(MAX_MATCHUP_WEEK, currentWeek + LOOKAHEAD_WEEKS); w += 1) {
    wanted.add(w);
  }
  for (const w of all) {
    if (!byWeek.has(w)) wanted.add(w);
  }
  for (const state of stored) {
    if (state.week >= currentWeek) continue;
    if (state.settled) continue;
    if (state.scored || state.week >= currentWeek - SETTLE_LOOKBACK_WEEKS) {
      wanted.add(state.week);
    }
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
    .select("week, is_final, points")
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

  // Collapse the per-roster rows into one state per week: settled when every
  // row for it is final, scored when any roster has points on the board.
  const stateByWeek = new Map<number, { settled: boolean; scored: boolean }>();
  for (const row of existing ?? []) {
    const week = Number(row.week);
    if (!Number.isFinite(week)) continue;
    const points = Number(row.points ?? 0);
    const prior = stateByWeek.get(week);
    stateByWeek.set(week, {
      settled: (prior?.settled ?? true) && Boolean(row.is_final),
      scored: (prior?.scored ?? false) || (Number.isFinite(points) && points > 0),
    });
  }
  const storedState: StoredWeekState[] = [...stateByWeek.entries()]
    .map(([week, state]) => ({ week, ...state }))
    .sort((a, b) => a.week - b.week);

  let targets = weeksToFetch(storedState, currentWeek, force);
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
    // Whether the week was PLAYED is a fact about the week, not about one
    // roster. It used to be tested per row as `points > 0`, which read a
    // legitimate zero as "not played yet": a roster on a playoff bye, or one
    // whose every starter was on bye, never settled and was re-fetched for the
    // rest of the season while every other roster in the same week was final.
    const weekHasScoring = matchups.some((m) => {
      const p = Number(m.points ?? 0);
      return Number.isFinite(p) && p > 0;
    });
    const weekIsFinal = week < currentWeek && weekHasScoring;

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
        // Verbatim, placeholders included. See normalizeIdList above.
        starter_ids: normalizeIdList(m.starters) as unknown as Json,
        starter_points: (m.starters_points ?? []) as unknown as Json,
        player_ids: normalizeIdList(m.players) as unknown as Json,
        player_points: (m.players_points ?? {}) as unknown as Json,
        // A past week with points on the board is settled, for every roster in
        // it. A past week with no points anywhere is a league that has not
        // started yet, which stays projectable. See weekHasScoring above.
        is_final: weekIsFinal,
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
