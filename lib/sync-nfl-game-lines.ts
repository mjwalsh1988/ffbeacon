/**
 * Capture the settled betting line for every finished game (nfl_game_lines,
 * migration 0333).
 *
 * Runs at the tail of the daily odds cron (app/api/cron/sync-nfl-odds) and from
 * the CLI (scripts/sync-nfl-game-lines.ts) for a backfill. It reads the games
 * nfl_game_odds already knows about, keeps the ones that kicked off at least
 * SETTLE_AFTER_MS ago and have no captured line yet, and asks ESPN's
 * per-event odds document for each (lib/nfl-odds.ts getEspnGameLine). A line
 * is written ONCE: it is the market a game was played under, and it does not
 * change after the game. A game ESPN cannot answer for is skipped and tried
 * again on the next run, never stored empty.
 *
 * Bounded per run (maxGames, default 24) so a long backfill window cannot
 * hold the cron past its time limit; the remainder is picked up the next day.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./database.types";
import { getEspnGameLine } from "./nfl-odds";
import { NFL_ODDS_SOURCE_SLUG } from "./sync-nfl-odds";

/** A game the daily run has not captured within this long is given up on, so a game ESPN never answers for cannot hold the queue forever. A backfill that names its weeks is not limited. */
export const GIVE_UP_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

/** A game is settled for odds purposes this long after kickoff. */
export const SETTLE_AFTER_MS = 4 * 60 * 60 * 1000;

const DEFAULT_MAX_GAMES = 24;

export type GameLinesSyncOptions = {
  season: number;
  seasonType?: "pre" | "regular" | "post";
  /** Only these weeks. Omitted: every week of the season. */
  weeks?: number[];
  maxGames?: number;
  now?: Date;
  /**
   * Epoch ms after which no new ESPN request is started. The cron passes one
   * derived from its maxDuration: each request may take up to its 20 s
   * timeout, and a run killed at the limit never records its finish.
   */
  deadlineMs?: number;
};

/** The per-request ESPN timeout in lib/nfl-odds.ts, so a request started before the deadline also ends before it. */
const REQUEST_ALLOWANCE_MS = 20_000;

export type GameLinesSyncResult = {
  candidates: number;
  stored: number;
  failed: number;
  /** Candidates left for the next run because of maxGames or the deadline. */
  deferred: number;
};

/** The ESPN event id stored on the scoreboard competition object, or null. */
export function eventIdFromMetadata(metadata: unknown): string | null {
  const id = (metadata as { id?: unknown } | null)?.id;
  const text = typeof id === "number" ? String(id) : typeof id === "string" ? id.trim() : "";
  return /^[0-9]{1,20}$/.test(text) ? text : null;
}

export async function runNflGameLinesSync(
  supabase: SupabaseClient<Database>,
  opts: GameLinesSyncOptions,
): Promise<GameLinesSyncResult> {
  const seasonType = opts.seasonType ?? "regular";
  const now = (opts.now ?? new Date()).getTime();
  const maxGames = opts.maxGames ?? DEFAULT_MAX_GAMES;

  let query = supabase
    .from("nfl_game_odds")
    .select("season, season_type, week, home_team, away_team, kickoff_at, metadata")
    .eq("source", NFL_ODDS_SOURCE_SLUG)
    .eq("season", opts.season)
    .eq("season_type", seasonType)
    .not("kickoff_at", "is", null)
    .lte("kickoff_at", new Date(now - SETTLE_AFTER_MS).toISOString())
    .order("kickoff_at", { ascending: true });
  if (opts.weeks && opts.weeks.length > 0) query = query.in("week", opts.weeks);
  else query = query.gte("kickoff_at", new Date(now - GIVE_UP_AFTER_MS).toISOString());
  const { data: games, error } = await query.limit(400);
  if (error) throw new Error(`nfl_game_odds read failed: ${error.message}`);

  const { data: captured, error: capturedError } = await supabase
    .from("nfl_game_lines")
    .select("espn_event_id")
    .eq("source", NFL_ODDS_SOURCE_SLUG)
    .eq("season", opts.season)
    .eq("season_type", seasonType)
    .limit(1000);
  if (capturedError) throw new Error(`nfl_game_lines read failed: ${capturedError.message}`);
  const have = new Set((captured ?? []).map((r) => r.espn_event_id));

  const candidates = (games ?? [])
    .map((g) => ({ ...g, eventId: eventIdFromMetadata(g.metadata) }))
    .filter((g): g is typeof g & { eventId: string } => g.eventId !== null && !have.has(g.eventId));

  let stored = 0;
  let failed = 0;
  let attempted = 0;
  for (const game of candidates.slice(0, maxGames)) {
    if (opts.deadlineMs !== undefined && Date.now() + REQUEST_ALLOWANCE_MS > opts.deadlineMs) break;
    attempted += 1;
    const line = await getEspnGameLine(game.eventId, game.home_team, game.away_team);
    if (!line) {
      failed += 1;
      continue;
    }
    const { error: upsertError } = await supabase.from("nfl_game_lines").upsert(
      {
        source: NFL_ODDS_SOURCE_SLUG,
        espn_event_id: game.eventId,
        season: game.season,
        season_type: game.season_type,
        week: game.week,
        home_team: game.home_team,
        away_team: game.away_team,
        kickoff_at: game.kickoff_at,
        provider: line.provider,
        open_home_spread: line.openHomeSpread,
        close_home_spread: line.closeHomeSpread,
        open_game_total: line.openGameTotal,
        close_game_total: line.closeGameTotal,
        home_moneyline: line.homeMoneyline,
        away_moneyline: line.awayMoneyline,
        over_odds: line.overOdds,
        under_odds: line.underOdds,
        metadata: line.raw as Json,
      },
      { onConflict: "source,espn_event_id", ignoreDuplicates: true },
    );
    if (upsertError) {
      failed += 1;
      console.warn(`  nfl_game_lines upsert failed for event ${game.eventId}: ${upsertError.message}`);
      continue;
    }
    stored += 1;
  }

  return {
    candidates: candidates.length,
    stored,
    failed,
    deferred: Math.max(0, candidates.length - attempted),
  };
}
