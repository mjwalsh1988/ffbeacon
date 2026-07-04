import type { createClient } from "@/lib/supabase/server";
import { ELIGIBLE_POSITIONS } from "@/lib/ranking-boards";

/**
 * Shared player autocomplete search, used by every player search surface (the
 * site-wide search palette, Signal Check, Beacon Breakdown, and the My Rankings
 * add-player combobox).
 *
 * Why this exists: Sleeper marks ~8.6k players `status='active'`, including
 * retired free agents (Adrian Peterson still reads active), practice-squad
 * depth, punters, and long snappers. `players.team` is not a reliable filter
 * either: it comes from a periodic snapshot and carries false-nulls for real
 * rostered stars during the offseason. The trustworthy, always-fresh signal for
 * "currently fantasy relevant" is membership in the `rankings` table: our value
 * sources rank the players who actually matter and drop the ones who don't, and
 * that table is a rolling recent window (see RELEVANCE_WINDOW_DAYS). So every
 * autocomplete only surfaces active players in the six fantasy positions who are
 * currently ranked by at least one source.
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
const RELEVANCE_WINDOW_DAYS = 90;

// Name matches are filtered down to ranked players AFTER the DB fetch, so we
// over-fetch to leave enough ranked rows to fill the caller's limit even when
// many name matches are unranked. Capped so a broad query stays cheap.
const OVERFETCH_MULTIPLIER = 6;
const MAX_OVERFETCH = 200;

/**
 * Of the given player ids, return the subset that is currently fantasy relevant
 * (ranked by at least one source within the relevance window).
 *
 * The explicit high `.limit()` overrides PostgREST's 1000-row default: a large
 * candidate set can match several thousand raw ranking rows (one per
 * source/format/snapshot), and truncating them would silently drop ranked
 * players from the result. We only read `player_id`, so the payload stays small.
 */
export async function fantasyRelevantPlayerIds(
  supabase: ServerClient,
  playerIds: string[],
): Promise<Set<string>> {
  if (playerIds.length === 0) return new Set();
  const cutoff = new Date(
    Date.now() - RELEVANCE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data, error } = await supabase
    .from("rankings")
    .select("player_id")
    .in("player_id", playerIds)
    .gte("generated_at", cutoff)
    .limit(50000);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.player_id));
}

/**
 * Search active, currently-ranked players by name. Returns raw display rows in
 * `full_name` order; callers map to their own result shape and apply any
 * additional ranking (e.g. promoting prefix matches).
 *
 * `query` must already be sanitized and length-checked by the caller.
 */
export async function searchFantasyPlayers(
  supabase: ServerClient,
  opts: { query: string; positions?: readonly string[]; limit: number },
): Promise<FantasyPlayerRow[]> {
  const positions = opts.positions ?? ELIGIBLE_POSITIONS;
  const escaped = opts.query.replace(/[%_]/g, (m) => `\\${m}`);
  const overfetch = Math.min(opts.limit * OVERFETCH_MULTIPLIER, MAX_OVERFETCH);

  const { data, error } = await supabase
    .from("players")
    .select(
      "id, slug, first_name, last_name, full_name, position, team, external_ids",
    )
    .eq("status", "active")
    .or(
      `full_name.ilike.%${escaped}%,first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%`,
    )
    .in("position", positions as unknown as string[])
    .order("full_name", { ascending: true, nullsFirst: false })
    .limit(overfetch);

  if (error) throw error;
  const rows = (data ?? []) as FantasyPlayerRow[];
  if (rows.length === 0) return [];

  const relevant = await fantasyRelevantPlayerIds(
    supabase,
    rows.map((r) => r.id),
  );
  return rows.filter((r) => relevant.has(r.id)).slice(0, opts.limit);
}
