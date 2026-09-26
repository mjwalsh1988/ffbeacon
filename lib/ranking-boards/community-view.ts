/**
 * Pure helpers for the community rankings page (app/rankings/community) and
 * the links into it. No reads, no clock: the page passes rows in and gets
 * words and decisions back, so the wording and the publish decision can be
 * tested without a database.
 */

export type Movement =
  | { kind: "new"; places: 0; words: "new" }
  | { kind: "same"; places: 0; words: "same" }
  | { kind: "up" | "down"; places: number; words: string };

/**
 * Movement since the last rebuild. `previous_rank` minus `overall_rank`: a
 * player who was 9th and is now 6th moved up 3. No previous rank means he was
 * not listed last time, which is "new", never a zero.
 */
export function communityMovement(
  previousRank: number | null | undefined,
  overallRank: number,
): Movement {
  if (previousRank === null || previousRank === undefined) {
    return { kind: "new", places: 0, words: "new" };
  }
  const change = previousRank - overallRank;
  if (change === 0) return { kind: "same", places: 0, words: "same" };
  const places = Math.abs(change);
  return change > 0
    ? { kind: "up", places, words: `up ${places}` }
    : { kind: "down", places, words: `down ${places}` };
}

/** 1 -> "1st", 12 -> "12th", 22 -> "22nd". */
export function ordinalRank(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** "Community rank: 14th, on 38 boards". */
export function communityRankLine(overallRank: number, boardsCount: number): string {
  return `Community rank: ${ordinalRank(overallRank)}, on ${boardsCount} ${
    boardsCount === 1 ? "board" : "boards"
  }`;
}

export type CommunityFormatRow = {
  eligible_boards: number;
  /** Distinct accounts behind the counted boards. The publish threshold. */
  eligible_accounts: number;
  published: boolean;
  players_listed: number;
  groups: string[];
  built_at: string;
};

export type CommunityPageState =
  | { kind: "published"; boards: number; playersListed: number; groups: string[] }
  | { kind: "building"; boards: number; people: number; needed: number };

/**
 * Whether the page shows players. The nightly build's `published` flag is the
 * decision; the threshold only supplies the "N of M" wording for a format
 * that has not got there. The threshold counts PEOPLE (distinct accounts),
 * not boards, so "needed" is a number of people. A format with no row at all
 * has had no build yet and reads as zero boards from zero people.
 */
export function communityPageState(
  row: CommunityFormatRow | null,
  minBoardsToPublish: number,
): CommunityPageState {
  if (row && row.published) {
    return {
      kind: "published",
      boards: row.eligible_boards,
      playersListed: row.players_listed,
      groups: row.groups.length > 0 ? row.groups : ["all"],
    };
  }
  const boards = row?.eligible_boards ?? 0;
  const people = row?.eligible_accounts ?? 0;
  return { kind: "building", boards, people, needed: Math.max(minBoardsToPublish, people + 1) };
}

/** Heading for one connected group of the fit. */
export function communityGroupHeading(groupKey: string): string {
  switch (groupKey) {
    case "offense":
      return "Offense";
    case "defense":
      return "Defense";
    case "all":
      return "All players";
    default:
      return groupKey.charAt(0).toUpperCase() + groupKey.slice(1).replace(/[-_]/g, " ");
  }
}

/** Order for groups on the page: offense before defense, anything else after. */
export function sortCommunityGroups(groups: string[]): string[] {
  const weight = (g: string) => (g === "all" ? 0 : g === "offense" ? 1 : g === "defense" ? 2 : 3);
  return [...groups].sort((a, b) => weight(a) - weight(b) || a.localeCompare(b));
}

/**
 * Width of the decorative strength bar, 0 to 100, scaled between the weakest
 * and strongest listed player in the same group. A group of one fills the bar.
 */
export function strengthPercent(strength: number, min: number, max: number): number {
  if (!Number.isFinite(strength) || max <= min) return 100;
  const pct = ((strength - min) / (max - min)) * 100;
  // A small floor so the weakest listed player still shows a sliver.
  return Math.round(Math.min(100, Math.max(4, pct)));
}
