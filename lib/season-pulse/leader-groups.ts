/**
 * Leader lists read off the season board: who is getting the work, and who
 * has the yards and touchdowns. Pure.
 *
 * Every list comes from the same board the fantasy ranks do, so a player's
 * targets here and the points those targets became on the leaders board are
 * the same weeks of the same rows.
 *
 * RATE LISTS NEED A FLOOR. Target share and snap share are averages, and an
 * average over one game is an anecdote. A player is listed on a rate only
 * after playing at least half the completed weeks, the same floor the
 * per-game rank uses.
 */

import { PER_GAME_MIN_SHARE } from "./board";
import type { BoardPlayer, SeasonBoard, SeasonPosition, StatKey } from "./types";

export type LeaderRow = {
  id: string;
  slug: string;
  name: string;
  position: SeasonPosition;
  team: string | null;
  sleeperId: string | null;
  /** The figure, formatted. */
  value: string;
  /** The same figure as a number, for the bar. */
  amount: number;
  /** A short second figure, e.g. "8.3 a game". */
  detail?: string;
};

export type LeaderGroup = {
  key: string;
  /** The button and the list heading. */
  label: string;
  /** What the figure is, said after it: "targets", "rushing yards". */
  unit: string;
  /** One line under the heading saying what is counted. */
  note?: string;
  rows: LeaderRow[];
};

const grouped = (n: number) => Math.round(n).toLocaleString("en-US");

function toRow(p: BoardPlayer, amount: number, value: string, detail?: string): LeaderRow {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    position: p.position,
    team: p.team,
    sleeperId: p.sleeperId,
    value,
    amount,
    detail,
  };
}

function minGames(board: SeasonBoard): number {
  return Math.max(1, Math.ceil(Math.max(1, board.lastCompletedWeek) * PER_GAME_MIN_SHARE));
}

/** A counting stat: the season total, with the per-game figure beside it. */
function countGroup(
  board: SeasonBoard,
  key: string,
  label: string,
  unit: string,
  amountOf: (p: BoardPlayer) => number,
  size: number,
  positions?: readonly SeasonPosition[],
): LeaderGroup {
  const rows = board.players
    .filter((p) => !positions || positions.includes(p.position))
    .map((p) => ({ p, amount: amountOf(p) }))
    .filter((e) => e.amount > 0)
    .sort((a, b) => b.amount - a.amount || b.p.total - a.p.total)
    .slice(0, size)
    .map(({ p, amount }) =>
      toRow(p, amount, grouped(amount), p.games > 0 ? `${(amount / p.games).toFixed(1)} a game` : undefined),
    );
  return { key, label, unit, rows };
}

const stat = (key: StatKey) => (p: BoardPlayer) => p.stats[key] ?? 0;

/** Who is getting the work: targets, target share, carries, snap share. */
export function usageGroups(board: SeasonBoard, size = 10): LeaderGroup[] {
  const floor = minGames(board);
  const rate = (
    key: string,
    label: string,
    unit: string,
    note: string,
    amountOf: (p: BoardPlayer) => number | null,
    positions: readonly SeasonPosition[],
  ): LeaderGroup => ({
    key,
    label,
    unit,
    note,
    rows: board.players
      .filter((p) => positions.includes(p.position) && p.games >= floor)
      .map((p) => ({ p, amount: amountOf(p) }))
      .filter((e): e is { p: BoardPlayer; amount: number } => e.amount !== null && e.amount > 0)
      .sort((a, b) => b.amount - a.amount || b.p.total - a.p.total)
      .slice(0, size)
      .map(({ p, amount }) => toRow(p, amount, `${amount.toFixed(1)}%`, `${p.games} ${p.games === 1 ? "game" : "games"}`)),
  });

  return [
    countGroup(board, "targets", "Targets", "targets", stat("rec_tgt"), size),
    rate(
      "target-share",
      "Target share",
      "of his team's targets",
      `His share of his team's targets in the games he played. At least ${floor} ${floor === 1 ? "game" : "games"}.`,
      (p) => p.targetShare,
      ["WR", "TE", "RB"],
    ),
    countGroup(board, "carries", "Carries", "carries", stat("rush_att"), size),
    rate(
      "snap-share",
      "Snap share",
      "of his team's offensive snaps",
      `The average share of offensive snaps he was on the field for. At least ${floor} ${floor === 1 ? "game" : "games"}.`,
      (p) => p.snapPct,
      ["RB", "WR", "TE"],
    ),
  ];
}

/** The NFL's own leaderboards: yards and touchdowns. */
export function statGroups(board: SeasonBoard, size = 10): LeaderGroup[] {
  return [
    countGroup(board, "pass-yd", "Passing yards", "passing yards", stat("pass_yd"), size),
    countGroup(board, "pass-td", "Passing touchdowns", "passing touchdowns", stat("pass_td"), size),
    countGroup(board, "rush-yd", "Rushing yards", "rushing yards", stat("rush_yd"), size),
    countGroup(board, "rec-yd", "Receiving yards", "receiving yards", stat("rec_yd"), size),
    countGroup(board, "rec", "Receptions", "receptions", stat("rec"), size),
    countGroup(
      board,
      "td",
      "Touchdowns",
      "rushing and receiving touchdowns",
      (p) => (p.stats.rush_td ?? 0) + (p.stats.rec_td ?? 0),
      size,
    ),
  ];
}
