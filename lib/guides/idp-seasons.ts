/**
 * The IDP guide's data reads (plan IDP-217): season lines from
 * player_idp_seasons, league structure from leagues, both cached for an hour
 * in the Next data cache because the guide is force-dynamic and these change
 * at most nightly.
 *
 * The top players per position feed the scoring switcher: their real season
 * lines, re-scored in the browser under each preset. Nothing here names a
 * stored points column (lib/idp/points-guard.test.ts).
 */

import { unstable_cache } from "next/cache";
import { createCachedReadClient } from "@/lib/supabase/server";
import { CACHE_TTL } from "@/lib/cache-tags";
import { scoreIdpLine, type StatLine } from "@/lib/idp/stat-line";
import { IDP_PRESETS } from "@/lib/idp/scoring-presets";
import { DEFENDER_LINE_KEYS, lineFromColumns } from "@/lib/player-profile/defender";
import { yearOverYear, MIN_GAMES, type IdpSeasonRow, type StabilityFigure } from "./idp-stability";
import { summarizeIdpLeagues, type IdpLeagueFacts } from "./idp-leagues";
import { countEligibility, perGameByRank, type EligibilityCounts } from "./idp-scarcity";

const PAGE = 1000;
/**
 * How deep perGameRank goes: the rank-group figure reads thirty-six and the
 * replacement slider reaches one past its maximum.
 */
export const TOP_PER_POSITION = 48;
const LINE_SELECT = DEFENDER_LINE_KEYS.join(", ");

export type GuidePlayerLine = {
  /** players.id, the stable row key (a slug can be empty). */
  id: string;
  name: string;
  slug: string;
  position: "DL" | "LB" | "DB";
  games: number;
  line: StatLine;
};

export type IdpGuideData = {
  /** The last complete season the figures are read from. */
  season: number;
  /**
   * The top twelve per position in that season by season total, Sleeper
   * default IDP scoring. The scoring switcher ranks these.
   */
  topByPosition: Record<"DL" | "LB" | "DB", GuidePlayerLine[]>;
  stability: StabilityFigure[];
  /** First and last season the stability figure covers. */
  stabilitySpan: [number, number] | null;
  leagues: IdpLeagueFacts;
  /**
   * Per-game points (Sleeper default IDP scoring) by per-game rank across every
   * player with MIN_GAMES or more, TOP_PER_POSITION deep. Feeds lesson 4.
   */
  perGameRank: Record<"DL" | "LB" | "DB", number[]>;
  /** Defenders on an NFL team by the positions they may play (today's labels). */
  eligibility: EligibilityCounts;
};

/** The top `n` per position by points in Sleeper default IDP scoring. Pure. */
export function topByPosition(rows: GuidePlayerLine[], n: number): IdpGuideData["topByPosition"] {
  const out: IdpGuideData["topByPosition"] = { DL: [], LB: [], DB: [] };
  for (const pos of ["DL", "LB", "DB"] as const) {
    out[pos] = rows
      .filter((r) => r.position === pos && r.games >= MIN_GAMES)
      .sort(
        (a, b) =>
          scoreIdpLine(b.line, IDP_PRESETS.idp123) - scoreIdpLine(a.line, IDP_PRESETS.idp123) ||
          a.name.localeCompare(b.name),
      )
      .slice(0, n);
  }
  return out;
}

async function loadGuideData(lastCompleteSeason: number): Promise<IdpGuideData> {
  const db = createCachedReadClient();

  const seasonRows: Array<Record<string, unknown>> = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("player_idp_seasons")
      .select(`player_id, season, position, games, ${LINE_SELECT}, players!inner(full_name, slug)`)
      .eq("season_type", "regular")
      .gte("season", 2020)
      .lte("season", lastCompleteSeason)
      .order("player_id", { ascending: true })
      .order("season", { ascending: true })
      .range(from, from + PAGE - 1);
    // Throw rather than break: a failed page would otherwise be cached for an
    // hour as a confident figure built on part of the rows.
    if (error) throw new Error(`IDP guide: player_idp_seasons read failed: ${error.message}`);
    if (!data) break;
    seasonRows.push(...(data as unknown as Array<Record<string, unknown>>));
    if (data.length < PAGE) break;
    if (from > 60_000) break;
  }

  const stabilityRows: IdpSeasonRow[] = seasonRows.map((r) => ({
    playerId: String(r.player_id),
    season: Number(r.season),
    position: String(r.position),
    games: Number(r.games ?? 0),
    line: lineFromColumns(r),
  }));
  const seasons = stabilityRows.map((r) => r.season);

  const latest: GuidePlayerLine[] = seasonRows
    .filter((r) => Number(r.season) === lastCompleteSeason)
    .map((r) => {
      const player = (Array.isArray(r.players) ? r.players[0] : r.players) as
        | { full_name: string | null; slug: string }
        | undefined;
      return {
        id: String(r.player_id),
        name: player?.full_name ?? "Unknown player",
        slug: player?.slug ?? "",
        position: String(r.position) as GuidePlayerLine["position"],
        games: Number(r.games ?? 0),
        line: lineFromColumns(r),
      };
    });

  const leagueRows: Array<{ roster_positions: unknown; scoring_settings: unknown }> = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("leagues")
      .select("roster_positions, scoring_settings")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`IDP guide: leagues read failed: ${error.message}`);
    if (!data) break;
    leagueRows.push(...data);
    if (data.length < PAGE) break;
  }

  // Eligibility among defenders on a team today (lesson 6).
  const eligibilityRows: Array<{ position: string | null; eligible: string[] | null }> = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("players")
      .select("id, position, eligible_positions")
      .in("position", ["DL", "LB", "DB"])
      .not("team", "is", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`IDP guide: players read failed: ${error.message}`);
    if (!data) break;
    for (const row of data) {
      eligibilityRows.push({ position: row.position, eligible: row.eligible_positions });
    }
    if (data.length < PAGE) break;
  }

  return {
    season: lastCompleteSeason,
    eligibility: countEligibility(eligibilityRows),
    topByPosition: topByPosition(latest, 12),
    perGameRank: perGameByRank(latest, TOP_PER_POSITION, MIN_GAMES),
    stability: yearOverYear(stabilityRows),
    stabilitySpan: seasons.length > 0 ? [Math.min(...seasons), Math.max(...seasons)] : null,
    leagues: summarizeIdpLeagues(
      leagueRows.map((l) => ({
        rosterPositions: l.roster_positions,
        scoringSettings: (l.scoring_settings as Record<string, unknown> | null) ?? null,
      })),
    ),
  };
}

/** Cached for an hour. The key carries the season so a rollover rebuilds it. */
export function loadIdpGuideDataCached(lastCompleteSeason: number): Promise<IdpGuideData> {
  return unstable_cache(
    () => loadGuideData(lastCompleteSeason),
    ["idp-guide-data", "v4", String(lastCompleteSeason)],
    { revalidate: CACHE_TTL.hourly },
  )();
}
