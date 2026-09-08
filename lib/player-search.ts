import type { createClient } from "@/lib/supabase/server";
import { ELIGIBLE_POSITIONS } from "@/lib/ranking-boards";
import { memoTtl } from "@/lib/memo-ttl";

/**
 * Shared player autocomplete search, used by every player search surface (the
 * site-wide search palette, Signal Check, Beacon Breakdown, and the My Rankings
 * add-player combobox).
 *
 * Why this exists: Sleeper marks ~8.5k players `status='active'`, including
 * retired free agents (Adrian Peterson still reads active), practice-squad
 * depth, punters, and long snappers. `players.team` is not a reliable filter
 * either: it comes from a periodic snapshot and carries false-nulls for real
 * rostered stars during the offseason. The trustworthy, always-fresh signal for
 * "currently fantasy relevant" is membership in the `rankings` table: our value
 * sources rank the players who actually matter and drop the ones who don't, and
 * that table is a rolling recent window (see RELEVANCE_WINDOW_DAYS). So every
 * autocomplete surfaces players in the six fantasy positions who are currently
 * ranked by at least one source.
 *
 * `players.status` is deliberately NOT part of that filter, and used to be.
 * It is Sleeper's ROSTER state, not a statement about whether a player exists:
 * a player on injured reserve is off the active 53 and reads "Inactive". So the
 * status filter did the opposite of its job in both directions at once. It let
 * through retired free agents, which is the thing the paragraph above says it
 * cannot catch, and it removed 28 currently-ranked real players, among them
 * Ricky Pearsall and Jayden Higgins, for the offence of being hurt.
 *
 * Nobody noticed until 2026-08-25, because the player dimension had not been
 * synced since May and every one of those players was still carrying a stale
 * "active" from before their injury. The moment the data became correct, they
 * vanished from search. Going on IR is exactly when someone looks a player up,
 * and a ranked player is a real player whatever his roster state.
 *
 * Dropping it costs nothing: measured across the busiest surname queries, every
 * one returns the same results or more (smith 9 -> 11, higgins 2 -> 3), because
 * the ranked-membership filter was already doing all the real work.
 */

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** Safe display fields shared by every autocomplete. No values or ranks. */
export interface FantasyPlayerRow {
  id: string;
  slug: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  position: string | null;
  team: string | null;
  external_ids: Record<string, unknown> | null;
}

// A player counts as fantasy relevant when a source has ranked them inside this
// window. `rankings` is already a rolling recent table (earliest rows are only a
// few weeks old), so this window mainly future-proofs the filter against the
// table accumulating history: it never lets a long-dropped player linger.
export const RELEVANCE_WINDOW_DAYS = 90;

// Name matches are filtered down to ranked players AFTER the DB fetch, so we
// over-fetch to leave enough ranked rows to fill the caller's limit even when
// many name matches are unranked. Capped so a broad query stays cheap.
const OVERFETCH_MULTIPLIER = 6;
const MAX_OVERFETCH = 200;

/** How long one process holds the ranked-player set before re-reading it. */
const RANKED_SET_TTL_MS = 5 * 60 * 1000;

/**
 * Every currently fantasy relevant player id, as one memoised set.
 *
 * This replaces a second round trip that ran on every settled keystroke:
 * `rankings` filtered by `.in("player_id", up to 200 ids)` with a 50,000 row
 * limit, just to learn which of the name matches were ranked. It answered a
 * question that is the same for every reader and changes once a night, and it
 * was showing up in the scan counters (8,992 sequential scans over 64M tuples).
 *
 * The whole answer is small: 11,852 ranking rows across 812 distinct players,
 * so the set is under a thousand uuids. The explicit high `.limit()` overrides
 * PostgREST's 1,000 row default, which would otherwise truncate the read and
 * silently drop ranked players from every search result.
 *
 * Memoised rather than user-scoped, which is what makes it safe to share: the
 * set says which players some source has ranked recently. It carries nothing
 * about who is asking.
 */
export async function rankedPlayerIdSet(
  supabase: ServerClient,
): Promise<Set<string>> {
  return memoTtl("ref:ranked-ids", RANKED_SET_TTL_MS, async () => {
    const cutoff = new Date(
      Date.now() - RELEVANCE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { data, error } = await supabase
      .from("rankings")
      .select("player_id")
      .gte("generated_at", cutoff)
      .limit(50000);
    if (error) throw error;
    return new Set((data ?? []).map((r) => r.player_id));
  });
}

/**
 * Of the given player ids, return the subset that is currently fantasy relevant.
 *
 * A thin filter over `rankedPlayerIdSet`, kept so callers holding a candidate
 * list keep working. It issues no query of its own.
 */
export async function fantasyRelevantPlayerIds(
  supabase: ServerClient,
  playerIds: string[],
): Promise<Set<string>> {
  if (playerIds.length === 0) return new Set();
  const ranked = await rankedPlayerIdSet(supabase);
  return new Set(playerIds.filter((id) => ranked.has(id)));
}

/**
 * Normalize a typed query the same way `players.search_name` is normalized.
 *
 * The column (migration 0194) is `first_name || ' ' || last_name`, lowercased,
 * with every non-alphanumeric character removed and runs of whitespace
 * collapsed. A query has to go through the identical transformation or the two
 * sides of the ILIKE are in different alphabets: "A.J." searched against
 * "aj brown" matches nothing, and neither does "St. Brown".
 */
export function normalizeSearchQuery(query: string): string {
  return query
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Search currently-ranked players by name. Returns raw display rows in
 * `full_name` order; callers map to their own result shape and apply any
 * additional ranking (e.g. promoting prefix matches).
 *
 * "Currently ranked" is the only relevance test, on purpose. See the file
 * header for why roster state is not one.
 *
 * `query` must already be sanitized and length-checked by the caller.
 */
export async function searchFantasyPlayers(
  supabase: ServerClient,
  opts: { query: string; positions?: readonly string[]; limit: number },
): Promise<FantasyPlayerRow[]> {
  const positions = opts.positions ?? ELIGIBLE_POSITIONS;
  const normalized = normalizeSearchQuery(opts.query);
  // Normalizing can empty a query that was all punctuation. Nothing matches an
  // empty pattern usefully, so answer before spending a round trip on it.
  if (!normalized) return [];
  const escaped = normalized.replace(/[%_]/g, (m) => `\\${m}`);
  const overfetch = Math.min(opts.limit * OVERFETCH_MULTIPLIER, MAX_OVERFETCH);

  // ONE COLUMN, ONE INDEX.
  //
  // This used to be an `or()` across full_name, first_name and last_name.
  // full_name and search_name carry trigram indexes; first_name and last_name
  // do not, and one unindexed arm of an OR makes the whole predicate a
  // sequential scan. `search_name` is the column built for exactly this
  // (migration 0194) and it subsumes all three arms, because a surname is a
  // substring of "first last".
  const { data, error } = await supabase
    .from("players")
    .select(
      "id, slug, first_name, last_name, full_name, position, team, external_ids",
    )
    .ilike("search_name", `%${escaped}%`)
    .in("position", positions as unknown as string[])
    .order("full_name", { ascending: true, nullsFirst: false })
    .limit(overfetch);

  if (error) throw error;
  const rows = (data ?? []) as FantasyPlayerRow[];
  if (rows.length === 0) return [];

  const ranked = await rankedPlayerIdSet(supabase);
  return rows.filter((r) => ranked.has(r.id)).slice(0, opts.limit);
}
