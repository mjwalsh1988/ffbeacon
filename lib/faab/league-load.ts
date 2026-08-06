/**
 * Everything league mode needs, fetched once.
 *
 * Most of this leans on the Power Pulse loaders, deliberately: the FAAB answer
 * has to be built from the same rosters, projections, and reliability numbers
 * the league's own Power Pulse page is built from, or the two features will
 * quietly disagree in front of the reader.
 *
 * What is new here is the money. Sleeper reports each roster's FAAB already
 * spent, and the league's total budget sits in the league settings, so every
 * team's remaining budget is a subtraction we were never doing. The winning bid
 * on every past waiver claim is preserved in the stored transaction record, so
 * the league's real going rate is a query rather than a guess.
 *
 * Pagination note: Supabase truncates a select at 1000 rows by default. The
 * multi-row reads here page explicitly, same as the Power Pulse loaders.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { GameLogEntry, PositionalFinish } from "./signals";

type ServiceClient = SupabaseClient<Database>;

const PAGE = 1000;

/** Every team's FAAB position in one league. */
export type BudgetRow = {
  sleeperRosterId: number;
  /** Dollars already spent. Sleeper's settings.waiver_budget_used. */
  spent: number;
  /** Total minus spent, floored at zero. */
  remaining: number;
};

export type LeagueMoney = {
  /** The league's full FAAB allowance per team. Null when not configured. */
  totalBudget: number | null;
  budgets: BudgetRow[];
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
 * Every team's remaining FAAB.
 *
 * `rosters.waiver_budget` holds the amount SPENT, not the amount left: it is
 * copied verbatim from Sleeper's `settings.waiver_budget_used`. Reading it as a
 * remaining balance would invert the entire market model, so the subtraction
 * happens here, once, where the column's meaning is documented.
 */
export async function loadLeagueMoney(
  supabase: ServiceClient,
  leagueRowId: string,
): Promise<LeagueMoney> {
  const { data: leagueRow } = await supabase
    .from("leagues")
    .select("metadata")
    .eq("id", leagueRowId)
    .maybeSingle();

  const meta = (leagueRow?.metadata ?? {}) as { settings?: Record<string, unknown> };
  const totalBudget = numberFrom(meta.settings?.waiver_budget);

  const { data } = await supabase
    .from("rosters")
    .select("sleeper_roster_id, waiver_budget")
    .eq("league_id", leagueRowId);

  const budgets: BudgetRow[] = (data ?? []).map((r) => {
    const spent = Math.max(0, numberFrom(r.waiver_budget) ?? 0);
    return {
      sleeperRosterId: Number(r.sleeper_roster_id),
      spent,
      remaining: totalBudget === null ? 0 : Math.max(0, totalBudget - spent),
    };
  });

  return { totalBudget, budgets };
}

/**
 * Winning waiver bids from this league's stored history.
 *
 * The bid amount is not a column. Sleeper puts it on the transaction's own
 * `settings.waiver_bid`, and we keep the whole transaction object in `metadata`
 * under the raw-source-preservation rule, so it is already here and needs no
 * new sync. Only completed waiver claims count: a failed claim tells you what
 * someone was willing to pay, not what the player cost.
 */
export async function loadWinningBids(
  supabase: ServiceClient,
  leagueRowId: string,
  seasons: number[],
): Promise<Array<{ amount: number; season: number; position: string | null }>> {
  if (seasons.length === 0) return [];

  const out: Array<{ amount: number; season: number; position: string | null }> = [];

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("league_transactions")
      .select("season, type, status, metadata")
      .eq("league_id", leagueRowId)
      .in("season", seasons)
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;

    for (const row of data) {
      if (row.type !== "waiver") continue;
      if (row.status && row.status !== "complete") continue;
      const meta = (row.metadata ?? {}) as { settings?: Record<string, unknown> };
      const amount = numberFrom(meta.settings?.waiver_bid);
      if (amount === null || amount <= 0) continue;
      out.push({ amount, season: Number(row.season), position: null });
    }

    if (data.length < PAGE) break;
  }

  return out;
}

/**
 * Recent game logs for one player, oldest first.
 *
 * Snap share is the point of this. `snap_pct` is populated for recent seasons;
 * where it is missing we derive it from the raw offensive snap counts, and
 * where neither exists the opportunity signal simply does not fire. Older
 * seasons genuinely lack these columns (see scripts/backfill-sleeper-stats.ts),
 * so a missing read is expected rather than an error.
 */
export async function loadGameLogs(
  supabase: ServiceClient,
  playerId: string,
  season: number,
  limit = 8,
): Promise<GameLogEntry[]> {
  const { data, error } = await supabase
    .from("player_stats")
    .select("season, week, snap_pct, off_snp, tm_off_snp, rec_tgt, rush_att, gp")
    .eq("player_id", playerId)
    .eq("season", season)
    .order("week", { ascending: false })
    .limit(limit);
  if (error || !data) return [];

  return data
    .filter((r) => Number(r.gp ?? 0) > 0)
    .map((r) => {
      const direct = numberFrom(r.snap_pct);
      const off = numberFrom(r.off_snp);
      const team = numberFrom(r.tm_off_snp);
      const derived = off !== null && team !== null && team > 0 ? off / team : null;
      // snap_pct is stored 0..1 in some seasons and 0..100 in others. Anything
      // above 1 is a percentage, so normalize before it reaches the signal.
      const raw = direct ?? derived;
      const snapPct = raw === null ? null : raw > 1 ? raw / 100 : raw;
      return {
        season: Number(r.season),
        week: Number(r.week),
        snapPct,
        teamSnaps: team,
        touches: (numberFrom(r.rec_tgt) ?? 0) + (numberFrom(r.rush_att) ?? 0),
      };
    })
    .sort((a, b) => a.week - b.week);
}

/** Where this player has finished at his position, most recent seasons first. */
export async function loadPositionalFinishes(
  supabase: ServiceClient,
  playerId: string,
  scoring: string,
  sinceSeason: number,
): Promise<PositionalFinish[]> {
  const { data, error } = await supabase
    .from("player_positional_finishes")
    .select("season, finish, players_ranked")
    .eq("player_id", playerId)
    .eq("scoring", scoring)
    .gte("season", sinceSeason)
    .order("season", { ascending: false });
  if (error || !data) return [];

  return data.map((r) => ({
    season: Number(r.season),
    finish: Number(r.finish),
    playersRanked: Number(r.players_ranked),
  }));
}

/** Display names for every roster, so the report can name teams properly. */
export async function loadTeamNames(
  supabase: ServiceClient,
  leagueRowId: string,
): Promise<Map<number, string>> {
  const out = new Map<number, string>();

  const [{ data: rosters }, { data: users }] = await Promise.all([
    supabase
      .from("rosters")
      .select("sleeper_roster_id, owner_user_id")
      .eq("league_id", leagueRowId),
    supabase
      .from("league_users")
      .select("sleeper_user_id, display_name, team_name")
      .eq("league_id", leagueRowId),
  ]);

  const byUser = new Map<string, string>();
  for (const u of users ?? []) {
    const name = u.team_name || u.display_name;
    if (u.sleeper_user_id && name) byUser.set(u.sleeper_user_id, name);
  }
  for (const r of rosters ?? []) {
    const name = r.owner_user_id ? byUser.get(r.owner_user_id) : null;
    out.set(Number(r.sleeper_roster_id), name ?? `Team ${r.sleeper_roster_id}`);
  }
  return out;
}
