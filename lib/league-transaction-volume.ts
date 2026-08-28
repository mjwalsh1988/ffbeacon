/**
 * How busy each team has been: completed transactions per roster.
 *
 * The transactions feed answers "what happened"; this answers "who keeps
 * happening". It is the one league-wide shape that the feed's reverse
 * chronological list cannot show, because activity is spread across hundreds of
 * rows and nobody counts them by scrolling.
 *
 * THREE COUNTING DECISIONS, ALL DELIBERATE.
 *
 * 1. Failed waiver claims are excluded. Sleeper keeps them with
 *    status='failed', they are roughly a tenth of every claim ever synced, and
 *    a claim that lost is not a move the team made. The count of what was
 *    dropped is returned so the panel can say so rather than quietly shrinking
 *    the numbers.
 *
 * 2. A trade counts once for EVERY roster it names. Two managers each made that
 *    move. This means the team totals sum to more than the league's row count,
 *    which is why `leagueTotal` is returned separately instead of being derived
 *    by adding the teams up.
 *
 * 3. A roster is counted once per transaction even when it appears in several
 *    places on the row (an add and a drop, or a pick and a player). The row is
 *    one move.
 *
 * No season filter. Sleeper's transactions endpoint only returns the league's
 * current season, so every synced row already shares one, the same assumption
 * lib/league-transactions-data.ts is built on.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { teamLabelParts } from "@/lib/team-label";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/** The four types Sleeper emits. Anything else lands in `other`. */
export type TransactionTypeCounts = {
  trade: number;
  waiver: number;
  freeAgent: number;
  commissioner: number;
  other: number;
};

export type TransactionVolumeTeam = {
  sleeperRosterId: number;
  /** Team name, or the handle when no team name is set. */
  teamName: string;
  /** "@handle", or null when printing it would repeat teamName. */
  ownerLine: string | null;
  avatarId: string | null;
  total: number;
  byType: TransactionTypeCounts;
};

export type TransactionVolume = {
  /** Every roster in the league, busiest first. Teams with zero are included. */
  teams: TransactionVolumeTeam[];
  /** Completed transaction ROWS in the league, each counted once. */
  leagueTotal: number;
  /**
   * The same rows split by type. Counted per ROW, so a trade adds one here
   * while adding one to each of its two teams above. These two numbers are
   * answering different questions and are not meant to reconcile.
   */
  leagueByType: TransactionTypeCounts;
  /** Failed waiver claims left out of every count above. */
  excludedFailed: number;
};

const PAGE = 1000;

function emptyCounts(): TransactionTypeCounts {
  return { trade: 0, waiver: 0, freeAgent: 0, commissioner: 0, other: 0 };
}

function bump(counts: TransactionTypeCounts, type: string): void {
  switch (type) {
    case "trade":
      counts.trade += 1;
      break;
    case "waiver":
      counts.waiver += 1;
      break;
    case "free_agent":
      counts.freeAgent += 1;
      break;
    case "commissioner":
      counts.commissioner += 1;
      break;
    default:
      counts.other += 1;
  }
}

/**
 * The roster ids on one row, deduped. Tolerates a malformed jsonb payload.
 *
 * The `> 0` is not a style choice. Sleeper roster ids are one-based, and
 * `Number(null)` and `Number("")` are both 0, so without it a null entry in the
 * array becomes a roster numbered zero that quietly matches nothing, or worse
 * matches Sleeper's own "0" empty-slot placeholder.
 */
export function rosterIdsOnRow(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<number>();
  for (const entry of raw) {
    if (typeof entry !== "number" && typeof entry !== "string") continue;
    const n = Number(entry);
    if (Number.isInteger(n) && n > 0) out.add(n);
  }
  return Array.from(out);
}

export async function loadTransactionVolume(
  supabase: AnySupabase,
  leagueRowId: string,
): Promise<TransactionVolume> {
  const client = supabase as SupabaseClient<Database>;

  const [{ data: rosterRows }, { data: userRows }] = await Promise.all([
    client
      .from("rosters")
      .select("sleeper_roster_id, owner_user_id")
      .eq("league_id", leagueRowId),
    client
      .from("league_users")
      .select("sleeper_user_id, display_name, team_name, avatar")
      .eq("league_id", leagueRowId),
  ]);

  // Every roster starts at zero, so a team that has made no moves all season
  // still appears in the chart. Dropping it would read as "this team is not in
  // the league" rather than "this team has done nothing".
  const userBySleeperId = new Map((userRows ?? []).map((u) => [u.sleeper_user_id, u]));
  const teams = new Map<number, TransactionVolumeTeam>();
  for (const r of rosterRows ?? []) {
    const u = r.owner_user_id ? userBySleeperId.get(r.owner_user_id) : null;
    const parts = teamLabelParts({
      teamName: u?.team_name ?? null,
      username: u?.display_name ?? null,
      sleeperRosterId: r.sleeper_roster_id,
    });
    teams.set(r.sleeper_roster_id, {
      sleeperRosterId: r.sleeper_roster_id,
      teamName: parts.primary,
      ownerLine: parts.owner,
      avatarId: u?.avatar ?? null,
      total: 0,
      byType: emptyCounts(),
    });
  }

  // Paged, because select() silently truncates at 1000 rows and the busiest
  // synced league already carries over 1500. Ordered by id so the pages
  // partition the set rather than overlapping it.
  let leagueTotal = 0;
  let excludedFailed = 0;
  const leagueByType = emptyCounts();
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await client
      .from("league_transactions")
      .select("id, type, status, roster_ids")
      .eq("league_id", leagueRowId)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) {
      throw new Error(`load transaction volume failed: ${error.message}`);
    }
    const page = data ?? [];
    for (const row of page) {
      if ((row.status ?? "").toLowerCase() !== "complete") {
        excludedFailed += 1;
        continue;
      }
      leagueTotal += 1;
      bump(leagueByType, row.type);
      for (const rosterId of rosterIdsOnRow(row.roster_ids)) {
        const team = teams.get(rosterId);
        // A roster id with no roster row means the manager left the league and
        // Sleeper kept the transaction. Nothing to attribute it to.
        if (!team) continue;
        team.total += 1;
        bump(team.byType, row.type);
      }
    }
    if (page.length < PAGE) break;
  }

  // Busiest first, then alphabetical, then roster id. The last two only ever
  // break ties, but without them the order of equal teams follows whatever
  // PostgREST returned and shuffles between reloads.
  const sorted = Array.from(teams.values()).sort(
    (a, b) =>
      b.total - a.total ||
      a.teamName.localeCompare(b.teamName) ||
      a.sleeperRosterId - b.sleeperRosterId,
  );

  return { teams: sorted, leagueTotal, leagueByType, excludedFailed };
}
