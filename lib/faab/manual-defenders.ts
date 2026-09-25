import "server-only";

/**
 * The defenders the MANUAL FAAB calculator can price (no league connected).
 *
 * League mode lists the defenders available in the reader's own league
 * (./idp-free-agents.ts). Manual mode has no league, so it lists the defenders
 * worth bidding on anywhere: every DL, LB and DB on an NFL roster who played a
 * real defensive role (20 or more defensive snaps in a game) this season or
 * last, the same relevance gate the site search uses, ranked within his
 * position by idp123 points a game (Sleeper's default IDP scoring).
 *
 * Ranked from the stored season lines in player_idp_seasons, one small read,
 * rather than from rest-of-season projections: the list only decides what the
 * search box suggests first. The price itself comes from the projections, read
 * once a defender is picked (./outlook.ts), exactly as for an offensive player.
 *
 * Returned only while the IDP switch is on, like every other IDP surface (plan
 * R-25); the page reads the switch and skips this call when it is off.
 */

import { unstable_cache } from "next/cache";
import { createCachedReadClient } from "@/lib/supabase/server";
import { fetchAllRows, fetchAllRowsInChunks } from "@/lib/supabase/fetch-all";
import { CACHE_TAGS, CACHE_TTL } from "@/lib/cache-tags";
import { IDP_POSITIONS } from "@/lib/site";
import { IDP_PRESETS } from "@/lib/idp/scoring-presets";
import { scoreIdpLine, type StatLine } from "@/lib/idp/stat-line";
import type { FaabListPlayer } from "./player-list";

/** Listed per position. Deep enough for the waiver tier, small enough to ship. */
export const MANUAL_DEFENDERS_PER_POSITION = 100;

/** A season needs this many games before its per-game figure is preferred. */
const MIN_GAMES_THIS_SEASON = 2;

/** Sorts after every ranked offensive player, and is never printed as a rank. */
const UNRANKED_BASE = 100_000;

const STAT_KEYS = Object.keys(IDP_PRESETS.idp123);

type SeasonRow = {
  player_id: string;
  season: number;
  position: string;
  games: number | null;
  games_20_snaps: number | null;
} & Record<string, unknown>;

export type ManualDefenderCandidate = {
  playerId: string;
  position: string;
  season: number;
  games: number;
  pointsPerGame: number;
};

/**
 * idp123 points a game for one stored season line, or null when he played no
 * games. Pure; exported for the tests.
 */
export function idp123PerGame(row: Record<string, unknown>, games: number): number | null {
  if (!(games > 0)) return null;
  const line: StatLine = {};
  for (const key of STAT_KEYS) {
    const value = Number(row[key]);
    if (Number.isFinite(value)) line[key] = value;
  }
  return scoreIdpLine(line, IDP_PRESETS.idp123) / games;
}

/**
 * One figure per player: this season's per-game rate once he has played
 * MIN_GAMES_THIS_SEASON games, otherwise last season's, otherwise whatever this
 * season has. Only seasons in which he passed the relevance gate count. Pure.
 */
export function pickRankingSeason(
  rows: ReadonlyArray<SeasonRow>,
  season: number,
): Map<string, ManualDefenderCandidate> {
  const byPlayer = new Map<string, SeasonRow[]>();
  for (const row of rows) {
    if ((row.games_20_snaps ?? 0) < 1) continue;
    const list = byPlayer.get(row.player_id) ?? [];
    list.push(row);
    byPlayer.set(row.player_id, list);
  }
  const out = new Map<string, ManualDefenderCandidate>();
  for (const [playerId, list] of byPlayer) {
    const current = list.find((r) => r.season === season);
    const prior = list.find((r) => r.season === season - 1);
    const chosen =
      current && (current.games ?? 0) >= MIN_GAMES_THIS_SEASON ? current : (prior ?? current);
    if (!chosen) continue;
    const games = chosen.games ?? 0;
    const ppg = idp123PerGame(chosen, games);
    if (ppg === null) continue;
    out.set(playerId, {
      playerId,
      position: (current ?? chosen).position,
      season: chosen.season,
      games,
      pointsPerGame: ppg,
    });
  }
  return out;
}

type PlayerRow = {
  id: string;
  slug: string;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  team: string | null;
  external_ids: Record<string, unknown> | null;
};

function sleeperIdOf(external: unknown): string | null {
  if (!external || typeof external !== "object") return null;
  const value = (external as Record<string, unknown>).sleeper;
  if (typeof value === "string" && value) return value;
  if (typeof value === "number") return String(value);
  return null;
}

async function loadManualDefenders(season: number): Promise<FaabListPlayer[]> {
  const supabase = createCachedReadClient();
  const seasonRows = await fetchAllRows<SeasonRow>("faab manual defenders seasons", (from, to) =>
    supabase
      .from("player_idp_seasons")
      .select(`player_id, season, position, games, games_20_snaps, ${STAT_KEYS.join(", ")}`)
      .in("season", [season, season - 1])
      .eq("season_type", "regular")
      .order("player_id", { ascending: true })
      .order("season", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: SeasonRow[] | null; error: { message: string } | null }>,
  );
  const candidates = pickRankingSeason(seasonRows, season);
  if (candidates.size === 0) return [];

  // Identity, and today's position and team: a defender who has left the
  // league or moved off defense is not someone to bid on.
  const players = await fetchAllRowsInChunks<PlayerRow, string>(
    "faab manual defenders players",
    [...candidates.keys()],
    (chunk, from, to) =>
      supabase
        .from("players")
        .select("id, slug, first_name, last_name, position, team, external_ids")
        .in("id", chunk)
        .in("position", [...IDP_POSITIONS])
        .not("team", "is", null)
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: PlayerRow[] | null; error: { message: string } | null }>,
  );

  const out: FaabListPlayer[] = [];
  let order = 0;
  for (const position of IDP_POSITIONS) {
    const atPosition = players
      .filter((p) => p.position === position && p.slug)
      .map((p) => ({ player: p, ppg: candidates.get(p.id)?.pointsPerGame ?? 0 }))
      .sort((a, b) => b.ppg - a.ppg || a.player.id.localeCompare(b.player.id))
      .slice(0, MANUAL_DEFENDERS_PER_POSITION);
    atPosition.forEach(({ player }, index) => {
      out.push({
        slug: player.slug,
        player_id: player.id,
        name: `${player.first_name ?? ""} ${player.last_name ?? ""}`.trim(),
        position,
        team: player.team,
        sleeper_id: sleeperIdOf(player.external_ids),
        overall_rank: UNRANKED_BASE + order,
        position_rank: index + 1,
        value: null,
      });
      order += 1;
    });
  }
  return out;
}

/** Memoized per season for a day; the season lines are rebuilt nightly. */
export function loadManualDefendersCached(season: number): Promise<FaabListPlayer[]> {
  return unstable_cache(() => loadManualDefenders(season), ["faab-manual-defenders", String(season)], {
    revalidate: CACHE_TTL.daily,
    tags: [CACHE_TAGS.playerProjections],
  })();
}
