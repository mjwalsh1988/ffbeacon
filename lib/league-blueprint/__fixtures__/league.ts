/**
 * A 12-team league built from plain objects for the Team Blueprint tests
 * (plan section 16). Roster 1 is the reader: deep at wide receiver, thin at
 * running back. Every other roster is a balanced middle team whose quality
 * steps down with its roster id.
 */

import type { FinderPick, FinderPlayer, FinderTeam } from "@/lib/trade-finder/types";

export const SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX"];

let seq = 0;
export function player(
  rosterId: number,
  position: string,
  value: number,
  projPoints: number | null,
  age: number | null = 26,
  over: Partial<FinderPlayer> = {},
): FinderPlayer {
  seq += 1;
  return {
    playerId: `r${rosterId}-${position}-${seq}`,
    sleeperId: String(10_000 + seq),
    name: `${position} ${rosterId}.${seq}`,
    position,
    team: "KC",
    value,
    hasValue: value > 0,
    age,
    projPoints,
    isInactive: false,
    ...over,
  };
}

export function pick(rosterId: number, season: number, round: number, value: number): FinderPick {
  return {
    key: `pick:${season}:${round}:${rosterId}`,
    season,
    round,
    pickPosition: "mid",
    originalRosterId: rosterId,
    isOwnPick: true,
    originalOwnerHandle: `owner${rosterId}`,
    originalTeamName: `Team ${rosterId}`,
    positionEstimated: true,
    label: `${season} R${round}, mid`,
    value,
    hasValue: value > 0,
  };
}

function team(rosterId: number, players: FinderPlayer[], picks: FinderPick[]): FinderTeam {
  return {
    rosterId,
    teamName: `Team ${rosterId}`,
    ownerHandle: `owner${rosterId}`,
    statusKey: rosterId <= 4 ? "competitor" : rosterId >= 10 ? "rebuilder" : "middle",
    statusLabel: null,
    pulseRank: rosterId,
    valueRank: rosterId,
    pulse: null,
    players,
    picks,
  };
}

export function buildLeague(): FinderTeam[] {
  seq = 0;
  const teams: FinderTeam[] = [];
  // The reader: strong wide receivers, two weak backs, a solid QB and TE.
  teams.push(
    team(
      1,
      [
        player(1, "QB", 6000, 22, 28),
        player(1, "RB", 1200, 7, 29),
        player(1, "RB", 900, 6, 30),
        player(1, "WR", 8000, 19, 24),
        player(1, "WR", 7000, 17, 25),
        player(1, "WR", 6500, 16, 23),
        player(1, "WR", 5000, 14, 31),
        player(1, "TE", 4000, 11, 27),
        player(1, "TE", 300, 3, 33),
      ],
      [pick(1, 2027, 1, 3000), pick(1, 2027, 2, 1200), pick(1, 2028, 1, 2800)],
    ),
  );
  for (let r = 2; r <= 12; r += 1) {
    const step = (13 - r) * 100;
    teams.push(
      team(
        r,
        [
          player(r, "QB", 3000 + step, 17 + r * 0.1),
          player(r, "RB", 4000 + step, 13),
          player(r, "RB", 3500 + step, 12),
          player(r, "RB", 3000 + step, 11.5),
          player(r, "WR", 3500 + step, 12),
          player(r, "WR", 3000 + step, 11),
          player(r, "WR", 2500, 9),
          player(r, "TE", 2500 + step, 8),
        ],
        [pick(r, 2027, 1, 3000), pick(r, 2028, 1, 2800)],
      ),
    );
  }
  return teams;
}

/** TeamCardData for every fixture team, consistent with the finder teams. */
export function buildCards(teams: FinderTeam[]): import("@/lib/league-view-data").TeamCardData[] {
  const totals = teams.map((t) => ({
    rosterId: t.rosterId,
    total: t.players.reduce((s, p) => s + p.value, 0) + t.picks.reduce((s, p) => s + p.value, 0),
  }));
  const rankOf = (rows: Array<{ rosterId: number; v: number }>, id: number) =>
    [...rows].sort((a, b) => b.v - a.v || a.rosterId - b.rosterId).findIndex((r) => r.rosterId === id) + 1;
  const posValue = (t: FinderTeam, pos: string) =>
    t.players.filter((p) => p.position === pos).reduce((s, p) => s + p.value, 0);
  const positionRankOf = new Map<string, number>();
  for (const pos of ["QB", "RB", "WR", "TE"]) {
    teams
      .flatMap((t) => t.players.filter((p) => p.position === pos))
      .sort((a, b) => b.value - a.value)
      .forEach((p, i) => positionRankOf.set(p.playerId, i + 1));
  }
  return teams.map((t) => {
    const starter = t.players.slice(0, 7).reduce((s, p) => s + p.value, 0);
    const bench = t.players.slice(7).reduce((s, p) => s + p.value, 0);
    const picks = t.picks.reduce((s, p) => s + p.value, 0);
    const ranks = (pos: string) =>
      rankOf(teams.map((x) => ({ rosterId: x.rosterId, v: posValue(x, pos) })), t.rosterId);
    return {
      rosterRowId: `row-${t.rosterId}`,
      sleeperRosterId: t.rosterId,
      teamName: t.teamName,
      ownerSleeperUsername: t.ownerHandle,
      ownerSleeperUserId: null,
      coOwnerIds: [],
      ownerDisplayName: t.ownerHandle,
      ownerAvatarId: null,
      record: { wins: 5, losses: 3, ties: 0, pointsFor: 900 + t.rosterId },
      cacheRow: {
        starter_value: starter,
        bench_value: bench,
        picks_value: picks,
        total_value: starter + bench + picks,
        overall_rank: rankOf(totals.map((x) => ({ rosterId: x.rosterId, v: x.total })), t.rosterId),
        starter_rank: null,
        positional_breakdowns: {},
      },
      players: t.players.map((p) => ({
        id: p.playerId,
        sleeper_id: p.sleeperId!,
        full_name: p.name,
        position: p.position,
        team: p.team,
        age: p.age === null ? null : Math.floor(p.age),
        years_experience: 4,
      })),
      trends: {},
      playerPositionRanks: Object.fromEntries(
        t.players.map((p) => [p.playerId, positionRankOf.get(p.playerId) ?? 99]),
      ),
      draftPicks: [],
      starterIds: t.players.slice(0, 7).map((p) => p.playerId),
      rosterIdToTeamName: {},
      rosterIdToOwnerUsername: {},
      positionValues: { QB: posValue(t, "QB"), RB: posValue(t, "RB"), WR: posValue(t, "WR"), TE: posValue(t, "TE") },
      positionRanks: { QB: ranks("QB"), RB: ranks("RB"), WR: ranks("WR"), TE: ranks("TE") },
      teamCount: teams.length,
      includePicks: true,
      displayTotalValue: starter + bench + picks,
      displayOverallRank: rankOf(totals.map((x) => ({ rosterId: x.rosterId, v: x.total })), t.rosterId),
      statRanks: {
        starter: null,
        bench: rankOf(teams.map((x) => ({ rosterId: x.rosterId, v: x.players.slice(7).reduce((s, p) => s + p.value, 0) })), t.rosterId),
        picks: rankOf(teams.map((x) => ({ rosterId: x.rosterId, v: x.picks.reduce((s, p) => s + p.value, 0) })), t.rosterId),
        total: null,
      },
    };
  });
}
