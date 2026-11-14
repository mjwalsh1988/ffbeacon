/**
 * What kind of league a Blueprint is built for, and whether its season is a
 * frozen snapshot. Pure.
 *
 * The kind comes from Sleeper's settings.type (0 redraft, 1 keeper, 2
 * dynasty, 3 chopped), the same reading lib/league-category.ts makes, except
 * that keeper stays its own kind here: a keeper league carries picks, so its
 * draft capital is graded.
 *
 * A league from a season before the current NFL season is frozen (LPI-T02):
 * never synced again, so its stored view is served as it is and says so.
 */

import { currentNflSeason } from "@/lib/nfl-season";
import type { BlueprintLeagueKind } from "./types";

export function leagueKindOf(metadata: unknown): { kind: BlueprintLeagueKind; isBestBall: boolean } {
  const settings =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? ((metadata as { settings?: Record<string, unknown> | null }).settings ?? {})
      : {};
  const type = Number(settings.type ?? 0);
  const kind: BlueprintLeagueKind =
    type === 3 ? "chopped" : type === 2 ? "dynasty" : type === 1 ? "keeper" : "redraft";
  return { kind, isBestBall: Number(settings.best_ball ?? 0) === 1 };
}

export function isFrozenSeason(season: string, currentSeason: string = currentNflSeason()): boolean {
  const s = Number(season);
  const current = Number(currentSeason);
  return Number.isFinite(s) && Number.isFinite(current) && s < current;
}

/** The sentence a frozen season's view carries, else null. */
export function frozenSeasonNote(season: string, currentSeason: string = currentNflSeason()): string | null {
  return isFrozenSeason(season, currentSeason) ? `Final roster from the ${season} season.` : null;
}
