/**
 * Is there room on this roster, or does adding a player mean cutting one?
 *
 * Sleeper's roster `players` array carries every reserve and taxi id as well as
 * the active squad: checked against production on 2026-09-19, all 495 sampled
 * reserve ids and all 1,582 sampled taxi ids were inside it. Counting that array
 * against the length of `roster_positions` therefore told 19% of the rosters
 * holding an injured or taxi player that they had to cut somebody while an
 * active spot sat open, and the phantom cut was subtracted from the upgrade.
 *
 * So both sides of the comparison drop the players who cannot start and the
 * slots they sit in. IR and TAXI are not `roster_positions` tokens on Sleeper
 * (they are `settings.reserve_slots` and `settings.taxi_slots`), but they are
 * filtered anyway: another platform's league shape must not reintroduce the bug.
 */

export type RosterFullness = {
  playerSleeperIds: readonly string[];
  reserveSleeperIds: readonly string[];
  taxiSleeperIds: readonly string[];
};

const NON_ACTIVE_SLOTS = new Set(["IR", "TAXI"]);

/** Slots a player can occupy without being on injured reserve or the taxi squad. */
export function activeRosterLimit(rosterPositions: readonly string[]): number {
  return rosterPositions.filter((token) => !NON_ACTIVE_SLOTS.has(token.toUpperCase())).length;
}

/** Players held in an active spot: everyone except reserve and taxi. */
export function activePlayerCount(roster: RosterFullness): number {
  const parked = new Set([...roster.reserveSleeperIds, ...roster.taxiSleeperIds]);
  return roster.playerSleeperIds.filter((id) => !parked.has(id)).length;
}

/** True when adding one more player forces a cut. */
export function rosterIsFull(
  roster: RosterFullness,
  rosterPositions: readonly string[],
): boolean {
  const limit = activeRosterLimit(rosterPositions);
  if (limit <= 0) return false;
  return activePlayerCount(roster) >= limit;
}
