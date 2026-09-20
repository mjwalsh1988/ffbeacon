/**
 * The reads behind the FAAB replay.
 *
 * `loadAuctionUniverse` in priors-load.ts sweeps the same transactions, but it
 * reduces each auction to what a price DISTRIBUTION needs and drops three
 * things the replay cannot work without:
 *
 *   - the league's budget in dollars, so a recommendation can be a whole-dollar
 *     bid graded against a whole-dollar winner rather than two percentages;
 *   - every bid in the auction, not just the winner and the runner-up, because
 *     that is what a league's heat is measured over;
 *   - the season and week on every row in one league's own order, because heat
 *     has to be rebuilt from the auctions strictly BEFORE the one being graded.
 *
 * Rather than widen the priors loader (whose output shape is the builder's
 * contract, and which nothing else should have a reason to change), this is a
 * sibling that reads the same tables for its own purpose.
 *
 * PAGINATION IS NOT OPTIONAL. PostgREST truncates a select at 1,000 rows and
 * says nothing about it. Every read below pages until a short page comes back.
 *
 * Runs from a script and from an admin action, never from a page render.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { groupAuctions, type AuctionTransactionRow } from "./league-load";
import type { PriorLeagueKind } from "./priors-build";
import { aliveFractionFor, isSuperflexShape, leagueKindFor } from "./priors-load";
import { toPriorCell, type PriorCell } from "./priors-math";
import type { ReplayAuction, ReplayBid } from "./replay";

type ServiceClient = SupabaseClient<Database>;

const PAGE = 1000;
const PLAYER_CHUNK = 500;

/**
 * Deliberately the same shape priors-load.ts keeps for a league, so
 * `aliveFractionFor` can be shared rather than reimplemented. If that shape
 * ever changes, the typecheck here is what says so.
 */
type LeagueFacts = {
  id: string;
  season: number;
  totalBudget: number;
  kind: PriorLeagueKind;
  superflex: boolean;
  rosterCount: number;
  eliminatedByRoster: Map<number, number>;
};

function numberFrom(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function loadLeagueFacts(supabase: ServiceClient): Promise<Map<string, LeagueFacts>> {
  const leagues = new Map<string, LeagueFacts>();

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("leagues")
      .select("id, season, metadata, roster_positions")
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;

    for (const row of data) {
      const meta = (row.metadata ?? {}) as { settings?: Record<string, unknown> };
      const totalBudget = numberFrom(meta.settings?.waiver_budget);
      // A league with no published budget cannot be expressed as a share of
      // one, and a bid graded against nothing is not a grade.
      if (totalBudget === null || totalBudget <= 0) continue;
      leagues.set(row.id, {
        id: row.id,
        season: Number(row.season),
        totalBudget,
        kind: leagueKindFor(numberFrom(meta.settings?.type)),
        superflex: isSuperflexShape(row.roster_positions),
        rosterCount: 0,
        eliminatedByRoster: new Map(),
      });
    }

    if (data.length < PAGE) break;
  }

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("rosters")
      .select("league_id, sleeper_roster_id, metadata")
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;

    for (const row of data) {
      const league = leagues.get(row.league_id);
      if (!league) continue;
      league.rosterCount += 1;
      const meta = (row.metadata ?? {}) as { settings?: Record<string, unknown> };
      const eliminated = numberFrom(meta.settings?.eliminated);
      if (eliminated !== null && eliminated > 0) {
        league.eliminatedByRoster.set(Number(row.sleeper_roster_id), eliminated);
      }
    }

    if (data.length < PAGE) break;
  }

  return leagues;
}

/** Position per Sleeper player id, for the players our auctions mention. */
async function loadPositions(
  supabase: ServiceClient,
  sleeperIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < sleeperIds.length; i += PLAYER_CHUNK) {
    const chunk = sleeperIds.slice(i, i + PLAYER_CHUNK);
    const { data, error } = await supabase
      .from("players")
      .select("position, external_ids")
      .in("external_ids->>sleeper", chunk);
    if (error || !data) continue;
    for (const row of data) {
      const ext = (row.external_ids ?? {}) as Record<string, unknown>;
      const sleeperId = typeof ext.sleeper === "string" ? ext.sleeper : null;
      if (!sleeperId || !row.position) continue;
      out.set(sleeperId, String(row.position).toUpperCase());
    }
  }
  return out;
}

/**
 * Every market cell, read straight through the service client.
 *
 * `loadPriorCellsCached` is the page path and wraps this table in
 * `unstable_cache`, which a script has no business pulling in. The replay
 * wants today's cells anyway: it usually runs right after a rebuild.
 */
export async function loadPriorCellsForReplay(supabase: ServiceClient): Promise<PriorCell[]> {
  const out: PriorCell[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("faab_market_priors")
      .select(
        "cell_key, league_kind, superflex, position, phase, bidders, sample_size, zero_share, p05, p10, p25, p50, p75, p90, p95, p99, runner_up_ratio_p50, leagues_count, seasons, built_at",
      )
      .order("cell_key", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const row of data) out.push(toPriorCell(row as unknown as Record<string, unknown>));
    if (data.length < PAGE) break;
  }
  return out;
}

/**
 * Every settled auction we hold, in the shape the replay engine grades.
 *
 * Nothing is filtered here beyond what makes an auction unreadable. The engine
 * decides what counts, because the engine is the part with tests.
 */
export async function loadReplayAuctions(supabase: ServiceClient): Promise<ReplayAuction[]> {
  const leagues = await loadLeagueFacts(supabase);

  const rowsByLeague = new Map<string, AuctionTransactionRow[]>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("league_transactions")
      .select("league_id, season, week, type, status, adds, roster_ids, metadata")
      .eq("type", "waiver")
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;

    for (const row of data) {
      const leagueId = (row as { league_id: string }).league_id;
      if (!leagues.has(leagueId)) continue;
      const list = rowsByLeague.get(leagueId) ?? [];
      list.push(row as AuctionTransactionRow);
      rowsByLeague.set(leagueId, list);
    }

    if (data.length < PAGE) break;
  }

  const grouped = new Map<string, ReturnType<typeof groupAuctions>>();
  const sleeperIds = new Set<string>();
  for (const [leagueId, rows] of rowsByLeague) {
    const auctions = groupAuctions(rows);
    if (auctions.length === 0) continue;
    grouped.set(leagueId, auctions);
    for (const auction of auctions) sleeperIds.add(auction.playerSleeperId);
  }

  const positions = await loadPositions(supabase, Array.from(sleeperIds));

  const out: ReplayAuction[] = [];
  for (const [leagueId, auctions] of grouped) {
    const league = leagues.get(leagueId);
    if (!league) continue;
    const asPct = (dollars: number) => (dollars / league.totalBudget) * 100;

    for (const auction of auctions) {
      const winner = auction.bids.find((b) => b.won);
      if (!winner) continue;
      const bids: ReplayBid[] = auction.bids.map((b) => ({
        rosterId: b.rosterId,
        amount: b.amount,
        pct: asPct(b.amount),
      }));
      out.push({
        leagueId,
        season: auction.season,
        week: auction.week,
        leagueKind: league.kind,
        superflex: league.superflex,
        position: positions.get(auction.playerSleeperId) ?? null,
        aliveFraction: aliveFractionFor(league, auction.week),
        totalBudget: league.totalBudget,
        bids,
        winningAmount: winner.amount,
        winningPct: asPct(winner.amount),
      });
    }
  }

  return out;
}
