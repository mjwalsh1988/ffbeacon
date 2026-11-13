import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createCachedReadClient } from "@/lib/supabase/server";
import { fetchAllRows, fetchAllRowsByKeyset } from "@/lib/supabase/fetch-all";
import { CACHE_TAGS, CACHE_TTL } from "@/lib/cache-tags";
import { SITE_TIME_ZONE } from "@/lib/datetime";
import { loadLatestPickSnapshot, type PickSnapshotRow } from "@/lib/draft-pick-snapshot";
import { getActiveFormats, getAvailableSources, resolveSourceForFormat } from "@/lib/source";
import { pickDynastyFormat } from "@/lib/guides/dynasty-age-market";
import { isBestBall } from "@/lib/rankings-formats";

/**
 * The live figures in the dynasty rookie draft guide. Four reads, each cached
 * and each allowed to fail on its own: a figure that cannot be read is left out
 * of the page, and the lesson around it still stands.
 *
 *   1. ROOKIE DRAFT FACTS. One row per completed rookie draft we synced from
 *      Sleeper (the first pick of each, from draft_selections): how many are
 *      linear, how many rounds, how many teams, and the month each started.
 *   2. THE CLASS BOARD. Where the newest rookie class went in those drafts,
 *      from draft_market_adp, the derived table the draft-value build writes:
 *      average pick, spread, earliest and latest pick per rookie, per format.
 *   3. THE PICK LADDER. Today's price of every rookie pick slot for the next
 *      class, from the newest draft_pick_values capture for the reader's value
 *      source and dynasty format.
 *   4. THE PRICE HISTORY. The same class's mid first and mid second, week by
 *      week, for as long as we have recorded them.
 *
 * ACCESS. draft_selections and draft_market_adp are service-role tables,
 * because the raw rows carry who picked whom. Only aggregates and a rookie's
 * own name and average pick leave this module; no manager, league or draft id
 * does. draft_pick_values is public-read and is read with the anon client.
 *
 * SOURCE AND FORMAT. The two value figures follow the reader's value source
 * and league format, resolved by the page and passed in. A redraft or best
 * ball reader sees the dynasty format with the same quarterback count, the
 * same rule the dynasty strategy guide uses (pickDynastyFormat). The source is
 * named by display_name, never by slug.
 */

/* ---------- 1. Rookie draft facts ---------- */

export type RookieDraftRow = {
  season: number;
  draftType: string | null;
  teams: number | null;
  rounds: number | null;
  /** When the first pick was made, ISO. */
  startedAt: string | null;
};

export type Share = { key: string; label: string; count: number; pct: number };

export type RookieDraftFacts = {
  season: number;
  drafts: number;
  /** Completed rookie drafts across every season on file. */
  allSeasonsDrafts: number;
  seasons: { season: number; drafts: number }[];
  linearPct: number;
  /** Draft lengths, shortest first. */
  rounds: Share[];
  commonRounds: number;
  commonRoundsPct: number;
  /** League sizes, smallest first. */
  teams: Share[];
  commonTeams: number;
  commonTeamsPct: number;
  /** Start months in calendar order, months with no draft left out. */
  months: Share[];
  busiestMonth: string;
  busiestMonthPct: number;
  /** Share of drafts that had started by May 31. */
  byEndOfMayPct: number;
};

/** A season needs this many completed drafts before the page describes it. */
export const MIN_DRAFTS_FOR_FACTS = 30;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const EASTERN_MONTH = new Intl.DateTimeFormat("en-US", { month: "numeric", timeZone: SITE_TIME_ZONE });

/** 1 to 12 in America/New_York, or null on a bad date. */
export function easternMonth(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const m = Number(EASTERN_MONTH.format(d));
  return m >= 1 && m <= 12 ? m : null;
}

function pctOf(count: number, total: number): number {
  return total > 0 ? Math.round((100 * count) / total) : 0;
}

function tally(values: (number | null)[], label: (v: number) => string): Share[] {
  const counts = new Map<number, number>();
  let total = 0;
  for (const v of values) {
    if (v === null || !Number.isFinite(v)) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
    total += 1;
  }
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([v, count]) => ({ key: String(v), label: label(v), count, pct: pctOf(count, total) }));
}

function mostCommon(shares: Share[]): Share | null {
  return shares.reduce<Share | null>((best, s) => (best === null || s.count > best.count ? s : best), null);
}

/**
 * Pure. Describes the newest FINISHED season (its rookie drafts are over once
 * September starts) that has enough completed drafts. Returns
 * null when no season does, so the page prints nothing rather than a
 * percentage of four drafts.
 */
export function summarizeRookieDrafts(rows: RookieDraftRow[], now: Date): RookieDraftFacts | null {
  const bySeason = new Map<number, RookieDraftRow[]>();
  for (const r of rows) {
    const list = bySeason.get(r.season) ?? [];
    list.push(r);
    bySeason.set(r.season, list);
  }
  const seasons = [...bySeason.entries()]
    .map(([season, list]) => ({ season, drafts: list.length }))
    .sort((a, b) => a.season - b.season);
  // Only a finished season. A class still being drafted would report that
  // every draft started by May, because the August ones have not happened yet.
  const finishedBefore = upcomingRookieClass(now);
  const pick = [...seasons].reverse().find((s) => s.season < finishedBefore && s.drafts >= MIN_DRAFTS_FOR_FACTS);
  if (!pick) return null;
  const list = bySeason.get(pick.season) ?? [];

  const rounds = tally(
    list.map((r) => r.rounds),
    (v) => `${v} ${v === 1 ? "round" : "rounds"}`,
  );
  const teams = tally(
    list.map((r) => r.teams),
    (v) => `${v} teams`,
  );
  const monthNumbers = list.map((r) => easternMonth(r.startedAt));
  const months = tally(monthNumbers, (v) => MONTH_NAMES[v - 1]);
  const dated = monthNumbers.filter((m): m is number => m !== null);
  const commonRounds = mostCommon(rounds);
  const commonTeams = mostCommon(teams);
  const busiest = mostCommon(months);
  if (!commonRounds || !commonTeams || !busiest) return null;

  return {
    season: pick.season,
    drafts: list.length,
    allSeasonsDrafts: rows.length,
    seasons,
    linearPct: pctOf(list.filter((r) => r.draftType === "linear").length, list.length),
    rounds,
    commonRounds: Number(commonRounds.key),
    commonRoundsPct: commonRounds.pct,
    teams,
    commonTeams: Number(commonTeams.key),
    commonTeamsPct: commonTeams.pct,
    months,
    busiestMonth: busiest.label,
    busiestMonthPct: busiest.pct,
    byEndOfMayPct: pctOf(dated.filter((m) => m <= 5).length, dated.length),
  };
}

async function readRookieDraftRows(): Promise<RookieDraftRow[]> {
  const db = createAdminClient();
  // One row per draft: its first pick. A rookie draft that was never finished
  // is left out, because its length and its start say nothing settled.
  const rows = await fetchAllRowsByKeyset(
    "rookie draft first picks",
    (after, limit) => {
      let q = db
        .from("draft_selections")
        .select("id, season, draft_type, teams, rounds, drafted_at")
        .eq("player_pool", "rookies")
        .eq("draft_status", "complete")
        .eq("pick_no", 1)
        .order("id", { ascending: true })
        .limit(limit);
      if (after !== null) q = q.gt("id", after);
      return q;
    },
    (row) => row.id,
  );
  return rows.map((r) => ({
    season: r.season,
    draftType: r.draft_type,
    teams: r.teams,
    rounds: r.rounds,
    startedAt: r.drafted_at,
  }));
}

const readRookieDraftRowsCached = unstable_cache(readRookieDraftRows, ["guide-rookie-draft-rows"], {
  revalidate: CACHE_TTL.daily,
});

/* ---------- 2. The class board ---------- */

export const BOARD_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export type BoardPosition = (typeof BOARD_POSITIONS)[number];

/** A rookie counts once more than half the drafts in a format took him. */
export const MIN_DRAFT_RATE = 0.5;
/** A format needs this many drafts before its board is shown. */
export const MIN_DRAFTS_FOR_BOARD = 20;
export const BOARD_SIZE = 24;

export type AdpRow = {
  season: number;
  formatSlug: string;
  name: string;
  slug: string | null;
  position: string;
  adp: number;
  stdev: number | null;
  earliest: number;
  latest: number;
  draftRate: number;
  drafts: number;
};

export type BoardPlayer = {
  rank: number;
  name: string;
  slug: string | null;
  position: BoardPosition;
  adp: number;
  stdev: number | null;
  earliest: number;
  latest: number;
};

export type SpreadBand = { label: string; from: number; to: number; stdev: number | null };

export type ClassBoard = {
  season: number;
  format: { slug: string; displayName: string };
  drafts: number;
  players: BoardPlayer[];
  spread: SpreadBand[];
  /** Offensive positions among the first twelve by average pick. */
  firstRound: Record<BoardPosition, number>;
};

export type QbGapRow = { name: string; slug: string | null; oneQb: number; superflex: number };

export type QbGap = {
  season: number;
  oneQb: { displayName: string; drafts: number };
  superflex: { displayName: string; drafts: number };
  rows: QbGapRow[];
};

type FormatMeta = {
  slug: string;
  display_name: string;
  league_type: string;
  is_superflex: boolean;
  te_premium_bonus?: number | string | null;
};

function hasTePremium(f: FormatMeta): boolean {
  return Number(f.te_premium_bonus ?? 0) > 0;
}

function isBoardPosition(p: string): p is BoardPosition {
  return (BOARD_POSITIONS as readonly string[]).includes(p);
}

function qualifying(rows: AdpRow[], season: number, formatSlug: string): AdpRow[] {
  return rows
    .filter(
      (r) =>
        r.season === season &&
        r.formatSlug === formatSlug &&
        r.draftRate >= MIN_DRAFT_RATE &&
        isBoardPosition(r.position),
    )
    .sort((a, b) => a.adp - b.adp || a.name.localeCompare(b.name));
}

function draftsIn(rows: AdpRow[], season: number, formatSlug: string): number {
  return rows.reduce((m, r) => (r.season === season && r.formatSlug === formatSlug ? Math.max(m, r.drafts) : m), 0);
}

const SPREAD_BANDS: { label: string; from: number; to: number }[] = [
  { label: "Picks 1 to 3", from: 1, to: 3 },
  { label: "Picks 4 to 6", from: 4, to: 6 },
  { label: "Picks 7 to 12", from: 7, to: 12 },
  { label: "Picks 13 to 24", from: 13, to: 24 },
];

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Pure. The newest season in which the wanted format (or, failing that, the
 * best-sampled dynasty format with the same quarterback count) has enough
 * drafts. Null when none does.
 */
export function buildClassBoard(rows: AdpRow[], formats: FormatMeta[], wantedSlug: string): ClassBoard | null {
  const dynasty = formats.filter((f) => f.league_type === "dynasty" && !isBestBall(f.slug));
  const wanted = dynasty.find((f) => f.slug === wantedSlug);
  if (!wanted) return null;
  const sameCount = dynasty.filter((f) => f.is_superflex === wanted.is_superflex);
  const seasons = [...new Set(rows.map((r) => r.season))].sort((a, b) => b - a);
  for (const season of seasons) {
    const sampled = (f: FormatMeta) => draftsIn(rows, season, f.slug);
    const format =
      sampled(wanted) >= MIN_DRAFTS_FOR_BOARD
        ? wanted
        : [...sameCount].sort((a, b) => sampled(b) - sampled(a)).find((f) => sampled(f) >= MIN_DRAFTS_FOR_BOARD);
    if (!format) continue;
    const top = qualifying(rows, season, format.slug).slice(0, BOARD_SIZE);
    if (top.length < 12) continue;
    const players: BoardPlayer[] = top.map((r, i) => ({
      rank: i + 1,
      name: r.name,
      slug: r.slug,
      position: r.position as BoardPosition,
      adp: r.adp,
      stdev: r.stdev,
      earliest: r.earliest,
      latest: r.latest,
    }));
    const firstRound: Record<BoardPosition, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
    for (const p of players.slice(0, 12)) firstRound[p.position] += 1;
    return {
      season,
      format: { slug: format.slug, displayName: format.display_name },
      drafts: sampled(format),
      players,
      spread: SPREAD_BANDS.map((b) => ({
        ...b,
        stdev: mean(
          players
            .filter((p) => p.rank >= b.from && p.rank <= b.to && p.stdev !== null)
            .map((p) => p.stdev as number),
        ),
      })),
      firstRound,
    };
  }
  return null;
}

/**
 * Pure. The same rookie quarterbacks in the best-sampled one-quarterback and
 * superflex dynasty formats of the newest season that has both.
 */
export function buildQbGap(rows: AdpRow[], formats: FormatMeta[]): QbGap | null {
  const dynasty = formats.filter((f) => f.league_type === "dynasty" && !isBestBall(f.slug));
  const seasons = [...new Set(rows.map((r) => r.season))].sort((a, b) => b - a);
  for (const season of seasons) {
    const sampled = (superflex: boolean) =>
      dynasty
        .filter((f) => f.is_superflex === superflex)
        .map((f) => ({ f, drafts: draftsIn(rows, season, f.slug) }))
        .filter((x) => x.drafts >= MIN_DRAFTS_FOR_BOARD);
    // Every pair with enough drafts on both sides. A pair that agrees on tight
    // end premium comes first, so the quarterback count is the only thing
    // that differs between the two columns; then the better-sampled pair.
    const pairs = sampled(false)
      .flatMap((one) => sampled(true).map((two) => ({ one, two })))
      .sort(
        (a, b) =>
          Number(hasTePremium(b.one.f) === hasTePremium(b.two.f)) -
            Number(hasTePremium(a.one.f) === hasTePremium(a.two.f)) ||
          Math.min(b.one.drafts, b.two.drafts) - Math.min(a.one.drafts, a.two.drafts),
      );
    if (pairs.length === 0) continue;
    const { one, two } = pairs[0];
    const oneQbs = qualifying(rows, season, one.f.slug).filter((r) => r.position === "QB");
    const twoQbs = qualifying(rows, season, two.f.slug).filter((r) => r.position === "QB");
    const out: QbGapRow[] = [];
    for (const q of twoQbs) {
      const match = oneQbs.find((o) => (o.slug ?? o.name) === (q.slug ?? q.name));
      if (match) out.push({ name: q.name, slug: q.slug, oneQb: match.adp, superflex: q.adp });
    }
    if (out.length === 0) continue;
    return {
      season,
      oneQb: { displayName: one.f.display_name, drafts: one.drafts },
      superflex: { displayName: two.f.display_name, drafts: two.drafts },
      rows: out,
    };
  }
  return null;
}

async function readRookieAdpRows(): Promise<AdpRow[]> {
  const db = createAdminClient();
  const { data: newest, error: newestErr } = await db
    .from("draft_market_adp")
    .select("season")
    .eq("player_pool", "rookies")
    .order("season", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (newestErr) throw new Error(`newest rookie ADP season: ${newestErr.message}`);
  // An empty table is a rebuild in progress, not an answer. Throwing keeps it
  // out of the cache.
  if (!newest) throw new Error("no rookie ADP rows on file");

  // The newest season and the one before it, so a class with only a handful of
  // drafts in so far falls back to last year's rather than to nothing.
  // A few hundred rows; paged anyway, on an order that is unique as a whole
  // (one row per season, format and player), so no page repeats or skips one.
  const rows = await fetchAllRows("rookie ADP rows", (from, to) =>
    db
      .from("draft_market_adp")
      .select(
        "player_id, season, format_slug, adp, pick_stdev, earliest_pick, latest_pick, draft_rate, drafts_sampled, players!inner(full_name, position, slug)",
      )
      .eq("player_pool", "rookies")
      .gte("season", newest.season - 1)
      .gte("draft_rate", MIN_DRAFT_RATE)
      .order("season", { ascending: true })
      .order("format_slug", { ascending: true })
      .order("player_id", { ascending: true })
      .range(from, to),
  );

  const out: AdpRow[] = [];
  for (const r of rows) {
    const p = (r as unknown as { players: { full_name: string | null; position: string; slug: string } | null })
      .players;
    if (!p || !p.full_name) continue;
    out.push({
      season: r.season,
      formatSlug: r.format_slug,
      name: p.full_name,
      slug: p.slug,
      position: p.position,
      adp: Number(r.adp),
      stdev: r.pick_stdev === null ? null : Number(r.pick_stdev),
      earliest: r.earliest_pick,
      latest: r.latest_pick,
      draftRate: Number(r.draft_rate),
      drafts: r.drafts_sampled,
    });
  }
  return out;
}

const readRookieAdpRowsCached = unstable_cache(readRookieAdpRows, ["guide-rookie-adp-rows"], {
  revalidate: CACHE_TTL.daily,
  // The nightly draft-value build rewrites this table and busts this tag.
  tags: [CACHE_TAGS.marketAdp],
});

/* ---------- 3. The pick ladder ---------- */

export const PICK_POSITIONS = ["early", "mid", "late"] as const;
export type PickPosition = (typeof PICK_POSITIONS)[number];

const ROUND_NAME = ["1st", "2nd", "3rd", "4th", "5th", "6th"];
const POSITION_NAME: Record<PickPosition, string> = { early: "Early", mid: "Mid", late: "Late" };

export type LadderSlot = {
  key: string;
  round: number;
  position: PickPosition;
  /** "Early 1st". */
  label: string;
  value: number;
  /** The slot's value as a percent of an early first, rounded. */
  index: number;
};

export type PickLadder = {
  season: number;
  slots: LadderSlot[];
  /** How much less a mid first one class further out costs, in percent, or null. */
  nextYearDiscountPct: number | null;
};

/**
 * The rookie class whose picks are still to be used. Rookie drafts run from
 * late April into August, so a class counts as the coming one until
 * September 1 of its own year.
 */
export function upcomingRookieClass(now: Date): number {
  const year = now.getUTCFullYear();
  return now.getUTCMonth() >= 8 ? year + 1 : year;
}

/** Pure. Null unless the season has an early first and at least six slots. */
export function buildPickLadder(rows: PickSnapshotRow[], classSeason: number): PickLadder | null {
  const seasons = [...new Set(rows.map((r) => r.season))].filter((s) => s >= classSeason).sort((a, b) => a - b);
  const season = seasons[0];
  if (season === undefined) return null;
  const at = (s: number, round: number, position: string) =>
    rows.find((r) => r.season === s && r.round === round && r.pick_position === position)?.value ?? null;
  const top = at(season, 1, "early");
  if (top === null || !(top > 0)) return null;

  const slots: LadderSlot[] = [];
  for (let round = 1; round <= ROUND_NAME.length; round++) {
    for (const position of PICK_POSITIONS) {
      const value = at(season, round, position);
      if (value === null || !(value > 0)) continue;
      slots.push({
        key: `${round}-${position}`,
        round,
        position,
        label: `${POSITION_NAME[position]} ${ROUND_NAME[round - 1]}`,
        value,
        index: Math.round((100 * value) / top),
      });
    }
  }
  if (slots.length < 6) return null;

  const mid = at(season, 1, "mid");
  const nextMid = at(season + 1, 1, "mid");
  const nextYearDiscountPct =
    mid !== null && nextMid !== null && mid > 0 && nextMid < mid ? Math.round((100 * (mid - nextMid)) / mid) : null;
  return { season, slots, nextYearDiscountPct };
}

/* ---------- 4. The price history ---------- */

export type PricePoint = {
  /** The Monday that starts the week, YYYY-MM-DD (UTC). */
  week: string;
  first: number | null;
  second: number | null;
};

export type PriceHistory = {
  season: number;
  points: PricePoint[];
  /** Mid first: first recorded week, highest week, lowest week and newest week. */
  start: { week: string; value: number };
  high: { week: string; value: number };
  low: { week: string; value: number };
  latest: { week: string; value: number };
  /** Newest against the first recorded week, in percent, signed. */
  changePct: number;
  /** Highest week down to the lowest week after it, in percent, or 0. */
  dropFromHighPct: number;
};

/** A history shorter than this is a dot, not a line. */
export const MIN_PRICE_WEEKS = 8;

export function mondayOf(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getUTCDay();
  const back = day === 0 ? 6 : day - 1;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back));
  return monday.toISOString().slice(0, 10);
}

export type PriceRow = { capturedAt: string; round: number; value: number };

/** Pure. Weekly averages of the mid first and the mid second. */
export function buildPriceHistory(rows: PriceRow[], season: number): PriceHistory | null {
  const weeks = new Map<string, { first: number[]; second: number[] }>();
  for (const r of rows) {
    const week = mondayOf(r.capturedAt);
    if (!week || !(r.value > 0)) continue;
    const bucket = weeks.get(week) ?? { first: [], second: [] };
    if (r.round === 1) bucket.first.push(r.value);
    else if (r.round === 2) bucket.second.push(r.value);
    weeks.set(week, bucket);
  }
  const points: PricePoint[] = [...weeks.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, b]) => {
      const first = mean(b.first);
      const second = mean(b.second);
      return {
        week,
        first: first === null ? null : Math.round(first),
        second: second === null ? null : Math.round(second),
      };
    });
  const firsts = points.filter((p): p is PricePoint & { first: number } => p.first !== null);
  if (firsts.length < MIN_PRICE_WEEKS) return null;

  const pt = (p: { week: string; first: number }) => ({ week: p.week, value: p.first });
  const start = firsts[0];
  const latest = firsts[firsts.length - 1];
  const high = firsts.reduce((m, p) => (p.first > m.first ? p : m), firsts[0]);
  const low = firsts.reduce((m, p) => (p.first < m.first ? p : m), firsts[0]);
  const afterHigh = firsts.slice(firsts.indexOf(high));
  const lowAfterHigh = afterHigh.reduce((m, p) => (p.first < m.first ? p : m), afterHigh[0]);
  return {
    season,
    points,
    start: pt(start),
    high: pt(high),
    low: pt(low),
    latest: pt(latest),
    changePct: Math.round((1000 * (latest.first - start.first)) / start.first) / 10,
    dropFromHighPct: Math.round((1000 * (high.first - lowAfterHigh.first)) / high.first) / 10,
  };
}

async function readPriceRows(formatConfigId: string, source: string, season: number): Promise<PriceRow[]> {
  const db = createCachedReadClient();
  const rows = await fetchAllRowsByKeyset(
    `pick price history ${formatConfigId}/${source}/${season}`,
    (after, limit) => {
      let q = db
        .from("draft_pick_values")
        .select("id, captured_at, round, value")
        .eq("format_config_id", formatConfigId)
        .eq("source", source)
        .eq("season", season)
        .eq("pick_position", "mid")
        .in("round", [1, 2])
        .order("id", { ascending: true })
        .limit(limit);
      if (after !== null) q = q.gt("id", after);
      return q;
    },
    (row) => row.id,
  );
  return rows.map((r) => ({ capturedAt: r.captured_at, round: r.round, value: Number(r.value) }));
}

function readPickFigures(formatConfigId: string, source: string, classSeason: number) {
  return unstable_cache(
    async () => {
      const snapshot = await loadLatestPickSnapshot(createCachedReadClient(), formatConfigId, source);
      const ladder = buildPickLadder(snapshot.rows, classSeason);
      const history = ladder
        ? buildPriceHistory(await readPriceRows(formatConfigId, source, ladder.season), ladder.season)
        : null;
      return { asOf: snapshot.capturedAt, ladder, history };
    },
    ["guide-rookie-pick-figures", formatConfigId, source, String(classSeason)],
    { revalidate: CACHE_TTL.hourly, tags: [CACHE_TAGS.playerValues] },
  )();
}

/* ---------- The page's one call ---------- */

export type PickMarket = {
  sourceName: string;
  format: { slug: string; displayName: string };
  asOf: string | null;
  ladder: PickLadder;
  history: PriceHistory | null;
};

export type RookieGuideData = {
  drafts: RookieDraftFacts | null;
  board: ClassBoard | null;
  qbGap: QbGap | null;
  market: PickMarket | null;
};

async function settle<T>(label: string, work: () => Promise<T | null>): Promise<T | null> {
  try {
    return await work();
  } catch (err) {
    // The reader gets the lesson without the figure; the server log gets the reason.
    console.error(`[rookie draft guide] ${label} failed`, err);
    return null;
  }
}

export async function loadRookieGuideData(
  supabase: SupabaseClient<Database>,
  readerFormatSlug: string | null,
  requestedSourceSlug: string | null,
): Promise<RookieGuideData> {
  const [registry, formats] = await Promise.all([getAvailableSources(supabase), getActiveFormats(supabase)]);
  const format = pickDynastyFormat(formats, readerFormatSlug);

  const [drafts, adpRows, market] = await Promise.all([
    settle("rookie draft facts", async () => summarizeRookieDrafts(await readRookieDraftRowsCached(), new Date())),
    settle("rookie ADP", () => readRookieAdpRowsCached()),
    settle("pick market", async (): Promise<PickMarket | null> => {
      if (!format) return null;
      const resolved = resolveSourceForFormat(registry, "player_value_history", format.slug, requestedSourceSlug);
      if (!resolved.source) return null;
      const figures = await readPickFigures(format.id, resolved.source, upcomingRookieClass(new Date()));
      if (!figures.ladder) return null;
      return {
        sourceName: registry.find((r) => r.slug === resolved.source)?.display_name ?? "the selected source",
        format: { slug: format.slug, displayName: format.display_name },
        asOf: figures.asOf,
        ladder: figures.ladder,
        history: figures.history,
      };
    }),
  ]);

  return {
    drafts,
    board: adpRows && format ? buildClassBoard(adpRows, formats, format.slug) : null,
    qbGap: adpRows ? buildQbGap(adpRows, formats) : null,
    market,
  };
}
