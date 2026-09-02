/**
 * The forward-looking, reliability, and market reads for a Beacon Breakdown.
 *
 * Three rules shape this file.
 *
 * ONE MODEL, NOT TWO. Projections run through lib/power-pulse/project.ts, the
 * same pure function the Power Pulse page and the FAAB calculator use. A second
 * copy of that math would drift, and the first symptom would be a Breakdown that
 * disagrees with the Power Pulse page it links to. We pass `scoringSettings:
 * null` because there is no league here, which makes `scoreWithFallback` read the
 * stored pts_ppr / pts_half_ppr / pts_std column for the active format instead of
 * a league's dot product. Every other adjustment (opponent strength, reliability,
 * availability, injury, variance) applies exactly as it does inside a league.
 *
 * BOTH PLAYERS IN ONE QUERY. The original breakdown fired three queries per
 * player. Adding projections, accuracy, defensive splits, market snapshots, and
 * value history per player would have turned a two-player page into twenty-odd
 * round trips. Every read here takes both ids at once.
 *
 * NO SLEEPER CALL. Resolving "what week is it" through Sleeper's state endpoint
 * would put an uncached external fetch on a public page's critical path. We
 * already store everything needed to answer it: the newest projected season, and
 * the newest week anybody actually played. Both are indexed lookups.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { ScoringKey } from "@/lib/player-profile";
import { loadDefenseSplits, type DefenseRow, type ProjectionRow } from "@/lib/power-pulse/load";
import { projectPlayerWeek, reliabilityMultiplier } from "@/lib/power-pulse/project";
import { DEFAULT_POWER_PULSE_SETTINGS, type PowerPulseSettings } from "@/lib/power-pulse/default-settings";
import { PULSE_POSITIONS, type PulsePosition } from "@/lib/power-pulse/types";
import { defenseSeasonsFor } from "@/lib/projections/defense-seasons";
import type {
  BreakdownExtras,
  BreakdownMarket,
  BreakdownProjection,
  BreakdownReliability,
  ProjectedWeekPoint,
  ReliabilityWeek,
} from "./types";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/** The scoring base name used by the derived tables keyed by base, not format. */
type ScoringBase = "pts_ppr" | "pts_half_ppr" | "pts_std";

/** A player, reduced to what the extras loader needs. */
export type ExtrasSubject = {
  id: string;
  position: string;
  team: string | null;
  injuryStatus: string | null;
  overallRank: number | null;
};

export type ExtrasContext = {
  scoringKey: ScoringKey;
  formatConfigId: string | null;
  valueSource: string | null;
  /** Drives which of Sleeper's ADP flavours we read. */
  isDynasty: boolean;
  isSuperflex: boolean;
  /** Points added per projected reception in a TE-premium format. */
  tePremiumPerReception: number;
};

/** Where the season sits, derived from our own tables. */
export type SeasonClock = {
  season: number | null;
  /** The first week we have not seen a completed game for. 1 in the preseason. */
  currentWeek: number;
  /** The newest season that has graded games, for the reliability read. */
  gradedSeason: number | null;
};

const PAGE = 1000;
/** Sleeper publishes an 18-week regular season. */
const MAX_WEEK = 18;

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function scoringBaseFor(key: ScoringKey): ScoringBase {
  return key;
}

/**
 * Where we are in the NFL calendar, read from stored data rather than Sleeper.
 *
 * `season` is the newest season we hold regular-season projections for.
 * `currentWeek` is one past the newest week anybody has a completed game in,
 * clamped into the regular season. In the preseason nothing has been played, so
 * it resolves to week 1 and the whole slate is "remaining", which is exactly the
 * behaviour the profile's projection outlook already has.
 */
export async function resolveSeasonClock(supabase: AnySupabase): Promise<SeasonClock> {
  const db = supabase as SupabaseClient<Database>;

  const { data: projSeason } = await db
    .from("player_weekly_projections")
    .select("season")
    .eq("season_type", "regular")
    .order("season", { ascending: false })
    .limit(1)
    .maybeSingle();

  const season = projSeason ? Number(projSeason.season) : null;

  const { data: statSeason } = await db
    .from("player_stats")
    .select("season")
    .eq("season_type", "regular")
    .gt("gp", 0)
    .order("season", { ascending: false })
    .limit(1)
    .maybeSingle();

  const gradedSeason = statSeason ? Number(statSeason.season) : null;

  if (season == null) return { season: null, currentWeek: 1, gradedSeason };

  // Only weeks inside the projected season count toward "what week is it".
  let currentWeek = 1;
  if (gradedSeason === season) {
    const { data: playedWeek } = await db
      .from("player_stats")
      .select("week")
      .eq("season", season)
      .eq("season_type", "regular")
      .gt("gp", 0)
      .order("week", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (playedWeek) {
      currentWeek = Math.min(MAX_WEEK + 1, Number(playedWeek.week) + 1);
    }
  }

  return { season, currentWeek, gradedSeason };
}

/** Weekly projections for both players from `fromWeek` on, in one paged read. */
async function loadProjectionRows(
  db: SupabaseClient<Database>,
  playerIds: string[],
  season: number,
  fromWeek: number,
): Promise<Map<string, Map<number, ProjectionRow>>> {
  const out = new Map<string, Map<number, ProjectionRow>>();
  if (playerIds.length === 0) return out;

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("player_weekly_projections")
      .select(
        "player_id, week, opponent, stat_line, projected_pts_ppr, projected_pts_half_ppr, projected_pts_std",
      )
      .eq("season", season)
      .eq("season_type", "regular")
      .gte("week", fromWeek)
      .in("player_id", playerIds)
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const row of data) {
      if (!row.player_id) continue;
      const byWeek = out.get(row.player_id) ?? new Map<number, ProjectionRow>();
      byWeek.set(Number(row.week), {
        playerId: row.player_id,
        week: Number(row.week),
        opponent: row.opponent,
        statLine: (row.stat_line as Record<string, unknown> | null) ?? null,
        ppr: numOrNull(row.projected_pts_ppr),
        halfPpr: numOrNull(row.projected_pts_half_ppr),
        std: numOrNull(row.projected_pts_std),
      });
      out.set(row.player_id, byWeek);
    }
    if (data.length < PAGE) break;
  }
  return out;
}

type AccuracyRecord = {
  shrunkMultiplier: number | null;
  beatRate: number | null;
  availabilityRate: number | null;
  ratioStdev: number | null;
  meanDiff: number | null;
  weeksPlayed: number;
  weeksProjected: number;
};

/** The blended (season IS NULL) reliability row for both players, one read. */
async function loadAccuracyRows(
  db: SupabaseClient<Database>,
  playerIds: string[],
  scoring: ScoringBase,
): Promise<Map<string, AccuracyRecord>> {
  const out = new Map<string, AccuracyRecord>();
  if (playerIds.length === 0) return out;

  const { data } = await db
    .from("player_projection_accuracy")
    .select(
      "player_id, shrunk_multiplier, beat_rate, availability_rate, ratio_stdev, mean_diff, weeks_played, weeks_projected",
    )
    .eq("scoring", scoring)
    .is("season", null)
    .in("player_id", playerIds);

  for (const row of data ?? []) {
    out.set(row.player_id, {
      shrunkMultiplier: numOrNull(row.shrunk_multiplier),
      beatRate: numOrNull(row.beat_rate),
      availabilityRate: numOrNull(row.availability_rate),
      ratioStdev: numOrNull(row.ratio_stdev),
      meanDiff: numOrNull(row.mean_diff),
      weeksPlayed: Number(row.weeks_played ?? 0),
      weeksProjected: Number(row.weeks_projected ?? 0),
    });
  }
  return out;
}

/**
 * Per-week projected against actual for the newest graded season, for the strip
 * plot on the Reliability tab. A week the player was projected for but did not
 * play is kept with `missed: true` rather than dropped, because a quiet gap in
 * the chart is exactly how an injured stretch disappears from a beat rate.
 */
async function loadReliabilityWeeks(
  db: SupabaseClient<Database>,
  playerIds: string[],
  season: number,
  scoringKey: ScoringKey,
  tePremium: number,
): Promise<Map<string, ReliabilityWeek[]>> {
  const out = new Map<string, ReliabilityWeek[]>();
  if (playerIds.length === 0) return out;

  const projCol =
    scoringKey === "pts_half_ppr"
      ? "projected_pts_half_ppr"
      : scoringKey === "pts_std"
        ? "projected_pts_std"
        : "projected_pts_ppr";

  const [projRes, statRes] = await Promise.all([
    db
      .from("player_weekly_projections")
      .select(`player_id, week, stat_line, ${projCol}`)
      .eq("season", season)
      .eq("season_type", "regular")
      .in("player_id", playerIds),
    db
      .from("player_stats")
      .select("player_id, week, gp, rec, pts_ppr, pts_half_ppr, pts_std")
      .eq("season", season)
      .eq("season_type", "regular")
      .in("player_id", playerIds),
  ]);

  type WeekBucket = { projected: number | null; actual: number | null; played: boolean };
  const byPlayer = new Map<string, Map<number, WeekBucket>>();

  const bucket = (playerId: string, week: number): WeekBucket => {
    const weeks = byPlayer.get(playerId) ?? new Map<number, WeekBucket>();
    const existing = weeks.get(week) ?? { projected: null, actual: null, played: false };
    weeks.set(week, existing);
    byPlayer.set(playerId, weeks);
    return existing;
  };

  for (const row of (projRes.data ?? []) as unknown as Array<Record<string, unknown>>) {
    const playerId = row.player_id as string | null;
    if (!playerId) continue;
    const base = numOrNull(row[projCol]);
    if (base == null) continue;
    const stats = (row.stat_line as Record<string, unknown> | null) ?? null;
    const projRec = numOrNull(stats?.rec) ?? 0;
    bucket(playerId, Number(row.week)).projected = base + tePremium * projRec;
  }

  for (const row of statRes.data ?? []) {
    if (!row.player_id) continue;
    const b = bucket(row.player_id, Number(row.week));
    const gp = Number(row.gp ?? 0);
    b.played = Number.isFinite(gp) && gp > 0;
    if (!b.played) continue;
    const base =
      scoringKey === "pts_half_ppr"
        ? numOrNull(row.pts_half_ppr)
        : scoringKey === "pts_std"
          ? numOrNull(row.pts_std)
          : numOrNull(row.pts_ppr);
    b.actual = (base ?? 0) + tePremium * (numOrNull(row.rec) ?? 0);
  }

  for (const [playerId, weeks] of byPlayer) {
    const rows: ReliabilityWeek[] = [...weeks.entries()]
      .map(([week, b]) => ({
        week,
        projected: b.projected,
        actual: b.played ? b.actual : null,
        missed: b.projected != null && b.projected > 0 && !b.played,
      }))
      // A week with neither a projection nor a game is not a data point.
      .filter((r) => r.projected != null || r.actual != null)
      .sort((x, y) => x.week - y.week);
    out.set(playerId, rows);
  }
  return out;
}

/**
 * Sleeper's ADP for both players, from the latest market snapshot.
 *
 * Sleeper publishes every flavour it runs in one `adp` object, keyed WITHOUT a
 * prefix: `ppr`, `half_ppr`, `std`, `2qb`, `dynasty_ppr`, `dynasty_half_ppr`,
 * `dynasty_std`, `dynasty_2qb`, and the IDP variants. We ask for the closest
 * match to the active format first (a dynasty superflex reader should not be
 * shown a redraft one-quarterback draft slot) and fall back through the rest,
 * naming which one we landed on so the footnote can be honest about it.
 *
 * 999 is Sleeper's "no data" sentinel and is treated as absent.
 */
const ADP_SENTINEL = 999;

const ADP_LABEL: Record<string, string> = {
  ppr: "Sleeper PPR ADP",
  half_ppr: "Sleeper half-PPR ADP",
  std: "Sleeper standard ADP",
  "2qb": "Sleeper superflex ADP",
  dynasty_ppr: "Sleeper dynasty PPR ADP",
  dynasty_half_ppr: "Sleeper dynasty half-PPR ADP",
  dynasty_std: "Sleeper dynasty standard ADP",
  dynasty_2qb: "Sleeper dynasty superflex ADP",
};

/** Preference order for one format, most specific first. */
export function adpKeyPreference(
  scoringKey: ScoringKey,
  isDynasty: boolean,
  isSuperflex: boolean,
): string[] {
  const scoring =
    scoringKey === "pts_half_ppr" ? "half_ppr" : scoringKey === "pts_std" ? "std" : "ppr";
  const dynastyKeys = isSuperflex
    ? ["dynasty_2qb", `dynasty_${scoring}`]
    : [`dynasty_${scoring}`, "dynasty_2qb"];
  const redraftKeys = isSuperflex ? ["2qb", scoring] : [scoring, "2qb"];
  const ordered = isDynasty ? [...dynastyKeys, ...redraftKeys] : [...redraftKeys, ...dynastyKeys];
  // Anything left, so a format we have no exact key for still shows something
  // rather than a dash.
  const rest = ["ppr", "half_ppr", "std", "dynasty_ppr", "dynasty_half_ppr", "dynasty_std"];
  return [...new Set([...ordered, ...rest])];
}

async function loadAdp(
  db: SupabaseClient<Database>,
  playerIds: string[],
  scoringKey: ScoringKey,
  isDynasty: boolean,
  isSuperflex: boolean,
): Promise<Map<string, { adp: number; basis: string }>> {
  const out = new Map<string, { adp: number; basis: string }>();
  if (playerIds.length === 0) return out;

  const { data } = await db
    .from("player_market_latest")
    .select("player_id, adp")
    .in("player_id", playerIds);

  const preferred = adpKeyPreference(scoringKey, isDynasty, isSuperflex);

  for (const row of data ?? []) {
    if (!row.player_id) continue;
    const adpMap = (row.adp ?? {}) as Record<string, unknown>;
    for (const key of preferred) {
      const v = numOrNull(adpMap[key]);
      if (v != null && v > 0 && v < ADP_SENTINEL) {
        out.set(row.player_id, { adp: v, basis: ADP_LABEL[key] ?? `Sleeper ${key} ADP` });
        break;
      }
    }
  }
  return out;
}

/** Value history for both players over `days`, ascending, in one read. */
async function loadValueSeriesPair(
  db: SupabaseClient<Database>,
  playerIds: string[],
  formatConfigId: string | null,
  source: string | null,
  days: number,
): Promise<Map<string, { t: string; value: number }[]>> {
  const out = new Map<string, { t: string; value: number }[]>();
  if (!formatConfigId || !source || playerIds.length === 0) return out;

  const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("player_value_history")
      .select("player_id, value, formula_offset, captured_at")
      .eq("format_config_id", formatConfigId)
      .eq("source", source)
      .in("player_id", playerIds)
      .gte("captured_at", sinceIso)
      .order("captured_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const row of data) {
      if (!row.player_id) continue;
      const list = out.get(row.player_id) ?? [];
      list.push({
        t: row.captured_at as string,
        // Honor formula_offset so the chart shows the market series, matching
        // the profile's value chart exactly.
        value: Number(row.value) - Number(row.formula_offset ?? 0),
      });
      out.set(row.player_id, list);
    }
    if (data.length < PAGE) break;
  }
  return out;
}

/**
 * Rounds early or late a player is going versus where we rank him.
 *
 * ADP is an overall draft slot and our overall rank is an overall ordering, so
 * the two are directly comparable once both are turned into rounds. Twelve teams
 * is the assumption because it is what the large majority of Sleeper leagues
 * run; the number is stated in the UI so the reader can discount it.
 */
const TEAMS_PER_ROUND = 12;

function adpRoundsLate(adp: number | null, overallRank: number | null): number | null {
  if (adp == null || overallRank == null) return null;
  return (adp - overallRank) / TEAMS_PER_ROUND;
}

/**
 * Everything the Projections, Reliability, and Market tabs need, for both
 * players, keyed by player id.
 *
 * `pulseSettings` is passed in rather than loaded here because the settings row
 * is service-role only and this function runs with the public client. The caller
 * reads it once with an admin client (falling back to code defaults when the row
 * is missing) and hands it down.
 */
export async function loadBreakdownExtras(
  supabase: AnySupabase,
  subjects: ExtrasSubject[],
  context: ExtrasContext,
  pulseSettings: PowerPulseSettings = DEFAULT_POWER_PULSE_SETTINGS,
): Promise<Map<string, BreakdownExtras>> {
  const db = supabase as SupabaseClient<Database>;
  const playerIds = subjects.map((s) => s.id);
  const scoringBase = scoringBaseFor(context.scoringKey);

  const clock = await resolveSeasonClock(db);

  // Power Pulse walks the current season and the two before it, most recent
  // first, and blends the first two that actually have a usable row. Mirrored
  // here so a Breakdown projection and a Power Pulse projection agree.
  const defenseSeasons =
    clock.season != null ? defenseSeasonsFor(clock.season) : [];

  const [projections, accuracy, defense, adp, series, reliabilityWeeks] = await Promise.all([
    clock.season != null
      ? loadProjectionRows(db, playerIds, clock.season, clock.currentWeek)
      : Promise.resolve(new Map<string, Map<number, ProjectionRow>>()),
    loadAccuracyRows(db, playerIds, scoringBase),
    defenseSeasons.length > 0
      ? loadDefenseSplits(db as never, scoringBase, defenseSeasons)
      : Promise.resolve(new Map<string, DefenseRow>()),
    loadAdp(db, playerIds, context.scoringKey, context.isDynasty, context.isSuperflex),
    loadValueSeriesPair(db, playerIds, context.formatConfigId, context.valueSource, 90),
    clock.gradedSeason != null
      ? loadReliabilityWeeks(
          db,
          playerIds,
          clock.gradedSeason,
          context.scoringKey,
          context.tePremiumPerReception,
        )
      : Promise.resolve(new Map<string, ReliabilityWeek[]>()),
  ]);

  const out = new Map<string, BreakdownExtras>();

  for (const subject of subjects) {
    const acc = accuracy.get(subject.id) ?? null;
    const accForEngine = acc
      ? {
          playerId: subject.id,
          shrunkMultiplier: acc.shrunkMultiplier,
          beatRate: acc.beatRate,
          availabilityRate: acc.availabilityRate,
          ratioStdev: acc.ratioStdev,
          weeksPlayed: acc.weeksPlayed,
        }
      : null;

    /* ---- projection ---- */
    let projection: BreakdownProjection | null = null;
    const position = (subject.position ?? "").toUpperCase();
    const isProjectable = (PULSE_POSITIONS as readonly string[]).includes(position);
    const byWeek = projections.get(subject.id);

    if (clock.season != null && isProjectable && byWeek && byWeek.size > 0) {
      const reliability = reliabilityMultiplier(accForEngine, pulseSettings);
      const weeks: ProjectedWeekPoint[] = [];
      let usedLeagueScoring = false;

      for (let week = clock.currentWeek; week <= MAX_WEEK; week += 1) {
        const projected = projectPlayerWeek({
          projection: byWeek.get(week),
          subject: {
            position: position as PulsePosition,
            injuryStatus: subject.injuryStatus,
          },
          accuracy: accForEngine,
          reliability,
          // No league here, so the engine reads the stored points column for the
          // active scoring instead of a league's own dot product.
          scoringSettings: null,
          defense,
          defenseSeasons,
          week,
          currentWeek: clock.currentWeek,
          settings: pulseSettings,
        });
        if (!projected) continue;
        usedLeagueScoring = usedLeagueScoring || projected.usedLeagueScoring;
        weeks.push({
          week: projected.week,
          points: projected.points,
          rawPoints: projected.rawPoints,
          sigma: projected.sigma,
          opponent: projected.opponent,
          opponentMultiplier: projected.opponentMultiplier,
        });
      }

      if (weeks.length > 0) {
        const totalPoints = weeks.reduce((s, w) => s + w.points, 0);
        // Weeks are treated as independent, so the season spread is the root of
        // the summed variances rather than the sum of the weekly sigmas. Adding
        // sigmas would overstate the band by roughly the square root of the
        // number of weeks.
        const seasonSigma = Math.sqrt(weeks.reduce((s, w) => s + w.sigma * w.sigma, 0));
        const multipliers = weeks
          .map((w) => w.opponentMultiplier)
          .filter((m) => Number.isFinite(m));
        projection = {
          season: clock.season,
          fromWeek: clock.currentWeek,
          weeks,
          totalPoints,
          perGame: weeks.length > 0 ? totalPoints / weeks.length : null,
          seasonSigma,
          floorPoints: Math.max(0, totalPoints - seasonSigma),
          ceilingPoints: totalPoints + seasonSigma,
          nextWeek: weeks[0] ?? null,
          scheduleMultiplier:
            multipliers.length > 0
              ? multipliers.reduce((s, m) => s + m, 0) / multipliers.length
              : null,
          usedLeagueScoring,
        };
      }
    }

    /* ---- reliability ---- */
    const weeks = reliabilityWeeks.get(subject.id) ?? [];
    const reliability: BreakdownReliability | null = acc
      ? {
          beatRate: acc.beatRate,
          availabilityRate: acc.availabilityRate,
          meanDiff: acc.meanDiff,
          ratioStdev: acc.ratioStdev,
          shrunkMultiplier: acc.shrunkMultiplier,
          weeksPlayed: acc.weeksPlayed,
          weeksProjected: acc.weeksProjected,
          weeks,
          season: clock.gradedSeason,
        }
      : weeks.length > 0
        ? {
            beatRate: null,
            availabilityRate: null,
            meanDiff: null,
            ratioStdev: null,
            shrunkMultiplier: null,
            weeksPlayed: weeks.filter((w) => w.actual != null).length,
            weeksProjected: weeks.filter((w) => w.projected != null).length,
            weeks,
            season: clock.gradedSeason,
          }
        : null;

    /* ---- market ---- */
    const adpRow = adp.get(subject.id) ?? null;
    const market: BreakdownMarket = {
      adp: adpRow?.adp ?? null,
      adpBasis: adpRow?.basis ?? null,
      adpRoundsLate: adpRoundsLate(adpRow?.adp ?? null, subject.overallRank),
      series: series.get(subject.id) ?? [],
      high30d: null,
      low30d: null,
      volatility30d: null,
      rankChange30d: null,
      change90dPct: null,
    };

    out.set(subject.id, { projection, reliability, market });
  }

  return out;
}
