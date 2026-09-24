/**
 * The pass list.
 *
 * Trade Finder shows one suggestion at a time, so "Not interested" is the only
 * steering wheel the feature has. A pass has to survive the page or the button
 * is decoration: reload, and the deal you just turned down is back at the top
 * because it is still, arithmetically, the best one.
 *
 * A pass expires after two weeks (the column default in migration 0173). Rosters
 * move and values move, so a permanent block would eventually hide the obvious
 * deal from the person who once said no to an earlier version of it.
 *
 * READS AND WRITES THROUGH THE READER'S OWN SESSION CLIENT. The owner policies on
 * trade_suggestion_declines are what scope these rows, rather than a `user_id`
 * filter we remembered to write. Passing the admin client here would work and
 * would be wrong: it would move the scoping from the database into this file.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { isValidSuggestionKey } from "@/lib/trade-finder/fingerprint";
import { fetchAllRowsInChunks } from "@/lib/supabase/fetch-all";

type SessionClient =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/**
 * A ceiling on how many live passes one league can accumulate.
 *
 * Well past what any reader will produce by hand, and low enough that a script
 * hammering the decline action cannot grow one query without bound.
 */
const MAX_DECLINES_PER_LEAGUE = 300;

/** Live passes for one reader in one league. Never throws. */
export async function loadDeclinedKeys(
  supabase: SessionClient,
  sleeperLeagueId: string,
): Promise<string[]> {
  try {
    const { data } = await supabase
      .from("trade_suggestion_declines")
      .select("suggestion_key")
      .eq("sleeper_league_id", sleeperLeagueId)
      .gt("expires_at", new Date().toISOString())
      // Newest passes first, so the ceiling keeps the most recent ones.
      .order("declined_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MAX_DECLINES_PER_LEAGUE);
    return (data ?? []).map((row) => row.suggestion_key);
  } catch {
    // A failed read means the reader sees a suggestion they already passed on.
    // That is a worse experience, not a broken one, and it beats an error page.
    return [];
  }
}

/**
 * Live passes across several leagues at once, keyed by Sleeper league id.
 *
 * One paged read rather than one per league, because the cross-league surface
 * asks this about every league the reader is in. The per-league ceiling is
 * applied here, newest first, so each league gets exactly what
 * loadDeclinedKeys would give it. A failed page returns nothing rather than a
 * partial list.
 */
export async function loadDeclinedKeysForLeagues(
  supabase: SessionClient,
  sleeperLeagueIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (sleeperLeagueIds.length === 0) return out;
  const nowIso = new Date().toISOString();
  try {
    const rows = await fetchAllRowsInChunks("trade finder declines", sleeperLeagueIds, (ids, from, to) =>
      (supabase as SupabaseClient<Database>)
        .from("trade_suggestion_declines")
        .select("sleeper_league_id, suggestion_key")
        .in("sleeper_league_id", ids)
        .gt("expires_at", nowIso)
        .order("declined_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    );
    for (const row of rows) {
      const list = out.get(row.sleeper_league_id) ?? [];
      if (list.length >= MAX_DECLINES_PER_LEAGUE) continue;
      list.push(row.suggestion_key);
      out.set(row.sleeper_league_id, list);
    }
  } catch (err) {
    console.error("[trade-finder-declines] cross-league read failed:", (err as Error).message);
    return new Map();
  }
  return out;
}

/**
 * Record a pass, or push an existing one's expiry back out.
 *
 * The upsert targets the unique index rather than checking first, so two presses
 * landing together settle in the database instead of racing in this process.
 *
 * `user_id` is stamped from the caller's own session, never from the request.
 * The insert policy would reject any other value anyway, which is the belt to
 * this braces.
 */
export async function recordDecline(
  supabase: SessionClient,
  params: { userId: string; sleeperLeagueId: string; suggestionKey: string },
): Promise<boolean> {
  if (!isValidSuggestionKey(params.suggestionKey)) return false;
  const now = new Date();
  const expires = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const { error } = await supabase.from("trade_suggestion_declines").upsert(
    {
      user_id: params.userId,
      sleeper_league_id: params.sleeperLeagueId,
      suggestion_key: params.suggestionKey,
      declined_at: now.toISOString(),
      expires_at: expires.toISOString(),
    },
    { onConflict: "user_id,sleeper_league_id,suggestion_key" },
  );
  return !error;
}

export const DECLINE_LIMITS = { MAX_DECLINES_PER_LEAGUE };
