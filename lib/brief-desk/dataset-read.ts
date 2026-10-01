/**
 * Reading a bundle dataset from a block.
 *
 * A dataset is a small table: `columns` names the keys and `rows` carries one
 * object per row, every value a string, a number or null (BundleDataset in
 * ./types.ts). The block library never invents a figure, so every helper here
 * only reads what the row already holds; a column that is absent reads as
 * null and renders as "n/a", never as 0.
 *
 * THE COLUMN NAMES THE BLOCKS EXPECT, by dataset kind. lib/brief-desk/
 * datasets.ts is the producer and this is the contract it writes to; its
 * tests (datasets.test.ts) pin these names. A block accepts a handful of
 * spellings for the identity columns (see the *_KEYS lists) so a small drift
 * in the producer degrades to a plain table rather than an empty one.
 *
 *   week_stat_tiles         id, label, value (one string per tile), and an
 *                           optional detail the producer does not write today
 *   value_movers_up         player_id, name, slug, position, team, current,
 *   value_movers_down       change_7d, change_30d, rank_in_format (the chart
 *                           reads current and change_7d)
 *   value_movers_by_format  player_id, name, slug, position, team, then one
 *                           column per figure per format, named
 *                           "{format_slug}.{figure}", for example
 *                           "dynasty-ppr-sflex.current",
 *                           "dynasty-ppr-sflex.change_7d",
 *                           "redraft-ppr-std.rank_in_format" (":" and "_" are
 *                           accepted as the separator too)
 *   top_scorers             rank, player_id, name, slug, position, team, week,
 *                           opponent, pts_ppr, pts_half_ppr, pts_std, then the
 *                           stat columns (pass_att through snap_pct); one
 *                           dataset per position, and the `position` column
 *                           also lets one dataset carry every position and the
 *                           block group by it
 *   box_score_lines         player_id, name, slug, position, team, week,
 *                           opponent, then the same stat columns
 *   injury_timeline         player_id, name, slug, position, team,
 *                           availability, relay_id, relay_slug, reported_at,
 *                           timeline, timeline_class, weeks_min, weeks_max,
 *                           earliest_return_week, expected_return_week (null
 *                           when no timeline was given), season_ending,
 *                           no_timeline ("yes" or "no")
 *   waiver_targets          player_id, name, slug, position, team, bid_low,
 *                           bid_high (a percent of remaining budget), bid_tier,
 *                           bid_aggression, redraft_value, redraft_change_7d,
 *                           redraft_rank, dynasty_value, dynasty_change_7d,
 *                           dynasty_rank. There is no add_rate column: no
 *                           add-rate data is read, and the action_list block
 *                           shows only the columns the dataset carries.
 *
 * `week` and `season` are context columns: they travel with every row so a
 * dataset is self-describing, and the tables do not print them as a figure,
 * because the block's title and source note already say the week.
 *
 * Pure. No I/O.
 */

import type { BundleDataset } from "./types";

export type DatasetRow = BundleDataset["rows"][number];
export type Cell = string | number | null;

export const PLAYER_ID_KEYS = ["player_id", "id"];
export const SLUG_KEYS = ["slug", "player_slug"];
export const NAME_KEYS = ["name", "player_name", "full_name", "player"];
export const POSITION_KEYS = ["position", "pos"];
export const TEAM_KEYS = ["team", "nfl_team"];

/** Columns that identify a row rather than describe it. Never shown as a figure. */
const IDENTITY_COLUMNS = new Set([
  ...PLAYER_ID_KEYS,
  ...SLUG_KEYS,
  ...NAME_KEYS,
  ...POSITION_KEYS,
  ...TEAM_KEYS,
  "relay_id",
  "relay_slug",
]);

/** Columns that say which week or season a row is about. Carried, not printed as a figure. */
const CONTEXT_COLUMNS = new Set(["week", "season"]);

const NA = "n/a";

/** The first present value among candidate column names, or null. */
export function readCell(row: DatasetRow, keys: string[]): Cell {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      const v = row[key];
      if (v !== undefined) return v;
    }
  }
  return null;
}

export function readText(row: DatasetRow, keys: string[]): string | null {
  const v = readCell(row, keys);
  if (v === null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/** A number, parsing a numeric string; null for anything else. */
export function readNumber(row: DatasetRow, keys: string[]): number | null {
  const v = readCell(row, keys);
  return toNumber(v);
}

export function toNumber(v: Cell): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function isIdentityColumn(column: string): boolean {
  return IDENTITY_COLUMNS.has(column);
}

/** The identity a row carries, for a player link. */
export function readPlayer(row: DatasetRow): {
  id: string | null;
  slug: string | null;
  name: string;
  position: string | null;
  team: string | null;
  /** For the photo; null on datasets written before it was carried. */
  sleeperId: string | null;
} {
  return {
    id: readText(row, PLAYER_ID_KEYS),
    slug: readText(row, SLUG_KEYS),
    name: readText(row, NAME_KEYS) ?? "Unnamed player",
    position: readText(row, POSITION_KEYS),
    team: readText(row, TEAM_KEYS),
    sleeperId: readText(row, ["sleeper_id"]),
  };
}

function cellNumber(row: DatasetRow, key: string): number {
  const v = row[key];
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/**
 * A week line read as one sentence, from a top_scorers or box_score_lines row:
 * "22 of 31, 287 passing yards, 2 TD; 4 carries, 18 rushing yards; 76% of
 * snaps". Every stat column the row carries is in it, so a compact row drops
 * no figure a wide table would have shown. A defender's row (pts_idp123)
 * reads his defensive line instead. Pure.
 */
export function rowLineText(row: DatasetRow): string {
  const n = (k: string) => cellNumber(row, k);
  const has = (k: string) => row[k] !== undefined && row[k] !== null;
  const pos = (readText(row, POSITION_KEYS) ?? "").toUpperCase();
  const parts: string[] = [];
  if (has("pts_idp123")) {
    const tkl = n("idp_tkl") || n("idp_tkl_solo") + n("idp_tkl_ast");
    if (tkl) parts.push(`${tkl} tackles${n("idp_tkl_solo") ? ` (${n("idp_tkl_solo")} solo)` : ""}`);
    const pairs: Array<[string, string, string]> = [
      ["idp_tkl_loss", "tackle for loss", "tackles for loss"],
      ["idp_sack", "sack", "sacks"],
      ["idp_qb_hit", "QB hit", "QB hits"],
      ["idp_pass_def", "pass defended", "passes defended"],
      ["idp_int", "interception", "interceptions"],
      ["idp_ff", "forced fumble", "forced fumbles"],
      ["idp_fum_rec", "fumble recovery", "fumble recoveries"],
      ["idp_def_td", "defensive TD", "defensive TDs"],
    ];
    for (const [k, one, many] of pairs) if (n(k)) parts.push(`${n(k)} ${n(k) === 1 ? one : many}`);
    if (has("def_snap_pct")) parts.push(`${n("def_snap_pct")}% of defensive snaps`);
    return parts.length > 0 ? parts.join(", ") : "No defensive stats";
  }
  // A kicker's or a team defense's row carries no columns a sentence could be
  // built from; the row shows the points alone rather than "No touches".
  if (pos === "K" || pos === "DEF") return has("snap_pct") ? `${n("snap_pct")}% of snaps` : "";
  const pass = () => {
    if (!n("pass_att")) return;
    const b = [`${n("pass_cmp")} of ${n("pass_att")}`, `${n("pass_yd")} passing yards`];
    if (n("pass_td")) b.push(`${n("pass_td")} TD`);
    if (n("pass_int")) b.push(`${n("pass_int")} INT`);
    parts.push(b.join(", "));
  };
  const rush = () => {
    if (!n("rush_att")) return;
    const b = [`${n("rush_att")} ${n("rush_att") === 1 ? "carry" : "carries"}`, `${n("rush_yd")} rushing yards`];
    if (n("rush_td")) b.push(`${n("rush_td")} TD`);
    parts.push(b.join(", "));
  };
  const rec = () => {
    if (!n("rec") && !n("rec_tgt") && !n("rec_yd") && !n("rec_td")) return;
    const catches = `${n("rec")} ${n("rec") === 1 ? "catch" : "catches"}`;
    const b = [n("rec_tgt") ? `${catches} on ${n("rec_tgt")} ${n("rec_tgt") === 1 ? "target" : "targets"}` : catches, `${n("rec_yd")} receiving yards`];
    if (n("rec_td")) b.push(`${n("rec_td")} TD`);
    parts.push(b.join(", "));
  };
  if (pos === "QB") [pass, rush, rec].forEach((f) => f());
  else if (pos === "RB") [rush, rec, pass].forEach((f) => f());
  else [rec, rush, pass].forEach((f) => f());
  if (n("fum_lost")) parts.push(`${n("fum_lost")} lost ${n("fum_lost") === 1 ? "fumble" : "fumbles"}`);
  if (has("snap_pct")) parts.push(`${n("snap_pct")}% of snaps`);
  return parts.length > 0 ? parts.join("; ") : "No touches";
}

/** Plain-language headers for the column names the datasets use. */
const COLUMN_LABELS: Record<string, string> = {
  rank: "Rank",
  current: "Value",
  value: "Value",
  previous: "Value a week ago",
  change_7d: "7-day change",
  change_30d: "30-day change",
  rank_in_format: "Rank",
  week: "Week",
  season: "Season",
  opponent: "Opponent",
  pts_ppr: "PPR pts",
  pts_half_ppr: "Half PPR pts",
  pts_std: "Standard pts",
  targets: "Targets",
  rec_tgt: "Targets",
  receptions: "Rec",
  rec: "Rec",
  rec_yd: "Rec yds",
  rec_yds: "Rec yds",
  rec_td: "Rec TD",
  rush_att: "Rush att",
  rush_yd: "Rush yds",
  rush_yds: "Rush yds",
  rush_td: "Rush TD",
  pass_att: "Pass att",
  pass_cmp: "Comp",
  pass_yd: "Pass yds",
  pass_yds: "Pass yds",
  pass_td: "Pass TD",
  pass_int: "INT",
  fum_lost: "Fum lost",
  snaps: "Snaps",
  snap_share: "Snap share",
  snap_pct: "Snap %",
  // A defender's line (plan IDP-213). Spelled out, because "Idp tkl solo" is
  // what humanizeColumn would otherwise print and a screen reader would say.
  pts_idp123: "IDP pts (Sleeper default)",
  idp_tkl: "Tackles",
  idp_tkl_solo: "Solo tackles",
  idp_tkl_ast: "Assisted tackles",
  idp_tkl_loss: "Tackles for loss",
  idp_sack: "Sacks",
  idp_qb_hit: "QB hits",
  idp_pass_def: "Passes defended",
  idp_int: "Interceptions made",
  idp_ff: "Forced fumbles",
  idp_fum_rec: "Fumble recoveries",
  idp_def_td: "Defensive TD",
  def_snap_pct: "Defensive snap %",
  availability: "Status",
  timeline: "Timeline",
  expected_return_week: "Expected return",
  add_rate: "Add rate",
  bid_low: "Bid low, % of budget",
  bid_high: "Bid high, % of budget",
  bid_tier: "Bid tier",
  bid_aggression: "Bid stance",
  bid: "Bid",
  faab_low: "Bid, low",
  faab_high: "Bid, high",
  redraft_value: "Redraft value",
  redraft_change_7d: "Redraft 7-day change",
  redraft_rank: "Redraft rank",
  dynasty_value: "Dynasty value",
  dynasty_change_7d: "Dynasty 7-day change",
  dynasty_rank: "Dynasty rank",
  games: "Games",
  label: "Figure",
  detail: "Detail",
};

const KEEP_CAPS = new Set(["ppr", "qb", "rb", "wr", "te", "k", "def", "td", "int", "faab", "adp", "nfl", "sf", "tep", "ir"]);

export function humanizeColumn(column: string): string {
  const known = COLUMN_LABELS[column];
  if (known) return known;
  const words = column.split(/[_\s]+/).filter(Boolean);
  return words
    .map((w, i) => {
      if (KEEP_CAPS.has(w.toLowerCase())) return w.toUpperCase();
      return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    })
    .join(" ");
}

/** Columns whose values are a change and should carry a sign. */
export function isSignedColumn(column: string): boolean {
  return /^change|_change|delta|diff|move/i.test(column);
}

/** Thousands grouped: a bare "1961" is read aloud as a year by some screen readers. */
const SIGNED_NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export function formatSigned(n: number): string {
  const rounded = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
  if (rounded > 0) return `+${SIGNED_NUMBER.format(rounded)}`;
  if (rounded < 0) return SIGNED_NUMBER.format(rounded);
  return "0";
}

const UNGROUPED_COLUMNS = new Set(["season", "year", "draft_year", "rookie_year"]);

/** A cell as text: numbers to a sensible precision, nulls as n/a. */
export function formatCell(v: Cell, column?: string): string {
  if (v === null || v === undefined) return NA;
  if (typeof v === "number") {
    if (column && isSignedColumn(column)) return formatSigned(v);
    // Grouped like the prose ("3,171"), except a year, which is never grouped.
    if (Number.isInteger(v)) return column && UNGROUPED_COLUMNS.has(column) ? String(v) : SIGNED_NUMBER.format(v);
    return (Math.round(v * 10) / 10).toFixed(1);
  }
  const s = String(v).trim();
  return s === "" ? NA : s;
}

/**
 * The columns a format toggle shows for one format: every column named
 * "{slug}{sep}{figure}", with the slug stripped from the header.
 */
export function formatColumnsFor(
  columns: string[],
  formatSlug: string,
): Array<{ column: string; label: string; figure: string }> {
  const out: Array<{ column: string; label: string; figure: string }> = [];
  for (const column of columns) {
    for (const sep of [".", ":", "__", "_"]) {
      const prefix = `${formatSlug}${sep}`;
      if (column.startsWith(prefix) && column.length > prefix.length) {
        const figure = column.slice(prefix.length);
        out.push({ column, label: humanizeColumn(figure), figure });
        break;
      }
    }
  }
  return out;
}

export function isContextColumn(column: string): boolean {
  return CONTEXT_COLUMNS.has(column);
}

/** The stat columns of a row set: everything that is not identity or context. */
export function figureColumns(columns: string[]): string[] {
  return columns.filter((c) => !isIdentityColumn(c) && !isContextColumn(c));
}
