import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * Sleeper player ids to the names a card can print.
 *
 * Sleeper names nobody: a transaction, a lineup and a matchup all arrive as
 * lists of numeric strings, so every surface that renders one has to look them
 * up. This is that lookup, in one place.
 *
 * TWO PASSES, AND THE SPLIT IS THE WHOLE POINT.
 *
 * `external_ids->>'sleeper'` is indexed (`idx_players_external_sleeper`). The
 * `slug.like.*-<id>` suffix match is a leading-wildcard pattern that no index
 * can serve. Putting both in one `or()` makes the ENTIRE filter unindexable, so
 * every call sequentially scans the whole `players` table: measured on
 * production, 161 ms and 4,106 shared buffers for 100 ids, against 23 ms and
 * 139 buffers for the indexed form of the same query.
 *
 * `lib/player-trades.ts` already found and fixed exactly this, and its comment
 * says so. This file was extracted without the fix and put the seq scan on the
 * league overview, which is the hottest page in League Pulse. Hence: pass one
 * is the indexed lookup, and pass two runs the suffix fallback ONLY against the
 * ids pass one could not resolve, which is normally none, so the second query
 * usually never runs at all.
 *
 * THE ID FILTER IS SECURITY, NOT TIDINESS. These ids arrive from a Sleeper
 * league we do not control and are interpolated into PostgREST's filter
 * language below. Sleeper player ids are numeric strings, so anything else is
 * dropped before it can reach the query.
 */

export type PlayerLookupEntry = {
  name: string;
  position: string | null;
  team: string | null;
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

const COLUMNS = "slug, full_name, first_name, last_name, position, team, external_ids";

type PlayerRow = {
  slug: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  team: string | null;
  external_ids: unknown;
};

export async function resolveSleeperPlayers(
  supabase: AnySupabase,
  sleeperIds: string[],
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
  for (const { data } of indexed) {
    for (const row of (data ?? []) as PlayerRow[]) {
      const ext = (row.external_ids as Record<string, unknown>) ?? {};
      const sid = typeof ext.sleeper === "string" ? ext.sleeper : null;
      if (!sid || out[sid]) continue;
      out[sid] = entry(row, sid);
    }
  }

  // Pass two: the suffix fallback, for rows whose `external_ids` was never
  // written. Normally empty, so normally no query at all.
  const unresolved = safeIds.filter((id) => !out[id]);
  if (unresolved.length === 0) return out;

  const fallback = await Promise.all(
    chunksOf(unresolved).map(async (chunk) => ({
      chunk,
      result: await db
        .from("players")
        .select(COLUMNS)
        .or(chunk.map((id) => `slug.like.*-${id}`).join(",")),
    })),
  );
  for (const { chunk, result } of fallback) {
    const wanted = new Set(chunk);
    for (const row of (result.data ?? []) as PlayerRow[]) {
      const sid = row.slug.match(/-(\d+)$/)?.[1] ?? null;
      // A LIKE can match a row we did not ask for (a slug ending in a longer id
      // that happens to contain this one). Confirm membership before trusting it.
      if (!sid || !wanted.has(sid) || out[sid]) continue;
      out[sid] = entry(row, sid);
    }
  }

  return out;
}

function entry(row: PlayerRow, fallbackName: string): PlayerLookupEntry {
  return {
    name:
      row.full_name ??
      (`${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || fallbackName),
    position: row.position ?? null,
    team: row.team ?? null,
  };
}

function chunksOf(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(ids.slice(i, i + CHUNK));
  return out;
}
