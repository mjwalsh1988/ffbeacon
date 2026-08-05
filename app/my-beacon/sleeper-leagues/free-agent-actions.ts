"use server";

import { createClient } from "@/lib/supabase/server";
import {
  findFreeAgentLeagues,
  MAX_SEARCHED_LEAGUES,
  type FreeAgentReport,
} from "@/lib/free-agent-finder";

/**
 * The Free Agent Finder's one server call.
 *
 * A server action rather than a route handler because this is a dashboard-only
 * lookup with no shareable URL and no cache to key: the reader picks a player,
 * we answer, and the answer is worth nothing to anyone else.
 *
 * WHY THE LEAGUE IDS COME FROM THE CLIENT
 *   We do not store which Sleeper leagues a reader is in; the page learns that
 *   from Sleeper at render time and hands it down. Deriving it again here would
 *   mean a second Sleeper round trip on every keystroke-driven search, which is
 *   exactly what this feature is supposed to avoid.
 *
 *   That is safe because it grants nothing. Rosters are public data under RLS
 *   and the public League Pulse tool already renders any league's rosters to
 *   anyone who asks, so a caller passing a league id they are not in learns
 *   nothing they could not read from /leagues/<id>. The auth gate below is
 *   about keeping this a member surface, not about protecting the rows.
 *
 * TRIGGERS NO SYNC. It reads stored rosters and nothing else. A league nobody
 * has pulsed comes back counted as unanswered, never as "he is available".
 */

/** Sleeper player ids are numeric strings; team defenses are alphabetic codes. */
const PLAYER_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
/** League and user ids are Sleeper's own long numeric ids. */
const SLEEPER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type FreeAgentSearchResult =
  { ok: true; report: FreeAgentReport } | { ok: false; error: string };

export async function searchFreeAgent(input: {
  sleeperPlayerId: string;
  sleeperLeagueIds: string[];
  sleeperUserId: string | null;
}): Promise<FreeAgentSearchResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const sleeperPlayerId = String(input.sleeperPlayerId ?? "");
  if (!PLAYER_ID_PATTERN.test(sleeperPlayerId)) {
    return { ok: false, error: "Invalid player id" };
  }

  const sleeperUserId =
    input.sleeperUserId && SLEEPER_ID_PATTERN.test(String(input.sleeperUserId))
      ? String(input.sleeperUserId)
      : null;

  const sleeperLeagueIds = (
    Array.isArray(input.sleeperLeagueIds) ? input.sleeperLeagueIds : []
  )
    .filter((id): id is string => typeof id === "string")
    .filter((id) => SLEEPER_ID_PATTERN.test(id))
    .slice(0, MAX_SEARCHED_LEAGUES);
  if (sleeperLeagueIds.length === 0) {
    return { ok: false, error: "No leagues to search" };
  }

  const report = await findFreeAgentLeagues(supabase, {
    sleeperPlayerId,
    sleeperLeagueIds,
    sleeperUserId,
  });
  return { ok: true, report };
}
