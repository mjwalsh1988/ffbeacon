/**
 * The player rows behind the Positional WAR dashboard.
 *
 * PURE. One function turns the stored curves plus three lookups (ownership,
 * trade value, the tier scale) into the rows the table renders, the scatter
 * plots, the chart reads back, and the CSV writes. ONE row shape for all four,
 * so the table and the scatterplot can never disagree about a player, and so
 * the whole dashboard is one payload rather than four overlapping ones.
 *
 * NOTHING HERE INVENTS A NUMBER. A player nobody rosters gets a null manager
 * and renders as a free agent; a player with no current value at the league's
 * resolved source gets a null trade value and is left off the scatterplot with
 * a stated count, never plotted at zero. Same rule the rest of League Pulse
 * follows: a missing figure changes the sentence rather than printing a
 * placeholder.
 *
 * WAR PER WEEK is season WAR divided by the weeks the player is actually
 * projected for, which is not the same as dividing by the window's length. A
 * player projected for nine of thirteen weeks (a bye, a return from injured
 * reserve, a rookie with no early role) earns his WAR in nine weeks, and
 * dividing by thirteen would understate how much he is worth in a week he
 * plays. Null when he has no projected week at all, which the engine already
 * excludes, so in practice the null branch is a guard rather than a case.
 */

import type { PlottableCurve, PulsePosition, WarCurvePoint } from "./types";
import { tierFor, type WarTier, type WarTierScale } from "./tiers";

/** Who owns a player, resolved from every roster in the league. */
export type WarOwner = {
  /** The Sleeper roster that holds him. */
  rosterId: number;
  /** The manager's Sleeper display name, or null when the roster has no owner. */
  manager: string | null;
};

/** One player, everywhere on the dashboard. */
export type WarTableRow = WarCurvePoint & {
  position: PulsePosition;
  tier: WarTier;
  /** Season WAR divided by the weeks he is projected for. Null when there are none. */
  warPerWeek: number | null;
  /** Null means no roster in this league holds him. */
  owner: WarOwner | null;
  /** True when the viewer's own roster holds him. */
  isYours: boolean;
  /**
   * Current trade value at the league's resolved format and value source.
   * Null when that source publishes none for him.
   */
  tradeValue: number | null;
};

/** One position's curve, with its rows. Assignable to PlottableCurve. */
export type WarDashboardPosition = Omit<PlottableCurve, "curve"> & {
  curve: WarTableRow[];
};

export type BuildWarRowsInput = {
  curves: readonly PlottableCurve[];
  /** The deepest position rank to include. The dashboard passes 36. */
  maxRank: number;
  scale: WarTierScale | null;
  /** Sleeper player id to owner. Built once from every roster in the league. */
  owners: ReadonlyMap<string, WarOwner>;
  /** FF Beacon player id to current value at the resolved format and source. */
  values: ReadonlyMap<string, number>;
  /** The viewer's own Sleeper roster id, when one resolved. */
  viewerRosterId: number | null;
};

/**
 * Build every dashboard row, position by position, capped at `maxRank`.
 *
 * The cap is applied here as well as in the chart geometry, and deliberately
 * with the same number, so the table under a chart lists exactly the players
 * the chart plots. A table that ran deeper would make the chart look like it
 * was hiding something; a shallower one would lose players off a curve the
 * reader can see.
 */
export function buildWarDashboardPositions(input: BuildWarRowsInput): WarDashboardPosition[] {
  const { curves, maxRank, scale, owners, values, viewerRosterId } = input;

  return curves.map((curve) => ({
    ...curve,
    curve: curve.curve
      .filter((point) => point.positionRank <= maxRank)
      .map((point) => {
        const owner = point.sleeperId ? (owners.get(point.sleeperId) ?? null) : null;
        return {
          ...point,
          position: curve.position,
          tier: tierFor(point, scale),
          warPerWeek: point.weeksProjected > 0 ? point.war / point.weeksProjected : null,
          owner,
          isYours: owner !== null && viewerRosterId !== null && owner.rosterId === viewerRosterId,
          tradeValue: values.get(point.playerId) ?? null,
        };
      }),
  }));
}

/** Every row across every position, flattened. */
export function flattenWarRows(positions: readonly WarDashboardPosition[]): WarTableRow[] {
  return positions.flatMap((p) => p.curve);
}

/**
 * What to show in the manager column.
 *
 * "Free agent" rather than a dash, because a dash reads as missing data and
 * this is a fact: nobody in this league holds him. A rostered player whose
 * roster carries no owner (an orphan team, which Sleeper allows) is named by
 * his roster number rather than left blank, for the same reason.
 */
export function ownerLabel(owner: WarOwner | null): string {
  if (!owner) return "Free agent";
  return owner.manager ?? `Team ${owner.rosterId}`;
}

/** Column keys the table can sort by. */
export type WarSortKey =
  | "war"
  | "pointsAboveReplacement"
  | "warPerWeek"
  | "projectedPointsPerWeek"
  | "tradeValue"
  | "positionRank";

export type WarSortDirection = "asc" | "desc";

/**
 * The sort value for one row on one column.
 *
 * A null (no trade value, no projected week) sorts to the BOTTOM in either
 * direction rather than to one end, because "we do not have this number" is
 * not a small number and it is not a large one. Returning null lets the
 * comparator below place it after every real value whichever way the column
 * is pointing.
 */
function sortValue(row: WarTableRow, key: WarSortKey): number | null {
  switch (key) {
    case "war":
      return row.war;
    case "pointsAboveReplacement":
      return row.pointsAboveReplacement;
    case "warPerWeek":
      return row.warPerWeek;
    case "projectedPointsPerWeek":
      return row.projectedPointsPerWeek;
    case "tradeValue":
      return row.tradeValue;
    case "positionRank":
      return row.positionRank;
  }
}

/**
 * Sort rows, total and stable.
 *
 * Ties fall to WAR descending and then to player id, so two rows that compare
 * equal on the chosen column keep one fixed order across renders rather than
 * shuffling when React re-runs the memo.
 */
export function sortWarRows(
  rows: readonly WarTableRow[],
  key: WarSortKey,
  direction: WarSortDirection,
): WarTableRow[] {
  const out = [...rows];
  out.sort((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    if (av === null && bv === null) {
      // fall through to the tiebreaks
    } else if (av === null) {
      return 1;
    } else if (bv === null) {
      return -1;
    } else if (av !== bv) {
      return direction === "asc" ? av - bv : bv - av;
    }
    if (b.war !== a.war) return b.war - a.war;
    return a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0;
  });
  return out;
}

/**
 * Filter by an active position set and a name search.
 *
 * The search is a plain case-insensitive substring on the player's name, which
 * is what a reader typing three letters of a surname expects. No fuzzy
 * matching: a search that quietly returns a player you did not ask for is
 * worse than one that returns nothing.
 */
export function filterWarRows(
  rows: readonly WarTableRow[],
  positions: ReadonlySet<PulsePosition>,
  search: string,
): WarTableRow[] {
  const query = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (!positions.has(row.position)) return false;
    if (query && !row.name.toLowerCase().includes(query)) return false;
    return true;
  });
}
