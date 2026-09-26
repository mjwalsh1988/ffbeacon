/**
 * Final scores for the edition's week, for the bundle's teams[].week_result.
 *
 * No table stores game scores, but every team-defense line Sleeper publishes
 * (player_stats rows for the DEF "player", raw object in metadata) carries
 * pts_allow, and the score follows from the two lines of one game:
 *
 *   a team's points = the opponent defense's pts_allow
 *                   + 6 for each defensive or special-teams touchdown it scored
 *                   + 2 for each safety it scored
 *
 * pts_allow alone is not the score: Sleeper leaves out the points a defense
 * gave up on its own offense's turnovers returned for a score, so Carolina's
 * 34 to 3 win in week 2 of 2026 shows Atlanta's defense allowing 28, and the
 * pick-six makes up the rest. The formula reproduced all 16 ESPN finals for
 * that week and every week 1 score quoted in that week's Brief.
 *
 * A game with only one line, or a line with no pts_allow, is left out rather
 * than guessed, and the desk is told to confirm scores against a page it
 * fetches either way.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { BundleWeekResult } from "./types";

export interface DefenseLine {
  team: string;
  opponent: string | null;
  game_date: string | null;
  stats: Record<string, unknown>;
}

function stat(stats: Record<string, unknown>, key: string): number {
  const n = Number(stats[key] ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Points a team scored beyond what the opponent's defense is charged with. */
function returnPoints(stats: Record<string, unknown>): number {
  return 6 * (stat(stats, "def_td") + stat(stats, "def_st_td")) + 2 * stat(stats, "safe");
}

/** Every team's result that both defense lines support, keyed by abbreviation. */
export function deriveWeekResults(lines: DefenseLine[]): Map<string, BundleWeekResult> {
  const byTeam = new Map(lines.map((l) => [l.team.toUpperCase(), l]));
  const out = new Map<string, BundleWeekResult>();
  for (const line of lines) {
    const team = line.team.toUpperCase();
    const opponent = line.opponent?.toUpperCase() ?? null;
    if (!opponent) continue;
    const other = byTeam.get(opponent);
    if (!other || other.opponent?.toUpperCase() !== team) continue;
    if (line.stats.pts_allow === undefined || other.stats.pts_allow === undefined) continue;
    const pointsFor = stat(other.stats, "pts_allow") + returnPoints(line.stats);
    const pointsAgainst = stat(line.stats, "pts_allow") + returnPoints(other.stats);
    out.set(team, {
      opponent,
      points_for: pointsFor,
      points_against: pointsAgainst,
      outcome: pointsFor > pointsAgainst ? "W" : pointsFor < pointsAgainst ? "L" : "T",
      game_date: line.game_date,
    });
  }
  return out;
}

/** The week's defense lines from player_stats. Thirty-two rows at most. */
export async function loadWeekResults(
  admin: SupabaseClient<Database>,
  season: number,
  seasonType: string,
  week: number,
): Promise<Map<string, BundleWeekResult>> {
  const { data: defenses } = await admin.from("players").select("id, team").eq("position", "DEF");
  const teamById = new Map((defenses ?? []).filter((d) => d.team).map((d) => [d.id, d.team as string]));
  if (teamById.size === 0) return new Map();
  const { data: rows } = await admin
    .from("player_stats")
    .select("player_id, opponent, metadata")
    .eq("season", season)
    .eq("season_type", seasonType)
    .eq("week", week)
    .in("player_id", [...teamById.keys()]);
  const lines: DefenseLine[] = [];
  for (const r of rows ?? []) {
    const team = teamById.get(r.player_id);
    const meta = (r.metadata ?? {}) as { stats?: Record<string, unknown>; date?: string };
    if (!team || !meta.stats) continue;
    lines.push({ team, opponent: r.opponent, game_date: typeof meta.date === "string" ? meta.date : null, stats: meta.stats });
  }
  return deriveWeekResults(lines);
}
