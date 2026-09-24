/**
 * What repeats from one IDP season to the next (plan IDP-217, lesson 5).
 *
 * THE METHOD, FIXED AND TESTED. Group by players.position (DL, LB, DB) as it
 * stands today. For every player with at least MIN_GAMES games (weeks with a
 * defensive snap) in BOTH of two consecutive regular seasons, take his
 * per-game rate in each, and correlate year one against year two across all
 * such pairs, 2020 to the last complete season. A correlation near 1 means a
 * figure repeats; near 0 means last year told you little about this year.
 *
 * LABEL DRIFT, STATED ON THE PAGE. The position is today's label applied to
 * past seasons, because that is what we store. A player who moved from safety
 * to linebacker is counted as a linebacker in both years.
 *
 * Never names a stored points column (lib/idp/points-guard.test.ts scans every
 * lib/guides/idp-* file): points are scored from the season line.
 */

import { scoreIdpLine, type StatLine } from "@/lib/idp/stat-line";
import { IDP_PRESETS } from "@/lib/idp/scoring-presets";

export const MIN_GAMES = 8;

export type IdpSeasonRow = {
  playerId: string;
  season: number;
  position: string;
  games: number;
  line: StatLine;
};

export type StabilityFigure = {
  position: "DL" | "LB" | "DB";
  /** Consecutive-season pairs that qualified. */
  pairs: number;
  /** Correlation of per-game points (Sleeper default IDP scoring). */
  points: number | null;
  tackles: number | null;
  sacks: number | null;
};

/** Pearson correlation; null for fewer than three pairs or no spread. */
export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return null;
  return cov / Math.sqrt(vx * vy);
}

function perGame(row: IdpSeasonRow) {
  const tackles = (row.line.idp_tkl ?? (row.line.idp_tkl_solo ?? 0) + (row.line.idp_tkl_ast ?? 0)) / row.games;
  return {
    points: scoreIdpLine(row.line, IDP_PRESETS.idp123) / row.games,
    tackles,
    sacks: (row.line.idp_sack ?? 0) / row.games,
  };
}

export function yearOverYear(rows: IdpSeasonRow[]): StabilityFigure[] {
  const byKey = new Map<string, IdpSeasonRow>();
  for (const r of rows) byKey.set(`${r.playerId}|${r.season}`, r);
  const out: StabilityFigure[] = [];
  for (const position of ["DL", "LB", "DB"] as const) {
    const a = { points: [] as number[], tackles: [] as number[], sacks: [] as number[] };
    const b = { points: [] as number[], tackles: [] as number[], sacks: [] as number[] };
    for (const r of rows) {
      if (r.position !== position || r.games < MIN_GAMES) continue;
      const next = byKey.get(`${r.playerId}|${r.season + 1}`);
      if (!next || next.position !== position || next.games < MIN_GAMES) continue;
      const x = perGame(r);
      const y = perGame(next);
      a.points.push(x.points);
      b.points.push(y.points);
      a.tackles.push(x.tackles);
      b.tackles.push(y.tackles);
      a.sacks.push(x.sacks);
      b.sacks.push(y.sacks);
    }
    out.push({
      position,
      pairs: a.points.length,
      points: pearson(a.points, b.points),
      tackles: pearson(a.tackles, b.tackles),
      sacks: pearson(a.sacks, b.sacks),
    });
  }
  return out;
}
