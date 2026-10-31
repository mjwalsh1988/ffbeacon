import "server-only";

/**
 * What an order remembers about the team it is for.
 *
 * Shared by the customer checkout and the admin's complimentary order, so both
 * store the same shape. The Blueprint is stored whole, so Michael reviews what the
 * customer saw; it is read from the cache and never built here. Format comes from
 * the league and source from the reader, through `resolveLeagueContext`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { readCachedBlueprint } from "@/lib/league-blueprint/cache";
import { resolveLeagueContext } from "@/lib/league-format-resolution";
import { LEAGUE_CORE_COLUMNS, type LeagueCoreRow } from "@/lib/league-pulse";
import { loadRosters } from "@/lib/power-pulse/load";
import type { SleeperLeague } from "@/lib/sleeper";
import type { TeamReviewContext } from "./types";

type Client = SupabaseClient<Database>;

export function reviewLinks(sleeperLeagueId: string, rosterId: number): TeamReviewContext["links"] {
  return {
    blueprint: `/leagues/${sleeperLeagueId}/blueprint?roster=${rosterId}`,
    overview: `/leagues/${sleeperLeagueId}`,
    lineups: `/leagues/${sleeperLeagueId}/lineups?roster=${rosterId}`,
    tradeIdeas: `/leagues/${sleeperLeagueId}/trade-ideas`,
  };
}

/** The stored league row. An order never syncs a league. */
export async function readLeagueRow(
  admin: Client,
  sleeperLeagueId: string,
): Promise<LeagueCoreRow | null> {
  const { data, error } = await admin
    .from("leagues")
    .select(LEAGUE_CORE_COLUMNS)
    .eq("sleeper_league_id", sleeperLeagueId)
    .maybeSingle();
  if (error) console.error("[orders] league read failed", error.message);
  return (data as unknown as LeagueCoreRow | null) ?? null;
}

/** The team, or null when the roster is not in that league. */
export async function buildTeamReviewContext(
  admin: Client,
  league: LeagueCoreRow,
  rosterId: number,
  sourceSlug: string | null,
): Promise<TeamReviewContext | null> {
  const rosters = await loadRosters(admin, league.id);
  const roster = rosters.find((r) => r.sleeperRosterId === rosterId);
  if (!roster) return null;

  const resolved = await resolveLeagueContext(
    admin,
    league.metadata as unknown as SleeperLeague,
    sourceSlug,
  );
  const season = String(league.season);
  const cached =
    resolved.coverage === "none"
      ? null
      : await readCachedBlueprint(admin, {
          leagueRowId: league.id,
          rosterId,
          season,
          source: resolved.sourceSlug,
        });

  return {
    sleeperLeagueId: league.sleeper_league_id,
    leagueRowId: league.id,
    leagueName: league.name,
    season,
    totalRosters: league.total_rosters ?? rosters.length,
    rosterId,
    teamName: roster.teamName,
    ownerHandle: roster.ownerHandle,
    formatSlug: resolved.formatSlug,
    formatDisplay: "formatDisplay" in resolved ? resolved.formatDisplay : "Unmatched",
    sourceSlug: resolved.sourceSlug,
    sourceDisplay: resolved.sourceDisplay,
    blueprint: cached
      ? {
          generatedAt: cached.generatedAt,
          overall: cached.view.standing.overall,
          statusLabel: cached.view.standing.status?.label ?? null,
          modelVersion: cached.modelVersion,
          view: cached.view,
        }
      : null,
    links: reviewLinks(league.sleeper_league_id, rosterId),
  };
}
