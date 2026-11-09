/**
 * How well known a historical player is, as a number in [0, 1] that stands in
 * for the roster rate when a historical answer is tiered (plan 31.4). Pure.
 *
 * A Hall of Famer is as known as a player gets. Otherwise seasons played
 * carry the most weight (a twelve-year starter is a name), then Pro Bowls
 * and All-Pro selections, then a first-round pedigree and games played. The
 * bands in settings.tiers.bands then read the result exactly as they read a
 * roster rate: under 0.02 is a Long Shot, 0.60 and over is Chalk.
 */

export interface ProminenceInput {
  hof: boolean;
  seasonsPlayed: number;
  proBowls: number;
  allPro: number;
  draftRound: number | null;
  careerGames: number | null;
}

export const HOF_PROMINENCE = 0.95;

export function prominenceOf(p: ProminenceInput): number {
  if (p.hof) return HOF_PROMINENCE;
  const seasons = Math.min(1, Math.max(0, p.seasonsPlayed - 1) / 11);
  const bowls = Math.min(1, p.proBowls / 4);
  const allPro = Math.min(1, p.allPro / 2);
  const pedigree = p.draftRound === 1 ? 1 : 0;
  const games = Math.min(1, (p.careerGames ?? 0) / 150);
  const score = 0.35 * seasons + 0.3 * bowls + 0.2 * allPro + 0.1 * pedigree + 0.1 * games;
  return Math.round(Math.min(1, score) * 10000) / 10000;
}
