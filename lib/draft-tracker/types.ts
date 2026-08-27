/**
 * Shared shapes for the Draft Tracker.
 *
 * The Draft Tracker is the manual draft board: a list of every drafted-eligible
 * player for one format, which the user crosses off by hand as a draft happens
 * somewhere we cannot see it. In person, or on a platform we do not sync with.
 *
 * Nothing in this file touches Supabase, Sleeper, or the network, so it is safe
 * on both sides of the server-client boundary.
 */

import type { PositionColorKey } from "@/lib/on-the-clock/position-colors";

/** How the board is ordered. Stored on the tracker row. */
export type DraftOrder = "value" | "adp" | "alphabetical";

/** Whether the user is tracking only their own roster or the whole room. */
export type TrackingMode = "mine" | "all";

/** A tracker is either in progress or put away. */
export type TrackerStatus = "active" | "complete";

/**
 * The six positions a fantasy draft actually picks from.
 *
 * Deliberately an alias rather than a second union. lib/on-the-clock/position-colors
 * already keys its badge classes on exactly these six, and two components here
 * index those classes by this type; a parallel definition would let the two
 * drift and produce an undefined class name at runtime.
 */
export type BoardPosition = PositionColorKey;

export const BOARD_POSITIONS: BoardPosition[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

/** The smallest and largest room the tracker will set up. */
export const MIN_TEAMS = 2;
export const MAX_TEAMS = 32;

/**
 * The longest a team name may be. Long enough for a full name, short enough
 * that the teams grid stays readable at a phone's width.
 */
export const MAX_TEAM_NAME_LENGTH = 40;

/**
 * How many saved drafts one account may keep. High enough that nobody meets it
 * in normal use (a heavy drafter runs a dozen a year), low enough that a script
 * cannot fill the table. Old drafts are deleted from the list page.
 *
 * Enforced by a trigger in migration 0220, not only here: a signed-in reader can
 * write to PostgREST directly, so a limit that lives solely in the server action
 * is not a limit.
 */
export const MAX_TRACKERS_PER_USER = 25;

/**
 * One draftable player on the board.
 *
 * Every field on this row is rendered somewhere. The row crosses to the browser
 * roughly 800 times per board, so a field nobody reads is 800 copies of nothing.
 */
export type TrackerPlayer = {
  playerId: string;
  sleeperId: string | null;
  /** Display name, first then last. */
  name: string;
  /**
   * Lowercased "last first", used only for the A to Z ordering. Precomputed on
   * the server so the browser never re-splits a name on every sort.
   */
  sortName: string;
  position: BoardPosition;
  team: string | null;
  overallRank: number;
  positionRank: number;
  tier: number | null;
  /** Player value from the resolved source, or null when the source has none. */
  value: number | null;
  /** Sleeper ADP for this format's market, or null when the market has no entry. */
  adp: number | null;
};

/** What the board loader returns. */
export type DraftTrackerBoard = {
  status: "ok" | "no-rankings";
  players: TrackerPlayer[];
  formatSlug: string;
  formatLabel: string;
  /** The resolved value/rankings source. */
  sourceSlug: string;
  sourceLabel: string;
  /** The Sleeper ADP market key this format was graded against, or null. */
  adpKey: string | null;
  /** The ADP snapshot date (YYYY-MM-DD), or null when no market was found. */
  adpDate: string | null;
};

/** One recorded pick. `teamSlot` null means "gone, owner not tracked". */
export type TrackerPick = {
  playerId: string;
  teamSlot: number | null;
  createdAt: string;
};

/** A saved draft, already joined to its format. */
export type DraftTracker = {
  id: string;
  name: string;
  formatConfigId: string;
  formatSlug: string;
  formatLabel: string;
  orderBy: DraftOrder;
  trackingMode: TrackingMode;
  teamCount: number;
  myTeamSlot: number;
  /** Index = team slot. A blank or missing entry reads as "Team N". */
  teamNames: string[];
  status: TrackerStatus;
  createdAt: string;
  updatedAt: string;
};

/** A tracker plus enough counts for the list page to describe it. */
export type DraftTrackerSummary = DraftTracker & {
  pickCount: number;
  myPickCount: number;
};
