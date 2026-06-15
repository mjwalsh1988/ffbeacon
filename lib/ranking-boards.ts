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

/** A player returned by the add-player search endpoint. */
export type SearchablePlayer = {
  playerId: string;
  slug: string;
  name: string;
  position: string;
  team: string | null;
  sleeperId: string | null;
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
