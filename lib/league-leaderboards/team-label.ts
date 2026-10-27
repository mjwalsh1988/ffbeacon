/**
 * How Leaderboards names a team: by the Sleeper handle of the manager who owns
 * it, not the team name.
 *
 * Team names are whatever a manager typed this week and change often, so "on
 * Taco Tuesday" in a screenshot means nothing a month later. The handle is the
 * stable name everyone in the league already knows. A roster with no owner (an
 * orphan) has no handle, so it falls back to its team name, which for an
 * ownerless roster is "Team N".
 *
 * Pure and client-safe: the page, the client points board and the share image
 * routes all read it, so a team is named the same way everywhere.
 */

import type { LeaderboardTeam } from "./types";

export function teamLabel(team: Pick<LeaderboardTeam, "ownerHandle" | "teamName">): string {
  const handle = team.ownerHandle?.trim();
  return handle ? handle : team.teamName;
}
