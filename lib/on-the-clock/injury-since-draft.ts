/**
 * "N of your players have a new injury designation since you drafted"
 * (RD-T063).
 *
 * The count needs a baseline, and nothing kept one: the snapshot recorded the
 * DATE of its projections, and `players` holds only today's designation. So
 * the snapshot now records every drafted player's designation at the moment it
 * locks (`metadata.injury_at_snapshot`, keyed by Sleeper id), and the snapshot
 * route compares it with today's. A snapshot written before this existed has
 * no baseline, and the banner stays hidden for it rather than guessing.
 *
 * "Changed" means the designation differs in either direction: a player who
 * picked one up, lost one, or moved between two (Questionable to Out). A
 * player we can no longer find is left out, not counted as changed.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { fetchAllRowsInChunks } from "@/lib/supabase/fetch-all";

export type InjuryBySleeperId = Record<string, string | null>;

/** "" and null both mean healthy; everything else compares case-blind. */
function norm(status: string | null | undefined): string | null {
  const s = (status ?? "").trim();
  return s.length > 0 ? s.toUpperCase() : null;
}

/** Sleeper ids whose designation differs between the two reads. Pure. */
export function changedInjuryIds(atSnapshot: InjuryBySleeperId, now: InjuryBySleeperId): string[] {
  const out: string[] = [];
  for (const [id, then] of Object.entries(atSnapshot)) {
    if (!(id in now)) continue;
    if (norm(then) !== norm(now[id])) out.push(id);
  }
  return out.sort();
}

/** How many of one roster's picks are in the changed set. Pure. */
export function countChangedForRoster(
  picks: ReadonlyArray<{ rosterId: number | null; sleeperPlayerId: string | null }>,
  rosterId: number | null,
  changedIds: readonly string[] | null | undefined,
): number | null {
  if (!changedIds || rosterId === null) return null;
  const changed = new Set(changedIds);
  return picks.filter(
    (p) => p.rosterId === rosterId && p.sleeperPlayerId !== null && changed.has(p.sleeperPlayerId),
  ).length;
}

/** Today's designation for each Sleeper id we hold a player for. */
export async function loadInjuryBySleeperId(
  supabase: SupabaseClient<Database>,
  sleeperIds: readonly string[],
): Promise<InjuryBySleeperId> {
  const ids = [...new Set(sleeperIds.filter((id) => id && id !== "0"))];
  if (ids.length === 0) return {};
  type Row = { id: string; sleeper: string | null; injury_status: string | null };
  const rows = await fetchAllRowsInChunks<Row, string>("draft injury statuses", ids, (chunk, from, to) =>
    supabase
      .from("players")
      .select("id, sleeper:external_ids->>sleeper, injury_status:metadata->sleeper->>injury_status")
      .in("external_ids->>sleeper", chunk)
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
  );
  const out: InjuryBySleeperId = {};
  for (const row of rows) {
    if (row.sleeper) out[row.sleeper] = norm(row.injury_status);
  }
  return out;
}
