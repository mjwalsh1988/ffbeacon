/**
 * Fixture builders for the Trade Finder tests.
 *
 * A league is a lot of nested plain data, and a test that spells all of it out
 * says more about object shapes than about the behaviour under test. These
 * builders take the two or three fields a given test actually cares about and
 * fill the rest with something ordinary, so each test reads as the scenario it
 * is describing.
 *
 * Values are on a KTC-like scale (a league-winning player sits near 8000) so the
 * ratios the engine works in behave the way they do in production.
 */

import type { FinderPick, FinderPlayer, FinderTeam } from "./types";
import { teamStatusWords, type TeamStatusKey } from "@/lib/league-team-status";

let counter = 0;

export function player(overrides: Partial<FinderPlayer> = {}): FinderPlayer {
  counter += 1;
  const value = overrides.value ?? 2000;
  return {
    playerId: overrides.playerId ?? `player-${counter}`,
    sleeperId: overrides.sleeperId ?? String(1000 + counter),
    name: overrides.name ?? `Player ${counter}`,
    position: overrides.position ?? "WR",
    team: overrides.team ?? "BUF",
    value,
    hasValue: overrides.hasValue ?? value > 0,
    age: overrides.age ?? 25,
    // Points roughly track value so a fixture without an explicit projection
    // still produces a lineup that makes sense.
    projPoints: overrides.projPoints === undefined ? value / 200 : overrides.projPoints,
    isInactive: overrides.isInactive ?? false,
  };
}

export function pick(overrides: Partial<FinderPick> = {}): FinderPick {
  const season = overrides.season ?? 2027;
  const round = overrides.round ?? 1;
  const value = overrides.value ?? 3000;
  // Defaults to somebody else's pick rather than an own one, because that is
  // the case with more moving parts: an own pick has no handle to render and no
  // second copy to be told apart from.
  const originalRosterId = overrides.originalRosterId ?? 9;
  return {
    key: overrides.key ?? `pick:${season}:${round}:${originalRosterId}`,
    season,
    round,
    pickPosition: overrides.pickPosition ?? "mid",
    originalRosterId,
    isOwnPick: overrides.isOwnPick ?? false,
    originalOwnerHandle: overrides.originalOwnerHandle ?? `manager${originalRosterId}`,
    originalTeamName: overrides.originalTeamName ?? `Team ${originalRosterId}`,
    positionEstimated: overrides.positionEstimated ?? true,
    label: overrides.label ?? `${season} round ${round}`,
    value,
    hasValue: overrides.hasValue ?? value > 0,
  };
}

export function team(overrides: Partial<FinderTeam> = {}): FinderTeam {
  counter += 1;
  const status: TeamStatusKey | null = overrides.statusKey ?? null;
  return {
    rosterId: overrides.rosterId ?? counter,
    teamName: overrides.teamName ?? `Team ${counter}`,
    ownerHandle: overrides.ownerHandle ?? `manager${counter}`,
    statusKey: status,
    // The prose form, matching lib/trade-finder-data.ts: every consumer puts
    // this after "a".
    statusLabel:
      overrides.statusLabel ??
      (status ? teamStatusWords(status).phrase : null),
    pulseRank: overrides.pulseRank ?? null,
    valueRank: overrides.valueRank ?? null,
    players: overrides.players ?? [],
    picks: overrides.picks ?? [],
  };
}

/** A standard one-QB lineup: QB, 2 RB, 2 WR, TE, FLEX. */
export const STANDARD_SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX"];

/** Superflex, where a second quarterback is a starting slot. */
export const SUPERFLEX_SLOTS = [
  "QB",
  "RB",
  "RB",
  "WR",
  "WR",
  "TE",
  "FLEX",
  "SUPER_FLEX",
];

/** A roster with one starter-quality player at each of the usual positions. */
export function fullRoster(scale = 1): FinderPlayer[] {
  return [
    player({ position: "QB", value: 3000 * scale }),
    player({ position: "RB", value: 2600 * scale }),
    player({ position: "RB", value: 2200 * scale }),
    player({ position: "WR", value: 2800 * scale }),
    player({ position: "WR", value: 2400 * scale }),
    player({ position: "TE", value: 1800 * scale }),
    player({ position: "WR", value: 1600 * scale }),
  ];
}

/** Reset the id counter so a test can assert on generated names. */
export function resetFixtureIds(): void {
  counter = 0;
}
