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
