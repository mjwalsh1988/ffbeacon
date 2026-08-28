/**
 * The pool of trades the game draws from.
 *
 * WHY THERE IS A POOL AT ALL, RATHER THAN A RANDOM QUERY PER ROUND.
 *   Not every trade in `league_transactions` can be played. A three-team deal
 *   has no two sides to choose between. A trade holding a player we never
 *   matched, or a startup pick we cannot resolve into the player taken at that
 *   seat, is refused by Signal Check on purpose, because half an answer stated
 *   confidently is worse than none. Finding that out costs a full grade. Doing
 *   it inside the request that is trying to show somebody a trade means the
 *   game occasionally has to say "hang on" for no reason a reader can see.
 *
 *   So a row in `would_you_rather_trades` is a trade that HAS ALREADY BEEN
 *   GRADED SUCCESSFULLY. Serving is then a cheap read, and the expensive
 *   discovery happens in the background: when the pool runs thin, or when an
 *   admin primes it with `npm run wyr:pool`.
 *
 * HOW A SAMPLE IS DRAWN WITHOUT `order by random()`.
 *   PostgREST cannot express it and it would mean an RPC on a service-role
 *   table for no other reason. Instead: count the candidate rows, pick a random
 *   offset, and read a window from there in `id` order. `id` is a v4 uuid, so
 *   its order carries no time, league or size correlation, and a window taken
 *   at a random offset is an unbiased sample of the whole table.
 *
 * ONE LEAGUE PER PASS, ON PURPOSE.
 *   `analyzeLeagueTrades` resolves the format, the value resolver, the ruleset
 *   and the startup index ONCE for the batch it is given, so twelve trades from
 *   one league cost barely more than one. Twelve trades from twelve leagues
 *   cost twelve times as much. The pass therefore picks the league with the most
 *   candidates in its sample window and grades that league's trades together.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { LeagueTradeInput } from "@/lib/league-signal-check";
import { normalizeDraftPicks } from "@/lib/league-pulse";
import {
  gradeLeagueTrades,
  tradeRosterPair,
  WYR_LEAGUE_COLUMNS,
  type WyrLeagueRow,
} from "./grade";
import { categoryForLeagueMetadata } from "./routing";
import type { WouldYouRatherSettings } from "./default-settings";

type Client = SupabaseClient<Database>;

/**
 * How many raw trades one sampling pass reads before filtering. Large enough
 * that a window usually holds several trades from the same league, small enough
 * that a cold request pays for one page rather than a table scan.
 */
const SAMPLE_WINDOW = 300;

/** Below this many active rows, a serve triggers a top-up. */
export const POOL_LOW_WATER_MARK = 25;

/**
 * How long a fruitless pass suppresses the next one.
 *
 * A persistently thin pool (a fresh install, or a corpus where most trades are
 * three-team deals) made EVERY page render and EVERY /next call pay for a count
 * over league_transactions, a 300-row window and a full grading batch, and
 * concurrent requests each did it independently. The cooldown bounds that to one
 * attempt a minute, and `growPoolOnce` coalescing below bounds concurrent ones
 * to a single execution, which is the same shape pulseLeague uses.
 */
const EMPTY_PASS_COOLDOWN_MS = 60 * 1000;

/** Set when a pass found nothing; suppresses attempts until it elapses. */
let cooldownUntil = 0;

/** The in-flight pass, so concurrent callers share one execution. */
let inFlight: Promise<PoolGrowthResult> | null = null;

interface CandidateRow {
  id: string;
  league_id: string;
  sleeper_transaction_id: string;
  adds: unknown;
  draft_picks: unknown;
  season: number | null;
  week: number | null;
  created_at_sleeper: string | null;
}

function pickRandom<T>(items: T[]): T | null {
  if (items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)];
}

/** `adds` is jsonb; anything that is not a plain object is treated as empty. */
function addsMap(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, number> = {};
  for (const [sid, rid] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(rid);
    // Sleeper writes "0" into a roster slot it has nothing for. A player id of
    // "0" is not a player, and an owner that does not parse is not an owner.
    if (sid && sid !== "0" && Number.isFinite(n)) out[sid] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** How many assets each roster in the pair receives, before grading. */
function assetCounts(
  adds: Record<string, number> | null,
  picks: unknown[],
  pair: [number, number],
): { a: number; b: number } {
  let a = 0;
  let b = 0;
  const bump = (rid: number) => {
    if (rid === pair[0]) a += 1;
    else if (rid === pair[1]) b += 1;
  };
  for (const rid of Object.values(adds ?? {})) bump(Number(rid));
  for (const p of picks) bump(Number((p as { owner_id?: unknown })?.owner_id));
  return { a, b };
}

export interface PoolGrowthResult {
  /** Trades examined in this pass. */
  considered: number;
  /** Trades that graded and were offered to the pool. */
  graded: number;
  /** Rows actually inserted (a trade already pooled is ignored, not an error). */
  inserted: number;
  /** Why a pass produced nothing, when it did. */
  note: string | null;
}

/**
 * Find gradeable trades and add them to the pool.
 *
 * Never throws. A pass that finds nothing is a normal outcome (the sample
 * window happened to hold only three-team deals), and the caller's job is to
 * carry on serving whatever the pool already holds.
 */
export async function growPool(
  admin: Client,
  settings: WouldYouRatherSettings,
  opts: { passes?: number; respectCooldown?: boolean } = {},
): Promise<PoolGrowthResult> {
  const passes = Math.max(1, opts.passes ?? 1);

  // The request path passes respectCooldown; the script and the admin button do
  // not, because an operator asking for a top-up means it.
  if (opts.respectCooldown) {
    if (Date.now() < cooldownUntil) {
      return { considered: 0, graded: 0, inserted: 0, note: "Cooling down after an empty pass." };
    }
    // One execution shared by every concurrent caller. Without this, a thin
    // pool meant every simultaneous render ran its own sampling and grading.
    if (inFlight) return inFlight;
    inFlight = runPasses(admin, settings, passes).finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return runPasses(admin, settings, passes);
}

async function runPasses(
  admin: Client,
  settings: WouldYouRatherSettings,
  passes: number,
): Promise<PoolGrowthResult> {
  const totals: PoolGrowthResult = { considered: 0, graded: 0, inserted: 0, note: null };

  for (let i = 0; i < passes; i += 1) {
    const pass = await growPoolOnce(admin, settings);
    totals.considered += pass.considered;
    totals.graded += pass.graded;
    totals.inserted += pass.inserted;
    if (pass.note) totals.note = pass.note;
  }

  // A pass that inserted nothing will very likely insert nothing again a second
  // later, so it buys quiet for a minute rather than being retried per request.
  if (totals.inserted === 0) cooldownUntil = Date.now() + EMPTY_PASS_COOLDOWN_MS;
  return totals;
}

async function growPoolOnce(
  admin: Client,
  settings: WouldYouRatherSettings,
): Promise<PoolGrowthResult> {
  const nothing = (note: string): PoolGrowthResult => ({
    considered: 0,
    graded: 0,
    inserted: 0,
    note,
  });

  try {
    const { count, error: countError } = await admin
      .from("league_transactions")
      .select("id", { count: "exact", head: true })
      .eq("type", "trade")
      .eq("status", "complete");
    if (countError) return nothing(countError.message);
    if (!count || count === 0) return nothing("No completed trades have been synced yet.");

    const offset = Math.floor(Math.random() * Math.max(1, count - SAMPLE_WINDOW + 1));
    const { data: rows, error } = await admin
      .from("league_transactions")
      .select(
        "id, league_id, sleeper_transaction_id, adds, draft_picks, season, week, created_at_sleeper",
      )
      .eq("type", "trade")
      .eq("status", "complete")
      .order("id")
      .range(offset, offset + SAMPLE_WINDOW - 1);
    if (error) return nothing(error.message);

    const candidates = (rows ?? []) as CandidateRow[];
    // Shape filtering happens here rather than in SQL: "exactly two rosters" is
    // a fact about two jsonb columns together, which PostgREST cannot ask for,
    // and the window is already in memory.
    const minPerSide = settings.pool.min_assets_per_side;
    const usable = candidates.flatMap((row) => {
      const adds = addsMap(row.adds);
      const picks = normalizeDraftPicks(row.draft_picks);
      const pair = tradeRosterPair(adds, picks);
      if (!pair) return [];
      const counts = assetCounts(adds, picks, pair);
      // A one-sided deal is not a question. Both sides have to receive
      // something or there is nothing to vote between.
      if (counts.a < minPerSide || counts.b < minPerSide) return [];
      return [{ row, adds, picks, pair, counts }];
    });
    if (usable.length === 0) {
      return nothing("No two-sided trades in this sample window.");
    }

    // Group by league, then pick a group AT RANDOM rather than the biggest one.
    // Taking the biggest looks efficient and is not: the same handful of
    // high-volume leagues win every pass, so a hundred passes pool a hundred
    // trades from nine leagues and the game shows the same nine league names
    // over and over. Preferring groups of two or more keeps most of the
    // batching benefit (one format resolution, one value resolver, one ruleset
    // for the whole group) without the concentration.
    const byLeague = new Map<string, typeof usable>();
    for (const item of usable) {
      const bucket = byLeague.get(item.row.league_id);
      if (bucket) bucket.push(item);
      else byLeague.set(item.row.league_id, [item]);
    }
    const groups = Array.from(byLeague.entries());

    // Prefer a league whose Positional WAR curves already exist, so the reveal
    // can say what each player is worth in THAT league rather than falling back
    // to the value read alone. This only READS the cache; a league without one
    // is still eligible, and nothing here ever causes a curve to be computed,
    // which is forbidden anywhere but the league deep view.
    let preferred = groups;
    if (settings.pool.prefer_leagues_with_war && groups.length > 1) {
      const { data: warLeagues } = await admin
        .from("league_positional_war_cache")
        .select("league_id")
        .in("league_id", groups.map(([id]) => id));
      const withWar = new Set((warLeagues ?? []).map((r) => r.league_id));
      const filtered = groups.filter(([id]) => withWar.has(id));
      if (filtered.length > 0) preferred = filtered;
    }

    const batched = preferred.filter(([, items]) => items.length > 1);
    const chosen = pickRandom(batched.length > 0 ? batched : preferred);
    if (!chosen) return nothing("No two-sided trades in this sample window.");
    const [leagueId, group] = chosen;
    const batch = group.slice(0, settings.pool.candidate_batch_size);

    const { data: league, error: leagueError } = await admin
      .from("leagues")
      .select(WYR_LEAGUE_COLUMNS)
      .eq("id", leagueId)
      .maybeSingle();
    if (leagueError) return nothing(leagueError.message);
    if (!league || !league.name) return nothing("The sampled league has not finished syncing.");

    const inputs = batch.map((item) => ({
      sleeperTransactionId: item.row.sleeper_transaction_id,
      adds: item.adds,
      draftPicks: item.picks,
      createdAtSleeper: item.row.created_at_sleeper,
      rosterPair: item.pair,
    })) satisfies Array<LeagueTradeInput & { rosterPair: [number, number] }>;

    const graded = await gradeLeagueTrades(admin, league as WyrLeagueRow, inputs);
    if (!graded.enabled) {
      return nothing("Signal Check is switched off, so no trade can be graded.");
    }

    // Which Discord channel these trades will post to, decided once for the
    // whole league rather than per trade. Null when the league's raw Sleeper
    // object has not been stored yet: the poster then serves the trade only to
    // a channel that takes every league type, which is better than guessing a
    // bucket and dropping a redraft trade into a dynasty room.
    const leagueCategory = categoryForLeagueMetadata(league.metadata);

    const inserts = batch.flatMap((item) => {
      const result = graded.results.get(item.row.sleeper_transaction_id);
      if (!result) return [];
      const isStartup = result.startup !== null;
      if (isStartup && !settings.pool.include_startup_trades) return [];
      // A pick-for-pick trade grades fine and plays badly: there is nothing to
      // recognise and nothing to argue about. Checked against the GRADED sides,
      // because a startup pick that became a player counts as the player.
      if (settings.pool.require_player_asset) {
        const hasPlayer = (["a", "b"] as const).some((side) =>
          (result.assetMeta[side] ?? []).some((m) => m.kind === "player"),
        );
        if (!hasPlayer) return [];
      }
      return [
        {
          league_id: item.row.league_id,
          league_category: leagueCategory,
          transaction_id: item.row.id,
          sleeper_transaction_id: item.row.sleeper_transaction_id,
          season: item.row.season,
          week: item.row.week,
          is_startup: isStartup,
          side_a_roster_id: item.pair[0],
          side_b_roster_id: item.pair[1],
          // Counted off the GRADED sides, not the raw transaction. A startup
          // pick that resolved into a player the same side already received is
          // dropped by the pipeline, and the pool row has to agree with what a
          // reader will actually see on the board.
          side_a_asset_count:
            result.view.sides.find((s) => s.side === "a")?.assets.length ?? 0,
          side_b_asset_count:
            result.view.sides.find((s) => s.side === "b")?.assets.length ?? 0,
        },
      ];
    });

    if (inserts.length === 0) {
      return {
        considered: batch.length,
        graded: 0,
        inserted: 0,
        note: "None of the sampled trades could be graded.",
      };
    }

    // ignoreDuplicates, because a trade already in the pool is the desired end
    // state and not a failure. It is also why no "already pooled" filter is
    // needed on the sampling query: the unique index on transaction_id is the
    // filter, and it does not grow a NOT IN list as the pool fills up.
    const { data: written, error: insertError } = await admin
      .from("would_you_rather_trades")
      .upsert(inserts, { onConflict: "transaction_id", ignoreDuplicates: true })
      .select("id");
    if (insertError) {
      return { considered: batch.length, graded: inserts.length, inserted: 0, note: insertError.message };
    }

    return {
      considered: batch.length,
      graded: inserts.length,
      inserted: written?.length ?? 0,
      note: null,
    };
  } catch (err) {
    return nothing(err instanceof Error ? err.message : "Pool growth failed.");
  }
}

/** How many trades are playable right now. */
export async function countActivePool(admin: Client): Promise<number> {
  const { count } = await admin
    .from("would_you_rather_trades")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");
  return count ?? 0;
}
