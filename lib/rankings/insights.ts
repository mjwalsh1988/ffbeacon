/**
 * What the rankings board can say about itself, beyond listing the players.
 *
 * Everything here is derived from rows the board has ALREADY fetched. There is
 * no extra query, no new table and no cron: `player_value_trends` carries the
 * 7-day and 30-day movement in the same row the Value column comes out of, and
 * `lib/rankings/tiers.ts` turns the values themselves into positional tiers.
 * The board was throwing about twenty of those columns away.
 *
 * Pure and clock-free, so the whole thing is testable without a database.
 */

import type { RankingsBoardRow } from "@/lib/rankings-board";
import {
  assignPositionalTiers,
  steepestCliff,
  tierBands,
  type TierBand,
} from "@/lib/rankings/tiers";

/**
 * A board row with its positional tier and scarcity figures attached.
 *
 * `tier` here is NOT `rankings.tier` from the database. That column is a
 * percentile sixth of the whole board and means nothing to a reader; this one
 * comes from the value cliffs inside the player's own position. The raw column
 * is deliberately not carried alongside it, because two fields both called a
 * tier and disagreeing is worse than either one on its own.
 */
export type BoardRow = RankingsBoardRow & {
  tier: number | null;
  tierSize: number | null;
  startsTier: boolean;
  gapToNext: number | null;
  gapToNextPct: number | null;
  opensNextTier: boolean;
};

/**
 * A player has to be worth at least this share of the board's best value
 * before his percentage moves are treated as signal.
 *
 * At the bottom of a 500-row dynasty board every value is double digits, so a
 * four-point week is a 12% week and a movers list built without this floor is
 * just a list of the cheapest players on the board. Scaling it to the board's
 * own top keeps it correct for a kicker board, whose whole range is 242 down
 * to 66 and where nobody should be excluded.
 *
 * THE FLOOR IS CHECKED AT BOTH ENDS OF THE WINDOW, and one end is not enough.
 * Checking only today's value put a receiver who went from about 30 to about
 * 220 at the top of the list at +631%, which is a true percentage and a
 * useless headline: he was a rounding error a week ago and is a deep bench
 * stash now. A mover is somebody who was already worth owning and whose price
 * changed, so both the before and the after have to clear the bar.
 *
 * Five percent reaches rank 268 of 500 on a dynasty superflex board, which is
 * past the end of a 12-team roster, so nobody a reader could actually own is
 * excluded. It is a fraction rather than a rank because a rank cut would be
 * nonsense on the 32-row defense board.
 */
const MOVER_MIN_VALUE_FRACTION = 0.05;

export type Mover = {
  slug: string;
  name: string;
  position: string;
  team: string | null;
  sleeper_id: string | null;
  value: number | null;
  /** Percentage move over the window this mover was selected for. */
  pct: number;
  /** Rank places gained (positive) or lost (negative). Null when unknown. */
  rankChange: number | null;
};

export type Movers = {
  risers: Mover[];
  fallers: Mover[];
  /** How many rows were eligible, so the UI can say what the list is out of. */
  considered: number;
};

export type BoardPulse = {
  /**
   * Rows with a usable reading over the window, on the same terms the movers
   * list uses. The three counts below sum to exactly this.
   */
  withWindow: number;
  rising: number;
  falling: number;
  holding: number;
  biggestRiser: Mover | null;
  biggestFaller: Mover | null;
  /** The largest drop between two adjacent tiers anywhere on the board. */
  cliff: { position: string; tier: number; drop: number } | null;
};

/** Attach the positional tier and the gap to the next player at that position. */
export function enrichBoardRows(rows: RankingsBoardRow[]): BoardRow[] {
  const tiers = assignPositionalTiers(
    rows.map((r) => ({ position: r.position, value: r.value })),
  );
  return rows.map((row, i) => {
    const t = tiers[i];
    return {
      ...row,
      tier: t.tier,
      tierSize: t.tierSize,
      startsTier: t.startsTier,
      gapToNext: t.gapToNext,
      gapToNextPct: t.gapToNextPct,
      opensNextTier: t.opensNextTier,
    };
  });
}

function valueFloor(rows: BoardRow[]): number {
  let top = 0;
  for (const row of rows) if (row.value !== null && row.value > top) top = row.value;
  return top * MOVER_MIN_VALUE_FRACTION;
}

type Reading = { row: BoardRow; pct: number; rankChange: number | null };

/**
 * ONE DEFINITION OF "THIS ROW'S WINDOW IS READABLE AND WORTH READING", used by
 * both the movers list and the board pulse.
 *
 * They decided it separately once, and disagreed: the pulse counted every row
 * with a gate on, the movers list applied the value floor, so a board whose
 * only gainers were deep bench players printed "242 players gained value"
 * beside "No player gained value over the last 30 days" in the next tile. Two
 * tiles, one strip, contradicting each other. The same split also let a row
 * that lost 100% of its value be counted as falling while being excluded from
 * the list of the biggest fallers.
 *
 * Zeroes are INCLUDED here, because a row that held is a real answer the
 * pulse needs to count. The movers list drops them itself: "moved by nothing"
 * does not belong on a list of movers.
 */
function readings(rows: BoardRow[], window: "7d" | "30d"): Reading[] {
  const floor = valueFloor(rows);
  const out: Reading[] = [];
  for (const row of rows) {
    if (row.value === null || row.value < floor) continue;
    const shown = window === "7d" ? row.show_trend_7d : row.show_trend_30d;
    const pct = window === "7d" ? row.change_7d_pct : row.change_30d_pct;
    if (!shown || pct === null) continue;
    // Where the price started, reconstructed from the move. A -100% divides
    // by zero, and a move that wiped a player out entirely is not something
    // either surface has anything useful to say about.
    const ratio = 1 + pct / 100;
    if (ratio <= 0) continue;
    if (row.value / ratio < floor) continue;
    out.push({
      row,
      pct,
      rankChange: window === "7d" ? row.rank_change_7d : row.rank_change_30d,
    });
  }
  return out;
}

function toMover(row: BoardRow, pct: number, rankChange: number | null): Mover {
  return {
    slug: row.slug,
    name: row.name,
    position: row.position,
    team: row.team,
    sleeper_id: row.sleeper_id,
    value: row.value,
    pct,
    rankChange,
  };
}

/**
 * The biggest climbers and the biggest fallers over one window.
 *
 * `window` picks which pair of columns is read, and the two are genuinely
 * different questions: a week is one piece of news, a month is a direction.
 * Both are offered because a reader deciding whether to buy wants the month
 * and a reader wondering what happened wants the week.
 *
 * A row is skipped rather than counted as flat when its window gate is off.
 * `show_trend_7d` / `show_trend_30d` mean the source has a data point near
 * both ends of the window; without one, a "0%" is an absence of data being
 * reported as a fact about a player.
 */
export function topMovers(
  rows: BoardRow[],
  { window, limit = 5 }: { window: "7d" | "30d"; limit?: number },
): Movers {
  const eligible = readings(rows, window).filter((r) => r.pct !== 0);
  const byPct = [...eligible].sort((a, b) => b.pct - a.pct);
  return {
    risers: byPct
      .filter((e) => e.pct > 0)
      .slice(0, limit)
      .map((e) => toMover(e.row, e.pct, e.rankChange)),
    fallers: byPct
      .filter((e) => e.pct < 0)
      .slice(-limit)
      .reverse()
      .map((e) => toMover(e.row, e.pct, e.rankChange)),
    considered: eligible.length,
  };
}

/**
 * The one-line state of the board: how the window went, and where the board's
 * steepest cliff sits.
 *
 * DEFAULTS TO THE SAME WINDOW THE TABLE RENDERS, which is 30 days. A strip
 * summarising a week sitting directly above a table whose only movement
 * columns are monthly gives a reader two different periods to hold in their
 * head and no warning that they differ.
 *
 * Counts the same population `topMovers` ranks, through the shared `readings`
 * above, so the strip's "N gained value" and its "biggest climber" can never
 * describe different sets of players.
 *
 * "Holding" counts a row whose window is readable and whose move rounded to
 * nothing, which is a real answer and not the same as a row with no reading at
 * all. Those are excluded from all four figures, and `withWindow` says how
 * many were counted so the numbers reconcile on screen.
 */
export function boardPulse(
  rows: BoardRow[],
  { window = "30d" }: { window?: "7d" | "30d" } = {},
): BoardPulse {
  let rising = 0;
  let falling = 0;
  let holding = 0;

  const counted = readings(rows, window);
  for (const { pct } of counted) {
    if (pct > 0) rising += 1;
    else if (pct < 0) falling += 1;
    else holding += 1;
  }

  const movers = topMovers(rows, { window, limit: 1 });

  // The steepest cliff, looked for one position at a time. A drop between two
  // tiers is only a cliff if both sides are the same position: the gap between
  // the best tight end and the second-best quarterback is not a decision
  // anybody makes.
  let cliff: BoardPulse["cliff"] = null;
  const positions = new Set(rows.map((r) => r.position));
  for (const position of positions) {
    const bands: TierBand[] = tierBands(
      rows.filter((r) => r.position === position).map((r) => ({ tier: r.tier, value: r.value })),
    );
    const steepest = steepestCliff(bands);
    if (steepest && (!cliff || steepest.drop > cliff.drop)) {
      cliff = { position, tier: steepest.tier, drop: steepest.drop };
    }
  }

  return {
    withWindow: counted.length,
    rising,
    falling,
    holding,
    biggestRiser: movers.risers[0] ?? null,
    biggestFaller: movers.fallers[0] ?? null,
    cliff,
  };
}
