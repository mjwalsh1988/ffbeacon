import "server-only";

/**
 * The defenders the FAAB calculator can bid on (plan R-6, IDP-312).
 *
 * The offensive list (./free-agents.ts) walks a ranked value universe, which
 * holds no defender. Once the IDP switch is on in a league that starts
 * defenders, this appends the top fifteen available at each defensive position
 * the league starts, from this week's projections under the league's own
 * scoring (lib/idp/free-agents.ts). With the switch off, or in any other
 * league, it returns nothing: off, it reads nothing beyond the memoised
 * settings; on, it reads the league's slots before deciding.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { ScoringSettings } from "@/lib/league-scoring";
import { resolveCurrentWeek } from "@/lib/league-matchups";
import { getNflState } from "@/lib/sleeper";
import { loadPowerPulseSettings } from "@/lib/power-pulse/settings";
import { idpEnabledFrom } from "@/lib/power-pulse/default-settings";
import { idpReadsFor } from "@/lib/power-pulse/idp-reads";
import { startingSlots } from "@/lib/power-pulse/lineup";
import { resolveProjectionSourceForWindow } from "@/lib/projections/source";
import { loadIdpFreeAgents, startableIdpPositions } from "@/lib/idp/free-agents";
import { DEFAULT_PLAYOFF_WEEK_START } from "@/lib/power-pulse/playoff-defaults";
import type { FreeAgentOption } from "./free-agents";

/** Sorts after every ranked player, and is never printed as a rank. */
const UNRANKED_BASE = 100_000;

export async function loadFaabDefenders(
  admin: SupabaseClient<Database>,
  leagueRowId: string,
): Promise<FreeAgentOption[]> {
  // The settings first, and alone: they are memoised, so with the switch off
  // this returns without a single read of its own.
  const settings = await loadPowerPulseSettings(admin);
  if (!idpEnabledFrom(settings)) return [];
  const { data: league } = await admin
    .from("leagues")
    .select("season, roster_positions, scoring_settings, metadata")
    .eq("id", leagueRowId)
    .maybeSingle();
  if (!league) return [];
  const rosterPositions = Array.isArray(league.roster_positions)
    ? league.roster_positions.filter((t): t is string => typeof t === "string")
    : [];
  const reads = idpReadsFor(idpEnabledFrom(settings), rosterPositions, "pts_ppr");
  if (!reads.loadsDefenders) return [];

  const season = Number(league.season);
  const meta = (league.metadata ?? {}) as { settings?: { playoff_week_start?: unknown } };
  const playoffStart = Number(meta.settings?.playoff_week_start);
  const week = resolveCurrentWeek(
    await getNflState(),
    season,
    Number.isFinite(playoffStart) && playoffStart > 0 ? playoffStart : DEFAULT_PLAYOFF_WEEK_START,
  );
  const source = await resolveProjectionSourceForWindow({
    supabase: admin,
    season,
    fromWeek: week,
    toWeek: week,
    settings: settings.beaconProjections,
  });

  const defenders = await loadIdpFreeAgents(admin, {
    leagueRowId,
    season,
    week,
    source,
    scoringSettings: (league.scoring_settings ?? null) as ScoringSettings | null,
    startable: startableIdpPositions(startingSlots(rosterPositions, reads.slotMap), reads.slotMap),
  });

  return (defenders ?? []).map((d, i) => ({
    slug: d.slug,
    player_id: d.playerId,
    name: d.name,
    position: d.position,
    team: d.team,
    sleeper_id: d.sleeperId,
    overall_rank: UNRANKED_BASE + i,
    position_rank: d.positionRank,
    value: null,
    unranked: true,
  }));
}
