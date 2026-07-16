import type { Position } from "@/lib/site";
import { POSITIONS } from "@/lib/site";

/**
 * Shared types and helpers for user-authored ranking boards (the My Beacon
 * "My Rankings" area). These boards are the user's own manual ordering of
 * players, so they carry no data source or scoring format dependency.
 */

/** A board either ranks every eligible player ("overall") or is scoped to a
 * single fantasy position. */
export type BoardScope = "overall" | Position;

export const BOARD_SCOPES: readonly BoardScope[] = [
  "overall",
  ...POSITIONS,
] as const;

/** The fantasy positions a player can be added under. We restrict boards to
 * these so users rank fantasy-relevant players, not offensive linemen, etc.
 * Mirrors lib/site.ts POSITIONS. */
export const ELIGIBLE_POSITIONS: readonly Position[] = POSITIONS;

export function isBoardScope(value: string): value is BoardScope {
  return (BOARD_SCOPES as readonly string[]).includes(value);
}

/** Human-readable label for a board scope, used in headings and chips. */
export function scopeLabel(scope: BoardScope): string {
  if (scope === "overall") return "Overall";
  return scope;
}

/** Longer descriptor for the scope, used in board cards and aria text. */
export function scopeDescription(scope: BoardScope): string {
  if (scope === "overall") return "Ranks every eligible active player.";
  return `Ranks ${scope} players only.`;
}

/** Default label for a tier when the user hasn't set a custom one. */
export function tierLabel(
  tierLabels: Record<string, string> | null | undefined,
  tier: number,
): string {
  const custom = tierLabels?.[String(tier)];
  if (custom && custom.trim().length > 0) return custom.trim();
  return `Tier ${tier}`;
}

/** A player row as shown inside a board editor. */
export type BoardPlayer = {
  /** user_ranking_board_players.id (null only for an optimistic, not-yet-saved row). */
  rowId: string | null;
  playerId: string;
  slug: string;
  name: string;
  position: string;
  team: string | null;
  sleeperId: string | null;
  /** Null when the player sits in "no tier" (or tiers are disabled). */
  tier: number | null;
};

/**
 * The order a board renders in, which is also the order it must persist in.
 *
 * With tiers on, that is the tier traversal (tier 1..tierCount, then the
 * "No tier" bucket), which can differ from the raw array order because
 * assigning a tier appends the player to the end of the array. With tiers off
 * the array order already is the display order.
 *
 * The result is total: every input player appears exactly once. A player
 * carrying a tier above tierCount (reachable only from a stale persisted row)
 * is treated as untiered rather than dropped, so a board can never silently
 * lose a player it still stores.
 */
export function orderBoardForDisplay(
  players: readonly BoardPlayer[],
  tiersEnabled: boolean,
  tierCount: number,
): BoardPlayer[] {
  if (!tiersEnabled) return [...players];
  const ordered: BoardPlayer[] = [];
  for (let tier = 1; tier <= tierCount; tier += 1) {
    ordered.push(...players.filter((p) => p.tier === tier));
  }
  ordered.push(...players.filter((p) => isUntiered(p.tier, tierCount)));
  return ordered;
}

/** True when a player belongs in the trailing "No tier" bucket: either they
 * carry no tier, or their tier no longer exists on the board. */
export function isUntiered(
  tier: number | null,
  tierCount: number,
): boolean {
  return tier == null || tier > tierCount;
}

/** Where a player sits in a board, both overall and within their position. */
export type BoardRank = {
  /** 1-based slot in the board's full display order. */
  overall: number;
  /** 1-based slot among only the players who share this player's position. */
  positionRank: number;
};

/**
 * Rank every player by their slot in the board's display order and by their
 * slot among same-position players, keyed by player id.
 *
 * Callers must pass the list in the order the board actually renders it (tier
 * groups flattened, when tiers are on) so the numbers match what the reader
 * sees. Positional ranks are derived from that same order, which is what lets
 * an "overall" board double as every positional board without the user
 * maintaining a separate one.
 */
export function computeBoardRanks(
  orderedPlayers: readonly BoardPlayer[],
): Map<string, BoardRank> {
  const ranks = new Map<string, BoardRank>();
  const seenByPosition = new Map<string, number>();
  orderedPlayers.forEach((player, index) => {
    const positionRank = (seenByPosition.get(player.position) ?? 0) + 1;
    seenByPosition.set(player.position, positionRank);
    ranks.set(player.playerId, { overall: index + 1, positionRank });
  });
  return ranks;
}

/** A player returned by the add-player search endpoint. */
export type SearchablePlayer = {
  playerId: string;
  slug: string;
  name: string;
  position: string;
  team: string | null;
  sleeperId: string | null;
};

/** A player returned by the rankings-import endpoint. Same shape as a
 * searchable player plus the source's published tier (null when the source
 * doesn't tier that player), used to seed the board's tiers on import. */
export type ImportedRankingPlayer = SearchablePlayer & {
  tier: number | null;
};

/** Pull a usable Sleeper id (string) out of players.external_ids.sleeper,
 * which may be a string, number, or absent. */
export function readSleeperId(
  externalIds: Record<string, unknown> | null | undefined,
): string | null {
  const raw = externalIds?.sleeper;
  if (typeof raw === "string" && raw.length > 0) return raw;
  if (typeof raw === "number") return String(raw);
  return null;
}

export const MAX_BOARD_NAME_LENGTH = 80;
export const MAX_TIERS = 30;
