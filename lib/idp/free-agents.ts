/**
 * Which defenders nobody in this league has rostered, and who is best of them
 * this week (plan R-6).
 *
 * The offensive free agent lists (lib/faab/free-agents.ts) walk a ranked value
 * universe and subtract the league's rosters. That cannot work for a defender:
 * no value source ranks one, so he is in no universe to walk. The universe
 * here is instead every DL, LB and DB with a PROJECTED line for the week,
 * scored under the league's own IDP rules, top fifteen per position the league
 * can start.
 *
 * Read only, and only ever called by a surface that has read the IDP switch
 * and found defenders are candidates in this league (lib/power-pulse/
 * idp-reads.ts loadsDefenders). Both callers run it inside their own metered
 * panel: the Lineups waiver panel after claimLineupWaiverSlot, and the FAAB
 * calculator behind its own rate limit.
 *
 * A defender is never scored from a stored points column (plan R-4, and
 * lib/idp/points-guard.test.ts): his number is his projected stat line through
 * the one scoring core, and a league with no IDP rule yields no number at all.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { scoreWithFallback, type ScoringSettings } from "@/lib/league-scoring";
import { IDP_POSITIONS, isDefender } from "@/lib/site";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

type ServiceClient = SupabaseClient<Database>;

/** How many available defenders to keep per position (plan R-6). */
export const IDP_FREE_AGENTS_PER_POSITION = 15;

export type IdpFreeAgent = {
  playerId: string;
  sleeperId: string;
  slug: string;
  name: string;
  /** The primary position: DL, LB or DB. */
  position: string;
  team: string | null;
  /** This week's projected points under the league's own scoring, unadjusted. */
  projectedPoints: number;
  /** 1 = the best available defender in the group he would play in this week. */
  positionRank: number;
};

/** One projection row joined to its player, as the read below returns it. */
export type IdpProjectionRow = {
  player_id: string | null;
  stat_line: unknown;
  availability: string | null;
  players: {
    slug: string;
    full_name: string | null;
    position: string | null;
    /** Every position Sleeper lets him start at. Absent in older fixtures. */
    eligible_positions?: string[] | null;
    team: string | null;
    external_ids: unknown;
  } | null;
};

/**
 * The pure half: given this week's defender projection rows, who is owned,
 * which positions the league starts and how it scores, return the best
 * available at each position. Exported for the tests.
 */
export function rankIdpFreeAgents(
  rows: readonly IdpProjectionRow[],
  owned: ReadonlySet<string>,
  startable: ReadonlySet<string>,
  scoring: ScoringSettings | null,
  perPosition = IDP_FREE_AGENTS_PER_POSITION,
): IdpFreeAgent[] {
  const byPosition = new Map<string, IdpFreeAgent[]>();
  const seen = new Set<string>();

  for (const row of rows) {
    const player = row.players;
    if (!row.player_id || !player) continue;
    const position = (player.position ?? "").toUpperCase();
    if (!isDefender(position)) continue;
    // Where he would play: his primary when the league starts it, else the
    // first other position he is eligible at that it does. A DL/LB in a league
    // that starts only LB slots is an LB free agent (the optimiser would seat
    // him there); ranked in that group, shown with his own primary.
    const eligible = [position, ...(player.eligible_positions ?? []).map((p) => p.toUpperCase())];
    const playsAt = eligible.find((p) => isDefender(p) && startable.has(p));
    if (!playsAt) continue;
    // Only a line Sleeper actually projected. An "out" or "unprojected" row
    // has no line to score, and a bye has no row.
    if (row.availability !== "projected") continue;

    const ext = (player.external_ids ?? {}) as Record<string, unknown>;
    const sleeperId = typeof ext.sleeper === "string" ? ext.sleeper : null;
    if (!sleeperId || owned.has(sleeperId) || seen.has(sleeperId)) continue;

    const line =
      row.stat_line && typeof row.stat_line === "object"
        ? (row.stat_line as Record<string, unknown>)
        : null;
    // The defender branch of the one scoring core: null when the league has no
    // IDP rule, never a stored column and never a zero.
    const scored = scoreWithFallback(line, { ppr: null, half_ppr: null, std: null }, scoring, position);
    if (scored.points === null || !Number.isFinite(scored.points) || scored.points <= 0) continue;

    seen.add(sleeperId);
    const list = byPosition.get(playsAt) ?? [];
    list.push({
      playerId: row.player_id,
      sleeperId,
      slug: player.slug,
      name: player.full_name ?? player.slug,
      position,
      team: player.team,
      projectedPoints: scored.points,
      positionRank: 0,
    });
    byPosition.set(playsAt, list);
  }

  const out: IdpFreeAgent[] = [];
  for (const position of IDP_POSITIONS) {
    const list = byPosition.get(position) ?? [];
    list.sort((a, b) => b.projectedPoints - a.projectedPoints || a.name.localeCompare(b.name));
    list.slice(0, perPosition).forEach((entry, i) => out.push({ ...entry, positionRank: i + 1 }));
  }
  return out;
}

/**
 * The IDP positions a league's starting slots accept, from the ON slot map the
 * caller already holds. Empty for a league with no defensive slot.
 */
export function startableIdpPositions(
  slotTokens: readonly string[],
  slotMap: Readonly<Record<string, readonly string[]>>,
): Set<string> {
  const out = new Set<string>();
  for (const token of slotTokens) {
    for (const position of slotMap[token] ?? []) if (isDefender(position)) out.add(position);
  }
  return out;
}

/**
 * The loader. One read of this week's defender projections for the resolved
 * source (a few hundred rows, paged), one read of the league's rosters.
 * Returns null when we hold no rosters for the league: "we do not know who is
 * owned" must not read as "every defender is available".
 */
export async function loadIdpFreeAgents(
  supabase: ServiceClient,
  params: {
    leagueRowId: string;
    season: number;
    week: number;
    /** The projection source the page already resolved. Never omitted. */
    source: string;
    scoringSettings: ScoringSettings | null;
    startable: ReadonlySet<string>;
    perPosition?: number;
  },
): Promise<IdpFreeAgent[] | null> {
  if (params.startable.size === 0) return [];

  const [rosterRows, projectionRows] = await Promise.all([
    fetchAllRows("idp free agents: rosters", (from, to) =>
      supabase
        .from("rosters")
        .select("id, player_ids")
        .eq("league_id", params.leagueRowId)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows("idp free agents: projections", (from, to) =>
      supabase
        .from("player_weekly_projections")
        .select("id, player_id, stat_line, availability, players!inner(slug, full_name, position, eligible_positions, team, external_ids)")
        .eq("season", params.season)
        .eq("season_type", "regular")
        .eq("week", params.week)
        .eq("source", params.source)
        .eq("availability", "projected")
        // Every defensive primary, not only the started ones: a DL eligible at
        // LB is a candidate in an LB-only league. Still a few hundred rows.
        .in("players.position", [...IDP_POSITIONS])
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);
  if (rosterRows.length === 0) return null;

  const owned = new Set<string>();
  for (const row of rosterRows) {
    const ids = Array.isArray(row.player_ids) ? row.player_ids : [];
    for (const id of ids) if (typeof id === "string" && id.length > 0 && id !== "0") owned.add(id);
  }

  return rankIdpFreeAgents(
    projectionRows as unknown as IdpProjectionRow[],
    owned,
    params.startable,
    params.scoringSettings,
    params.perPosition,
  );
}
