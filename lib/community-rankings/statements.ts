/**
 * Community rankings, step 1: boards to weighted head-to-head statements
 * (plan section 9.2, points 1, 3 and 5). PURE.
 *
 * A board says three kinds of thing:
 *   - WITHIN: every player on it is preferred over every player below him.
 *   - LEFT OFF: every player on it is preferred over every player the reader
 *     deliberately left off. A judgement the reader made, so it sits in the
 *     within class and shares the within weight.
 *   - POOL: every player on it is preferred over every player in the first
 *     floor(n + n * poolMargin) of the board's pool (the seed source's ranked
 *     set for its format and scope) who is neither on the board nor left off.
 *     A 50 player board speaks about pool ranks 51 to 100 and nobody beyond.
 * Two players both missing from a board get nothing from it.
 *
 * Every board carries the same total weight, 1, so a 200 player board does not
 * outvote a 12 player one by producing more pairs. withinBoardShare of it is
 * split evenly over the within and left-off statements, the rest over the pool
 * statements; a board with only one kind gives that kind all of it.
 *
 * Statements are added straight into one aggregate table of
 * (winner, loser, weight). Nothing is materialised per board.
 */

export type StatementBoard = {
  /** Board order, best first. */
  playerIds: readonly string[];
  /** Players the reader deliberately left off. */
  leftOff: readonly string[];
  /** The seed source's ranked set for the board's format and scope, in seed order. */
  pool: readonly string[];
  /** Board depth; defaults to playerIds.length. */
  depth?: number;
};

export type StatementOptions = {
  poolMargin: number;
  withinBoardShare: number;
};

export type StatementAggregate = {
  /** winner id -> loser id -> summed weight. */
  wins: Map<string, Map<string, number>>;
  /** player id -> number of boards that had him ON the board. */
  boardsCount: Map<string, number>;
  /** Boards that contributed at least one statement. */
  boards: number;
};

export function createAggregate(): StatementAggregate {
  return { wins: new Map(), boardsCount: new Map(), boards: 0 };
}

function addWeight(
  wins: Map<string, Map<string, number>>,
  winner: string,
  loser: string,
  weight: number,
): void {
  let row = wins.get(winner);
  if (!row) {
    row = new Map();
    wins.set(winner, row);
  }
  row.set(loser, (row.get(loser) ?? 0) + weight);
}

/** Fold one board into the aggregate. */
export function addBoard(
  agg: StatementAggregate,
  board: StatementBoard,
  opts: StatementOptions,
): void {
  // Deduplicate the board order defensively: the first mention wins.
  const seen = new Set<string>();
  const onBoard: string[] = [];
  for (const id of board.playerIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    onBoard.push(id);
  }
  const n = onBoard.length;
  if (n === 0) return;

  const leftOff: string[] = [];
  const leftOffSet = new Set<string>();
  for (const id of board.leftOff) {
    if (seen.has(id) || leftOffSet.has(id)) continue;
    leftOffSet.add(id);
    leftOff.push(id);
  }

  const depth = board.depth ?? n;
  const cutoff = Math.floor(depth + depth * Math.max(0, opts.poolMargin));
  const poolOthers: string[] = [];
  const poolSeen = new Set<string>();
  for (const id of board.pool.slice(0, cutoff)) {
    if (seen.has(id) || leftOffSet.has(id) || poolSeen.has(id)) continue;
    poolSeen.add(id);
    poolOthers.push(id);
  }

  const withinCount = (n * (n - 1)) / 2 + n * leftOff.length;
  const poolCount = n * poolOthers.length;
  if (withinCount === 0 && poolCount === 0) {
    // A one player board with nothing to compare him to still ranked him.
    for (const id of onBoard) agg.boardsCount.set(id, (agg.boardsCount.get(id) ?? 0) + 1);
    return;
  }

  const share = Math.min(1, Math.max(0, opts.withinBoardShare));
  let withinWeight = 0;
  let poolWeight = 0;
  if (withinCount > 0 && poolCount > 0) {
    withinWeight = share / withinCount;
    poolWeight = (1 - share) / poolCount;
  } else if (withinCount > 0) {
    withinWeight = 1 / withinCount;
  } else {
    poolWeight = 1 / poolCount;
  }

  for (let i = 0; i < n; i += 1) {
    const winner = onBoard[i];
    agg.boardsCount.set(winner, (agg.boardsCount.get(winner) ?? 0) + 1);
    if (withinWeight > 0) {
      for (let j = i + 1; j < n; j += 1) addWeight(agg.wins, winner, onBoard[j], withinWeight);
      for (const loser of leftOff) addWeight(agg.wins, winner, loser, withinWeight);
    }
    if (poolWeight > 0) {
      for (const loser of poolOthers) addWeight(agg.wins, winner, loser, poolWeight);
    }
  }
  agg.boards += 1;
}

/** Fold every board into one aggregate. */
export function aggregateBoards(
  boards: readonly StatementBoard[],
  opts: StatementOptions,
): StatementAggregate {
  const agg = createAggregate();
  for (const board of boards) addBoard(agg, board, opts);
  return agg;
}

/** Total weight a board contributed, for tests and diagnostics. */
export function totalWeight(agg: StatementAggregate): number {
  let sum = 0;
  for (const row of agg.wins.values()) for (const w of row.values()) sum += w;
  return sum;
}
