import type { IdpPosition, Position } from "@/lib/site";
import { IDP_POSITIONS, POSITIONS, isDefender, positionNoun } from "@/lib/site";

/**
 * Shared types and helpers for user-authored ranking boards (the My Beacon
 * "My Rankings" area, and Beacon Ranker at /tools/custom-rankings). A board is
 * the owner's own ordering of players. It remembers the format it was built
 * for and the source it was seeded from (migration 0304), which is what lets
 * the community rankings and the "vs FF Beacon" figure read it.
 */

/**
 * What a board ranks.
 *
 *   overall  every OFFENSIVE position. An overall board that also ranks
 *            defenders is still "overall", with `includesDefenders` set, so the
 *            community merge treats the two as one scope with a wider pool.
 *   QB..DEF  one offensive position (DEF is the team defense).
 *   DL/LB/DB one defensive position.
 *   defense  every individual defender.
 */
export type BoardScope = "overall" | Position | IdpPosition | "defense";

export const BOARD_SCOPES: readonly BoardScope[] = [
  "overall",
  ...POSITIONS,
  ...IDP_POSITIONS,
  "defense",
] as const;

/** The offensive positions, for the site's default player search pool. Boards
 * reach defenders through BOARD_POSITIONS, never by widening this, because
 * lib/player-search.ts reads it as the default pool for every surface. */
export const ELIGIBLE_POSITIONS: readonly Position[] = POSITIONS;

/** Every position a board can hold: the six offensive ones and DL, LB, DB. */
export const BOARD_POSITIONS: readonly string[] = [...POSITIONS, ...IDP_POSITIONS];

export function isBoardScope(value: string): value is BoardScope {
  return (BOARD_SCOPES as readonly string[]).includes(value);
}

/** True for a scope that ranks defenders only. */
export function isDefenderScope(scope: BoardScope): boolean {
  return scope === "defense" || isDefender(scope);
}

/** True for a scope that ranks exactly one position. */
export function isSinglePositionScope(scope: BoardScope): boolean {
  return scope !== "overall" && scope !== "defense";
}

/** The positions a board of this scope may hold. */
export function scopePositions(
  scope: BoardScope,
  includesDefenders = false,
): readonly string[] {
  if (scope === "overall") {
    return includesDefenders ? BOARD_POSITIONS : POSITIONS;
  }
  if (scope === "defense") return IDP_POSITIONS;
  return [scope];
}

/** Short label for a board scope, used in chips and headings. */
export function scopeLabel(scope: BoardScope, includesDefenders = false): string {
  if (scope === "overall") return includesDefenders ? "Overall with IDP" : "Overall";
  if (scope === "defense") return "All defenders";
  return scope;
}

/** A sentence describing the scope, used in board cards and aria text. The
 * position is spelled out, never "LB". */
export function scopeDescription(scope: BoardScope, includesDefenders = false): string {
  if (scope === "overall") {
    return includesDefenders
      ? "Ranks every offensive player and every defensive player."
      : "Ranks every offensive player.";
  }
  if (scope === "defense") {
    return "Ranks every defensive player: linemen, linebackers and defensive backs.";
  }
  return `Ranks ${positionNoun(scope, "plural")} only.`;
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

/** A player row as shown inside a board editor. The row's rank is its place
 * in the array; its tier is derived from the board's tier breaks. */
export type BoardPlayer = {
  /** user_ranking_board_players.id (null only for an optimistic, not-yet-saved row). */
  rowId: string | null;
  playerId: string;
  slug: string;
  name: string;
  position: string;
  team: string | null;
  sleeperId: string | null;
};

/* ------------------------------------------------------------------------
 * Tier breaks (plan section 7).
 *
 * A tier break is a line drawn AFTER a rank. Tiers are numbered from the top by
 * the lines: breaks [2, 10] on a 24 player board make ranks 1-2 tier 1, 3-10
 * tier 2 and 11-24 tier 3. A break stays at its rank when players move: the
 * line did not move, the players did. A break at or past the last rank has
 * nothing below it and is removed.
 * ---------------------------------------------------------------------- */

/** At most 29 lines, which is the old 30 tier maximum. */
export const MAX_TIER_BREAKS = 29;

/** Sorted, de-duplicated, whole, and strictly inside the board: every value r
 * satisfies 1 <= r < boardLength. `removed` lists the breaks that fell off the
 * end, so the caller can tell the reader. Garbage entries are dropped silently,
 * because they never described a line anyone saw. */
export function normalizeTierBreaks(
  breaks: readonly unknown[],
  boardLength: number,
): { breaks: number[]; removed: number[] } {
  const clean = new Set<number>();
  for (const value of breaks) {
    if (typeof value === "number" && Number.isInteger(value) && value >= 1) {
      clean.add(value);
    }
  }
  const sorted = [...clean].sort((a, b) => a - b);
  const kept: number[] = [];
  const removed: number[] = [];
  for (const rank of sorted) {
    if (rank < boardLength && kept.length < MAX_TIER_BREAKS) kept.push(rank);
    else removed.push(rank);
  }
  return { breaks: kept, removed };
}

/** The tier (1-based) of the player at `rank` (1-based). */
export function tierForRank(breaks: readonly number[], rank: number): number {
  let tier = 1;
  for (const b of breaks) {
    if (b < rank) tier += 1;
    else break;
  }
  return tier;
}

/** Every tier as a contiguous run of ranks, top down. A board with no players
 * has no tiers. */
export function tierRanges(
  breaks: readonly number[],
  boardLength: number,
): { tier: number; start: number; end: number }[] {
  if (boardLength <= 0) return [];
  const { breaks: clean } = normalizeTierBreaks(breaks, boardLength);
  const ranges: { tier: number; start: number; end: number }[] = [];
  let start = 1;
  clean.forEach((b, i) => {
    ranges.push({ tier: i + 1, start, end: b });
    start = b + 1;
  });
  ranges.push({ tier: clean.length + 1, start, end: boardLength });
  return ranges;
}

/** Draw a line after `rank`. A no-op when one is already there or the rank is
 * not strictly inside the board. */
export function addTierBreak(
  breaks: readonly number[],
  rank: number,
  boardLength: number,
): number[] {
  return normalizeTierBreaks([...breaks, rank], boardLength).breaks;
}

export function removeTierBreak(breaks: readonly number[], rank: number): number[] {
  return breaks.filter((b) => b !== rank);
}

/**
 * Move the line after `from` to sit after `to`. Refused (returns null) when
 * `to` is outside the board or already carries a line, so a move can never
 * silently merge two tiers.
 */
export function moveTierBreak(
  breaks: readonly number[],
  from: number,
  to: number,
  boardLength: number,
): number[] | null {
  if (!breaks.includes(from)) return null;
  if (!Number.isInteger(to) || to < 1 || to >= boardLength) return null;
  if (to === from) return [...breaks];
  if (breaks.includes(to)) return null;
  return normalizeTierBreaks(
    breaks.map((b) => (b === from ? to : b)),
    boardLength,
  ).breaks;
}

/**
 * Breaks from an ordered list of tier numbers (a source's published tiers, or
 * the per-row tiers of the old storage): a line wherever the tier changes
 * between two neighbours, the step into a null ("no tier") included.
 */
export function breaksFromTiers(tiers: readonly (number | null)[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < tiers.length; i += 1) {
    if (tiers[i] !== tiers[i - 1]) out.push(i);
  }
  return normalizeTierBreaks(out, tiers.length).breaks;
}

/** Where a player sits in a board, both overall and within their position. */
export type BoardRank = {
  /** 1-based slot in the board's order. */
  overall: number;
  /** 1-based slot among only the players who share this player's position. */
  positionRank: number;
};

/**
 * Rank every player by their slot in the board and by their slot among
 * same-position players, keyed by player id. Positional ranks are what let an
 * overall board double as every positional board without the owner keeping a
 * separate one.
 */
export function computeBoardRanks(
  orderedPlayers: readonly { playerId: string; position: string }[],
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
 * doesn't tier that player), used to draw the board's tier breaks on import. */
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

/** Sanity ceiling on how many players one board may hold. Shared by the editor
 * save, the import, the builder flush and the guest claim. */
export const MAX_BOARD_PLAYERS = 2000;

/** Top-N choices the owner can pick for a featured board's profile summary.
 * Shared between the client editor (rendering the select) and the server
 * action (validating the chosen value), so the two can never drift apart. */
export const PROFILE_TOP_N_CHOICES = [5, 10, 15, 20, 25, 50] as const;
export const PRIMARY_TOP_N_DEFAULT = 10;
export const SECONDARY_TOP_N_DEFAULT = 5;

/** A board's profile-display state, as read back for the boards manager and
 * returned by its server actions after a write. */
export type ProfileBoard = {
  id: string;
  name: string;
  scope: BoardScope;
  includesDefenders: boolean;
  playerCount: number;
  profileVisible: boolean;
  profileIsPrimary: boolean;
  profileSort: number;
  /** How many ranked players show in the board's profile summary. Null = the
   * default (10 primary / 5 secondary). */
  profileTopN: number | null;
};

/**
 * Tier labels are keyed by tier NUMBER, and drawing or removing a line
 * renumbers every tier below it. These keep each custom label on the tier it
 * was written for.
 *
 * Adding a line splits one tier in two: the top half keeps the label, the new
 * lower half starts unlabelled, and every tier below moves down one number.
 */
export function shiftLabelsForAddedBreak(
  labels: Record<string, string>,
  breaksBefore: readonly number[],
  addedAfterRank: number,
): Record<string, string> {
  // The new tier's number: one more than the tier the line was drawn inside.
  const newTier = tierForRank(breaksBefore, addedAfterRank) + 1;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    const n = Number(key);
    out[String(n >= newTier ? n + 1 : n)] = value;
  }
  return out;
}

/**
 * Removing a line merges the tier below it into the tier above. The upper
 * tier's label survives, the lower tier's label goes with its line, and every
 * tier further down moves up one number.
 */
export function shiftLabelsForRemovedBreak(
  labels: Record<string, string>,
  breaksBefore: readonly number[],
  removedRank: number,
): Record<string, string> {
  const index = breaksBefore.indexOf(removedRank);
  if (index < 0) return { ...labels };
  const mergedTier = index + 2;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    const n = Number(key);
    if (n === mergedTier) continue;
    out[String(n > mergedTier ? n - 1 : n)] = value;
  }
  return out;
}
