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
 *   - A league with no stored weeks gets the full slate fetched once.
 *   - After that we refresh only the weeks that can still move: the current
 *     week and the next two (lineups change), plus any week that is missing.
 *   - `force` refetches everything.
 *
 * A week whose games are done is marked `is_final` so the engine can treat it as
 * a settled result rather than something to project.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { getSleeperMatchups, type SleeperMatchup } from "@/lib/sleeper";

type ServiceClient = SupabaseClient<Database>;

/** Regular season plus the deepest playoff week any league runs. */
export const MAX_MATCHUP_WEEK = 18;

/** How many upcoming weeks past the current one get their lineups refreshed. */
const LOOKAHEAD_WEEKS = 2;

export type MatchupSyncResult = {
  ok: boolean;
  weeksFetched: number[];
  rowsWritten: number;
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
    return { ok: false, weeksFetched: [], rowsWritten: 0, error: existingErr.message };
  }

  const storedWeeks = new Set((existing ?? []).map((r) => Number(r.week)));
  const targets = weeksToFetch(storedWeeks, currentWeek, force);
  if (targets.length === 0) return { ok: true, weeksFetched: [], rowsWritten: 0 };

  const nowIso = new Date().toISOString();
  const rows: Database["public"]["Tables"]["league_matchups"]["Insert"][] = [];
  const fetched: number[] = [];

  for (const week of targets) {
    const matchups: SleeperMatchup[] = await getSleeperMatchups(sleeperLeagueId, week);
    if (matchups.length === 0) continue;
    fetched.push(week);

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

  if (rows.length === 0) return { ok: true, weeksFetched: fetched, rowsWritten: 0 };

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase
      .from("league_matchups")
      .upsert(rows.slice(i, i + CHUNK), { onConflict: "league_id,week,sleeper_roster_id" });
    if (error) {
      return { ok: false, weeksFetched: fetched, rowsWritten: i, error: error.message };
    }
  }

  return { ok: true, weeksFetched: fetched, rowsWritten: rows.length };
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
