/**
 * Pure, client-safe stat definitions for the Beacon Breakdown "Stats" tab.
 * No server imports so both the server loader (load-stats.ts) and the client
 * comparison UI (stats-compare.tsx) can share these. Built on top of the
 * profile's StatLine/GameRow/SeasonAgg shapes so the aggregation stays
 * consistent with the player profile's statistics tab.
 */

import type { StatLine, SeasonAgg, GameRow } from "@/components/player-profile/stat-shaping";

/** Everything one player contributes to the Stats tab, precomputed server-side
 * and serialized to the client. */
export type PlayerStatsPayload = {
  name: string;
  position: string;
  seasons: number[];
  /** Regular-season totals per season, newest first. */
  seasonAggs: SeasonAgg[];
  /** Weekly game rows grouped by season for the weekly comparison. */
  weeklyBySeason: Record<number, GameRow[]>;
};

/** A single comparable stat. `compute` derives the number from a stat line and
 * the games played (games is 1 for a single weekly row). Returns null when the
 * stat is undefined for the inputs (e.g. yards-per-carry with zero carries). */
export type CompareStat = {
  key: string;
  label: string;
  group: string;
  /** Which direction wins the head-to-head. INT is the only "lower is better". */
  better: "high" | "low";
  /** False for stats that make no sense week-by-week (season totals only). */
  weekly: boolean;
  compute: (line: StatLine, games: number) => number | null;
  fmt: (n: number) => string;
};

const int = (n: number): string => Math.round(n).toLocaleString();
const dec1 = (n: number): string => n.toFixed(1);
const pct = (n: number): string => `${n.toFixed(1)}%`;

const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);

export const STAT_GROUPS = ["Overview", "Passing", "Rushing", "Receiving"] as const;

export const COMPARE_STATS: CompareStat[] = [
  // Overview
  { key: "games", label: "Games played", group: "Overview", better: "high", weekly: false, compute: (_l, g) => g, fmt: int },
  { key: "total_yd", label: "Total yards", group: "Overview", better: "high", weekly: true, compute: (l) => l.pass_yd + l.rush_yd + l.rec_yd, fmt: int },
  { key: "scrimmage_yd", label: "Scrimmage yards", group: "Overview", better: "high", weekly: true, compute: (l) => l.rush_yd + l.rec_yd, fmt: int },
  { key: "total_td", label: "Total TDs", group: "Overview", better: "high", weekly: true, compute: (l) => l.pass_td + l.rush_td + l.rec_td, fmt: int },
  { key: "ppr", label: "Fantasy points (PPR)", group: "Overview", better: "high", weekly: true, compute: (l) => l.pts_ppr, fmt: dec1 },
  { key: "ppr_g", label: "PPR per game", group: "Overview", better: "high", weekly: false, compute: (l, g) => ratio(l.pts_ppr, g), fmt: dec1 },

  // Passing
  { key: "pass_cmp", label: "Completions", group: "Passing", better: "high", weekly: true, compute: (l) => l.pass_cmp, fmt: int },
  { key: "pass_att", label: "Pass attempts", group: "Passing", better: "high", weekly: true, compute: (l) => l.pass_att, fmt: int },
  { key: "cmp_pct", label: "Completion %", group: "Passing", better: "high", weekly: true, compute: (l) => { const r = ratio(l.pass_cmp, l.pass_att); return r == null ? null : r * 100; }, fmt: pct },
  { key: "pass_yd", label: "Passing yards", group: "Passing", better: "high", weekly: true, compute: (l) => l.pass_yd, fmt: int },
  { key: "pass_td", label: "Passing TDs", group: "Passing", better: "high", weekly: true, compute: (l) => l.pass_td, fmt: int },
  { key: "pass_int", label: "Interceptions", group: "Passing", better: "low", weekly: true, compute: (l) => l.pass_int, fmt: int },
  { key: "ypa", label: "Yards / attempt", group: "Passing", better: "high", weekly: true, compute: (l) => ratio(l.pass_yd, l.pass_att), fmt: dec1 },

  // Rushing
  { key: "rush_att", label: "Carries", group: "Rushing", better: "high", weekly: true, compute: (l) => l.rush_att, fmt: int },
  { key: "rush_yd", label: "Rushing yards", group: "Rushing", better: "high", weekly: true, compute: (l) => l.rush_yd, fmt: int },
  { key: "rush_td", label: "Rushing TDs", group: "Rushing", better: "high", weekly: true, compute: (l) => l.rush_td, fmt: int },
  { key: "ypc", label: "Yards / carry", group: "Rushing", better: "high", weekly: true, compute: (l) => ratio(l.rush_yd, l.rush_att), fmt: dec1 },

  // Receiving
  { key: "rec_tgt", label: "Targets", group: "Receiving", better: "high", weekly: true, compute: (l) => l.rec_tgt, fmt: int },
  { key: "rec", label: "Receptions", group: "Receiving", better: "high", weekly: true, compute: (l) => l.rec, fmt: int },
  { key: "catch_pct", label: "Catch %", group: "Receiving", better: "high", weekly: true, compute: (l) => { const r = ratio(l.rec, l.rec_tgt); return r == null ? null : r * 100; }, fmt: pct },
  { key: "rec_yd", label: "Receiving yards", group: "Receiving", better: "high", weekly: true, compute: (l) => l.rec_yd, fmt: int },
  { key: "rec_td", label: "Receiving TDs", group: "Receiving", better: "high", weekly: true, compute: (l) => l.rec_td, fmt: int },
  { key: "ypr", label: "Yards / catch", group: "Receiving", better: "high", weekly: true, compute: (l) => ratio(l.rec_yd, l.rec), fmt: dec1 },
  { key: "ypt", label: "Yards / target", group: "Receiving", better: "high", weekly: true, compute: (l) => ratio(l.rec_yd, l.rec_tgt), fmt: dec1 },
];

/** Stats offered in the weekly stat selector (season-only stats excluded). */
export const WEEKLY_STATS: CompareStat[] = COMPARE_STATS.filter((s) => s.weekly);

/** Winner of a single head-to-head, with a small tolerance so identical
 * numbers read as even and a missing side never "wins". */
export function statEdge(
  aVal: number | null,
  bVal: number | null,
  better: "high" | "low",
): "a" | "b" | "even" | "na" {
  if (aVal == null || bVal == null) return "na";
  const diff = aVal - bVal;
  if (Math.abs(diff) < 1e-9) return "even";
  const aWins = better === "high" ? diff > 0 : diff < 0;
  return aWins ? "a" : "b";
}

/** True when neither player produced anything for this stat (hide the row). */
export function bothEmpty(aVal: number | null, bVal: number | null): boolean {
  const aZero = aVal == null || aVal === 0;
  const bZero = bVal == null || bVal === 0;
  return aZero && bZero;
}
