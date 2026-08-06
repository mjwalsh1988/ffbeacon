/**
 * One player's outlook, without a league.
 *
 * This is what the manual calculator needs to stop guessing: his own rest-of-
 * season projection, the same projection for everyone else at his position (so
 * replacement level is measurable rather than assumed), and the reliability and
 * usage reads league mode already uses.
 *
 * The position curve is sent to the browser rather than a single replacement
 * number on purpose. League size and starter count are things the reader is
 * still dragging around in the form, and shipping the whole curve lets those
 * controls stay instant instead of firing a request per keystroke.
 *
 * READ ONLY. Nothing here writes or syncs.
 */

import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createCachedReadClient } from "@/lib/supabase/server";
import { CACHE_TAGS, CACHE_TTL } from "@/lib/cache-tags";
import { getNflState } from "@/lib/sleeper";
import {
  loadAccuracy,
  loadDefenseSplits,
  loadProjections,
  type AccuracyRow,
} from "@/lib/power-pulse/load";
import { opponentMultiplier } from "@/lib/power-pulse/project";
import { loadPowerPulseSettings } from "@/lib/power-pulse/settings";
import type { PulsePosition } from "@/lib/power-pulse/types";
import { buildSignals } from "./signals";
import { loadGameLogs, loadPositionalFinishes } from "./league-load";
import type {
  FaabConfidence,
  FaabSettings,
  FaabSignal,
  MarginalWeek,
} from "./types";

type ServiceClient = SupabaseClient<Database>;

const PAGE = 1000;

/** Scoring bases we can read a projection in, keyed off the reader's format. */
const SCORING_COLUMN = {
  ppr: "projected_pts_ppr",
  half_ppr: "projected_pts_half_ppr",
  std: "projected_pts_std",
} as const;

export type ScoringBase = keyof typeof SCORING_COLUMN;

/** The accuracy table keys its rows by these same strings. */
const ACCURACY_SCORING: Record<ScoringBase, string> = {
  ppr: "pts_ppr",
  half_ppr: "pts_half_ppr",
  std: "pts_std",
};

export type PlayerOutlook = {
  playerId: string;
  sleeperId: string | null;
  name: string;
  position: string;
  team: string | null;
  /** Rest-of-regular-season average. Null when nothing is published for him. */
  projectedPointsPerWeek: number | null;
  /** Every player at his position, points a week, sorted high to low. */
  positionCurve: number[];
  currentWeek: number;
  lastRegularWeek: number;
  weeksRemaining: number;
  /** Per-week opponent detail, used for the matchup read and the week strip. */
  weeks: MarginalWeek[];
  signals: FaabSignal[];
  confidence: FaabConfidence;
  notices: string[];
};

/**
 * Rest-of-season projections for every player at one position.
 *
 * Paged, because a full position across a dozen remaining weeks runs well past
 * the 1000-row default and a silent truncation here would quietly lower
 * replacement level for everyone.
 */
async function loadPositionProjections(
  position: string,
  season: number,
  fromWeek: number,
  toWeek: number,
  scoring: ScoringBase,
): Promise<Map<string, { total: number; weeks: number }>> {
  const supabase = createCachedReadClient();
  const column = SCORING_COLUMN[scoring];
  const totals = new Map<string, { total: number; weeks: number }>();

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("player_weekly_projections")
      .select(`player_id, week, ${column}, players!inner(position)`)
      .eq("season", season)
      .eq("season_type", "regular")
      .gte("week", fromWeek)
      .lte("week", toWeek)
      .eq("players.position", position)
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;

    for (const row of data as unknown as Array<Record<string, unknown>>) {
      const playerId = row.player_id;
      const value = Number(row[column]);
      if (typeof playerId !== "string" || !Number.isFinite(value)) continue;
      const entry = totals.get(playerId) ?? { total: 0, weeks: 0 };
      entry.total += value;
      entry.weeks += 1;
      totals.set(playerId, entry);
    }

    if (data.length < PAGE) break;
  }

  return totals;
}

/**
 * The same read, memoized.
 *
 * This is the heaviest query behind the manual calculator: every player at a
 * position across every remaining week, so replacement level is measured rather
 * than assumed. It is also identical for every reader who picks any player at
 * that position, and the projections behind it move at most daily, so running
 * it fresh on each selection was pure waste.
 *
 * unstable_cache JSON-serializes its result and a Map does not survive that
 * round trip, so the entries array is cached and the Map rebuilt on the way out.
 */
function loadPositionProjectionsCached(
  position: string,
  season: number,
  fromWeek: number,
  toWeek: number,
  scoring: ScoringBase,
): Promise<Map<string, { total: number; weeks: number }>> {
  return unstable_cache(
    async () => [
      ...(await loadPositionProjections(position, season, fromWeek, toWeek, scoring)),
    ],
    [
      "faab-position-projections",
      position,
      String(season),
      String(fromWeek),
      String(toWeek),
      scoring,
    ],
    { revalidate: CACHE_TTL.daily, tags: [CACHE_TAGS.playerProjections] },
  )().then((entries) => new Map(entries));
}

/** Which scoring base a format slug implies. */
export function scoringBaseForFormat(formatSlug: string): ScoringBase {
  if (formatSlug.includes("half")) return "half_ppr";
  if (formatSlug.includes("-std-") || formatSlug.endsWith("-std")) return "std";
  return "ppr";
}

export async function loadPlayerOutlook(
  supabase: ServiceClient,
  {
    playerId,
    formatSlug,
    settings,
  }: {
    playerId: string;
    formatSlug: string;
    settings: FaabSettings;
  },
): Promise<PlayerOutlook | null> {
  const { data: player } = await supabase
    .from("players")
    .select("id, full_name, first_name, last_name, position, team, external_ids, metadata")
    .eq("id", playerId)
    .maybeSingle();
  if (!player) return null;

  const position = (player.position ?? "").toUpperCase();
  const ext = (player.external_ids as Record<string, unknown>) ?? {};
  const sleeperId = typeof ext.sleeper === "string" ? ext.sleeper : null;
  const meta = (player.metadata as { sleeper?: Record<string, unknown> } | null)?.sleeper ?? {};
  const injuryStatus =
    typeof meta.injury_status === "string" && meta.injury_status.length > 0
      ? meta.injury_status
      : null;

  const nflState = await getNflState();
  const season = Number(nflState?.season) || new Date().getUTCFullYear();
  // Sleeper's own week, floored at 1 so the preseason reads as week 1 rather
  // than zero. 14 is the last regular season week we assume without a league
  // telling us when its playoffs start.
  const currentWeek = Math.max(1, Number(nflState?.week) || 1);
  const lastRegularWeek = 14;
  const weeksRemaining = Math.max(0, lastRegularWeek - currentWeek + 1);

  const notices: string[] = [];
  if (weeksRemaining === 0) {
    notices.push(
      "The regular season is over, so there are no weeks left to project. This bid is based on market value alone.",
    );
  }

  const scoring = scoringBaseForFormat(formatSlug);
  const pulseSettings = await loadPowerPulseSettings(supabase);

  const [positionTotals, accuracyMap, defense, ownProjections] = await Promise.all([
    weeksRemaining > 0
      ? loadPositionProjectionsCached(
          position,
          season,
          currentWeek,
          lastRegularWeek,
          scoring,
        )
      : Promise.resolve(new Map<string, { total: number; weeks: number }>()),
    loadAccuracy(supabase, [playerId], ACCURACY_SCORING[scoring]),
    loadDefenseSplits(supabase, ACCURACY_SCORING[scoring], [season - 1, season - 2]),
    weeksRemaining > 0
      ? loadProjections(supabase, [playerId], season, currentWeek)
      : Promise.resolve([]),
  ]);

  // Averaged over the weeks he is actually projected for, so a bye does not
  // read as a zero-point week and drag the average down.
  const own = positionTotals.get(playerId) ?? null;
  const projectedPointsPerWeek =
    own && own.weeks > 0 ? own.total / own.weeks : null;

  const positionCurve = [...positionTotals.values()]
    .filter((entry) => entry.weeks > 0)
    .map((entry) => entry.total / entry.weeks)
    .sort((a, b) => b - a);

  if (projectedPointsPerWeek === null && weeksRemaining > 0) {
    notices.push(
      "No weekly projections are published for this player right now, so the bid falls back to market value and league size.",
    );
  }

  // Per-week opponent detail. `startsForYou` is true for every week here on
  // purpose: without a roster we cannot know which weeks he would start, and
  // the matchup read is about the games themselves.
  const accuracy: AccuracyRow | null = accuracyMap.get(playerId) ?? null;
  const weeks: MarginalWeek[] = ownProjections
    .filter((p) => p.week >= currentWeek && p.week <= lastRegularWeek)
    .sort((a, b) => a.week - b.week)
    .map((p) => ({
      week: p.week,
      startsForYou: true,
      pointsAdded: 0,
      opponent: p.opponent,
      opponentMultiplier: opponentMultiplier(
        defense,
        [season - 1, season - 2],
        p.opponent,
        position as PulsePosition,
        pulseSettings,
      ),
    }));

  const [gameLogs, finishes] = await Promise.all([
    loadGameLogs(supabase, playerId, season),
    settings.signals.ceiling.enabled
      ? loadPositionalFinishes(
          supabase,
          playerId,
          ACCURACY_SCORING[scoring],
          season - settings.signals.ceiling.lookbackSeasons,
        )
      : Promise.resolve([]),
  ]);

  const signals = buildSignals({
    position,
    accuracy: accuracy
      ? {
          beatRate: accuracy.beatRate,
          availabilityRate: accuracy.availabilityRate,
          ratioStdev: accuracy.ratioStdev,
          weeksPlayed: accuracy.weeksPlayed,
        }
      : null,
    gameLogs,
    weeks,
    positionalFinishes: finishes,
    currentSeason: season,
    settings: settings.signals,
  });

  if (injuryStatus) {
    notices.push(
      `Sleeper lists him as ${injuryStatus}. Check his status before you bid.`,
    );
  }

  const confidence: FaabConfidence = gradeManualConfidence({
    accuracyWeeks: accuracy?.weeksPlayed ?? 0,
    hasProjection: projectedPointsPerWeek !== null,
    hasSnapData: gameLogs.some((g) => g.snapPct !== null),
    curveSize: positionCurve.length,
  });

  return {
    playerId,
    sleeperId,
    name:
      player.full_name ??
      `${player.first_name ?? ""} ${player.last_name ?? ""}`.trim(),
    position,
    team: player.team,
    projectedPointsPerWeek,
    positionCurve,
    currentWeek,
    lastRegularWeek,
    weeksRemaining,
    weeks,
    signals,
    confidence,
    notices,
  };
}

/**
 * Manual mode can never be as sure as league mode, because it is answering a
 * near question rather than the exact one. The grading reflects that: no
 * projection means low no matter how much history a player has.
 */
function gradeManualConfidence({
  accuracyWeeks,
  hasProjection,
  hasSnapData,
  curveSize,
}: {
  accuracyWeeks: number;
  hasProjection: boolean;
  hasSnapData: boolean;
  curveSize: number;
}): FaabConfidence {
  if (!hasProjection) return "low";
  let score = 1;
  if (accuracyWeeks >= 8) score += 2;
  else if (accuracyWeeks >= 4) score += 1;
  if (hasSnapData) score += 1;
  if (curveSize >= 24) score += 1;

  if (score >= 4) return "high";
  if (score >= 2) return "medium";
  return "low";
}
