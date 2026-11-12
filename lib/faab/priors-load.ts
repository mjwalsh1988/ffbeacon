/**
 * Read the waiver auctions of a BATCH of leagues and reduce them to the
 * anonymous shape the priors builder consumes.
 *
 * This used to sweep the whole `league_transactions` table on every rebuild.
 * It now reads only the leagues the incremental pass hands it
 * (lib/faab/priors-incremental.ts), for this season and last, so a run costs
 * what changed rather than what exists. It still iterates transaction rows for
 * those leagues, never per-league compute: no Sleeper request and no model.
 *
 * PAGINATION IS NOT OPTIONAL. PostgREST truncates a select at 1,000 rows and
 * says nothing about it. Every read below pages over a unique key until a
 * short page comes back, and a failed page throws rather than feeding the
 * builder a partial set.
 *
 * The league id and the Sleeper player id travel with each auction because
 * the kept sample (`faab_prior_auctions`, service role only) needs them: the
 * league id to replace a changed league's rows and to count distinct leagues,
 * the player id for the offseason showcase's median bid. The published cells
 * store counts and quantiles only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  fetchAllRowsInChunks,
  fetchAllRowsInChunksByKeyset,
} from "@/lib/supabase/fetch-all";
import {
  groupAuctions,
  type AuctionTransactionRow,
} from "./league-load";
import type { PriorAuction, PriorLeagueKind } from "./priors-build";

type ServiceClient = SupabaseClient<Database>;

/** League ids per `.in()` request: well inside a URL, few enough round trips. */
const ID_CHUNK = 100;

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

/** One won auction as the kept sample stores it. */
export type KeptAuction = PriorAuction & { playerSleeperId: string };

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

async function loadLeagueFacts(
  supabase: ServiceClient,
  leagueIds: string[],
): Promise<{ leagues: Map<string, LeagueFacts>; seasons: Set<number> }> {
  const leagues = new Map<string, LeagueFacts>();
  const seasons = new Set<number>();

  const leagueRows = await fetchAllRowsInChunks(
    "faab priors leagues",
    leagueIds,
    (chunk, from, to) =>
      supabase
        .from("leagues")
        .select("id, season, metadata, roster_positions")
        .in("id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
    ID_CHUNK,
  );

  for (const row of leagueRows) {
    seasons.add(Number(row.season));
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

  // Ordered by id: unsorted paging can hand a row back twice, which would
  // inflate a league's roster count and with it the chopped alive fraction.
  const rosterRows = await fetchAllRowsInChunks(
    "faab priors rosters",
    Array.from(leagues.keys()),
    (chunk, from, to) =>
      supabase
        .from("rosters")
        .select("league_id, sleeper_roster_id, metadata")
        .in("league_id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
    ID_CHUNK,
  );

  for (const row of rosterRows) {
    const league = leagues.get(row.league_id);
    if (!league) continue;
    league.rosterCount += 1;
    const meta = (row.metadata ?? {}) as { settings?: Record<string, unknown> };
    const eliminated = numberFrom(meta.settings?.eliminated);
    if (eliminated !== null && eliminated > 0) {
      league.eliminatedByRoster.set(Number(row.sleeper_roster_id), eliminated);
    }
  }

  return { leagues, seasons };
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

type WaiverRow = AuctionTransactionRow & { id: string; league_id: string };

export type LeagueAuctionBatch = {
  auctions: KeptAuction[];
  /** The season every league in the batch is filed under, budget or not. */
  leagueSeasons: Set<number>;
};

/**
 * Every won auction in these leagues for these seasons.
 *
 * A league with no published budget contributes nothing, and the caller still
 * clears its old rows: a league whose commissioner removed FAAB has no
 * auctions to price from any more.
 */
export async function loadLeagueAuctions(
  supabase: ServiceClient,
  leagueIds: string[],
  seasons: number[],
): Promise<LeagueAuctionBatch> {
  if (leagueIds.length === 0 || seasons.length === 0) {
    return { auctions: [], leagueSeasons: new Set() };
  }
  const { leagues, seasons: leagueSeasons } = await loadLeagueFacts(supabase, leagueIds);
  const budgeted = Array.from(leagues.keys());
  if (budgeted.length === 0) return { auctions: [], leagueSeasons };

  // Keyset on id rather than offset paging: offset makes Postgres discard
  // every earlier row on every page, and a chopped or dynasty league can hold
  // thousands of failed bids.
  const rows = await fetchAllRowsInChunksByKeyset<WaiverRow, string, string>(
    "faab priors waiver transactions",
    budgeted,
    (chunk, after, limit) => {
      let q = supabase
        .from("league_transactions")
        .select("id, league_id, season, week, type, status, adds, roster_ids, metadata")
        .in("league_id", chunk)
        .eq("type", "waiver")
        .in("season", seasons)
        .order("id", { ascending: true })
        .limit(limit);
      if (after !== null) q = q.gt("id", after);
      return q as unknown as PromiseLike<{
        data: WaiverRow[] | null;
        error: { message: string } | null;
      }>;
    },
    (row) => row.id,
    ID_CHUNK,
  );

  const rowsByLeague = new Map<string, AuctionTransactionRow[]>();
  for (const row of rows) {
    const list = rowsByLeague.get(row.league_id) ?? [];
    list.push(row);
    rowsByLeague.set(row.league_id, list);
  }

  const grouped = new Map<string, ReturnType<typeof groupAuctions>>();
  const sleeperIds = new Set<string>();
  for (const [leagueId, leagueRows] of rowsByLeague) {
    const auctions = groupAuctions(leagueRows);
    if (auctions.length === 0) continue;
    grouped.set(leagueId, auctions);
    for (const auction of auctions) sleeperIds.add(auction.playerSleeperId);
  }

  const positions = await loadPositions(supabase, Array.from(sleeperIds));

  const out: KeptAuction[] = [];
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
        playerSleeperId: auction.playerSleeperId,
      });
    }
  }

  return { auctions: out, leagueSeasons };
}
