/**
 * One player, every league you are in.
 *
 * This is the question a manager in eight rooms actually has on Sunday morning,
 * and the one no waiver page can answer: he is free in three of them, he would
 * start in two, and the right bid is different in each because the rosters are
 * different. Answering it eight times by hand is why people skip claims they
 * should have made.
 *
 * We already know which leagues he is free in (lib/free-agent-finder.ts answers
 * that from stored rosters without touching Sleeper). This runs the full
 * league-mode calculation for each league where he is actually gettable, and
 * reports the rest honestly rather than pretending we checked them.
 *
 * READ ONLY, like the single-league path. Nothing here writes or syncs.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { calculateLeagueFaab } from "./league-faab";
import type { FaabSettings, MultiLeagueRow, NeedLevel } from "./types";

type ServiceClient = SupabaseClient<Database>;

/**
 * Ceiling on how many leagues one run will price.
 *
 * Each league costs a full projection pass plus two season simulations, so this
 * is a real budget rather than a formality. Leagues past the cap are reported
 * as unchecked, never silently dropped: "we did not look" and "he is not
 * available" must never look the same in the output.
 */
export const MAX_PRICED_LEAGUES = 10;

export type MultiLeagueInput = {
  /** Sleeper league ids to consider, in the reader's own order. */
  sleeperLeagueIds: string[];
  sleeperUserId: string;
  candidateSleeperId: string;
  needLevel: NeedLevel;
  /** Stands in for leagues that publish no FAAB budget through Sleeper. */
  fallbackBudget?: number | null;
  settings: FaabSettings;
};

export type MultiLeagueOutcome = {
  rows: MultiLeagueRow[];
  /** Leagues we ran out of budget for. */
  notChecked: number;
};

export async function calculateAcrossLeagues(
  supabase: ServiceClient,
  input: MultiLeagueInput,
): Promise<MultiLeagueOutcome> {
  const wanted = input.sleeperLeagueIds.slice(0, MAX_PRICED_LEAGUES);
  const notChecked = Math.max(0, input.sleeperLeagueIds.length - wanted.length);
  if (wanted.length === 0) return { rows: [], notChecked };

  const { data: leagueRows } = await supabase
    .from("leagues")
    .select("id, sleeper_league_id, name")
    .in("sleeper_league_id", wanted);

  const bySleeperId = new Map(
    (leagueRows ?? []).map((l) => [
      l.sleeper_league_id,
      { rowId: l.id, name: l.name ?? "Untitled league" },
    ]),
  );

  const rows: MultiLeagueRow[] = [];

  for (const sleeperLeagueId of wanted) {
    const league = bySleeperId.get(sleeperLeagueId);
    if (!league) {
      rows.push({
        sleeperLeagueId,
        leagueName: sleeperLeagueId,
        status: "unsynced",
        report: null,
        rosteredBy: null,
        message:
          "We have not synced this league yet. Open it in League Pulse once and it will answer next time.",
      });
      continue;
    }

    // Which roster is theirs here. A league they are not actually in cannot be
    // priced, and guessing a roster would produce a confident wrong answer.
    const { data: rosterRows } = await supabase
      .from("rosters")
      .select("sleeper_roster_id, owner_user_id, co_owners")
      .eq("league_id", league.rowId);

    const ownRoster = (rosterRows ?? []).find((r) => {
      if (r.owner_user_id === input.sleeperUserId) return true;
      const co = Array.isArray(r.co_owners) ? r.co_owners : [];
      return co.some((c) => typeof c === "string" && c === input.sleeperUserId);
    });

    if (!ownRoster) {
      rows.push({
        sleeperLeagueId,
        leagueName: league.name,
        status: "error",
        report: null,
        rosteredBy: null,
        message: "We could not find your team in this league.",
      });
      continue;
    }

    const outcome = await calculateLeagueFaab(supabase, {
      leagueRowId: league.rowId,
      sleeperRosterId: Number(ownRoster.sleeper_roster_id),
      candidateSleeperId: input.candidateSleeperId,
      needLevel: input.needLevel,
      fallbackBudget: input.fallbackBudget ?? null,
      settings: input.settings,
    });

    if (!outcome.ok) {
      rows.push({
        sleeperLeagueId,
        leagueName: league.name,
        status: "error",
        report: null,
        rosteredBy: null,
        message: outcome.error,
      });
      continue;
    }

    if (outcome.report.availability === "rostered") {
      rows.push({
        sleeperLeagueId,
        leagueName: league.name,
        status: "rostered",
        report: null,
        rosteredBy: outcome.report.rosteredBy,
        message: null,
      });
      continue;
    }

    rows.push({
      sleeperLeagueId,
      leagueName: league.name,
      status: "ok",
      report: outcome.report,
      rosteredBy: null,
      message: null,
    });
  }

  // Answerable leagues first, biggest upgrade at the top, so the reader's eye
  // lands on the claim actually worth making.
  rows.sort((a, b) => {
    const rank = (r: MultiLeagueRow) =>
      r.status === "ok" ? 0 : r.status === "rostered" ? 1 : 2;
    const byStatus = rank(a) - rank(b);
    if (byStatus !== 0) return byStatus;
    const aGain = a.report?.marginal?.netPointsPerWeek ?? -1;
    const bGain = b.report?.marginal?.netPointsPerWeek ?? -1;
    if (aGain !== bGain) return bGain - aGain;
    return a.leagueName.localeCompare(b.leagueName, undefined, { sensitivity: "base" });
  });

  return { rows, notChecked };
}
