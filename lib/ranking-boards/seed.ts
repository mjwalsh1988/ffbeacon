import "server-only";

/**
 * Beacon Ranker's seed lists (plan sections 5.1, 5.3 and 8).
 *
 * THE OFFENSIVE SEED is the chosen source's rankings in order: the same query
 * as app/api/rankings/import (current season, season-long rows, the
 * data_type = rankings filter through resolveSourceForFormat), but callable for
 * a guest, which that route is not. The caller meters it
 * (claimRateLimitSlot, per actor) before asking, because a run start is the
 * one moment a guest could otherwise pull a thousand-row list in a loop. The
 * read itself is public data, the same for every reader, so it is cached for
 * an hour.
 *
 * THE DEFENDER SEED is ours, because no source ranks a defender (decision 17):
 *   1. projected points for the rest of the season through
 *      lib/projections/read.ts loadAdjustedProjections, defenders only, under
 *      Sleeper's default IDP scoring (idp123). That read resolves its own
 *      projection source (resolveProjectionSourceForWindow) and returns our
 *      ADJUSTED figure.
 *   2. where a defender has no projection, last season's points under idp123,
 *      read from player_positional_finishes, which the finishes calc scores
 *      from each defender's stat lines (lib/idp/stat-line.ts). Out of season
 *      the remaining-weeks window is empty and every defender takes this path.
 *   3. a defender with neither is not seeded; the reader can add him by hand.
 * A defender is never scored from the stored pts_* columns. The list says in
 * words which figure ordered it.
 */

import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createAdminClient, createCachedReadClient } from "@/lib/supabase/server";
import { fetchAllRows, fetchAllRowsInChunks } from "@/lib/supabase/fetch-all";
import {
  getActiveFormats,
  getAvailableSources,
  resolveSourceForFormat,
  describeSource,
} from "@/lib/source";
import { idpRelevantPlayerIdSet } from "@/lib/player-search";
import { loadAdjustedProjections } from "@/lib/projections/read";
import { resolveSeasonClock } from "@/lib/start-sit/clock";
import { IDP_PRESETS } from "@/lib/idp/scoring-presets";
import { IDP_POSITIONS, OFFENSE_POSITIONS } from "@/lib/site";
import { readSleeperId } from "@/lib/ranking-boards";

type Client = SupabaseClient<Database>;

const MAX_SEED_ROWS = 1000;
const REGULAR_SEASON_WEEKS = 18;

export type SeedPlayer = {
  playerId: string;
  slug: string;
  name: string;
  position: string;
  team: string | null;
  sleeperId: string | null;
};

export type OffenseSeed = {
  players: SeedPlayer[];
  /** The source that actually answered (after any fallback). */
  sourceSlug: string | null;
  sourceDisplay: string | null;
  /** The source the reader asked for, when it could not cover the format. */
  requestedDisplay: string | null;
  fellBack: boolean;
  formatSlug: string;
  formatDisplay: string;
};

type PlayerJoin = {
  id: string;
  slug: string;
  first_name: string;
  last_name: string;
  full_name: string | null;
  position: string;
  team: string | null;
  external_ids: Record<string, unknown> | null;
};

function toSeedPlayer(p: PlayerJoin): SeedPlayer {
  return {
    playerId: p.id,
    slug: p.slug,
    name: p.full_name ?? `${p.first_name} ${p.last_name}`,
    position: p.position,
    team: p.team,
    sleeperId: readSleeperId(p.external_ids),
  };
}

/** One source's current season-long rankings for one format, in overall-rank
 * order, every position. Cached for an hour: public, and rebuilt nightly. */
function loadRankedPlayers(sourceSlug: string, formatConfigId: string): Promise<SeedPlayer[]> {
  return unstable_cache(
    async () => {
      const supabase = createCachedReadClient();
      const rows = await fetchAllRows(
        "ranker seed rankings",
        (from, to) =>
          supabase
            .from("rankings")
            .select(
              "id, overall_rank, players!inner(id, slug, first_name, last_name, full_name, position, team, external_ids)",
            )
            .eq("format_config_id", formatConfigId)
            .eq("source", sourceSlug)
            .is("week", null)
            .order("overall_rank", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
        { maxRows: MAX_SEED_ROWS * 2 },
      );
      return rows
        .slice(0, MAX_SEED_ROWS)
        .map((row) => toSeedPlayer(row.players as unknown as PlayerJoin));
    },
    ["ranking-boards:seed", sourceSlug, formatConfigId],
    { revalidate: 3600 },
  )();
}

/**
 * The offensive seed for a (source, format, positions) choice. Returns null
 * only for a format that is not active; a source that cannot cover the format
 * falls back to one that can, and says so.
 */
export async function loadOffenseSeed(
  supabase: Client,
  opts: { formatSlug: string; sourceSlug: string | null; positions: readonly string[] },
): Promise<OffenseSeed | null> {
  const [formats, registry] = await Promise.all([
    getActiveFormats(supabase),
    getAvailableSources(supabase),
  ]);
  const format = formats.find((f) => f.slug === opts.formatSlug);
  if (!format) return null;
  const resolution = resolveSourceForFormat(registry, "rankings", format.slug, opts.sourceSlug);
  const base = {
    formatSlug: format.slug,
    formatDisplay: format.display_name,
    fellBack: resolution.fellBack,
    requestedDisplay: resolution.fellBack ? describeSource(registry, resolution.requested) : null,
  };
  if (!resolution.source) {
    return { ...base, players: [], sourceSlug: null, sourceDisplay: null };
  }
  const offense = new Set(
    opts.positions.filter((p) => (OFFENSE_POSITIONS as readonly string[]).includes(p)),
  );
  const ranked = await loadRankedPlayers(resolution.source, format.id);
  return {
    ...base,
    players: ranked.filter((p) => offense.has(p.position)),
    sourceSlug: resolution.source,
    sourceDisplay: describeSource(registry, resolution.source),
  };
}

export type DefenderSeedBasis = "projected" | "last_season" | "mixed" | "none";

export type DefenderSeed = {
  players: SeedPlayer[];
  basis: DefenderSeedBasis;
  /** The season "last season's points" refers to. */
  lastSeason: number;
  /** One sentence for the page: which figure ordered the list. */
  basisText: string;
};

type DefenderRow = SeedPlayer & { projected: number | null; lastSeasonPoints: number | null };

type DefenderRows = { rows: DefenderRow[]; lastSeason: number; projectedWindow: boolean };

/** Every relevant defender with both figures. Cached for six hours per
 * (season, week): projections refresh daily and the IDP set is memoised for
 * the day anyway. Uses the service-role client because the projection read's
 * settings and accuracy tables are service-role only. */
async function readDefenderRows(): Promise<DefenderRows> {
  const admin = createAdminClient();
  const clock = await resolveSeasonClock(admin);
  const relevant = [...(await idpRelevantPlayerIdSet(admin))];
  const players = await fetchAllRowsInChunks(
    "ranker defender players",
    relevant,
    (chunk, from, to) =>
      admin
        .from("players")
        .select("id, slug, first_name, last_name, full_name, position, team, external_ids")
        .in("id", chunk)
        .in("position", [...IDP_POSITIONS])
        .not("team", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
  );
  const seeds = players.map((p) => toSeedPlayer(p as unknown as PlayerJoin));

  const season = clock.season;
  const window =
    season != null && clock.currentWeek <= REGULAR_SEASON_WEEKS
      ? { from: clock.currentWeek, to: REGULAR_SEASON_WEEKS }
      : null;
  const lastSeason = season != null && window ? season - 1 : season ?? new Date().getUTCFullYear() - 1;

  const projected = new Map<string, number>();
  if (season != null && window && seeds.length > 0) {
    const { byPlayer } = await loadAdjustedProjections({
      supabase: admin,
      playerIds: seeds.map((s) => s.playerId),
      season,
      fromWeek: window.from,
      toWeek: window.to,
      scoringSettings: { ...IDP_PRESETS.idp123 },
      positionByPlayer: new Map(seeds.map((s) => [s.playerId, s.position])),
      currentWeek: clock.currentWeek,
      includeDefenders: true,
      defendersOnly: true,
    });
    for (const [id, summary] of byPlayer) {
      if (summary.weeks > 0) projected.set(id, summary.total);
    }
  }

  const finishes = await fetchAllRowsInChunks(
    "ranker defender last season",
    seeds.map((s) => s.playerId),
    (chunk, from, to) =>
      admin
        .from("player_positional_finishes")
        .select("player_id, total_points, season")
        .in("player_id", chunk)
        .eq("scoring", "idp123")
        .eq("season", lastSeason)
        .order("player_id", { ascending: true })
        .range(from, to),
  );
  const last = new Map(finishes.map((f) => [f.player_id, Number(f.total_points)]));

  const rows: DefenderRow[] = seeds.map((s) => ({
    ...s,
    projected: projected.get(s.playerId) ?? null,
    lastSeasonPoints: last.get(s.playerId) ?? null,
  }));
  return { rows, lastSeason, projectedWindow: window !== null };
}

/** The cached read. `uncached` is for code that runs outside a Next request,
 * where unstable_cache has no cache to use (the community rankings script). */
function loadDefenderRows(uncached = false): Promise<DefenderRows> {
  if (uncached) return readDefenderRows();
  return unstable_cache(readDefenderRows, ["ranking-boards:defender-seed", "v1"], {
    revalidate: 21_600,
  })();
}

/**
 * The defender seed for the given defensive positions, best first: projected
 * players by projected rest-of-season points, then the rest by last season's
 * points. Two figures on two scales are never interleaved, so the second group
 * always follows the first.
 */
export async function loadDefenderSeed(
  positions: readonly string[],
  opts: { uncached?: boolean } = {},
): Promise<DefenderSeed> {
  const { rows, lastSeason, projectedWindow } = await loadDefenderRows(opts.uncached === true);
  const wanted = new Set(positions);
  const pool = rows.filter((r) => wanted.has(r.position));
  const withProjection = pool
    .filter((r) => r.projected !== null)
    .sort((a, b) => (b.projected ?? 0) - (a.projected ?? 0) || a.name.localeCompare(b.name));
  const withLast = pool
    .filter((r) => r.projected === null && r.lastSeasonPoints !== null)
    .sort(
      (a, b) =>
        (b.lastSeasonPoints ?? 0) - (a.lastSeasonPoints ?? 0) || a.name.localeCompare(b.name),
    );
  const players = [...withProjection, ...withLast].map(
    ({ projected: _p, lastSeasonPoints: _l, ...seed }) => seed,
  );

  let basis: DefenderSeedBasis;
  let basisText: string;
  if (withProjection.length > 0 && withLast.length > 0) {
    basis = "mixed";
    basisText = `Defenders are ordered by our projected points for the rest of the season under Sleeper's default IDP scoring. The ${withLast.length} without a projection follow, ordered by their ${lastSeason} points.`;
  } else if (withProjection.length > 0) {
    basis = "projected";
    basisText =
      "Defenders are ordered by our projected points for the rest of the season under Sleeper's default IDP scoring.";
  } else if (withLast.length > 0) {
    basis = "last_season";
    basisText = projectedWindow
      ? `No defender has a projection yet, so defenders are ordered by their ${lastSeason} points under Sleeper's default IDP scoring.`
      : `The season is over, so defenders are ordered by their ${lastSeason} points under Sleeper's default IDP scoring.`;
  } else {
    basis = "none";
    basisText = "We have no projection or last season's points for any defender yet.";
  }
  return { players, basis, lastSeason, basisText };
}
