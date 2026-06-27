/**
 * Partial-tolerant reverse lookup: Sleeper player id -> FF Beacon players.id.
 *
 * This replaces the numeric-only mapper in the Signal Check import path. It must
 * handle BOTH:
 *   - numeric skill-player ids ("4046", "11620"), and
 *   - non-numeric DST team-code ids ("BUF", "ARI") which Sleeper uses for
 *     defenses and which we store in players.external_ids->>'sleeper' the same way.
 * Kickers are normal numeric ids.
 *
 * Behavior contract:
 *   - Ids are sanitized to ^[A-Za-z0-9]{1,16}$ and de-duped first (the Sleeper
 *     empty-slot placeholder "0" is dropped), so the filter is injection-safe and
 *     no hostile id ever reaches PostgREST.
 *   - Chunked by 200 to stay under URL/filter limits.
 *   - PARTIAL by design: ids with no matching player are simply absent from the
 *     returned map. The function NEVER throws; a failed chunk is skipped and the
 *     rest still map.
 *
 * .in() vs .or(): the sleeper id lives at the json path external_ids->>'sleeper',
 * not a top-level column. supabase-js .in() is typed to real columns and cannot
 * express a json path, so we build a per-id .or() of equality filters. Because the
 * ids are already sanitized to alphanumerics, the .or() string is injection-safe.
 * This is the same proven pattern used in lib/trade-analyzer.ts and
 * lib/league-view-data.ts for this exact lookup.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { sanitizeSleeperPlayerIds } from "@/lib/on-the-clock/validation";

const CHUNK_SIZE = 200;

/**
 * Map sanitized Sleeper ids to FF Beacon player ids. Accepts any
 * SupabaseClient<Database> (the anon client works: players is public-read).
 */
export async function mapSleeperToPlayerIds(
  client: SupabaseClient<Database>,
  sleeperIds: readonly string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = sanitizeSleeperPlayerIds(sleeperIds);
  if (ids.length === 0) return map;

  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const ors = chunk.map((id) => `external_ids->>sleeper.eq.${id}`).join(",");
    try {
      const { data, error } = await client
        .from("players")
        .select("id, external_ids")
        .or(ors);
      if (error || !data) continue; // partial map: skip this chunk, keep going
      for (const row of data) {
        const ext = row.external_ids as Record<string, unknown> | null;
        const sid = ext?.sleeper;
        if ((typeof sid === "string" || typeof sid === "number") && row.id) {
          map.set(String(sid), row.id);
        }
      }
    } catch {
      // Never throw: leave these ids unmapped and continue with the next chunk.
      continue;
    }
  }

  return map;
}
