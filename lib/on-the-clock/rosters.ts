/**
 * On The Clock per-team roster + power-ranking rollup (Rosters & Rankings tab).
 *
 * Pure, browser-safe, deterministic. NOTHING here touches Sleeper, Supabase, or
 * fetch. It turns the data the cockpit already holds (made picks, rosters, the
 * normalized traded_picks, and the FF Beacon board) into one rollup per team:
 *   - drafted players grouped by position (QB/RB/WR/TE), valued from the board,
 *   - the future draft picks the team currently owns, valued by board projection,
 *   - a power-ranking total = drafted player value + future pick value.
 *
 * Future-pick ownership mirrors the League Pulse pipeline (lib/league-pulse.ts
 * buildBaselinePicks): every team starts owning one pick per round for the next
 * few seasons, and the league's traded_picks then mutates the current owner. We
 * only keep FUTURE seasons here (draftSeason + 1 and beyond); the current draft's
 * own picks are never counted as "future".
 *
 * Pick VALUES reuse the Trade Analyzer's board projection (bucketSlot +
 * futureDiscount), keeping On The Clock's force-FF-Beacon posture: no KTC pick
 * values, no DB round trip. Pick values are therefore estimates.
 */

import type { RankedPlayer } from "./board-types";
import type { ShapedPick, ShapedRoster } from "./types";
import type { TradedPickRecord } from "./pick-ownership";
import { bucketSlot, futureDiscount, FALLBACK_PICK_VALUE } from "./trade-analyzer";

/** The four valued positions the rollup groups drafted players into. */
export const ROSTER_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export type RosterPosition = (typeof ROSTER_POSITIONS)[number];

/** Default future horizon, matching the League Pulse baseline (next 3 seasons,
 * 4 rounds each). Documented here so they are never hidden magic numbers. */
const DEFAULT_FUTURE_SEASONS = 3;
const DEFAULT_FUTURE_ROUNDS = 4;

/** One drafted player on a team, valued from the FF Beacon board. */
export interface RosterPlayerLite {
  playerId: string | null;
  sleeperId: string | null;
  name: string;
  position: RosterPosition;
  team: string | null;
  value: number;
  /** Overall pick number it was taken at (stable key + ordering). */
  pickNo: number;
}

/** One future draft pick a team currently owns (estimated value). */
export interface RosterFuturePick {
  season: number;
  round: number;
  originalRosterId: number;
  /** True when the team still owns its own pick (not acquired via trade). */
  isOwn: boolean;
  /** Original owner's name when acquired via trade, else null. */
  viaTeamName: string | null;
  value: number;
}

/** A full per-team rollup, ranked by total FF Beacon value. */
export interface TeamRollup {
  rosterId: number;
  /** Primary label: the owner's Sleeper username / display name. */
  ownerName: string;
  /** Custom team name (metadata.team_name), shown subtly after the username.
   * null when the owner set none or it just echoes the username. */
  teamName: string | null;
  isYou: boolean;
  players: Record<RosterPosition, RosterPlayerLite[]>;
  positionTotals: Record<RosterPosition, number>;
  playersValue: number;
  playerCount: number;
  futurePicks: RosterFuturePick[];
  futurePicksValue: number;
  totalValue: number;
  /** 1-based power ranking (1 = highest total value). */
  rank: number;
}

export interface TeamRollupInput {
  rosters: ShapedRoster[];
  /** Made picks in the current draft (drafted players). */
  picks: ShapedPick[];
  /** Normalized traded picks (mutates future-pick ownership). */
  tradedPicks: TradedPickRecord[];
  /** FULL FF Beacon board for player + pick valuation. */
  valueBoard: RankedPlayer[];
  /** roster_id -> owner username / display name (the primary label + pick "via"). */
  ownerNameByRosterId: Record<number, string>;
  /** roster_id -> custom team name (metadata.team_name), the subtle label. Optional. */
  teamNameByRosterId?: Record<number, string | null>;
  /** Connected user's roster id, for the "You" highlight. null when undetected. */
  myRosterId: number | null;
  /** Sleeper draft settings (teams). */
  draftSettings: Record<string, number>;
  /** The current draft's season; futures are draftSeason + 1 and beyond. */
  draftSeason: number;
  futureSeasonCount?: number;
  futureRounds?: number;
}

function coercePosition(pos: string | null | undefined): RosterPosition | null {
  const p = (pos ?? "").toUpperCase();
  if (p === "QB" || p === "RB" || p === "WR" || p === "TE") return p;
  return null;
}

/**
 * Build one ranked rollup per team. Returns rollups sorted by total value desc
 * with `rank` assigned. An empty board yields token pick values but still ranks.
 */
export function buildTeamRollups(input: TeamRollupInput): TeamRollup[] {
  const {
    rosters,
    picks,
    tradedPicks,
    valueBoard,
    ownerNameByRosterId,
    teamNameByRosterId,
    myRosterId,
    draftSettings,
    draftSeason,
  } = input;

  const teams =
    Number.isFinite(draftSettings.teams) && draftSettings.teams > 0 ? draftSettings.teams : 12;
  const futureSeasonCount = input.futureSeasonCount ?? DEFAULT_FUTURE_SEASONS;
  const futureRounds = input.futureRounds ?? DEFAULT_FUTURE_ROUNDS;

  // Player value lookups from the FF Beacon board (by player id, then sleeper id).
  const valByPlayerId = new Map<string, number>();
  const valBySleeperId = new Map<string, number>();
  for (const p of valueBoard) {
    valByPlayerId.set(p.playerId, p.value);
    if (p.sleeperId) valBySleeperId.set(p.sleeperId, p.value);
  }
  const playerValue = (playerId: string | null, sleeperId: string | null): number => {
    if (playerId && valByPlayerId.has(playerId)) return valByPlayerId.get(playerId)!;
    if (sleeperId && valBySleeperId.has(sleeperId)) return valBySleeperId.get(sleeperId)!;
    return 0;
  };

  // Board sorted by value desc, for future-pick projection (mid bucket per round).
  const boardDesc = valueBoard
    .slice()
    .sort((a, b) => b.value - a.value || a.overallRank - b.overallRank);
  const projectPickValue = (round: number, yearsAhead: number): number => {
    if (boardDesc.length === 0) return FALLBACK_PICK_VALUE;
    const idx = (round - 1) * teams + bucketSlot("mid", teams) - 1;
    const clamped = Math.min(Math.max(0, idx), boardDesc.length - 1);
    const base = boardDesc[clamped]?.value ?? FALLBACK_PICK_VALUE;
    return Math.round(base * futureDiscount(yearsAhead));
  };

  // Future-pick ownership baseline: each team owns its own pick per round per
  // future season; traded_picks then moves the current owner. Mirrors League
  // Pulse buildBaselinePicks, restricted to FUTURE seasons.
  const futureOwner = new Map<
    string,
    { season: number; round: number; original: number; current: number }
  >();
  for (let s = 1; s <= futureSeasonCount; s++) {
    const season = draftSeason + s;
    for (let round = 1; round <= futureRounds; round++) {
      for (const r of rosters) {
        futureOwner.set(`${season}|${round}|${r.rosterId}`, {
          season,
          round,
          original: r.rosterId,
          current: r.rosterId,
        });
      }
    }
  }
  for (const t of tradedPicks) {
    if (t.season <= draftSeason) continue; // futures only
    const entry = futureOwner.get(`${t.season}|${t.round}|${t.originalRosterId}`);
    // Only mutate picks inside our baseline horizon; deep-future trades are ignored
    // so the view stays bounded (rare, and would have no baseline to value against).
    if (entry) entry.current = t.currentOwnerRosterId;
  }

  // Drafted players grouped by the roster that made the pick (owns the player).
  const playersByRoster = new Map<number, RosterPlayerLite[]>();
  for (const pk of picks) {
    if (pk.rosterId == null) continue;
    const position = coercePosition(pk.position);
    if (!position) continue; // only valued positions QB/RB/WR/TE
    const name = `${pk.firstName ?? ""} ${pk.lastName ?? ""}`.trim() || "Unknown player";
    const arr = playersByRoster.get(pk.rosterId) ?? [];
    arr.push({
      playerId: pk.playerId,
      sleeperId: pk.sleeperPlayerId,
      name,
      position,
      team: pk.team,
      value: playerValue(pk.playerId, pk.sleeperPlayerId),
      pickNo: pk.pickNo,
    });
    playersByRoster.set(pk.rosterId, arr);
  }

  // Future picks grouped by current owner.
  const picksByOwner = new Map<number, RosterFuturePick[]>();
  for (const fp of futureOwner.values()) {
    const yearsAhead = fp.season - draftSeason;
    const isOwn = fp.original === fp.current;
    const arr = picksByOwner.get(fp.current) ?? [];
    arr.push({
      season: fp.season,
      round: fp.round,
      originalRosterId: fp.original,
      isOwn,
      viaTeamName: isOwn ? null : ownerNameByRosterId[fp.original] ?? `Team ${fp.original}`,
      value: projectPickValue(fp.round, yearsAhead),
    });
    picksByOwner.set(fp.current, arr);
  }

  const rollups: TeamRollup[] = rosters.map((r) => {
    const rid = r.rosterId;
    const players: Record<RosterPosition, RosterPlayerLite[]> = { QB: [], RB: [], WR: [], TE: [] };
    for (const pl of playersByRoster.get(rid) ?? []) players[pl.position].push(pl);

    const positionTotals: Record<RosterPosition, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
    let playersValue = 0;
    let playerCount = 0;
    for (const pos of ROSTER_POSITIONS) {
      players[pos].sort((a, b) => b.value - a.value || a.pickNo - b.pickNo);
      const sum = players[pos].reduce((s, p) => s + p.value, 0);
      positionTotals[pos] = sum;
      playersValue += sum;
      playerCount += players[pos].length;
    }

    const futurePicks = (picksByOwner.get(rid) ?? [])
      .slice()
      .sort(
        (a, b) =>
          a.season - b.season || a.round - b.round || a.originalRosterId - b.originalRosterId,
      );
    const futurePicksValue = futurePicks.reduce((s, p) => s + p.value, 0);

    const ownerName = ownerNameByRosterId[rid] ?? `Team ${rid}`;
    const rawTeamName = teamNameByRosterId?.[rid] ?? null;
    // Suppress the custom team name when it just echoes the username (so leagues
    // with no custom team name don't show the same text twice).
    const teamName =
      rawTeamName && rawTeamName.toLowerCase() !== ownerName.toLowerCase() ? rawTeamName : null;

    return {
      rosterId: rid,
      ownerName,
      teamName,
      isYou: myRosterId != null && rid === myRosterId,
      players,
      positionTotals,
      playersValue,
      playerCount,
      futurePicks,
      futurePicksValue,
      totalValue: playersValue + futurePicksValue,
      rank: 0,
    };
  });

  rollups.sort((a, b) => b.totalValue - a.totalValue || b.playersValue - a.playersValue);
  rollups.forEach((r, i) => (r.rank = i + 1));
  return rollups;
}
