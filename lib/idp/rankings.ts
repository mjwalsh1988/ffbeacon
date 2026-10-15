import "server-only";

/**
 * IDP rankings: every relevant defender ranked for the rest of the season, for
 * /rankings/idp, the defender profiles' rank line and nothing else.
 *
 * NO MODEL OF ITS OWN. The rows are the Beacon Ranker's defender seed
 * (lib/ranking-boards/seed.ts loadDefenderRows): our projected rest-of-season
 * points under Sleeper's default IDP scoring (idp123), and last season's idp123
 * points for a defender with no projection. The order is that seed's order:
 * projected players first, the rest after, never interleaved, because the two
 * figures are on two scales.
 *
 * NO VALUE SOURCE. None prices a defender (CLAUDE.md, IDP), so there is no
 * source or format to sync to and this module reads neither.
 *
 * NOT GATED BY THE IDP SWITCH. league_power_pulse_settings.settings.idp.enabled
 * governs League Pulse only; defender profiles, the IDP guide and the ranker's
 * defender seed do not read it, and this page sits with them. The power pulse
 * settings are read below ONLY to resolve the projection engine.
 *
 * A defender is never scored from a stored points column. Every figure here was
 * scored from stat lines under idp123 by the projection read or the finishes
 * calc; lib/idp/points-guard.test.ts holds the line.
 *
 * Plan of record: docs/seo-audit/gsc-growth-plan-2026-10-15.md, section 5.2.
 */

import { unstable_cache } from "next/cache";
import { createAdminClient, createCachedReadClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { loadDefenderRows, type DefenderRow } from "@/lib/ranking-boards/seed";
import { resolveProjectionSourceForWindow } from "@/lib/projections/source";
import { projectionSourceDisplay } from "@/lib/projections/source-constants";
import { loadPowerPulseSettings } from "@/lib/power-pulse/settings";
import { resolveSeasonClock } from "@/lib/start-sit/clock";
import { IDP_POSITIONS, type IdpPosition } from "@/lib/site";

export const IDP_RANKINGS_PER_POSITION = 60;

const REGULAR_SEASON_WEEKS = 18;

export type IdpRankingRow = {
  playerId: string;
  slug: string;
  name: string;
  position: IdpPosition;
  team: string | null;
  overallRank: number; // 1-based across all three positions, in list order
  positionRank: number; // 1-based within position
  /** Projected rest-of-season points under idp123, or null. */
  projectedRos: number | null;
  /** Last season's regular-season idp123 points, or null. */
  lastSeasonPoints: number | null;
  /** Last season's finish at his position under idp123, and the field size. */
  lastSeasonFinish: { finish: number; of: number } | null;
  /** Last season's average defensive snap share, 0 to 100, or null. */
  avgSnapPct: number | null;
  /** Which figure placed him: the projection or last season's points. */
  basis: "projected" | "last_season";
};

export type IdpRankings = {
  season: number | null;
  currentWeek: number;
  lastSeason: number;
  /** One sentence for the page: which figure ordered the list. */
  basisText: string;
  /** Display name of the projection engine that produced projectedRos. */
  projectionSourceDisplay: string;
  byPosition: Record<IdpPosition, IdpRankingRow[]>;
  rows: IdpRankingRow[];
};

/** The extra figures the page shows beside each defender, keyed by player id. */
export type IdpRankingExtras = {
  finishes?: Map<string, { finish: number; of: number }>;
  snapPct?: Map<string, number>;
};

/** The seed's comparator, projected players first: best figure, then name. */
function byProjected(a: DefenderRow, b: DefenderRow): number {
  return (b.projected ?? 0) - (a.projected ?? 0) || a.name.localeCompare(b.name);
}

function byLastSeason(a: DefenderRow, b: DefenderRow): number {
  return (b.lastSeasonPoints ?? 0) - (a.lastSeasonPoints ?? 0) || a.name.localeCompare(b.name);
}

function isIdpPosition(position: string): position is IdpPosition {
  return (IDP_POSITIONS as readonly string[]).includes(position);
}

/**
 * Rank defenders exactly as the ranker's defender seed orders them, per
 * position, keeping the first `perPosition` of each. Overall ranks run across
 * DL, then LB, then DB, in that order. A defender with neither figure is left
 * out, as the seed leaves him out. Pure.
 */
export function rankDefenders(
  rows: readonly DefenderRow[],
  perPosition: number,
  extras: IdpRankingExtras = {},
): IdpRankingRow[] {
  const out: IdpRankingRow[] = [];
  let overall = 0;
  for (const position of IDP_POSITIONS) {
    const pool = rows.filter((r) => r.position === position);
    const withProjection = pool.filter((r) => r.projected !== null).sort(byProjected);
    const withLast = pool
      .filter((r) => r.projected === null && r.lastSeasonPoints !== null)
      .sort(byLastSeason);
    const ordered = [...withProjection, ...withLast].slice(0, Math.max(0, perPosition));
    ordered.forEach((row, index) => {
      if (!isIdpPosition(row.position)) return;
      overall += 1;
      out.push({
        playerId: row.playerId,
        slug: row.slug,
        name: row.name,
        position: row.position,
        team: row.team,
        overallRank: overall,
        positionRank: index + 1,
        projectedRos: row.projected,
        lastSeasonPoints: row.lastSeasonPoints,
        lastSeasonFinish: extras.finishes?.get(row.playerId) ?? null,
        avgSnapPct: extras.snapPct?.get(row.playerId) ?? null,
        basis: row.projected !== null ? "projected" : "last_season",
      });
    });
  }
  return out;
}

/**
 * Which figure ordered the list, in words. The same four branches as
 * loadDefenderSeed in lib/ranking-boards/seed.ts, over the ranked rows.
 */
export function idpBasisText(
  rows: readonly IdpRankingRow[],
  lastSeason: number,
  projectedWindow: boolean,
): string {
  const projected = rows.filter((r) => r.basis === "projected").length;
  const withLast = rows.length - projected;
  if (projected > 0 && withLast > 0) {
    // The seed's sentence, with a singular for a list of one.
    const follow =
      withLast === 1
        ? `The one defender without a projection follows, ordered by his ${lastSeason} points.`
        : `The ${withLast} without a projection follow, ordered by their ${lastSeason} points.`;
    return `Defenders are ordered by our projected points for the rest of the season under Sleeper's default IDP scoring. ${follow}`;
  }
  if (projected > 0) {
    return "Defenders are ordered by our projected points for the rest of the season under Sleeper's default IDP scoring.";
  }
  if (withLast > 0) {
    return projectedWindow
      ? `No defender has a projection yet, so defenders are ordered by their ${lastSeason} points under Sleeper's default IDP scoring.`
      : `The season is over, so defenders are ordered by their ${lastSeason} points under Sleeper's default IDP scoring.`;
  }
  return "We have no projection or last season's points for any defender yet.";
}

/** Where the season is and which engine projects the rest of it. Resolved the
 * same way as seed.ts resolveDefenderSeedKey, OUTSIDE the cached read, so a new
 * week, a new season or an engine flip starts a fresh entry (CLAUDE.md,
 * Projection Engine Source). */
type IdpRankingsKey = {
  season: number | null;
  currentWeek: number;
  projectionSource: string;
};

async function resolveIdpRankingsKey(): Promise<IdpRankingsKey> {
  const admin = createAdminClient();
  const [clock, pulseSettings] = await Promise.all([
    resolveSeasonClock(admin),
    loadPowerPulseSettings(admin),
  ]);
  const inWindow = clock.season != null && clock.currentWeek <= REGULAR_SEASON_WEEKS;
  const projectionSource = inWindow
    ? await resolveProjectionSourceForWindow({
        supabase: admin,
        season: clock.season as number,
        fromWeek: clock.currentWeek,
        toWeek: REGULAR_SEASON_WEEKS,
        settings: pulseSettings.beaconProjections,
      })
    : "none";
  return { season: clock.season, currentWeek: clock.currentWeek, projectionSource };
}

async function readIdpRankings(key: IdpRankingsKey, uncached = false): Promise<IdpRankings> {
  const { rows, lastSeason, projectedWindow } = await loadDefenderRows(uncached);
  const ranked = rankDefenders(rows, IDP_RANKINGS_PER_POSITION);
  const wanted = new Set(ranked.map((r) => r.playerId));
  // Both tables are public-read, so the publishable client with RLS applied:
  // the service role is only needed for the projection engine's settings.
  const reader = createCachedReadClient();

  // Both reads are PAGED and filtered in memory rather than sent a list of a
  // few hundred ids through .in(), which overruns the request URL (see the
  // note in lib/sitemap/sections.ts). Each table holds one row per player per
  // season (and scoring, or season type), so a season is a few thousand rows.
  const [finishRows, snapRows] = await Promise.all([
    fetchAllRows("idp rankings finishes", (from, to) =>
      reader
        .from("player_positional_finishes")
        .select("player_id, position, finish, players_ranked")
        .eq("scoring", "idp123")
        .eq("season", lastSeason)
        .order("player_id", { ascending: true })
        .order("position", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows("idp rankings snap share", (from, to) =>
      reader
        .from("player_idp_seasons")
        .select("player_id, avg_def_snap_pct")
        .eq("season", lastSeason)
        .eq("season_type", "regular")
        .order("player_id", { ascending: true })
        .order("position", { ascending: true })
        .range(from, to),
    ),
  ]);

  // A finish is shown only when it was earned at the position he is listed at
  // now: a linebacker moved to the line would otherwise print as "DL4" for a
  // rank he earned among linebackers.
  const positionOf = new Map(ranked.map((r) => [r.playerId, r.position as string]));
  const finishes = new Map<string, { finish: number; of: number }>();
  for (const f of finishRows) {
    if (!wanted.has(f.player_id) || positionOf.get(f.player_id) !== f.position) continue;
    finishes.set(f.player_id, { finish: f.finish, of: f.players_ranked });
  }
  const snapPct = new Map<string, number>();
  for (const s of snapRows) {
    if (!wanted.has(s.player_id) || s.avg_def_snap_pct === null) continue;
    // Stored as a share, 0 to 1 (lib/idp/seasons.ts); shown as a percentage.
    // Capped at 100: a stored share can land a hair over 1 (2025 holds a
    // 1.0107), and a snap share above 100 percent is not a thing.
    snapPct.set(s.player_id, Math.min(100, Math.round(Number(s.avg_def_snap_pct) * 100)));
  }

  const full = rankDefenders(rows, IDP_RANKINGS_PER_POSITION, { finishes, snapPct });
  const byPosition = { DL: [], LB: [], DB: [] } as Record<IdpPosition, IdpRankingRow[]>;
  for (const row of full) byPosition[row.position].push(row);

  return {
    season: key.season,
    currentWeek: key.currentWeek,
    lastSeason,
    basisText: idpBasisText(full, lastSeason, projectedWindow),
    projectionSourceDisplay: projectionSourceDisplay(key.projectionSource),
    byPosition,
    rows: full,
  };
}

/** The uncached read, for code that runs outside a Next request, where
 * unstable_cache has no cache to use. The seed read is uncached too. */
export async function loadIdpRankings(): Promise<IdpRankings> {
  return readIdpRankings(await resolveIdpRankingsKey(), true);
}

/** The cached read: six hours per (season, week, projection engine), the same
 * helper and lifetime as the defender seed it is built from. */
export async function loadIdpRankingsCached(): Promise<IdpRankings> {
  const key = await resolveIdpRankingsKey();
  return unstable_cache(
    () => readIdpRankings(key),
    [
      "idp:rankings",
      "v1",
      String(key.season ?? "none"),
      String(key.currentWeek),
      key.projectionSource,
    ],
    { revalidate: 21_600 },
  )();
}
