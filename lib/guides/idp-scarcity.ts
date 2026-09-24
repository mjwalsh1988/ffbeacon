/**
 * Scarcity, eligibility and the quiz verdict for the IDP guide (plan IDP-219,
 * lessons 4, 5 and 6). Pure: the page reads the rows, these do arithmetic.
 *
 * Every per-game figure is Sleeper default IDP scoring (idp123), scored from
 * the season line, never from a stored points column
 * (lib/idp/points-guard.test.ts scans every lib/guides/idp-* file).
 */

import { scoreIdpLine, type StatLine } from "@/lib/idp/stat-line";
import { IDP_PRESETS } from "@/lib/idp/scoring-presets";

export type IdpPosition = "DL" | "LB" | "DB";
export const IDP_POSITIONS: readonly IdpPosition[] = ["DL", "LB", "DB"];

type Ranked = { games: number; line: StatLine };

/** Per-game points in Sleeper default IDP scoring; null for no games. */
export function perGamePoints(p: Ranked): number | null {
  if (!p.games) return null;
  return scoreIdpLine(p.line, IDP_PRESETS.idp123) / p.games;
}

/**
 * Per-game points by per-game rank, one array per position, the best first,
 * `depth` deep. Every qualifying player at the position is ranked (at least
 * `minGames` games), not a list already cut on season total: ranking a
 * season-total list by per game let a twelfth-ranked player outscore the
 * first, which is two orders on one line.
 */
export function perGameByRank(
  rows: ReadonlyArray<Ranked & { position: string }>,
  depth: number,
  minGames: number,
): Record<IdpPosition, number[]> {
  const out = { DL: [], LB: [], DB: [] } as Record<IdpPosition, number[]>;
  for (const pos of IDP_POSITIONS) {
    out[pos] = rows
      .filter((r) => r.position === pos && r.games >= minGames)
      .map(perGamePoints)
      .filter((v): v is number => v !== null)
      .sort((x, y) => y - x)
      .slice(0, depth)
      .map((v) => Math.round(v * 10) / 10);
  }
  return out;
}

export const RANK_GROUPS: ReadonlyArray<{ label: string; from: number; to: number }> = [
  { label: "1 to 6", from: 1, to: 6 },
  { label: "7 to 12", from: 7, to: 12 },
  { label: "13 to 24", from: 13, to: 24 },
  { label: "25 to 36", from: 25, to: 36 },
];

export type RankGroupRow = {
  position: IdpPosition;
  groups: Array<{ label: string; perGame: number | null }>;
};

/**
 * The average per-game points of each rank group. A group is null unless
 * every rank in it is present: an average of the three players we happen to
 * hold in a six-player band would read as that band's figure and is not.
 */
export function rankGroups(byRank: Record<IdpPosition, number[]>): RankGroupRow[] {
  return IDP_POSITIONS.map((position) => ({
    position,
    groups: RANK_GROUPS.map(({ label, from, to }) => {
      const slice = byRank[position].slice(from - 1, to);
      if (slice.length < to - from + 1) return { label, perGame: null };
      const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
      return { label, perGame: Math.round(mean * 10) / 10 };
    }),
  }));
}

export type EligibilityCounts = {
  dlOnly: number;
  dlLb: number;
  lbOnly: number;
  dbLb: number;
  dbOnly: number;
  /** Any other combination (all three, or DL with DB). */
  other: number;
  onTeam: number;
};

/**
 * Defenders on an NFL team by the positions Sleeper lets them play, in
 * exclusive buckets so the figure's bars add up to the whole. An empty
 * eligibility list falls back to the player's own position.
 */
export function countEligibility(
  rows: Array<{ position: string | null; eligible: readonly string[] | null }>,
): EligibilityCounts {
  const c: EligibilityCounts = { dlOnly: 0, dlLb: 0, lbOnly: 0, dbLb: 0, dbOnly: 0, other: 0, onTeam: 0 };
  for (const row of rows) {
    const list = row.eligible && row.eligible.length > 0 ? row.eligible : row.position ? [row.position] : [];
    const dl = list.includes("DL");
    const lb = list.includes("LB");
    const db = list.includes("DB");
    if (!dl && !lb && !db) continue;
    c.onTeam += 1;
    if (dl && lb && !db) c.dlLb += 1;
    else if (db && lb && !dl) c.dbLb += 1;
    else if (dl && !lb && !db) c.dlOnly += 1;
    else if (lb && !dl && !db) c.lbOnly += 1;
    else if (db && !dl && !lb) c.dbOnly += 1;
    else c.other += 1;
  }
  return c;
}

/**
 * Where the quiz draws its line. A year-to-year correlation at or above this
 * is called a figure that repeats. The page prints the number, so a reader can
 * see which side of the line each answer fell on.
 */
export const REPEATS_AT = 0.5;

/** Chase a figure that repeats, ignore one that does not; null without data. */
export function chaseOrIgnore(correlation: number | null): "chase" | "ignore" | null {
  if (correlation === null || !Number.isFinite(correlation)) return null;
  return correlation >= REPEATS_AT ? "chase" : "ignore";
}
