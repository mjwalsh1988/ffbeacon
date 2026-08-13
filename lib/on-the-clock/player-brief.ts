/**
 * Season-history brief for the handful of players the draft room is actively
 * recommending.
 *
 * WHY THIS IS NOT PART OF THE BOARD LOAD. The ranked board carries every player
 * in a format, which is roughly 800 rows for FF Beacon dynasty superflex.
 * Attaching six seasons of positional finishes to all of them would move tens of
 * thousands of rows on every board fetch to render six numbers, and the board is
 * fetched once per league per session. The spotlight needs history for two
 * players at a time, so it asks for two players at a time.
 *
 * Finishes come from player_positional_finishes, the nightly-rebuilt cache
 * behind the player profile. A finish depends only on the scoring type, so it is
 * source-independent: On The Clock forces FF Beacon values but reads exactly the
 * same finish rows the public profile shows, which is the point. A player's
 * "WR6 in 2025" cannot mean one thing on his profile and another in a draft room.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { scoringKeyForType, type ScoringKey } from "@/lib/player-profile";
import { FINISH_SEASONS_CITED, type SeasonFinish } from "./rationale";

type Client = SupabaseClient<Database>;

/** How many players one request may ask about. The room shows at most two. */
export const MAX_BRIEF_PLAYERS = 4;

/**
 * Seasons of history the spotlight will ever display. Tied to the number the
 * written argument reasons over, so the prose can never grade a smaller set of
 * seasons than the chips beside it show.
 */
export const BRIEF_SEASONS = FINISH_SEASONS_CITED;

export interface PlayerBrief {
  playerId: string;
  /** Newest first, capped at BRIEF_SEASONS. Empty for a rookie. */
  finishes: SeasonFinish[];
}

export interface PlayerBriefResult {
  /** The scoring the finishes were read for, so the UI can label them. */
  scoringKey: ScoringKey;
  /** Human label for that scoring ("PPR", "Half PPR", "Standard"). */
  scoringLabel: string;
  briefs: PlayerBrief[];
}

const SCORING_LABEL: Record<ScoringKey, string> = {
  pts_ppr: "PPR",
  pts_half_ppr: "Half PPR",
  pts_std: "Standard",
};

/**
 * Load positional finishes for up to MAX_BRIEF_PLAYERS players, in the scoring
 * this format actually uses.
 *
 * Returns null for an unknown format rather than guessing. scoringKeyForType
 * defaults to PPR for anything it does not recognize, which is the right default
 * for a format that exists and the wrong answer for one that does not: it would
 * label half-PPR-shaped nothing as "PPR" and the caller would render it.
 *
 * A failed finish query THROWS, so the route can answer 503 and the client can
 * retry on its next recommendation. Swallowing it into an empty brief made a
 * transient outage look like "this player has never scored a point", and the
 * client cached that answer for the rest of the session.
 */
export async function loadPlayerBriefs(
  supabase: Client,
  params: { formatSlug: string; playerIds: string[] },
): Promise<PlayerBriefResult | null> {
  const ids = [...new Set(params.playerIds)].slice(0, MAX_BRIEF_PLAYERS);

  const { data: format } = await supabase
    .from("format_configs")
    .select("scoring_type")
    .eq("slug", params.formatSlug)
    .maybeSingle();

  if (!format) return null;

  const scoringKey = scoringKeyForType(format.scoring_type);
  if (ids.length === 0) {
    return { scoringKey, scoringLabel: SCORING_LABEL[scoringKey], briefs: [] };
  }

  const { data, error } = await supabase
    .from("player_positional_finishes")
    .select("player_id, season, finish, players_ranked")
    .in("player_id", ids)
    .eq("scoring", scoringKey)
    .order("season", { ascending: false });

  if (error || !data) {
    throw new Error(`otc player-brief finish load failed: ${error?.message ?? "no rows returned"}`);
  }

  const bySeasonDesc = new Map<string, SeasonFinish[]>();
  for (const row of data) {
    const list = bySeasonDesc.get(row.player_id) ?? [];
    if (list.length >= BRIEF_SEASONS) continue;
    list.push({
      season: Number(row.season),
      finish: Number(row.finish),
      playersRanked: Number(row.players_ranked),
    });
    bySeasonDesc.set(row.player_id, list);
  }

  return {
    scoringKey,
    scoringLabel: SCORING_LABEL[scoringKey],
    briefs: ids.map((playerId) => ({
      playerId,
      finishes: bySeasonDesc.get(playerId) ?? [],
    })),
  };
}
