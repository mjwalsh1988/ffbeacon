/**
 * The bundle: everything the desk run may write an edition from (plan
 * section 9.2). buildBundle(admin, now, override?) decides whether an edition
 * is due and, when it is, assembles the period's Relays, the players they
 * name with their values, week lines, season-to-date figures and next-week
 * projections, the league-wide scoreboard, the block-ready datasets, the
 * editorial instructions, the reference edition and any rejected attempt.
 *
 * Every player figure comes through an existing read path and never a raw
 * column: values through player_value_trends on the registry's default source
 * per edition format (resolveSourceForFormat, so a source that does not cover
 * a format falls through the way the site does, and the bundle names the
 * source actually used per format; for an override, which always names a
 * closed past period, the same trend calculation is run over
 * player_value_history as of the period's end instead, so a backfilled week
 * shows that week's movers and not today's); the week line through player_stats; the
 * projection and beat rate through lib/projections/read.ts
 * loadAdjustedProjections, which resolves the projection source itself.
 *
 * positional_war_note is always null here. Positional WAR is league-specific
 * (docs: it reads one league's own scoring and lineup slots) and the bundle
 * has no league context, so there is no honest figure to put there.
 *
 * The heavy assembly is memoised in-process for ten minutes keyed on the
 * period AND on every source it reads from (the value source resolved for each
 * edition format and the projection engine for the next-week window), because
 * a retry from the run should not rebuild it, and because a cache that outlives
 * a source flip must carry the source in its key (CLAUDE.md, Projection Engine
 * Source). The cheap "is it due" checks (an edition already in review, too few
 * off-season Relays) run on every call so the answer moves the moment a draft
 * lands.
 *
 * Every select names its columns, and anything that can exceed 1000 rows is
 * paged.
 */

import { isDefender } from "@/lib/site";
import { idp123Points, idpLineCells, snapPercent } from "./datasets";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { loadFaabSettings } from "@/lib/faab/settings";
import { bustMemo, memoTtl } from "@/lib/memo-ttl";
import { loadPowerPulseSettings } from "@/lib/power-pulse/settings";
import { loadAdjustedProjections } from "@/lib/projections/read";
import { resolveProjectionSourceForWindow } from "@/lib/projections/source";
import { parseRelayFacts } from "@/lib/relays/types";
import type { NflStateLike } from "@/lib/relays/week";
import { getNflState } from "@/lib/sleeper";
import { describeSource, getActiveFormats, getAvailableSources, resolveSourceForFormat } from "@/lib/source";
import { BLOCK_KIND_META, EDITION_FORMAT_SLUGS, SECTION_ICONS } from "./blocks";
import { periodForOffSeasonClose, periodForWeek, resolveCadence, type EditionPeriod } from "./cadence";
import {
  buildAllDatasets,
  rankTrendRows,
  type DatasetPlayer,
  type FormatTrend,
  type WeekLine,
} from "./datasets";
import type { BundleOverride } from "./override";
import { loadBriefDeskSettings, type BriefDeskSettings } from "./settings";
import { isInSeasonPhase, requiredSlugPrefix } from "./slug";
import type { Bundle, BundleFormatValue, BundleNotDue, BundlePlayer, BundleRelay, BundleTeam, BundleWeekResult } from "./types";
import { loadWeekResults } from "./week-results";
import { loadGameDatasets, PPR_STORED_SCORING } from "./game-data";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { computeTrendRows, INTERVAL_DAYS_BY_CADENCE, type HistoryRow } from "@/lib/calculate-trends";
import { FALLBACK_STALE_DAYS, staleDaysFor } from "@/lib/beacon/freshness";

type Admin = SupabaseClient<Database>;

export type { BundleOverride } from "./override";

export const BUNDLE_MEMO_PREFIX = "brief-desk:bundle:";
const BUNDLE_TTL_MS = 10 * 60_000;
const ID_BATCH = 300;
/** How far back an off-season period may be extended to cover skipped periods. */
const MAX_ROLL_BACK_MS = 90 * 86_400_000;
/** How many players the datasets need names for beyond the Relays' own. */
const MOVER_CANDIDATES = 30;
const WAIVER_CANDIDATES = 60;
/**
 * The reference edition the run matches (instruction 11). The week 3, 2026
 * redo is the first in the game-by-game format (plan section 23); week 1 stays
 * beside it in the folder as the record of the old shape.
 */
const EXAMPLE_PATH = path.join("docs", "beacon-brief", "examples", "week-3-2026-brief.json");

/** The typed defensive columns (migration 0296), read beside the offensive ones. */
const IDP_STAT_COLUMNS =
  "def_snp, def_snap_pct, idp_tkl, idp_tkl_solo, idp_tkl_ast, idp_tkl_loss, idp_sack, idp_qb_hit, idp_pass_def, idp_int, idp_ff, idp_fum_rec, idp_def_td, idp_safe, idp_blk_kick";

const STAT_COLUMNS =
  `player_id, opponent, pts_ppr, pts_half_ppr, pts_std, pass_att, pass_cmp, pass_yd, pass_td, pass_int, rush_att, rush_yd, rush_td, rec_tgt, rec, rec_yd, rec_td, fum_lost, snap_pct, ${IDP_STAT_COLUMNS}` as const;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Page a query to completion. The factory builds a fresh query per page
 * because a PostgREST builder mutates as filters are added. Pages are ordered
 * by the caller on a unique key. This used to stop silently at 80 pages (80k
 * rows) and return what it had; fetchAllRows throws instead of returning a
 * partial set.
 */
function pageAll<T>(
  factory: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  return fetchAllRows("brief desk bundle", factory);
}

function playerName(p: { full_name: string | null; first_name: string; last_name: string }): string {
  return p.full_name ?? `${p.first_name} ${p.last_name}`.trim();
}

function toStateLike(state: Awaited<ReturnType<typeof getNflState>>): NflStateLike | null {
  if (!state) return null;
  return {
    season: state.season,
    season_type: state.season_type,
    week: state.week,
    season_start_date: state.season_start_date ?? null,
  };
}

/** The period an override names, or null when it names nothing real. */
function periodForOverride(state: NflStateLike, settings: BriefDeskSettings, override: BundleOverride): EditionPeriod | null {
  if (override.season !== state.season) return null;
  if ("week" in override) return periodForWeek(state, settings, override.week);
  return periodForOffSeasonClose(state, settings, override.periodEnd);
}

type EditionStatusRow = { edition_id: string; status: string; review_notes: string | null; reviewed_at: string | null; draft_payload: unknown; created_at: string };

/** Every edition already drafted for this period, with its article's status. */
async function loadPeriodEditions(admin: Admin, period: EditionPeriod): Promise<EditionStatusRow[]> {
  const { data: editions } = await admin
    .from("brief_editions")
    .select("id, article_id, review_notes, reviewed_at, draft_payload, created_at")
    .eq("season", period.season)
    .eq("period_end", period.periodEnd)
    .order("created_at", { ascending: false })
    .limit(50);
  if (!editions || editions.length === 0) return [];
  const { data: articles } = await admin
    .from("articles")
    .select("id, status")
    .in("id", editions.map((e) => e.article_id));
  const statusById = new Map((articles ?? []).map((a) => [a.id, a.status]));
  return editions.map((e) => ({
    edition_id: e.id,
    status: statusById.get(e.article_id) ?? "missing",
    review_notes: e.review_notes,
    reviewed_at: e.reviewed_at,
    draft_payload: e.draft_payload,
    created_at: e.created_at,
  }));
}

/**
 * Off-season only: when earlier periods were skipped for want of Relays, the
 * open period covers them too. The start is pulled back to the newest
 * published edition's period_end, capped at MAX_ROLL_BACK_MS so a first
 * edition after a long gap does not cover half a year.
 */
async function extendForRolledPeriods(admin: Admin, period: EditionPeriod): Promise<EditionPeriod> {
  if (period.phase !== "off") return period;
  const { data: published } = await admin
    .from("articles")
    .select("id")
    .eq("article_type", "brief")
    .eq("status", "published")
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(20);
  const ids = (published ?? []).map((a) => a.id);
  if (ids.length === 0) return period;
  const { data: editions } = await admin
    .from("brief_editions")
    .select("period_end")
    .in("article_id", ids)
    .order("period_end", { ascending: false })
    .limit(1);
  const newestEnd = editions?.[0]?.period_end ?? null;
  if (!newestEnd) return period;
  const start = new Date(period.periodStart).getTime();
  const newest = new Date(newestEnd).getTime();
  if (newest >= start || start - newest > MAX_ROLL_BACK_MS) return period;
  return { ...period, periodStart: new Date(newest).toISOString() };
}

async function countPeriodRelays(admin: Admin, period: EditionPeriod): Promise<number> {
  const { count } = await admin
    .from("relays")
    .select("id", { count: "exact", head: true })
    .in("status", ["published", "hidden"])
    .gte("source_posted_at", period.periodStart)
    .lt("source_posted_at", period.periodEnd);
  return count ?? 0;
}

type RelayLite = {
  id: string;
  slug: string;
  kind: string;
  headline: string;
  facts: unknown;
  timeline: string | null;
  availability: string | null;
  relevance_tier: number;
  source_handle: string;
  source_url: string;
  source_posted_at: string;
  follows_relay_id: string | null;
  status: string;
};

async function loadPeriodRelays(admin: Admin, period: EditionPeriod): Promise<BundleRelay[]> {
  const rows = await pageAll<RelayLite>((from, to) =>
    admin
      .from("relays")
      .select(
        "id, slug, kind, headline, facts, timeline, availability, relevance_tier, source_handle, source_url, source_posted_at, follows_relay_id, status",
      )
      .in("status", ["published", "hidden"])
      .gte("source_posted_at", period.periodStart)
      .lt("source_posted_at", period.periodEnd)
      .order("source_posted_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  const playersByRelay = new Map<string, string[]>();
  const primaryByRelay = new Map<string, string[]>();
  const teamIdsByRelay = new Map<string, string[]>();
  for (const batch of chunk(rows.map((r) => r.id), ID_BATCH)) {
    const [{ data: rp }, { data: rt }] = await Promise.all([
      admin.from("relay_players").select("relay_id, player_id, is_primary").in("relay_id", batch),
      admin.from("relay_teams").select("relay_id, team_id").in("relay_id", batch),
    ]);
    for (const r of rp ?? []) {
      playersByRelay.set(r.relay_id, [...(playersByRelay.get(r.relay_id) ?? []), r.player_id]);
      if (r.is_primary) primaryByRelay.set(r.relay_id, [...(primaryByRelay.get(r.relay_id) ?? []), r.player_id]);
    }
    for (const r of rt ?? []) teamIdsByRelay.set(r.relay_id, [...(teamIdsByRelay.get(r.relay_id) ?? []), r.team_id]);
  }
  const teamIds = [...new Set([...teamIdsByRelay.values()].flat())];
  const abbrById = new Map<string, string>();
  for (const batch of chunk(teamIds, ID_BATCH)) {
    const { data } = await admin.from("nfl_teams").select("id, abbreviation").in("id", batch);
    for (const t of data ?? []) abbrById.set(t.id, t.abbreviation);
  }
  return rows.map((r) => {
    const players = [...new Set(playersByRelay.get(r.id) ?? [])];
    return {
      id: r.id,
      slug: r.slug,
      permalink: `/brief/relay/${r.slug}`,
      kind: r.kind,
      headline: r.headline,
      facts: parseRelayFacts(r.facts),
      timeline: r.timeline,
      availability: r.availability,
      relevance_tier: r.relevance_tier,
      source_handle: r.source_handle,
      source_url: r.source_url,
      source_posted_at: r.source_posted_at,
      players,
      subject_player_ids: [...new Set(primaryByRelay.get(r.id) ?? (players.length === 1 ? players : []))],
      teams: [...new Set((teamIdsByRelay.get(r.id) ?? []).map((id) => abbrById.get(id)).filter((a): a is string => Boolean(a)))].sort(),
      follows_relay_id: r.follows_relay_id,
      status: r.status === "hidden" ? "hidden" : "published",
    };
  });
}

async function loadPlayers(admin: Admin, ids: string[]): Promise<Map<string, DatasetPlayer>> {
  const out = new Map<string, DatasetPlayer>();
  for (const batch of chunk([...new Set(ids)], ID_BATCH)) {
    const { data } = await admin.from("players").select("id, slug, full_name, first_name, last_name, position, team, external_ids").in("id", batch);
    for (const p of data ?? []) {
      const sid = (p.external_ids as { sleeper?: unknown } | null)?.sleeper;
      const sleeperId = typeof sid === "string" || typeof sid === "number" ? String(sid) : null;
      out.set(p.id, { id: p.id, name: playerName(p), slug: p.slug, position: p.position, team: p.team, sleeper_id: sleeperId });
    }
  }
  return out;
}

/**
 * The Relays' teams plus every team that played in the edition's week, each
 * with its final score when one can be derived (./week-results.ts). A team on
 * bye, or any period without a week, carries week_result null.
 */
async function loadTeams(admin: Admin, abbreviations: string[], results: Map<string, BundleWeekResult>): Promise<Record<string, BundleTeam>> {
  const out: Record<string, BundleTeam> = {};
  const wanted = [...new Set([...abbreviations, ...results.keys()])];
  if (wanted.length === 0) return out;
  const { data } = await admin.from("nfl_teams").select("abbreviation, name").in("abbreviation", wanted);
  for (const t of data ?? []) out[t.abbreviation] = { name: t.name, week_result: results.get(t.abbreviation) ?? null };
  return out;
}

type TrendInputRow = { player_id: string; current_value: number; change_7d: number | null; change_30d: number | null };

/**
 * History back from `asOf` far enough for the 30-day window plus its
 * half-window bookend tolerance (lib/calculate-trends.ts), with margin.
 */
const AS_OF_LOOKBACK_DAYS = 50;

/**
 * One format and source's trend rows AS OF a closed period's end, computed
 * from player_value_history by the nightly trend calculation itself
 * (computeTrendRows with its clock set to `asOf`). player_value_trends only
 * ever holds today's figures, so reading it for a backfilled week would print
 * this week's movers under that week's heading.
 */
async function loadTrendRowsAsOf(admin: Admin, formatConfigId: string, source: string, asOf: string): Promise<TrendInputRow[]> {
  const asOfMs = new Date(asOf).getTime();
  const since = new Date(asOfMs - AS_OF_LOOKBACK_DAYS * 86_400_000).toISOString();
  const [history, cadence] = await Promise.all([
    fetchAllRows<HistoryRow>("brief desk trends as of", (from, to) =>
      admin
        .from("player_value_history")
        .select("id, player_id, format_config_id, source, value, captured_at, formula_offset")
        .eq("format_config_id", formatConfigId)
        .eq("source", source)
        .gte("captured_at", since)
        .lte("captured_at", asOf)
        .order("captured_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    admin.from("source_registry").select("update_cadence").eq("slug", source).maybeSingle(),
  ]);
  // The nightly calc iterates in id order and its per-day dedup keeps the
  // first row seen, so the same order gives the same figures.
  history.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const update = cadence.data?.update_cadence ?? "daily";
  const intervals = new Map([[source, INTERVAL_DAYS_BY_CADENCE[update] ?? INTERVAL_DAYS_BY_CADENCE.daily]]);
  const stale = new Map([[source, staleDaysFor(update, FALLBACK_STALE_DAYS)]]);
  return computeTrendRows(history, asOfMs, intervals, stale)
    .map((r) => ({ player_id: r.player_id, current_value: r.current_value, change_7d: r.change_7d, change_30d: r.change_30d }))
    .sort((a, b) => b.current_value - a.current_value || (a.player_id < b.player_id ? -1 : 1));
}

/**
 * One format's trend rows on the registry's default source for that format:
 * today's player_value_trends, or, for a closed past period (`asOf`), the
 * same figures as they stood at its end.
 */
async function loadFormatTrend(admin: Admin, formatSlug: string, asOf: string | null): Promise<FormatTrend | null> {
  const [formats, registry] = await Promise.all([getActiveFormats(admin), getAvailableSources(admin)]);
  const format = formats.find((f) => f.slug === formatSlug);
  if (!format) return null;
  const resolved = resolveSourceForFormat(registry, "player_value_history", formatSlug, null);
  if (!resolved.source) {
    return { formatSlug, formatDisplay: format.display_name, sourceSlug: null, sourceDisplay: "no source", rows: [], asOf };
  }
  const source = resolved.source;
  const rows = asOf
    ? await loadTrendRowsAsOf(admin, format.id, source, asOf)
    : await pageAll<TrendInputRow>((from, to) =>
        admin
          .from("player_value_trends")
          .select("player_id, current_value, change_7d, change_30d")
          .eq("format_config_id", format.id)
          .eq("source", source)
          .order("current_value", { ascending: false })
          .order("player_id", { ascending: true })
          .range(from, to),
      );
  return {
    formatSlug,
    formatDisplay: format.display_name,
    sourceSlug: source,
    sourceDisplay: describeSource(registry, source),
    rows: rankTrendRows(rows),
    asOf,
  };
}

type StatRow = Omit<WeekLine, "player_id"> & { player_id: string };

async function loadWeekLines(admin: Admin, season: number, seasonType: string, week: number): Promise<WeekLine[]> {
  return pageAll<StatRow>((from, to) =>
    admin
      .from("player_stats")
      .select(STAT_COLUMNS)
      .eq("season", season)
      .eq("season_type", seasonType)
      .eq("week", week)
      .order("pts_ppr", { ascending: false, nullsFirst: false })
      .order("player_id", { ascending: true })
      .range(from, to),
  );
}

type SeasonTotals = Map<string, { games: number; pts_ppr: number; pts_idp123: number }>;

/** Every player's regular-season PPR total and games through `week`. */
async function loadSeasonToDate(admin: Admin, season: number, week: number): Promise<SeasonTotals> {
  const rows = await pageAll<{ player_id: string; pts_ppr: number | null; gp: number } & Record<string, unknown>>((from, to) =>
    admin
      .from("player_stats")
      .select(`player_id, pts_ppr, gp, ${IDP_STAT_COLUMNS}`)
      .eq("season", season)
      .eq("season_type", "regular")
      .lte("week", week)
      .order("player_id", { ascending: true })
      .order("week", { ascending: true })
      .range(from, to),
  );
  const totals: SeasonTotals = new Map();
  for (const r of rows) {
    const t = totals.get(r.player_id) ?? { games: 0, pts_ppr: 0, pts_idp123: 0 };
    t.games += r.gp > 0 ? 1 : 0;
    t.pts_ppr += r.pts_ppr ?? 0;
    t.pts_idp123 += idp123Points(r as unknown as WeekLine);
    totals.set(r.player_id, t);
  }
  return totals;
}

/** The week line as the bundle's plain record, without the player id. */
function weekLineRecord(
  line: WeekLine,
  week: number,
  defender = false,
): Record<string, number | string | null> {
  // A defender's record carries his defensive line and IDP points only (plan
  // IDP-213): handing the desk "0 receiving yards" for a linebacker invites a
  // sentence about it.
  if (defender) return { week, ...idpLineCells(line) };
  const { player_id: _playerId, ...rest } = line;
  void _playerId;
  const out: Record<string, number | string | null> = { week };
  for (const [key, value] of Object.entries(rest)) {
    // The defensive columns are null on an offensive line; leave them out so
    // the offensive record reads exactly as it did.
    if (key.startsWith("idp_") || key === "def_snp" || key === "def_snap_pct") continue;
    out[key] = value as number | string | null;
  }
  // A whole percentage, the same scale a defender's def_snap_pct carries
  // through idpLineCells, so the desk never reads 0.93 in one record and 93 in
  // the next.
  out.snap_pct = snapPercent(line.snap_pct);
  return out;
}

function readExample(): { slug: string; draft_payload: unknown } | null {
  try {
    const raw = readFileSync(path.join(process.cwd(), EXAMPLE_PATH), "utf8");
    const parsed = JSON.parse(raw) as { slug?: unknown };
    return { slug: typeof parsed.slug === "string" ? parsed.slug : "week-3-fantasy-football-news-injuries-2026", draft_payload: parsed };
  } catch {
    return null;
  }
}

type TrendIndex = { trend: FormatTrend | null; rows: Map<string, FormatTrend["rows"][number]> };

function indexTrend(trend: FormatTrend | null): TrendIndex {
  return { trend, rows: new Map((trend?.rows ?? []).map((r) => [r.player_id, r])) };
}

function toFormatValue({ trend, rows }: TrendIndex, playerId: string): BundleFormatValue {
  const row = rows.get(playerId) ?? null;
  return {
    current: row?.current_value ?? null,
    change_7d: row?.change_7d ?? null,
    change_30d: row?.change_30d ?? null,
    rank_in_format: row?.rank_in_format ?? null,
    source_slug: trend?.sourceSlug ?? null,
    source_display: trend?.sourceSlug ? trend.sourceDisplay : null,
  };
}

/** The heavy assembly, memoised per period. */
async function assemble(
  admin: Admin,
  period: EditionPeriod,
  settings: BriefDeskSettings,
  state: NflStateLike,
  previousAttempt: Bundle["previous_attempt"],
  /** A closed past period's end (an override): values are read as of then. */
  trendsAsOf: string | null,
): Promise<Bundle> {
  const computedAt = new Date().toISOString();
  const inSeason = isInSeasonPhase(period.phase);
  const hasWeek = (period.phase === "regular" || period.phase === "post") && period.week !== null;

  const [relays, trends, faabSettings] = await Promise.all([
    loadPeriodRelays(admin, period),
    Promise.all(EDITION_FORMAT_SLUGS.map((slug) => loadFormatTrend(admin, slug, trendsAsOf))),
    loadFaabSettings(admin),
  ]);
  const dynasty = trends[0];
  const redraft = trends[1];
  const presentTrends = trends.filter((t): t is FormatTrend => t !== null);

  // Names for the Relays' players plus the movers and waiver candidates the
  // datasets will name. Players the index lacks are skipped by the builders.
  const relayPlayerIds = [...new Set(relays.flatMap((r) => r.players))];
  const extraIds = new Set<string>();
  for (const t of presentTrends) {
    const withChange = t.rows.filter((r) => r.change_7d !== null && r.change_7d !== 0);
    const up = [...withChange].sort((a, b) => (b.change_7d ?? 0) - (a.change_7d ?? 0)).slice(0, MOVER_CANDIDATES);
    const down = [...withChange].sort((a, b) => (a.change_7d ?? 0) - (b.change_7d ?? 0)).slice(0, MOVER_CANDIDATES);
    for (const r of [...up, ...down]) extraIds.add(r.player_id);
  }
  if (redraft) {
    const demand = faabSettings.userDefaults.defaultTeams * faabSettings.userDefaults.defaultStarters;
    const risers = redraft.rows
      .filter((r) => r.change_7d !== null && r.change_7d > 0 && r.rank_in_format > demand)
      .sort((a, b) => (b.change_7d ?? 0) - (a.change_7d ?? 0))
      .slice(0, WAIVER_CANDIDATES);
    for (const r of risers) extraIds.add(r.player_id);
  }

  const seasonNumber = Number(period.season);
  const seasonType = period.phase === "post" ? "post" : "regular";
  const [players, lines, seasonTotals] = await Promise.all([
    loadPlayers(admin, [...relayPlayerIds, ...extraIds]),
    hasWeek ? loadWeekLines(admin, seasonNumber, seasonType, period.week!) : Promise.resolve(null),
    period.phase === "regular" && period.week !== null ? loadSeasonToDate(admin, seasonNumber, period.week) : Promise.resolve(null),
  ]);

  // Top scorers need names and positions for every scorer, not only the
  // Relays' players; the week's scorers are a bounded second batch.
  if (lines) {
    const missing = lines.map((l) => l.player_id).filter((id) => !players.has(id));
    for (const [id, p] of await loadPlayers(admin, missing)) players.set(id, p);
  }
  // Season-to-date rank at the position needs every scorer's position too.
  const positionOf = new Map<string, string>();
  if (seasonTotals) {
    const unknown = [...seasonTotals.keys()].filter((id) => !players.has(id));
    for (const [id, p] of await loadPlayers(admin, unknown)) players.set(id, p);
    for (const [id, p] of players) if (p.position) positionOf.set(id, p.position.toUpperCase());
  }
  const rankAtPosition = new Map<string, number>();
  if (seasonTotals) {
    const byPosition = new Map<string, Array<{ id: string; pts: number }>>();
    for (const [id, t] of seasonTotals) {
      const pos = positionOf.get(id);
      if (!pos) continue;
      // A defender ranks among his position on Sleeper default IDP points,
      // never on PPR, which is zero for every one of them (plan R-21).
      const pts = isDefender(pos) ? t.pts_idp123 : t.pts_ppr;
      byPosition.set(pos, [...(byPosition.get(pos) ?? []), { id, pts }]);
    }
    for (const list of byPosition.values()) {
      list.sort((a, b) => b.pts - a.pts || a.id.localeCompare(b.id));
      list.forEach((entry, i) => rankAtPosition.set(entry.id, i + 1));
    }
  }

  // Next-week projections for the Relays' players, through the shared read
  // path, which resolves the projection source itself. Only in the regular
  // season, and only when Sleeper's live week is a real week.
  const nextWeek = projectionWindow(state);
  const projections = new Map<string, { week: number; opponent: string | null; projected_pts: number | null; beat_rate: number | null }>();
  if (nextWeek !== null && relayPlayerIds.length > 0) {
    const positionByPlayer = new Map<string, string>();
    for (const id of relayPlayerIds) {
      const pos = players.get(id)?.position;
      if (pos) positionByPlayer.set(id, pos);
    }
    const { byPlayer } = await loadAdjustedProjections({
      supabase: admin,
      playerIds: relayPlayerIds,
      season: Number(state.season),
      fromWeek: nextWeek,
      toWeek: nextWeek,
      // PPR, like every other figure in the edition. null scored the next-week
      // projection in standard scoring while the prose called it points.
      scoringSettings: { ...PPR_STORED_SCORING },
      positionByPlayer,
      currentWeek: nextWeek,
    });
    for (const [id, summary] of byPlayer) {
      const w = summary.byWeek.get(nextWeek);
      if (!w) continue;
      projections.set(id, {
        week: nextWeek,
        opponent: w.opponent,
        projected_pts: Math.round(w.points * 10) / 10,
        beat_rate: w.beatRate === null ? null : Math.round(w.beatRate * 1000) / 1000,
      });
    }
  }

  const lineByPlayer = new Map((lines ?? []).map((l) => [l.player_id, l]));
  const trendIndexes = trends.map(indexTrend);
  const bundlePlayers: Record<string, BundlePlayer> = {};
  for (const id of relayPlayerIds) {
    const p = players.get(id);
    if (!p) continue;
    const line = lineByPlayer.get(id) ?? null;
    const totals = seasonTotals?.get(id) ?? null;
    const defender = isDefender(p.position);
    const value: Record<string, BundleFormatValue> = {};
    for (const [i, slug] of EDITION_FORMAT_SLUGS.entries()) {
      const v = toFormatValue(trendIndexes[i], id);
      value[slug] = defender ? { ...v, coverage: "not_covered" } : v;
    }
    bundlePlayers[id] = {
      slug: p.slug,
      full_name: p.name,
      position: p.position,
      team: p.team,
      value,
      week_line: line && period.week !== null ? weekLineRecord(line, period.week, defender) : null,
      season_to_date: totals
        ? defender
          ? {
              games: totals.games,
              pts_ppr: null,
              pts_idp123: Math.round(totals.pts_idp123 * 10) / 10,
              rank_at_position: rankAtPosition.get(id) ?? null,
              scoring: "idp123",
            }
          : {
              games: totals.games,
              pts_ppr: Math.round(totals.pts_ppr * 10) / 10,
              rank_at_position: rankAtPosition.get(id) ?? null,
            }
        : null,
      next_week: projections.get(id) ?? null,
      // No league context, so no Positional WAR figure (see the header).
      positional_war_note: null,
    };
  }

  const datasets = buildAllDatasets({
    relays,
    players,
    bundlePlayerIds: relayPlayerIds,
    trends: presentTrends,
    dynasty,
    redraft,
    lines,
    week: hasWeek ? period.week : null,
    inSeason,
    faabSettings,
    computedAt,
  });

  const topScorers: Bundle["league_wide"]["top_scorers_by_position"] = {};
  for (const [id, d] of Object.entries(datasets)) {
    if (!id.startsWith("top_scorers_")) continue;
    topScorers[id.slice("top_scorers_".length).toUpperCase()] = d.rows.slice(0, 10).map((r) => ({
      player_id: String(r.player_id),
      name: String(r.name),
      pts_ppr: Number(r.pts_ppr ?? 0),
    }));
  }
  const movers = (id: "value_movers_up" | "value_movers_down") =>
    (datasets[id]?.rows ?? []).slice(0, 10).map((r) => ({ player_id: String(r.player_id), name: String(r.name), change_7d: Number(r.change_7d ?? 0) }));

  const weekResults = hasWeek ? await loadWeekResults(admin, seasonNumber, seasonType, period.week!) : new Map<string, BundleWeekResult>();

  // The premium edition's game cards, awards and projection report (plan
  // section 20). Only for a real week with box scores; a failure here costs
  // the edition its cards, never the bundle, and the validator then does not
  // ask for blocks whose datasets were not built.
  let gameIndex: Bundle["game_index"] = [];
  if (hasWeek && lines && lines.length > 0) {
    try {
      const games = await loadGameDatasets(admin, {
        season: seasonNumber,
        seasonType: seasonType as "regular" | "post",
        week: period.week!,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        lines,
        results: weekResults,
        formatSlugs: EDITION_FORMAT_SLUGS,
        computedAt,
      });
      Object.assign(datasets, games.datasets);
      gameIndex = games.index;
    } catch (err) {
      console.error("[brief-desk/bundle] game datasets failed", err instanceof Error ? err.message : String(err));
    }
  }

  const [{ data: previousRows }, teams] = await Promise.all([
    admin
      .from("articles")
      .select("slug, title, published_at")
      .eq("article_type", "brief")
      .eq("status", "published")
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(20),
    loadTeams(admin, [...new Set(relays.flatMap((r) => r.teams))], weekResults),
  ]);

  const formats = await getActiveFormats(admin);

  return {
    due: true,
    edition: {
      season: period.season,
      week: period.week,
      phase: period.phase,
      pre_season_week: period.preSeasonWeek,
      cadence: period.cadence,
      period_start: period.periodStart,
      period_end: period.periodEnd,
      suggested_slug: period.suggestedSlug,
      suggested_title: period.suggestedTitle,
      required_slug_prefix: requiredSlugPrefix(period),
    },
    context: {
      formats: EDITION_FORMAT_SLUGS.map((slug) => ({ slug, display: formats.find((f) => f.slug === slug)?.display_name ?? slug })),
      source_slug: dynasty?.sourceSlug ?? redraft?.sourceSlug ?? null,
      // null, never a placeholder: instruction 9 has the run paste this into
      // the format sentence, and the byline renders it, so a stand-in phrase
      // like "this source" would reach the page as if it were a name.
      source_display: dynasty?.sourceSlug ? dynasty.sourceDisplay : redraft?.sourceSlug ? redraft.sourceDisplay : null,
      nfl_state: { season: state.season, season_type: state.season_type ?? null, week: state.week ?? null },
    },
    instructions: settings.briefInstructions,
    relays,
    players: bundlePlayers,
    teams,
    league_wide: {
      top_scorers_by_position: topScorers,
      value_movers: { up: movers("value_movers_up"), down: movers("value_movers_down") },
      // No defense-versus-position notes are computed for the bundle.
      dvp_notes: [],
    },
    datasets,
    game_index: gameIndex,
    block_kinds: BLOCK_KIND_META,
    section_icons: SECTION_ICONS,
    example: readExample(),
    previous_editions: (previousRows ?? []).map((a) => ({ slug: a.slug, title: a.title, published_at: a.published_at })),
    previous_attempt: previousAttempt,
    submit: { method: "POST", path: "/api/brief-desk/drafts", content_type: "application/json" },
  };
}

/**
 * The next-week projection window `assemble` reads, or null when it reads
 * none. One place, so the memo key and the read cannot disagree about it.
 */
function projectionWindow(state: NflStateLike): number | null {
  return state.season_type === "regular" && typeof state.week === "number" && state.week >= 1 && state.week <= 18
    ? state.week
    : null;
}

/**
 * Every source the assembled bundle depends on, as one string for the memo
 * key: the value source resolved for each edition format and the projection
 * engine for the next-week window. Both resolutions are the same calls the
 * read paths make and are memoised themselves (the registry for a minute,
 * the settings row for a minute, and the projection probe short-circuits to
 * Sleeper while the feature is off), so this costs nothing on the cheap
 * due-check path that runs before the memo.
 */
async function sourceKey(admin: Admin, state: NflStateLike, period: EditionPeriod): Promise<string> {
  const [registry, settings] = await Promise.all([getAvailableSources(admin), loadPowerPulseSettings(admin)]);
  const values = EDITION_FORMAT_SLUGS.map(
    (slug) => resolveSourceForFormat(registry, "player_value_history", slug, null).source ?? "none",
  );
  const week = projectionWindow(state);
  const projection =
    week === null
      ? "none"
      : await resolveProjectionSourceForWindow({
          supabase: admin,
          season: Number(state.season),
          fromWeek: week,
          toWeek: week,
          settings: settings.beaconProjections,
        });
  // The game cards grade weeks 1 to the edition's week (./game-data.ts), a
  // second window that can resolve to a different engine than next week's.
  const graded =
    (period.phase === "regular" || period.phase === "post") && period.week !== null
      ? await resolveProjectionSourceForWindow({
          supabase: admin,
          season: Number(period.season),
          fromWeek: 1,
          toWeek: period.week,
          settings: settings.beaconProjections,
        })
      : "none";
  return `${values.join(",")}|${projection}|${graded}`;
}

/**
 * Whether an edition is due at `now`, and the bundle when it is. `override`
 * names a past week or an off-season close; the route only passes one when
 * the request also carries an admin session.
 */
export async function buildBundle(
  admin: Admin,
  now: Date,
  override?: BundleOverride | null,
  /**
   * Backfill only (./backfill.ts): build the bundle for a week that already
   * has a published edition, so it can be redrafted in the current format.
   * Requires an override. No route passes this; the backfill script does.
   */
  opts?: { ignoreExistingEdition?: boolean },
): Promise<Bundle | BundleNotDue> {
  const [settings, rawState] = await Promise.all([loadBriefDeskSettings(admin), getNflState()]);
  const state = toStateLike(rawState);
  const cadence = resolveCadence(state, settings, now);

  let period: EditionPeriod | null;
  if (override) {
    if (!settings.enabled) return { due: false, reason: cadence.reason, next_close: cadence.nextClose, next_period: null };
    if (!state) return { due: false, reason: cadence.reason, next_close: null, next_period: null };
    period = periodForOverride(state, settings, override);
    if (!period) {
      return { due: false, reason: "the override names no period this season", next_close: cadence.nextClose, next_period: cadence.period };
    }
    if (new Date(period.periodEnd).getTime() > now.getTime()) {
      return { due: false, reason: "the override names a period that has not closed", next_close: period.periodEnd, next_period: period };
    }
  } else {
    period = cadence.period;
    if (!period || !state) return { due: false, reason: cadence.reason, next_close: cadence.nextClose, next_period: null };
  }

  const editions = await loadPeriodEditions(admin, period);
  const blocking = editions.find((e) => e.status === "in_review" || e.status === "published");
  if (blocking && !(opts?.ignoreExistingEdition && override)) {
    return {
      due: false,
      reason: `this period already has an edition ${blocking.status === "published" ? "published" : "in review"}`,
      next_close: cadence.nextClose,
      next_period: null,
    };
  }

  if (period.phase === "off") {
    period = await extendForRolledPeriods(admin, period);
    const relayCount = await countPeriodRelays(admin, period);
    if (relayCount < settings.minRelays) {
      return {
        due: false,
        reason: `off-season period holds ${relayCount} Relays, under the minimum of ${settings.minRelays}; it rolls into the next period`,
        next_close: cadence.nextClose,
        next_period: period,
      };
    }
  }

  const rejected = editions.find((e) => e.status === "rejected") ?? null;
  const previousAttempt: Bundle["previous_attempt"] = rejected
    ? { notes: rejected.review_notes, rejected_at: rejected.reviewed_at, draft_payload: rejected.draft_payload }
    : null;

  const sources = await sourceKey(admin, state, period);
  const key = `${BUNDLE_MEMO_PREFIX}${period.periodStart}|${period.periodEnd}|${override ? "override" : "live"}|${sources}`;
  // A bundle is a few hundred kilobytes, and every closed period, source flip
  // or override used to leave its entry referenced for the life of the
  // process. Evict the predecessors under this prefix, keeping the key about
  // to be read, so at most one bundle is held.
  bustMemo(BUNDLE_MEMO_PREFIX, key);
  // An override always names a closed period (checked above), so its values
  // are read as they stood at its end; the live run reads today's trends.
  const trendsAsOf = override ? period.periodEnd : null;
  const bundle = await memoTtl(key, BUNDLE_TTL_MS, () => assemble(admin, period!, settings, state!, previousAttempt, trendsAsOf));
  // The rejected attempt can change inside the memo window; it is cheap and is
  // read fresh above, so the memoised bundle is returned with the live value.
  return { ...bundle, previous_attempt: previousAttempt, instructions: settings.briefInstructions };
}
