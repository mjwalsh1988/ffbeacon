/**
 * The one place every Trade Finder call site reads Manager Pulse tendencies.
 *
 * `/leagues/[id]/trade-ideas` (the page you own) is not the only caller of
 * `findTrades`: the Search button (`app/actions/trade-finder.ts
 * findLeagueTrade`) and the portfolio walk (`lib/trade-finder-cross-league.ts
 * findCrossLeagueTrade`) both call it too, on the exact same league. Before
 * this module existed only the page passed `managerTendencies` and
 * `tendencyThresholds`, so a first paint could show a tendency-adjusted band
 * and a "trades often" sentence, and the reader's very next interaction, a
 * plain Search press, would silently drop both with no wrong number produced
 * and no visible reason for the change. See docs/manager-pulse/manager-pulse-plan.md
 * section 8 and CLAUDE.md's Trade Ideas section for what a tendency may and
 * may not do to a suggestion.
 *
 * ABSOLUTE RULE, SIGNED-IN ONLY. A tendency is a set of conclusions about a
 * named real person, drawn from several seasons of their trading history.
 * That is exactly why `/tools/manager-pulse` sits behind a sign-in gate and
 * why `manager_pulse_tendencies` is closed to `authenticated` at the database
 * level, service-role only. `/leagues/[id]/trade-ideas` and its Search
 * button and portfolio walk are all PUBLIC surfaces. Handing a signed-out
 * stranger, with no account at all, sentences about eleven named managers'
 * trading habits would defeat that gate rather than merely bypass it, so
 * `signedIn: false` returns an empty map and never touches the tendency
 * table or the roster-to-Sleeper-user read that feeds it.
 *
 * Read-only and cache-only throughout, the same guarantee
 * `getManagerTendencies` (lib/manager-pulse/service.ts) already carries:
 * this module never queries Sleeper and never queues a capture. A league
 * nobody has ever looked up in Manager Pulse costs one query and comes back
 * empty, which the engine reads as "no opinion" rather than as a neutral
 * one.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getManagerTendencies } from "@/lib/manager-pulse/service";
import { loadManagerPulseSettings } from "@/lib/manager-pulse/settings";
import type { ManagerTendency } from "@/lib/manager-pulse/types";
import { resolveTendencyThresholds, type TendencyThresholds } from "@/lib/trade-finder/tendency";

export type TendencyContext = {
  managerTendencies: Map<number, ManagerTendency>;
  tendencyThresholds: TendencyThresholds;
};

/**
 * Manager Pulse tendencies for one league, keyed by Sleeper roster id, plus
 * the three admin thresholds that bound how far a tendency may move a
 * suggestion. Every caller of `findTrades` for a real league should read
 * this once and pass both fields straight through, so the page, the Search
 * button and the portfolio walk can never disagree about what a manager's
 * history says.
 *
 * Signed out: no settings read, no roster read, no tendency read. The
 * thresholds still come back (the published defaults, via
 * `resolveTendencyThresholds()`), because a threshold is an admin's tuning
 * knob rather than a fact about a person, but they are paired with an empty
 * map, so they change nothing.
 */
export async function loadTendencyContext(
  admin: SupabaseClient<Database>,
  params: { leagueRowId: string; signedIn: boolean },
): Promise<TendencyContext> {
  if (!params.signedIn) {
    return {
      managerTendencies: new Map<number, ManagerTendency>(),
      tendencyThresholds: resolveTendencyThresholds(),
    };
  }

  // The three tendency thresholds an admin owns, read HERE and handed back
  // to the caller for the pure engine. The engine cannot read the settings
  // row itself, and a copy of an admin number is a number that eventually
  // disagrees with its original: raising the sample floor at
  // /admin/manager-pulse has to make every Trade Ideas call site go
  // quieter, not leave some of them talking on a stale constant.
  const settings = await loadManagerPulseSettings(admin);
  const tendencyThresholds: TendencyThresholds = {
    minSample: settings.samples.minTradesForMargin,
    bandStepMax: settings.tendency.bandStepMax,
    frequentTradesPerSeason: settings.wording.tradesOftenPerSeason,
  };

  const managerTendencies = await loadManagerTendenciesByRoster(admin, params.leagueRowId);
  return { managerTendencies, tendencyThresholds };
}

/**
 * `owner_user_id` on `rosters` is already the raw Sleeper user id
 * (lib/league-pulse.ts writes it straight from Sleeper's own `owner_id`, and
 * lib/trade-finder-data.ts already compares it against a searched
 * `sleeperUserId` for the same reason), so no separate join against
 * `league_users` is needed to get from a roster to the id Manager Pulse keys
 * tendencies on. One query here, one batched call to `getManagerTendencies`.
 */
async function loadManagerTendenciesByRoster(
  admin: SupabaseClient<Database>,
  leagueRowId: string,
): Promise<Map<number, ManagerTendency>> {
  const out = new Map<number, ManagerTendency>();
  const { data, error } = await admin
    .from("rosters")
    .select("sleeper_roster_id, owner_user_id")
    .eq("league_id", leagueRowId);
  if (error || !data) return out;

  const sleeperUserIds = Array.from(
    new Set(
      data
        .map((r) => r.owner_user_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );
  if (sleeperUserIds.length === 0) return out;

  const tendenciesByUser = await getManagerTendencies(admin, { sleeperUserIds });
  for (const row of data) {
    if (!row.owner_user_id) continue;
    const tendency = tendenciesByUser.get(row.owner_user_id);
    if (tendency) out.set(Number(row.sleeper_roster_id), tendency);
  }
  return out;
}
