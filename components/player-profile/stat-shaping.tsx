/**
 * Pure stat-shaping helpers shared by the statistics tab (server) and the weekly
 * stats table (client). Kept free of any server-only imports (no Supabase, no
 * cookies) so the client weekly table can import it safely. Fantasy points are
 * read on the server and passed in as `ppr` on each GameRow, so nothing here
 * needs the metadata jsonb.
 */

import type { ReactNode } from "react";

export type StatLine = {
  pass_cmp: number;
  pass_att: number;
  pass_yd: number;
  pass_td: number;
  pass_int: number;
  rush_att: number;
  rush_yd: number;
  rush_td: number;
  rec: number;
  rec_tgt: number;
  rec_yd: number;
  rec_td: number;
  pts_ppr: number;
};

/** A single game row: the numeric stat line plus week context. Serializable so
 *  it can cross the server -> client boundary as a prop. */
export type GameRow = StatLine & {
  season: number;
  week: number;
  opponent: string | null;
  snap_pct: number | null;
  gp: number | null;
};

/** A game row enriched with active-scoring actual + projected points, used by the
 *  weekly game log and the projected-vs-actual chart. Kept separate from GameRow
 *  so unrelated GameRow consumers (Beacon Breakdown, Signal Scout) are untouched. */
export type WeeklyGameRow = GameRow & {
  /** Actual fantasy points in the active scoring (TE premium applied). */
  pts_active: number;
  /** Projected points for the same week/scoring (TE premium applied), null when
   *  no projection is on file for that week. */
  proj_active: number | null;
};

/** One week of projected-vs-actual points for the accuracy chart. `actual` is
 *  null for weeks not yet played (so a current-season chart can show just the
 *  projection line until games happen). `prior` is the previous season's actual
 *  output for the same week number, drawn as a subtle comparison line (null when
 *  the player has no prior-season game that week). */
export type AccuracyPoint = {
  week: number;
  opponent: string | null;
  projected: number | null;
  actual: number | null;
  prior: number | null;
};

export type SeasonAgg = { season: number; games: number; line: StatLine };

export type StatCol = { label: string; get: (s: StatLine) => string };

function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function emptyLine(): StatLine {
  return {
    pass_cmp: 0,
    pass_att: 0,
    pass_yd: 0,
    pass_td: 0,
    pass_int: 0,
    rush_att: 0,
    rush_yd: 0,
    rush_td: 0,
    rec: 0,
    rec_tgt: 0,
    rec_yd: 0,
    rec_td: 0,
    pts_ppr: 0,
  };
}

export function lineFromGame(r: GameRow): StatLine {
  return {
    pass_cmp: num(r.pass_cmp),
    pass_att: num(r.pass_att),
    pass_yd: num(r.pass_yd),
    pass_td: num(r.pass_td),
    pass_int: num(r.pass_int),
    rush_att: num(r.rush_att),
    rush_yd: num(r.rush_yd),
    rush_td: num(r.rush_td),
    rec: num(r.rec),
    rec_tgt: num(r.rec_tgt),
    rec_yd: num(r.rec_yd),
    rec_td: num(r.rec_td),
    pts_ppr: num(r.pts_ppr),
  };
}

function addLines(a: StatLine, b: StatLine): StatLine {
  return {
    pass_cmp: a.pass_cmp + b.pass_cmp,
    pass_att: a.pass_att + b.pass_att,
    pass_yd: a.pass_yd + b.pass_yd,
    pass_td: a.pass_td + b.pass_td,
    pass_int: a.pass_int + b.pass_int,
    rush_att: a.rush_att + b.rush_att,
    rush_yd: a.rush_yd + b.rush_yd,
    rush_td: a.rush_td + b.rush_td,
    rec: a.rec + b.rec,
    rec_tgt: a.rec_tgt + b.rec_tgt,
    rec_yd: a.rec_yd + b.rec_yd,
    rec_td: a.rec_td + b.rec_td,
    pts_ppr: a.pts_ppr + b.pts_ppr,
  };
}

function fmt(v: number): string {
  return Math.round(v).toLocaleString();
}

/** Position-specific stat columns, matching the prior profile layout. */
export function statColumns(position: string): StatCol[] {
  const p = (position || "").toUpperCase();
  if (p === "QB")
    return [
      { label: "Cmp/Att", get: (s) => `${fmt(s.pass_cmp)}/${fmt(s.pass_att)}` },
      { label: "Pass Yd", get: (s) => fmt(s.pass_yd) },
      { label: "Pass TD", get: (s) => fmt(s.pass_td) },
      { label: "INT", get: (s) => fmt(s.pass_int) },
      { label: "Rush Yd", get: (s) => fmt(s.rush_yd) },
      { label: "Rush TD", get: (s) => fmt(s.rush_td) },
    ];
  if (p === "RB")
    return [
      { label: "Car", get: (s) => fmt(s.rush_att) },
      { label: "Rush Yd", get: (s) => fmt(s.rush_yd) },
      { label: "Rush TD", get: (s) => fmt(s.rush_td) },
      { label: "Rec", get: (s) => fmt(s.rec) },
      { label: "Rec Yd", get: (s) => fmt(s.rec_yd) },
      { label: "Rec TD", get: (s) => fmt(s.rec_td) },
    ];
  if (p === "WR" || p === "TE")
    return [
      { label: "Tgt", get: (s) => fmt(s.rec_tgt) },
      { label: "Rec", get: (s) => fmt(s.rec) },
      { label: "Rec Yd", get: (s) => fmt(s.rec_yd) },
      { label: "Rec TD", get: (s) => fmt(s.rec_td) },
      { label: "Rush Yd", get: (s) => fmt(s.rush_yd) },
    ];
  return [
    { label: "Rush Yd", get: (s) => fmt(s.rush_yd) },
    { label: "Rec", get: (s) => fmt(s.rec) },
    { label: "Rec Yd", get: (s) => fmt(s.rec_yd) },
  ];
}

// ---------- projection shaping ----------

/** One decimal (projections are expected values, e.g. 0.8 rush TD). */
function fmt1(v: number): string {
  return num(v).toFixed(1);
}

/** Build a StatLine from a projection's stat_line jsonb (same keys as stats). */
export function lineFromProjection(stats: Record<string, unknown> | null): StatLine {
  const g = (key: string): number => {
    const v = stats?.[key];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  };
  return {
    pass_cmp: g("pass_cmp"),
    pass_att: g("pass_att"),
    pass_yd: g("pass_yd"),
    pass_td: g("pass_td"),
    pass_int: g("pass_int"),
    rush_att: g("rush_att"),
    rush_yd: g("rush_yd"),
    rush_td: g("rush_td"),
    rec: g("rec"),
    rec_tgt: g("rec_tgt"),
    rec_yd: g("rec_yd"),
    rec_td: g("rec_td"),
    pts_ppr: g("pts_ppr"),
  };
}

/**
 * Position-specific projected stat columns. Mirrors statColumns but formats for
 * expected values: yardage/attempts stay whole, low-magnitude counts (TDs,
 * receptions, INTs) keep one decimal so a 0.8 projected TD does not round to 1.
 * K / DEF return no component columns (their stat_line is not skill-position
 * shaped); those rows lean on the projected-points column alone.
 */
export function projectionStatColumns(position: string): StatCol[] {
  const p = (position || "").toUpperCase();
  if (p === "QB")
    return [
      { label: "Pass Yd", get: (s) => fmt(s.pass_yd) },
      { label: "Pass TD", get: (s) => fmt1(s.pass_td) },
      { label: "INT", get: (s) => fmt1(s.pass_int) },
      { label: "Rush Yd", get: (s) => fmt(s.rush_yd) },
      { label: "Rush TD", get: (s) => fmt1(s.rush_td) },
    ];
  if (p === "RB")
    return [
      { label: "Car", get: (s) => fmt1(s.rush_att) },
      { label: "Rush Yd", get: (s) => fmt(s.rush_yd) },
      { label: "Rush TD", get: (s) => fmt1(s.rush_td) },
      { label: "Rec", get: (s) => fmt1(s.rec) },
      { label: "Rec Yd", get: (s) => fmt(s.rec_yd) },
      { label: "Rec TD", get: (s) => fmt1(s.rec_td) },
    ];
  if (p === "WR" || p === "TE")
    return [
      { label: "Tgt", get: (s) => fmt1(s.rec_tgt) },
      { label: "Rec", get: (s) => fmt1(s.rec) },
      { label: "Rec Yd", get: (s) => fmt(s.rec_yd) },
      { label: "Rec TD", get: (s) => fmt1(s.rec_td) },
    ];
  return [];
}

// ---------- projection accuracy (beat rate) ----------

/** Beats and the elapsed-week denominator behind the "beat rate" card. */
export type BeatRate = { beats: number; total: number };

/** One week's input for the beat rate. `elapsed` marks a week the player's team
 *  has already played (so it belongs in the denominator); `projected` / `actual`
 *  are that week's points, both null-safe because an injured or inactive week
 *  has an actual only when the player suited up and may carry no projection at
 *  all once the player is ruled out for the season. */
export type BeatRateWeek = {
  projected: number | null;
  actual: number | null;
  elapsed: boolean;
};

/**
 * Beat rate across the full elapsed season, not just the games the player suited
 * up for. The denominator is every week the player's team has already played, so
 * weeks the player missed (injury, inactive) count as misses instead of being
 * dropped, which would otherwise inflate the rate for players who sat out. This
 * holds even when no projection was published for the missed weeks (Sleeper
 * stops projecting a player once they are ruled out), because the denominator is
 * driven by games played, not projection coverage. Bye weeks have no game, so
 * they never enter the count. Future weeks of an in-progress season are excluded
 * by the caller (they are not yet elapsed). A week is a beat only when the player
 * actually played and met or beat that week's projection. Returns null when no
 * elapsed weeks exist yet (nothing to rate).
 */
export function beatRateOverSeason(weeks: BeatRateWeek[]): BeatRate | null {
  const elapsed = weeks.filter((w) => w.elapsed);
  if (elapsed.length === 0) return null;
  const beats = elapsed.filter(
    (w) =>
      w.projected != null && w.actual != null && (w.actual as number) >= (w.projected as number),
  ).length;
  return { beats, total: elapsed.length };
}

/**
 * Whether a given (season, week) has already been played leaguewide, used to
 * decide if a missed projected week should count against a player's beat rate.
 * `live` carries the current NFL season and the last fully completed regular
 * week; a completed prior season is always elapsed, a future season never is,
 * and within the live season only weeks at or before the last completed week
 * count. Callers OR this with their own per-week "played" evidence so a week the
 * player has already scored in counts even when the live signal is unavailable
 * (pass `lastCompletedWeek: -1` in that case to lean entirely on played weeks).
 */
export function weekHasElapsed(
  season: number,
  week: number,
  live: { season: number; lastCompletedWeek: number },
): boolean {
  if (season < live.season) return true;
  if (season > live.season) return false;
  return week <= live.lastCompletedWeek;
}

export function aggregateSeasons(rows: GameRow[]): SeasonAgg[] {
  const bySeason = new Map<number, SeasonAgg>();
  for (const r of rows) {
    let agg = bySeason.get(r.season);
    if (!agg) {
      agg = { season: r.season, games: 0, line: emptyLine() };
      bySeason.set(r.season, agg);
    }
    agg.line = addLines(agg.line, lineFromGame(r));
    agg.games += num(r.gp) > 0 ? 1 : 0;
  }
  return Array.from(bySeason.values()).sort((a, b) => b.season - a.season);
}

/** Horizontally scrollable, keyboard-focusable table shell. Every data column
 *  stays present at all breakpoints; scroll is the compaction mechanism. */
export function StatScroll({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div
      role="region"
      aria-label={`${caption}. Scroll horizontally to see every column.`}
      tabIndex={0}
      className="beacon-scroll overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
    >
      {children}
    </div>
  );
}
