/**
 * Roster age history (owner decision 18.3, plan 6.4).
 *
 * After a successful build, one compact row per (league, roster, Eastern day)
 * goes into league_roster_age_history, updated in place on a second build the
 * same day. Written only for rosters somebody viewed, so the table grows with
 * attention rather than with the number of leagues. Nothing reads it yet; the
 * follow-up "age over time" chart will.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { SITE_TIME_ZONE } from "@/lib/datetime";
import type { BlueprintAge } from "./types";

type Client = SupabaseClient<Database>;

const EASTERN_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: SITE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "YYYY-MM-DD" of a moment in America/New_York. */
export function easternDay(at: Date): string {
  return EASTERN_DAY.format(at);
}

/** Pure: the compact jsonb the row stores. */
export function ageHistoryPayload(age: BlueprintAge): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const r of age.rows) out[r.position] = { mine: r.mine, league: r.league, count: r.count };
  out.roster = age.rosterMean;
  out.league = age.leagueMean;
  return out;
}

export async function writeAgeHistory(
  admin: Client,
  args: { leagueRowId: string; rosterId: number; season: string; age: BlueprintAge; at: Date },
): Promise<void> {
  const { error } = await admin.from("league_roster_age_history").upsert(
    {
      league_id: args.leagueRowId,
      roster_id: args.rosterId,
      season: args.season,
      as_of_day: easternDay(args.at),
      ages: ageHistoryPayload(args.age) as Json,
    },
    { onConflict: "league_id,roster_id,as_of_day" },
  );
  if (error) throw new Error(`league_roster_age_history write failed: ${error.message}`);
}
