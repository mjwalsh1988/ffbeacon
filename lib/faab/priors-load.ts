/**
 * Read every waiver auction we hold, across every league, and reduce it to the
 * anonymous shape the priors builder consumes.
 *
 * This is the one place in the product that sweeps the whole
 * `league_transactions` table. It runs from a script and from the nightly
 * derived-data cron, never from a page render, and it iterates transaction
 * rows rather than leagues: there is no per-league compute here and none may
 * be added, for the same scaling reason as every other on-demand model.
 *
 * PAGINATION IS NOT OPTIONAL. PostgREST truncates a select at 1,000 rows and
 * says nothing about it, and this table holds tens of thousands. Every read
 * below pages with .range() over a unique order until a short page comes
 * back, and a failed page throws rather than feeding the builder a partial set.
 *
 * Nothing identifying leaves this module: the league id travels only so the
 * builder can count distinct leagues, and the builder stores the count rather
 * than the ids.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { fetchAllRowsInChunks } from "@/lib/supabase/fetch-all";
import {
  groupAuctions,
  type AuctionTransactionRow,
  type LeagueAuction,
} from "./league-load";
import type { PriorAuction, PriorLeagueKind } from "./priors-build";

type ServiceClient = SupabaseClient<Database>;

const PAGE = 1000;

type LeagueFacts = {
  id: string;
  season: number;
  totalBudget: number;
  kind: PriorLeagueKind;
  superflex: boolean;
  rosterCount: number;
  /** Sleeper roster id to the week it was eliminated, chopped leagues only. */
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

/**
 * Sleeper's league type, as a price bucket.
 *
 * Keeper prices as redraft on purpose. A keeper league keeps a handful of
 * players and drafts the rest, so its in-season waiver market behaves like a
 * redraft one, and lib/sleeper-to-format.ts already draws the line in the same
 * place. Type 3 is chopped, which is its own market entirely.
 */
export function leagueKindFor(sleeperType: number | null): PriorLeagueKind {
  if (sleeperType === 3) return "chopped";
  if (sleeperType === 2) return "dynasty";
  return "redraft";
}

/** Two starting quarterbacks, however the league spells it. */
export function isSuperflexShape(rosterPositions: unknown): boolean {
  if (!Array.isArray(rosterPositions)) return false;
  const tokens = rosterPositions.map((t) => String(t).toUpperCase());
  if (tokens.includes("SUPER_FLEX")) return true;
  return tokens.filter((t) => t === "QB").length >= 2;
}

async function loadLeagueFacts(supabase: ServiceClient): Promise<Map<string, LeagueFacts>> {
  const leagues = new Map<string, LeagueFacts>();

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("leagues")
      .select("id, season, metadata, roster_positions")
      // Paging with no sort is not stable in PostgREST: a boundary can skip a
      // row or hand the same one back twice, and a repeat here would inflate
      // a league's roster count and double an auction into the published
      // quantiles. Same reason lib/faab/outlook.ts orders by id.
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`faab priors leagues read failed at row ${from}: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const row of data) {
      const meta = (row.metadata ?? {}) as { settings?: Record<string, unknown> };
      const totalBudget = numberFrom(meta.settings?.waiver_budget);
      // A league with no published budget cannot be expressed as a share of
      // one, and dividing by zero would turn every bid into infinity.
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
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`faab priors rosters read failed at row ${from}: ${error.message}`);
    if (!data || data.length === 0) break;

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
  const rows = await fetchAllRowsInChunks("faab priors positions", sleeperIds, (chunk, from, to) =>
    supabase
      .from("players")
      .select("position, external_ids")
      .in("external_ids->>sleeper", chunk)
      .order("id", { ascending: true })
      .range(from, to),
  );
  for (const row of rows) {
    const ext = (row.external_ids ?? {}) as Record<string, unknown>;
    const sleeperId = typeof ext.sleeper === "string" ? ext.sleeper : null;
    if (!sleeperId || !row.position) continue;
    out.set(sleeperId, String(row.position).toUpperCase());
  }
  return out;
}

/**
 * How much of the field was still alive in a given week of a chopped league.
 *
 * A roster counts as alive in week w when it was never eliminated, or when it
 * was eliminated in week w or later: a team chopped on the week's results was
 * still in the league, and still bidding, while that week's waivers ran.
 */
export function aliveFractionFor(league: LeagueFacts, week: number): number | null {
  if (league.kind !== "chopped" || league.rosterCount === 0) return null;
  let alive = league.rosterCount;
  for (const eliminatedWeek of league.eliminatedByRoster.values()) {
    if (eliminatedWeek < week) alive -= 1;
  }
  return Math.max(0, Math.min(1, alive / league.rosterCount));
}

export type AuctionUniverse = {
  auctions: PriorAuction[];
  /** Leagues that contributed at least one auction. */
  leagues: number;
};

/** Every usable auction across every synced league, as anonymous rows. */
export async function loadAuctionUniverse(supabase: ServiceClient): Promise<AuctionUniverse> {
  const leagues = await loadLeagueFacts(supabase);

  const rowsByLeague = new Map<string, AuctionTransactionRow[]>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("league_transactions")
      .select("league_id, season, week, type, status, adds, roster_ids, metadata")
      .eq("type", "waiver")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`faab priors waiver transactions read failed at row ${from}: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const row of data) {
      const leagueId = (row as { league_id: string }).league_id;
      if (!leagues.has(leagueId)) continue;
      const list = rowsByLeague.get(leagueId) ?? [];
      list.push(row as AuctionTransactionRow);
      rowsByLeague.set(leagueId, list);
    }

    if (data.length < PAGE) break;
  }

  const grouped = new Map<string, LeagueAuction[]>();
  const sleeperIds = new Set<string>();
  for (const [leagueId, rows] of rowsByLeague) {
    const auctions = groupAuctions(rows);
    if (auctions.length === 0) continue;
    grouped.set(leagueId, auctions);
    for (const auction of auctions) sleeperIds.add(auction.playerSleeperId);
  }

  const positions = await loadPositions(supabase, Array.from(sleeperIds));

  const out: PriorAuction[] = [];
  const contributing = new Set<string>();
  for (const [leagueId, auctions] of grouped) {
    const league = leagues.get(leagueId);
    if (!league) continue;
    for (const auction of auctions) {
      const sorted = auction.bids;
      const winner = sorted.find((b) => b.won);
      if (!winner) continue;
      const rivals = sorted.filter((b) => !b.won);
      const asPct = (dollars: number) => (dollars / league.totalBudget) * 100;
      out.push({
        leagueKind: league.kind,
        superflex: league.superflex,
        position: positions.get(auction.playerSleeperId) ?? null,
        week: auction.week,
        aliveFraction: aliveFractionFor(league, auction.week),
        bidderCount: sorted.length,
        winningPct: asPct(winner.amount),
        runnerUpPct: rivals.length > 0 ? asPct(rivals[0].amount) : null,
        leagueId,
        season: auction.season,
      });
      contributing.add(leagueId);
    }
  }

  return { auctions: out, leagues: contributing.size };
}
