/**
 * The block-ready datasets the bundle ships (plan section 9.2 and 11.2).
 *
 * One builder per kind in ./blocks.ts DATASET_KINDS. Every builder is pure:
 * it takes rows the bundle builder has already loaded and returns a
 * BundleDataset whose rows are plain strings, numbers and nulls. A block
 * renders exactly one of these and nothing else, so the run has no path to put
 * an invented number on the page. Every dataset carries computed_at and a
 * source_note that names the value source by its display name.
 *
 * The figures come from the same reads as the per-player figures in the
 * bundle: value_movers_* and value_movers_by_format from player_value_trends
 * (change_7d on the registry's default source), top_scorers_* and
 * box_score_lines from player_stats, injury_timeline from the period's Relays
 * with the stated timeline parsed by parseReturnTimeline, and waiver_targets
 * from the redraft trend rows plus the site's own FAAB calculator at its
 * default league shape. week_stat_tiles is six counts and two named figures.
 *
 * THE COLUMN NAMES ARE A CONTRACT with the block library. The header of
 * ./dataset-read.ts lists them per dataset kind, and the blocks under
 * components/brief-desk/blocks/ read exactly those names. A dataset may carry
 * extra columns (the blocks show or ignore them per kind), but a listed
 * column is never renamed here without the reader following.
 */

import type { FaabSettings } from "@/lib/faab/types";
import { calculateFaabRecommendation } from "@/lib/faab/calculate-faab";
import type { BundleDataset, BundleRelay } from "./types";

export const DATASET_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;
export type DatasetPosition = (typeof DATASET_POSITIONS)[number];

/** Availabilities that put a Relay on the injury timeline. */
export const INJURED_AVAILABILITIES = new Set(["out", "ir", "pup", "doubtful"]);

/** Relay kinds counted as transactions on the stat tiles. */
const TRANSACTION_KINDS = new Set(["transaction", "contract", "suspension"]);

export interface DatasetPlayer {
  id: string;
  name: string;
  slug: string;
  position: string | null;
  team: string | null;
}

export type PlayerIndex = ReadonlyMap<string, DatasetPlayer>;

/** One player's row in one format on one source, ranked by current value. */
export interface FormatTrendRow {
  player_id: string;
  current_value: number;
  change_7d: number | null;
  change_30d: number | null;
  /** 1-based rank by current_value within this source and format. */
  rank_in_format: number;
}

export interface FormatTrend {
  formatSlug: string;
  formatDisplay: string;
  sourceSlug: string | null;
  sourceDisplay: string;
  rows: FormatTrendRow[];
}

/** One player's line for one week, named columns from player_stats. */
export interface WeekLine {
  player_id: string;
  opponent: string | null;
  pts_ppr: number | null;
  pts_half_ppr: number | null;
  pts_std: number | null;
  pass_att: number;
  pass_cmp: number;
  pass_yd: number;
  pass_td: number;
  pass_int: number;
  rush_att: number;
  rush_yd: number;
  rush_td: number;
  rec_tgt: number | null;
  rec: number;
  rec_yd: number;
  rec_td: number;
  fum_lost: number;
  snap_pct: number | null;
}

export type DatasetRelay = Pick<
  BundleRelay,
  "id" | "slug" | "kind" | "headline" | "availability" | "timeline" | "source_posted_at" | "players" | "teams"
>;

type Row = Record<string, string | number | null>;

function round1(n: number | null | undefined): number | null {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

function playerCells(p: DatasetPlayer): Row {
  return { player_id: p.id, name: p.name, slug: p.slug, position: p.position, team: p.team };
}

/**
 * Sort trend rows by current value, highest first, and assign the 1-based
 * rank. player_value_trends carries rank_7d_ago and rank_change_7d but not the
 * rank itself; ordering by value is what the rankings pages do too.
 */
export function rankTrendRows(
  rows: Array<{ player_id: string; current_value: number; change_7d: number | null; change_30d: number | null }>,
): FormatTrendRow[] {
  return [...rows]
    .sort((a, b) => b.current_value - a.current_value || a.player_id.localeCompare(b.player_id))
    .map((r, i) => ({
      player_id: r.player_id,
      current_value: r.current_value,
      change_7d: r.change_7d,
      change_30d: r.change_30d,
      rank_in_format: i + 1,
    }));
}

function valueNote(trend: FormatTrend): string {
  return `Values from ${trend.sourceDisplay}, ${trend.formatDisplay}. The move column is the change over the last seven days.`;
}

/** value_movers_up or value_movers_down: the biggest change_7d in one direction. */
export function buildValueMoversDataset(
  direction: "up" | "down",
  trend: FormatTrend,
  players: PlayerIndex,
  computedAt: string,
  limit = 15,
): BundleDataset {
  const candidates = trend.rows.filter(
    (r) => r.change_7d !== null && (direction === "up" ? r.change_7d > 0 : r.change_7d < 0),
  );
  candidates.sort((a, b) =>
    direction === "up" ? (b.change_7d ?? 0) - (a.change_7d ?? 0) : (a.change_7d ?? 0) - (b.change_7d ?? 0),
  );
  const rows: Row[] = [];
  for (const r of candidates) {
    const p = players.get(r.player_id);
    if (!p) continue;
    rows.push({
      ...playerCells(p),
      current: r.current_value,
      change_7d: r.change_7d,
      change_30d: r.change_30d,
      rank_in_format: r.rank_in_format,
    });
    if (rows.length >= limit) break;
  }
  return {
    id: direction === "up" ? "value_movers_up" : "value_movers_down",
    kind: direction === "up" ? "value_movers_up" : "value_movers_down",
    title: `Biggest ${direction === "up" ? "risers" : "fallers"}, ${trend.formatDisplay}`,
    columns: ["player_id", "name", "slug", "position", "team", "current", "change_7d", "change_30d", "rank_in_format"],
    rows,
    source_note: valueNote(trend),
    computed_at: computedAt,
  };
}

/**
 * value_movers_by_format: the union of the top movers in every edition format,
 * one row per player with every format's figures side by side, so the format
 * toggle re-reads a column rather than a second dataset. Column names are
 * "{format_slug}.{figure}" ("dynasty-ppr-sflex.change_7d"), which is what
 * dataset-read.ts formatColumnsFor splits on.
 */
export function buildValueMoversByFormatDataset(
  trends: FormatTrend[],
  players: PlayerIndex,
  computedAt: string,
  limitPerSide = 10,
): BundleDataset {
  const ids = new Set<string>();
  for (const t of trends) {
    const withChange = t.rows.filter((r) => r.change_7d !== null && players.has(r.player_id));
    const up = [...withChange].sort((a, b) => (b.change_7d ?? 0) - (a.change_7d ?? 0)).slice(0, limitPerSide);
    const down = [...withChange].sort((a, b) => (a.change_7d ?? 0) - (b.change_7d ?? 0)).slice(0, limitPerSide);
    for (const r of [...up, ...down]) if ((r.change_7d ?? 0) !== 0) ids.add(r.player_id);
  }
  const byFormat = trends.map((t) => ({
    prefix: `${t.formatSlug}.`,
    rows: new Map(t.rows.map((r) => [r.player_id, r])),
  }));
  const columns = ["player_id", "name", "slug", "position", "team"];
  for (const f of byFormat) columns.push(`${f.prefix}current`, `${f.prefix}change_7d`, `${f.prefix}rank_in_format`);

  const rows: Row[] = [];
  for (const id of ids) {
    const p = players.get(id);
    if (!p) continue;
    const row: Row = playerCells(p);
    for (const f of byFormat) {
      const r = f.rows.get(id);
      row[`${f.prefix}current`] = r?.current_value ?? null;
      row[`${f.prefix}change_7d`] = r?.change_7d ?? null;
      row[`${f.prefix}rank_in_format`] = r?.rank_in_format ?? null;
    }
    rows.push(row);
  }
  // Ordered by the first format's absolute move, biggest first, so the default
  // toggle state reads top to bottom.
  const first = byFormat[0];
  rows.sort((a, b) => {
    const av = Math.abs(Number(a[`${first?.prefix}change_7d`] ?? 0));
    const bv = Math.abs(Number(b[`${first?.prefix}change_7d`] ?? 0));
    return bv - av;
  });
  const sources = [...new Set(trends.map((t) => t.sourceDisplay))].join(" and ");
  return {
    id: "value_movers_by_format",
    kind: "value_movers_by_format",
    title: "Value movers by format",
    columns,
    rows,
    source_note: `Values from ${sources}: ${trends.map((t) => `${t.formatDisplay} on ${t.sourceDisplay}`).join("; ")}. The move column is the change over the last seven days.`,
    computed_at: computedAt,
  };
}

const LINE_COLUMNS = [
  "opponent",
  "pts_ppr",
  "pts_half_ppr",
  "pts_std",
  "pass_att",
  "pass_cmp",
  "pass_yd",
  "pass_td",
  "pass_int",
  "rush_att",
  "rush_yd",
  "rush_td",
  "rec_tgt",
  "rec",
  "rec_yd",
  "rec_td",
  "fum_lost",
  "snap_pct",
] as const;

function lineCells(line: WeekLine): Row {
  return {
    opponent: line.opponent,
    pts_ppr: round1(line.pts_ppr),
    pts_half_ppr: round1(line.pts_half_ppr),
    pts_std: round1(line.pts_std),
    pass_att: line.pass_att,
    pass_cmp: line.pass_cmp,
    pass_yd: line.pass_yd,
    pass_td: line.pass_td,
    pass_int: line.pass_int,
    rush_att: line.rush_att,
    rush_yd: line.rush_yd,
    rush_td: line.rush_td,
    rec_tgt: line.rec_tgt,
    rec: line.rec,
    rec_yd: line.rec_yd,
    rec_td: line.rec_td,
    fum_lost: line.fum_lost,
    snap_pct: round1(line.snap_pct),
  };
}

/** top_scorers_{position}: the week's best PPR lines at one position, with a 1-based rank by PPR points. */
export function buildTopScorersDataset(
  position: DatasetPosition,
  lines: WeekLine[],
  players: PlayerIndex,
  week: number,
  computedAt: string,
  limit = 15,
): BundleDataset {
  const rows: Row[] = [];
  const scored = lines
    .filter((l) => l.pts_ppr !== null)
    .map((l) => ({ line: l, player: players.get(l.player_id) ?? null }))
    .filter((x): x is { line: WeekLine; player: DatasetPlayer } => x.player !== null && (x.player.position ?? "").toUpperCase() === position)
    .sort((a, b) => (b.line.pts_ppr ?? 0) - (a.line.pts_ppr ?? 0));
  for (const [i, { line, player }] of scored.slice(0, limit).entries()) {
    rows.push({ rank: i + 1, ...playerCells(player), week, ...lineCells(line) });
  }
  return {
    id: `top_scorers_${position.toLowerCase()}`,
    kind: "top_scorers",
    title: `Top ${position} scorers, week ${week} (PPR)`,
    columns: ["rank", "player_id", "name", "slug", "position", "team", "week", ...LINE_COLUMNS],
    rows,
    source_note: `Week ${week} box scores from player_stats, ranked by PPR points. Half PPR and standard totals are shown beside them.`,
    computed_at: computedAt,
  };
}

/** box_score_lines: the bundle players' lines for the week, in the order given. */
export function buildBoxScoreLinesDataset(
  playerIds: string[],
  lines: WeekLine[],
  players: PlayerIndex,
  week: number,
  computedAt: string,
): BundleDataset {
  const byPlayer = new Map(lines.map((l) => [l.player_id, l]));
  const rows: Row[] = [];
  for (const id of playerIds) {
    const p = players.get(id);
    const line = byPlayer.get(id);
    if (!p || !line) continue;
    rows.push({ ...playerCells(p), week, ...lineCells(line) });
  }
  rows.sort((a, b) => Number(b.pts_ppr ?? -1) - Number(a.pts_ppr ?? -1));
  return {
    id: "box_score_lines",
    kind: "box_score_lines",
    title: `Week ${week} lines for the players in this edition`,
    columns: ["player_id", "name", "slug", "position", "team", "week", ...LINE_COLUMNS],
    rows,
    source_note: `Week ${week} box scores from player_stats for the players the period's Relays name. A player with no line did not record a stat that week.`,
    computed_at: computedAt,
  };
}

export type TimelineClass =
  | "weeks"
  | "week"
  | "season_ending"
  | "day_to_day"
  | "week_to_week"
  | "indefinite"
  | "none";

export interface ParsedTimeline {
  timeline_class: TimelineClass;
  /** Weeks out, when the words gave a count. Months count as four weeks; days round up to a week; games count as weeks. */
  weeks_min: number | null;
  weeks_max: number | null;
  /** The first week the player could be back, when a current week is known. */
  earliest_return_week: number | null;
  /** The later bound, so a reader planning around it is not surprised. */
  expected_return_week: number | null;
  season_ending: boolean;
  /** True when no timeline was given at all, or the words carried no week. */
  no_timeline: boolean;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  a: 1,
  an: 1,
  couple: 2,
  several: 3,
  few: 3,
  multiple: 3,
};

const LAST_REGULAR_WEEK = 18;

function numberToken(token: string): number | null {
  const n = Number(token);
  if (Number.isFinite(n)) return n;
  return NUMBER_WORDS[token.toLowerCase()] ?? null;
}

function empty(cls: TimelineClass, noTimeline: boolean): ParsedTimeline {
  return {
    timeline_class: cls,
    weeks_min: null,
    weeks_max: null,
    earliest_return_week: null,
    expected_return_week: null,
    season_ending: cls === "season_ending",
    no_timeline: noTimeline,
  };
}

/**
 * Turn a Relay's stated timeline into an expected return week where the words
 * allow it. Deliberately literal: "4 to 6 weeks" reported in week 2 is a
 * return between weeks 6 and 8, and expected_return_week is the LATER bound.
 * "week 8" is week 8. "Season-ending" is season ending. "Day to day" reads as
 * back next week. Anything vaguer ("multiple weeks", "week to week",
 * "indefinitely") is classified but carries no week, and null text is
 * "no timeline given". A month is counted as four weeks, a game as a week and
 * days round up to a week; nothing else is inferred.
 */
export function parseReturnTimeline(text: string | null | undefined, currentWeek: number | null): ParsedTimeline {
  // Unicode dashes (hyphen through horizontal bar) become a plain hyphen, written as escapes so this file stays ASCII.
  const raw = (text ?? "").trim().toLowerCase().replace(new RegExp("[\\u2010-\\u2015]", "g"), "-");
  if (!raw) return empty("none", true);

  if (
    /season[- ]ending|out for the (season|year)|rest of the (season|year)|remainder of the (season|year)|done for the (season|year)|miss(es|ed)? the (season|year|rest)|end of (the )?(season|year)|torn (acl|achilles)|ruptured achilles/.test(
      raw,
    )
  ) {
    return empty("season_ending", false);
  }
  if (/day[- ]to[- ]day/.test(raw)) {
    return {
      timeline_class: "day_to_day",
      weeks_min: 0,
      weeks_max: 1,
      earliest_return_week: currentWeek === null ? null : currentWeek + 1,
      expected_return_week: currentWeek === null ? null : currentWeek + 1,
      season_ending: false,
      no_timeline: false,
    };
  }
  if (/week[- ]to[- ]week/.test(raw)) return empty("week_to_week", false);
  if (/indefinite/.test(raw)) return empty("indefinite", false);

  // "week 8", "wk 8", "in week 8", "until week 8", "return in week 8".
  const weekMatch = raw.match(/\b(?:week|wk)\s*(\d{1,2})\b/);
  if (weekMatch) {
    const week = Number(weekMatch[1]);
    if (week >= 1 && week <= LAST_REGULAR_WEEK) {
      return {
        timeline_class: "week",
        weeks_min: currentWeek === null ? null : Math.max(0, week - currentWeek),
        weeks_max: currentWeek === null ? null : Math.max(0, week - currentWeek),
        earliest_return_week: week,
        expected_return_week: week,
        season_ending: false,
        no_timeline: false,
      };
    }
  }

  // "4 to 6 weeks", "4-6 weeks", "four to six weeks", "2 or 3 games", "6 weeks",
  // "a few weeks", "2 months", "10 days".
  const numberPattern = "(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a|an|couple|several|few|multiple)";
  const rangeMatch = raw.match(
    new RegExp(`\\b${numberPattern}(?:\\s*(?:-\\s*to\\s*-|-|to|or)\\s*${numberPattern})?\\s*(?:of\\s+)?(weeks?|wks?|games?|months?|days?)\\b`),
  );
  if (rangeMatch) {
    const unit = rangeMatch[3];
    let min = numberToken(rangeMatch[1]);
    let max = rangeMatch[2] ? numberToken(rangeMatch[2]) : min;
    if (min === null || max === null) return empty("indefinite", false);
    if (min > max) [min, max] = [max, min];
    const vague = ["several", "few", "multiple"].includes(rangeMatch[1].toLowerCase());
    if (unit.startsWith("month")) {
      min *= 4;
      max *= 4;
    } else if (unit.startsWith("day")) {
      min = Math.ceil(min / 7);
      max = Math.ceil(max / 7);
    }
    if (vague) {
      // "a few weeks" says weeks, not how many. Classified, no week claimed.
      return { ...empty("indefinite", false), weeks_min: null, weeks_max: null };
    }
    const earliest = currentWeek === null ? null : currentWeek + min;
    const latest = currentWeek === null ? null : currentWeek + max;
    const beyond = earliest !== null && earliest > LAST_REGULAR_WEEK;
    return {
      timeline_class: "weeks",
      weeks_min: min,
      weeks_max: max,
      earliest_return_week: beyond ? null : earliest,
      expected_return_week: beyond ? null : latest !== null && latest > LAST_REGULAR_WEEK ? LAST_REGULAR_WEEK : latest,
      season_ending: beyond,
      no_timeline: false,
    };
  }

  return empty("indefinite", false);
}

/**
 * injury_timeline: every player whose NEWEST availability-bearing Relay in the
 * period says out, IR, PUP or doubtful. A later Relay that marks him active or
 * questionable drops him, which is what "newest" buys. One row per player.
 */
export function buildInjuryTimelineDataset(
  relays: DatasetRelay[],
  players: PlayerIndex,
  currentWeek: number | null,
  computedAt: string,
): BundleDataset {
  const newestByPlayer = new Map<string, DatasetRelay>();
  for (const relay of relays) {
    if (!relay.availability || relay.availability === "none") continue;
    for (const pid of relay.players) {
      const prev = newestByPlayer.get(pid);
      if (!prev || new Date(relay.source_posted_at).getTime() > new Date(prev.source_posted_at).getTime()) {
        newestByPlayer.set(pid, relay);
      }
    }
  }
  const rows: Row[] = [];
  for (const [pid, relay] of newestByPlayer) {
    if (!INJURED_AVAILABILITIES.has(relay.availability ?? "")) continue;
    const p = players.get(pid);
    if (!p) continue;
    const parsed = parseReturnTimeline(relay.timeline, currentWeek);
    rows.push({
      ...playerCells(p),
      availability: relay.availability,
      relay_id: relay.id,
      relay_slug: relay.slug,
      reported_at: relay.source_posted_at,
      timeline: relay.timeline,
      timeline_class: parsed.timeline_class,
      weeks_min: parsed.weeks_min,
      weeks_max: parsed.weeks_max,
      earliest_return_week: parsed.earliest_return_week,
      expected_return_week: parsed.expected_return_week,
      season_ending: parsed.season_ending ? "yes" : "no",
      no_timeline: parsed.no_timeline ? "yes" : "no",
    });
  }
  rows.sort((a, b) => {
    const aw = a.expected_return_week === null ? 99 : Number(a.expected_return_week);
    const bw = b.expected_return_week === null ? 99 : Number(b.expected_return_week);
    return aw - bw || String(a.name).localeCompare(String(b.name));
  });
  return {
    id: "injury_timeline",
    kind: "injury_timeline",
    title: "Expected returns",
    columns: [
      "player_id",
      "name",
      "slug",
      "position",
      "team",
      "availability",
      "relay_id",
      "relay_slug",
      "reported_at",
      "timeline",
      "timeline_class",
      "weeks_min",
      "weeks_max",
      "earliest_return_week",
      "expected_return_week",
      "season_ending",
      "no_timeline",
    ],
    rows,
    source_note: `Players the period's Relays report as out, on IR, on PUP or doubtful, by their newest report. expected_return_week is the later bound of the stated timeline counted from ${
      currentWeek === null ? "the report (no week arithmetic off-season)" : `week ${currentWeek}`
    }; a row with no_timeline = yes had no timeline stated and none is inferred.`,
    computed_at: computedAt,
  };
}

export interface WaiverTargetsInput {
  /** The redraft edition format: a waiver claim is a this-week decision. */
  redraft: FormatTrend;
  /** The dynasty format, shown beside it. */
  dynasty: FormatTrend | null;
  players: PlayerIndex;
  /** Players on the injury timeline, who are never a target. */
  injuredPlayerIds: ReadonlySet<string>;
  faabSettings: FaabSettings;
  computedAt: string;
  limit?: number;
}

/**
 * waiver_targets: the biggest seven-day risers on the redraft format who sit
 * OUTSIDE a default league's weekly starter demand (12 teams x 9 starters,
 * the FAAB calculator's public baseline), excluding anyone on the injury
 * timeline. The bid range is the site's FAAB calculator at that same default
 * shape (medium need, 100 budget) as a percent of remaining budget. It is
 * NOT a league-specific figure and no add-rate data is used; the source note
 * says both.
 */
export function buildWaiverTargetsDataset(input: WaiverTargetsInput): BundleDataset {
  const { redraft, dynasty, players, injuredPlayerIds, faabSettings, computedAt } = input;
  const limit = input.limit ?? 12;
  const teams = faabSettings.userDefaults.defaultTeams;
  const starters = faabSettings.userDefaults.defaultStarters;
  const demand = teams * starters;
  const pool = redraft.rows.map((r) => ({ overallRank: r.rank_in_format, value: r.current_value }));
  const dynastyRows = new Map((dynasty?.rows ?? []).map((r) => [r.player_id, r]));

  const candidates = redraft.rows
    .filter((r) => r.change_7d !== null && r.change_7d > 0 && r.rank_in_format > demand && !injuredPlayerIds.has(r.player_id))
    .sort((a, b) => (b.change_7d ?? 0) - (a.change_7d ?? 0));

  const rows: Row[] = [];
  for (const r of candidates) {
    const p = players.get(r.player_id);
    if (!p) continue;
    const bid = calculateFaabRecommendation({
      player: { overallRank: r.rank_in_format, value: r.current_value },
      remainingBudget: faabSettings.userDefaults.defaultBudget,
      needLevel: faabSettings.userDefaults.defaultNeed,
      teams,
      offensiveStarters: starters,
      settings: faabSettings,
      playerPool: pool,
    });
    const d = dynastyRows.get(r.player_id) ?? null;
    rows.push({
      ...playerCells(p),
      bid_low: bid.lowPct,
      bid_high: bid.highPct,
      bid_tier: bid.tierLabel,
      bid_aggression: bid.aggressionLabel,
      redraft_value: r.current_value,
      redraft_change_7d: r.change_7d,
      redraft_rank: r.rank_in_format,
      dynasty_value: d?.current_value ?? null,
      dynasty_change_7d: d?.change_7d ?? null,
      dynasty_rank: d?.rank_in_format ?? null,
    });
    if (rows.length >= limit) break;
  }
  // No add_rate column: no waiver add-rate data is read, and the source note
  // says so. The action_list block shows only the columns the dataset carries.
  return {
    id: "waiver_targets",
    kind: "waiver_targets",
    title: "Waiver targets",
    columns: [
      "player_id",
      "name",
      "slug",
      "position",
      "team",
      "bid_low",
      "bid_high",
      "bid_tier",
      "bid_aggression",
      "redraft_value",
      "redraft_change_7d",
      "redraft_rank",
      "dynasty_value",
      "dynasty_change_7d",
      "dynasty_rank",
    ],
    rows,
    source_note: `Seven-day risers on ${redraft.sourceDisplay}, ${redraft.formatDisplay}, ranked outside the top ${demand} (a ${teams}-team, ${starters}-starter league's weekly starters), excluding players on the injury timeline. The bid range is the FF Beacon FAAB calculator at its default league shape (${teams} teams, ${starters} starters, ${faabSettings.userDefaults.defaultNeed} need, ${faabSettings.userDefaults.defaultBudget} budget) as a percent of remaining budget; it is not a league-specific figure and no waiver add-rate data is used.${
      dynasty ? ` Dynasty columns are ${dynasty.formatDisplay} on ${dynasty.sourceDisplay}.` : ""
    }`,
    computed_at: computedAt,
  };
}

export interface StatTilesInput {
  relays: DatasetRelay[];
  /** In season the last two tiles are the top riser and the top scorer; off-season the top faller and the most-mentioned team. */
  inSeason: boolean;
  dynasty: FormatTrend | null;
  players: PlayerIndex;
  /** The week's lines, in season. */
  lines: WeekLine[] | null;
  week: number | null;
  computedAt: string;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/**
 * week_stat_tiles: six league-wide figures for the top of the page (plan
 * 11.2). Each row is one tile: an id, a label and the value as ONE string, so
 * the block can render label and value as a single text node and never draw a
 * number twice. A tile with nothing behind it says "no data".
 */
export function buildWeekStatTilesDataset(input: StatTilesInput): BundleDataset {
  const { relays, inSeason, dynasty, players, lines, week, computedAt } = input;
  const injuries = relays.filter((r) => r.kind === "injury").length;
  const ruledOut = new Set<string>();
  for (const r of relays) {
    if (r.availability === "out" || r.availability === "ir") for (const pid of r.players) ruledOut.add(pid);
  }
  const transactions = relays.filter((r) => TRANSACTION_KINDS.has(r.kind)).length;

  const rows: Row[] = [
    { id: "reports", label: "Reports this period", value: String(relays.length) },
    { id: "injuries", label: "Injuries reported", value: String(injuries) },
    { id: "ruled_out", label: "Players ruled out or placed on IR", value: String(ruledOut.size) },
    { id: "transactions", label: "Transactions", value: String(transactions) },
  ];

  const mover = (direction: "up" | "down"): string => {
    if (!dynasty) return "no data";
    const withChange = dynasty.rows.filter((r) => r.change_7d !== null && players.has(r.player_id));
    withChange.sort((a, b) => (direction === "up" ? (b.change_7d ?? 0) - (a.change_7d ?? 0) : (a.change_7d ?? 0) - (b.change_7d ?? 0)));
    const top = withChange[0];
    if (!top || (direction === "up" ? (top.change_7d ?? 0) <= 0 : (top.change_7d ?? 0) >= 0)) return "no data";
    return `${players.get(top.player_id)!.name}, ${signed(top.change_7d ?? 0)}`;
  };

  if (inSeason) {
    rows.push({
      id: "top_riser",
      label: `Biggest value riser, ${dynasty?.formatDisplay ?? "dynasty"}`,
      value: mover("up"),
    });
    let scorer = "no data";
    if (lines && lines.length > 0) {
      const best = [...lines].filter((l) => l.pts_ppr !== null && players.has(l.player_id)).sort((a, b) => (b.pts_ppr ?? 0) - (a.pts_ppr ?? 0))[0];
      if (best) scorer = `${players.get(best.player_id)!.name}, ${round1(best.pts_ppr)}`;
    }
    rows.push({ id: "top_scorer", label: `Top PPR scorer${week !== null ? `, week ${week}` : ""}`, value: scorer });
  } else {
    rows.push({
      id: "top_faller",
      label: `Biggest value faller, ${dynasty?.formatDisplay ?? "dynasty"}`,
      value: mover("down"),
    });
    const teamCounts = new Map<string, number>();
    for (const r of relays) for (const t of r.teams) teamCounts.set(t, (teamCounts.get(t) ?? 0) + 1);
    const top = [...teamCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    rows.push({
      id: "most_mentioned_team",
      label: "Most-mentioned team",
      value: top ? `${top[0]}, ${top[1]} report${top[1] === 1 ? "" : "s"}` : "no data",
    });
  }

  return {
    id: "week_stat_tiles",
    kind: "week_stat_tiles",
    title: inSeason && week !== null ? `Week ${week} at a glance` : "The period at a glance",
    columns: ["id", "label", "value"],
    rows,
    source_note: `Counts are the period's Relays. ${
      dynasty ? `The value figure is the seven-day change on ${dynasty.sourceDisplay}, ${dynasty.formatDisplay}.` : "No value source was available for this period."
    }${inSeason ? " The top scorer is the week's best PPR line in player_stats." : ""}`,
    computed_at: computedAt,
  };
}

export interface AllDatasetsInput {
  relays: DatasetRelay[];
  players: PlayerIndex;
  /** Player ids the bundle carries (the Relays' players), for box_score_lines. */
  bundlePlayerIds: string[];
  /** The edition formats in order; the first is treated as the dynasty format. */
  trends: FormatTrend[];
  dynasty: FormatTrend | null;
  redraft: FormatTrend | null;
  lines: WeekLine[] | null;
  week: number | null;
  inSeason: boolean;
  faabSettings: FaabSettings;
  computedAt: string;
}

/** Every dataset the bundle ships, keyed by id. */
export function buildAllDatasets(input: AllDatasetsInput): Record<string, BundleDataset> {
  const out: Record<string, BundleDataset> = {};
  const add = (d: BundleDataset) => {
    out[d.id] = d;
  };
  add(
    buildWeekStatTilesDataset({
      relays: input.relays,
      inSeason: input.inSeason,
      dynasty: input.dynasty,
      players: input.players,
      lines: input.lines,
      week: input.week,
      computedAt: input.computedAt,
    }),
  );
  if (input.dynasty) {
    add(buildValueMoversDataset("up", input.dynasty, input.players, input.computedAt));
    add(buildValueMoversDataset("down", input.dynasty, input.players, input.computedAt));
  }
  if (input.trends.length > 0) add(buildValueMoversByFormatDataset(input.trends, input.players, input.computedAt));
  if (input.lines && input.week !== null) {
    for (const position of DATASET_POSITIONS) {
      add(buildTopScorersDataset(position, input.lines, input.players, input.week, input.computedAt));
    }
    add(buildBoxScoreLinesDataset(input.bundlePlayerIds, input.lines, input.players, input.week, input.computedAt));
  }
  const injury = buildInjuryTimelineDataset(input.relays, input.players, input.inSeason ? input.week : null, input.computedAt);
  add(injury);
  if (input.redraft) {
    add(
      buildWaiverTargetsDataset({
        redraft: input.redraft,
        dynasty: input.dynasty,
        players: input.players,
        injuredPlayerIds: new Set(injury.rows.map((r) => String(r.player_id))),
        faabSettings: input.faabSettings,
        computedAt: input.computedAt,
      }),
    );
  }
  return out;
}
