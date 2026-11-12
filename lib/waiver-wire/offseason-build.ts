/**
 * The waiver wire's offseason board: last season's best pickups.
 *
 * Between the end of one season and the first week of the next there is no
 * waiver wire to rank, so the hub shows what last season's wire was worth
 * instead: the players our leagues most often picked up, off waivers or as
 * free agents, ranked by the fantasy points they scored AFTER the pickup.
 *
 * Pure: no client, no clock, no I/O. lib/waiver-wire/offseason.ts does the
 * reads and stores the result; the page re-ranks it under the reader's own
 * scoring.
 *
 * THREE DECISIONS, AND WHY.
 *
 * "After the pickup" starts at the week most leagues made it (the mode of each
 * league's first add of him, earliest on a tie). A player who broke out in
 * week 9 is credited from week 9 on, not for the eight weeks before anyone
 * wanted him. One week per player rather than per league, because the figure
 * on screen is "what a pickup like this was worth", and a per-league average
 * would blend a week 2 pickup with a week 15 one.
 *
 * It ends at week 17, where most fantasy seasons end. Week 18 is the week
 * leagues do not play, so a points total that counted it would credit a player
 * for games nobody started him in.
 *
 * A player qualifies only when enough leagues picked him up
 * (MIN_LEAGUE_SHARE of the season's leagues, never fewer than MIN_LEAGUES).
 * Without the floor the list is topped by stars a single league dropped by
 * mistake and a rival scooped up, which is a story about one league rather
 * than about the wire.
 */

import { REGULAR_SEASON_WEEKS } from "@/lib/nfl-week";

export const MIN_LEAGUE_SHARE = 0.05;
export const MIN_LEAGUES = 5;
export const FANTASY_LAST_WEEK = 17;
/**
 * The positions the board shows. Kickers and team defenses are streamed week
 * to week rather than picked up once, so a points-after-pickup total says
 * little about them; defenders are never scored from these columns at all.
 */
export const SHOWCASE_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export type ShowcasePosition = (typeof SHOWCASE_POSITIONS)[number];

export function isShowcasePosition(position: string | null | undefined): position is ShowcasePosition {
  return !!position && (SHOWCASE_POSITIONS as readonly string[]).includes(position);
}

/**
 * Players kept per position per scoring type; the stored list is the union.
 * Per position because quarterbacks outscore everyone, so a single top-N
 * would store almost no tight ends.
 */
export const STORED_PER_POSITION = 15;

/** One row of `waiver_pickup_counts`: [sleeper id, first week, leagues, via waiver, via free agent]. */
export type PickupCountRow = [string, number, number, number, number];

export type PickupAggregate = {
  sleeperId: string;
  leagues: number;
  viaWaiver: number;
  viaFreeAgent: number;
  /** First-add week to the number of leagues whose first add was that week. */
  weekCounts: Map<number, number>;
};

/** Fold one batch of counts into the running totals. Leagues never repeat across batches. */
export function foldPickupCounts(
  acc: Map<string, PickupAggregate>,
  rows: PickupCountRow[],
): void {
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const [sleeperId, week, leagues, viaWaiver, viaFreeAgent] = row;
    if (typeof sleeperId !== "string" || !sleeperId) continue;
    const w = Number(week);
    const n = Number(leagues);
    if (!Number.isInteger(w) || !Number.isFinite(n) || n <= 0) continue;
    const agg =
      acc.get(sleeperId) ??
      { sleeperId, leagues: 0, viaWaiver: 0, viaFreeAgent: 0, weekCounts: new Map<number, number>() };
    agg.leagues += n;
    agg.viaWaiver += Number(viaWaiver) || 0;
    agg.viaFreeAgent += Number(viaFreeAgent) || 0;
    agg.weekCounts.set(w, (agg.weekCounts.get(w) ?? 0) + n);
    acc.set(sleeperId, agg);
  }
}

/** The week most leagues first picked him up; the earlier week wins a tie. */
export function typicalWeek(weekCounts: Map<number, number>): number | null {
  let best: number | null = null;
  let bestCount = -1;
  for (const [week, count] of weekCounts) {
    if (count > bestCount || (count === bestCount && best !== null && week < best)) {
      best = week;
      bestCount = count;
    }
  }
  return best;
}

/** The minimum leagues a player needs to qualify, given the season's league count. */
export function qualifyingLeagues(seasonLeagues: number): number {
  return Math.max(MIN_LEAGUES, Math.ceil(seasonLeagues * MIN_LEAGUE_SHARE));
}

export type WeekLine = {
  week: number;
  /** Games played; a row with no game played adds nothing. */
  gp: number | null;
  ppr: number | null;
  half: number | null;
  std: number | null;
  rec: number | null;
};

export type PointsAfter = {
  ppr: number;
  half: number;
  std: number;
  /** Receptions over the same weeks, so a TE premium can be added on render. */
  rec: number;
  games: number;
};

/**
 * Points from `fromWeek` through FANTASY_LAST_WEEK. A null points column on a
 * played game is a zero, not a missing game (see the player_stats memory
 * note): Sleeper stores NULL for a game that scored nothing.
 */
export function pointsAfter(lines: WeekLine[], fromWeek: number): PointsAfter {
  const out: PointsAfter = { ppr: 0, half: 0, std: 0, rec: 0, games: 0 };
  for (const line of lines) {
    if (line.week < fromWeek || line.week > FANTASY_LAST_WEEK) continue;
    if (!line.gp || line.gp <= 0) continue;
    out.games += 1;
    out.ppr += line.ppr ?? 0;
    out.half += line.half ?? 0;
    out.std += line.std ?? 0;
    out.rec += line.rec ?? 0;
  }
  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    ppr: round1(out.ppr),
    half: round1(out.half),
    std: round1(out.std),
    rec: out.rec,
    games: out.games,
  };
}

/** One stored entry. Names and teams are resolved at render, never stored. */
export type ShowcaseEntry = {
  playerId: string;
  sleeperId: string;
  /** Position when the board was built; selection only, the page reads the live one. */
  position: ShowcasePosition;
  typicalWeek: number;
  leagues: number;
  viaWaiver: number;
  viaFreeAgent: number;
  /** Median winning FAAB bid, share of budget 0 to 100; null with no priced claim. */
  medianBidPct: number | null;
  /** How many priced FAAB claims the median is drawn from. */
  bidSamples: number;
  points: PointsAfter;
};

export type ShowcaseScoring = "ppr" | "half_ppr" | "standard";

/**
 * Points under a format's scoring, plus its TE premium when it has one. A
 * TE premium is a per-reception bonus for tight ends, so it is added from the
 * stored receptions rather than stored three more times.
 */
export function scoredPoints(
  entry: Pick<ShowcaseEntry, "points">,
  scoring: ShowcaseScoring,
  tePremiumBonus: number,
  isTightEnd: boolean,
): number {
  const base =
    scoring === "standard" ? entry.points.std : scoring === "half_ppr" ? entry.points.half : entry.points.ppr;
  const bonus = isTightEnd && tePremiumBonus > 0 ? tePremiumBonus * entry.points.rec : 0;
  return Math.round((base + bonus) * 10) / 10;
}

/**
 * The stored list: the top STORED_PER_POSITION at each position under each
 * scoring, as a union, so the page can re-rank for any reader without a
 * rebuild.
 */
export function selectStored(entries: ShowcaseEntry[]): ShowcaseEntry[] {
  const keep = new Map<string, ShowcaseEntry>();
  for (const position of SHOWCASE_POSITIONS) {
    const atPosition = entries.filter((e) => e.position === position);
    for (const key of ["ppr", "half", "std"] as const) {
      const sorted = [...atPosition].sort(
        (a, b) =>
          b.points[key] - a.points[key] || b.leagues - a.leagues || a.playerId.localeCompare(b.playerId),
      );
      for (const e of sorted.slice(0, STORED_PER_POSITION)) keep.set(e.playerId, e);
    }
  }
  return Array.from(keep.values()).sort((a, b) => b.points.ppr - a.points.ppr);
}

/** Nearest-rank median, matching the priors' percentile rule. */
export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(0.5 * sorted.length) - 1)];
}

/** Rebuild a stored season no more than this often. */
export const SHOWCASE_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Is the waiver wire between seasons, and if so which season does the
 * offseason board look back on? The clock's season is the newest one we hold
 * projections for, and its week reads REGULAR_SEASON_WEEKS + 1 once that
 * season's regular season is over. It flips to the new season, week 1, the day
 * the new season's projections land, which is exactly when the weekly board
 * has something to show again.
 */
export function offseasonSeasonFor(clock: {
  season: number | null;
  currentWeek: number;
}): number | null {
  if (clock.season === null) return null;
  return clock.currentWeek > REGULAR_SEASON_WEEKS ? clock.season : null;
}

/** Whether a stored showcase should be rebuilt now. Pure. */
export function showcaseDue(builtAt: string | null, nowMs: number): boolean {
  if (!builtAt) return true;
  const at = new Date(builtAt).getTime();
  if (!Number.isFinite(at)) return true;
  return nowMs - at > SHOWCASE_STALE_MS;
}

/** A median drawn from fewer priced claims than this is not printed. */
export const MIN_BID_SAMPLES = 3;

type Rankable = Pick<ShowcaseEntry, "points" | "leagues" | "playerId"> & { position: string };

/**
 * The board's order for one reader: points after the pickup under their
 * format's scoring (with the tight end premium where the format has one),
 * then leagues, then id so the order is stable. The page's structured data
 * uses this too, so the list a crawler reads is the list the reader sees.
 */
export function rankShowcase<T extends Rankable>(
  players: T[],
  scoring: ShowcaseScoring,
  tePremiumBonus: number,
  seasonLeagues: number,
): Array<T & { scored: number; share: number }> {
  return players
    .map((p) => ({
      ...p,
      scored: scoredPoints(p, scoring, tePremiumBonus, p.position === "TE"),
      share: seasonLeagues > 0 ? p.leagues / seasonLeagues : 0,
    }))
    .sort((a, b) => b.scored - a.scored || b.leagues - a.leagues || a.playerId.localeCompare(b.playerId));
}

/** What a pickup like this cost, as a figure and the words that explain it. */
export function pickupCost(
  p: Pick<ShowcaseEntry, "medianBidPct" | "bidSamples" | "viaWaiver" | "viaFreeAgent">,
): { kind: "bid" | "free" | "unpriced"; pct: number | null; samples: number } {
  if (p.medianBidPct !== null && p.bidSamples >= MIN_BID_SAMPLES) {
    return { kind: "bid", pct: p.medianBidPct, samples: p.bidSamples };
  }
  if (p.viaFreeAgent >= p.viaWaiver) return { kind: "free", pct: null, samples: p.bidSamples };
  return { kind: "unpriced", pct: null, samples: p.bidSamples };
}
