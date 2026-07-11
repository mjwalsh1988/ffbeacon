/**
 * Pure aggregation helpers for the Signal Scout admin overview
 * (app/admin/signal-scout/page.tsx). No I/O here: page.tsx fetches the raw
 * rows and these functions turn them into the numbers the page renders.
 * Colocated with the page (not lib/signal-scout) because this is
 * admin-display math, not game logic.
 */

export interface WindowRoundRow {
  status: string;
  score_awarded: number;
  hints_used: number;
  target_player_id: string;
}

export interface TargetAggregate {
  playerId: string;
  rounds: number;
  wins: number;
  skips: number;
}

export interface HardestEasiestRow extends TargetAggregate {
  winRate: number;
}

export interface CountRow {
  playerId: string;
  count: number;
}

/** One pass over the completed-rounds window, grouped by target player. */
export function aggregateTargets(rows: WindowRoundRow[]): Map<string, TargetAggregate> {
  const byTarget = new Map<string, TargetAggregate>();
  for (const row of rows) {
    const entry = byTarget.get(row.target_player_id) ?? {
      playerId: row.target_player_id,
      rounds: 0,
      wins: 0,
      skips: 0,
    };
    entry.rounds += 1;
    if (row.status === "won") entry.wins += 1;
    if (row.status === "skipped") entry.skips += 1;
    byTarget.set(row.target_player_id, entry);
  }
  return byTarget;
}

/** Average score_awarded among won rounds, and average hints_used across
 * every completed round in the window. Null when there is no data to
 * average (empty window, or no wins for the score average). */
export function computeAverages(rows: WindowRoundRow[]): {
  avgWinningScore: number | null;
  avgHints: number | null;
} {
  if (rows.length === 0) return { avgWinningScore: null, avgHints: null };

  const wonRows = rows.filter((r) => r.status === "won");
  const avgWinningScore =
    wonRows.length === 0
      ? null
      : wonRows.reduce((sum, r) => sum + r.score_awarded, 0) / wonRows.length;

  const avgHints = rows.reduce((sum, r) => sum + r.hints_used, 0) / rows.length;

  return { avgWinningScore, avgHints };
}

const MIN_ROUNDS_FOR_DIFFICULTY = 5;

/** Lowest win rate first (hardest targets), minimum round count required so
 * a single-round fluke does not dominate the list. Ties broken by more
 * rounds played (more confidence in the rate). */
export function pickHardest(
  byTarget: Map<string, TargetAggregate>,
  limit = 10,
): HardestEasiestRow[] {
  return [...byTarget.values()]
    .filter((t) => t.rounds >= MIN_ROUNDS_FOR_DIFFICULTY)
    .map((t) => ({ ...t, winRate: t.wins / t.rounds }))
    .sort((a, b) => a.winRate - b.winRate || b.rounds - a.rounds)
    .slice(0, limit);
}

/** Highest win rate first (easiest targets), same minimum-rounds gate. */
export function pickEasiest(
  byTarget: Map<string, TargetAggregate>,
  limit = 10,
): HardestEasiestRow[] {
  return [...byTarget.values()]
    .filter((t) => t.rounds >= MIN_ROUNDS_FOR_DIFFICULTY)
    .map((t) => ({ ...t, winRate: t.wins / t.rounds }))
    .sort((a, b) => b.winRate - a.winRate || b.rounds - a.rounds)
    .slice(0, limit);
}

/** Highest skip count first. No minimum rounds gate (a skip is a skip). */
export function pickMostSkipped(byTarget: Map<string, TargetAggregate>, limit = 10): CountRow[] {
  return [...byTarget.values()]
    .filter((t) => t.skips > 0)
    .sort((a, b) => b.skips - a.skips)
    .map((t) => ({ playerId: t.playerId, count: t.skips }))
    .slice(0, limit);
}

/** Highest guess count first, across the most recent guesses window. */
export function aggregateMostGuessed(
  rows: Array<{ guessed_player_id: string }>,
  limit = 10,
): CountRow[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.guessed_player_id, (counts.get(row.guessed_player_id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([playerId, count]) => ({ playerId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
