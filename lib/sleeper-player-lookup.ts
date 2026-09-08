import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * Sleeper player ids to our player rows.
 *
 * Sleeper names nobody: a transaction, a lineup and a matchup all arrive as
 * lists of numeric strings, so every surface that renders one has to look them
 * up. This is that lookup, in one place, and it is the ONLY place allowed to
 * run the slug-tail fallback. `lib/players/sleeper-lookup-guard.test.ts` fails
 * the suite if another file grows a copy.
 *
 * TWO PASSES, AND THE SPLIT IS THE WHOLE POINT.
 *
 * `external_ids->>'sleeper'` is indexed (`idx_players_external_sleeper`).
 * Putting a second, unindexable predicate in the SAME `or()` makes the ENTIRE
 * filter unindexable, so every call sequentially scans `players`. Measured on
 * production before this was fixed (site-speed-audit-and-plan.md, 4.1):
 *
 *   with the slug clause:    Seq Scan, 10,473 rows removed, 1,319.8 ms
 *   without the slug clause: BitmapOr on the index,             0.3 ms
 *
 * Pass one is the indexed lookup. Pass two runs the fallback ONLY against the
 * ids pass one could not resolve, which is normally none, so the second query
 * usually never runs at all.
 *
 * AND THE FALLBACK IS ITSELF INDEXED NOW. It used to be `slug.like.*-<id>`, a
 * leading-wildcard pattern no B-tree can serve, so the rare second pass was a
 * full scan. Migration 0271 added `players.sleeper_slug_tail`, a stored
 * generated column holding the numeric tail of the slug, with its own index, so
 * the fallback is `.in("sleeper_slug_tail", missing)`: same rows, index scan.
 *
 * THE ID FILTER IS SECURITY, NOT TIDINESS. These ids arrive from a Sleeper
 * league we do not control and are interpolated into PostgREST's filter
 * language below. Sleeper player ids are numeric strings, so anything else is
 * dropped before it can reach the query.
 */

export type PlayerLookupEntry = {
  /** Our `players.id`. */
  id: string;
  slug: string;
  /** Best display name, falling back to the Sleeper id when we hold neither. */
  name: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  /** Not nullable in the schema, so neither is this. */
  position: string;
  team: string | null;
  birthDate: string | null;
  yearsExperience: number | null;
};

export type PlayerLookup = Record<string, PlayerLookupEntry>;

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/**
 * Ids per query.
 *
 * A chunk of 100 is roughly 100 filter terms and about 3 KB of request line,
 * comfortably inside any proxy's limit. The activity feed can name well over a
 * thousand players on one full page, which is where the old 200 (and its 400
 * terms, because both branches were in the same filter) got close to the edge.
 */
const CHUNK = 100;

/**
 * `birth_date` and `years_experience` are here for the league overview's team
 * cards, which are the reason this helper exists at all. Two more columns on a
 * 10,481 row table is not worth a second query shape.
 */
const COLUMNS =
  "id, slug, full_name, first_name, last_name, position, team, external_ids, birth_date, years_experience";

type PlayerRow = {
  id: string;
  slug: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  position: string;
  team: string | null;
  external_ids: unknown;
  birth_date: string | null;
  years_experience: number | null;
};

export type ResolveOptions = {
  /**
   * Turn a failed read into a thrown error rather than a missing name.
   *
   * The two feed callers want the opposite: a transaction row that cannot name
   * one of its players should still render, with the id in place of the name.
   * A caller that WRITES a cache from the result wants the throw, because a
   * silently short lookup there stores a roster valued as though half of it
   * did not exist. `lib/league-power-rankings.ts` is that caller.
   */
  throwOnError?: boolean;
};

export async function resolveSleeperPlayers(
  supabase: AnySupabase,
  sleeperIds: string[],
  options: ResolveOptions = {},
): Promise<PlayerLookup> {
  const out: PlayerLookup = {};
  const safeIds = [...new Set(sleeperIds)].filter((id) => /^\d+$/.test(id));
  if (safeIds.length === 0) return out;

  const db = supabase as SupabaseClient<Database>;

  // Pass one: the indexed lookup. Chunks run together rather than in a queue;
  // they touch no shared state and each writes disjoint keys.
  const indexed = await Promise.all(
    chunksOf(safeIds).map((chunk) =>
      db
        .from("players")
        .select(COLUMNS)
        .or(chunk.map((id) => `external_ids->>sleeper.eq.${id}`).join(",")),
    ),
  );
  for (const { data, error } of indexed) {
    if (error && options.throwOnError) {
      throw new Error(`player resolve failed: ${error.message}`);
    }
    for (const row of (data ?? []) as PlayerRow[]) {
      const ext = (row.external_ids as Record<string, unknown>) ?? {};
      const sid = typeof ext.sleeper === "string" ? ext.sleeper : null;
      if (!sid || out[sid]) continue;
      out[sid] = entry(row, sid);
    }
  }

  // Pass two: the slug-tail fallback, for a player Sleeper added since our last
  // sync, or a row whose `external_ids` was never written. Normally empty, so
  // normally no query at all.
  const unresolved = safeIds.filter((id) => !out[id]);
  if (unresolved.length === 0) return out;

  const fallback = await Promise.all(
    chunksOf(unresolved).map(async (chunk) => ({
      chunk,
      result: await db
        .from("players")
        .select(COLUMNS)
        .in("sleeper_slug_tail", chunk),
    })),
  );
  for (const { chunk, result } of fallback) {
    if (result.error && options.throwOnError) {
      throw new Error(`player resolve failed: ${result.error.message}`);
    }
    const wanted = new Set(chunk);
    for (const row of (result.data ?? []) as PlayerRow[]) {
      const sid = row.slug.match(/-(\d+)$/)?.[1] ?? null;
      // The generated column is derived from the same regex, so a row we did
      // not ask for cannot come back. Confirming membership anyway keeps this
      // loop honest if the column definition ever changes under it.
      if (!sid || !wanted.has(sid) || out[sid]) continue;
      out[sid] = entry(row, sid);
    }
  }

  return out;
}

function entry(row: PlayerRow, fallbackName: string): PlayerLookupEntry {
  return {
    id: row.id,
    slug: row.slug,
    name:
      row.full_name ??
      (`${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || fallbackName),
    fullName: row.full_name ?? null,
    firstName: row.first_name ?? null,
    lastName: row.last_name ?? null,
    position: row.position,
    team: row.team ?? null,
    birthDate: row.birth_date ?? null,
    yearsExperience: row.years_experience ?? null,
  };
}

function chunksOf(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(ids.slice(i, i + CHUNK));
  return out;
}
