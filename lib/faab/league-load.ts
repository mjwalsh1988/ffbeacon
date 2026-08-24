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
import { formatTeamLabel } from "@/lib/team-label";
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

/**
 * What kind of league this is, and which value board prices it.
 *
 * The cut guard in lib/faab/marginal.ts needs both. A dynasty roster and a
 * redraft roster disagree completely about what a player on IR is worth, and
 * the disagreement is already priced: the same player carries two different
 * numbers on two different boards. So rather than guessing at return dates we
 * read the board that matches the league, which `pulseLeague` already derived
 * from the league's own Sleeper settings.
 *
 * Sleeper's `settings.type` is 0 redraft, 1 keeper, 2 dynasty. It is the
 * fallback for a league whose scoring shape matched no format of ours, where
 * `format_config_id` is null and there is no board to read.
 */
export type LeagueValueContext = {
  formatConfigId: string | null;
  /** True for dynasty and keeper leagues, where a cut gives up the asset. */
  isKeeperLeague: boolean;
};

export async function loadLeagueValueContext(
  supabase: ServiceClient,
  leagueRowId: string,
): Promise<LeagueValueContext> {
  const { data } = await supabase
    .from("leagues")
    .select("format_config_id, metadata, format_configs(league_type)")
    .eq("id", leagueRowId)
    .maybeSingle();

  if (!data) return { formatConfigId: null, isKeeperLeague: false };

  const config = data.format_configs as { league_type?: string | null } | null;
  const meta = (data.metadata ?? {}) as { settings?: Record<string, unknown> };
  const sleeperType = numberFrom(meta.settings?.type);

  // The derived format leads, because it is what the value lookup will read
  // against. Sleeper's own flag only decides leagues we could not match.
  const isKeeperLeague =
    config?.league_type === "dynasty" ? true : sleeperType !== null && sleeperType >= 1;

  return { formatConfigId: data.format_config_id ?? null, isKeeperLeague };
}

/**
 * Market value for a set of players, on one board.
 *
 * Values are only comparable within a single source, so this picks one source
 * and reads every player from it rather than taking whatever each player has
 * the most of. The highest-priority active source that actually covers these
 * players wins; a player that source has no row for comes back absent, which
 * the cut guard reads as "the market puts nothing on him", which is correct.
 *
 * Returns an empty map when no source covers the format, and the guard that
 * consumes it stands down rather than inventing a bar.
 */
export async function loadPlayerValues(
  supabase: ServiceClient,
  formatConfigId: string | null,
  playerIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!formatConfigId || playerIds.length === 0) return out;

  const [{ data: sources }, { data: rows }] = await Promise.all([
    supabase
      .from("source_registry")
      .select("slug, priority")
      .eq("is_active", true)
      .order("priority", { ascending: true }),
    supabase
      .from("player_value_trends")
      .select("player_id, source, current_value")
      .eq("format_config_id", formatConfigId)
      .in("player_id", playerIds.slice(0, PAGE)),
  ]);

  if (!rows || rows.length === 0) return out;

  const bySource = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const value = numberFrom(row.current_value);
    if (value === null) continue;
    const map = bySource.get(row.source) ?? new Map<string, number>();
    map.set(row.player_id, value);
    bySource.set(row.source, map);
  }

  // Priority order, and the first source with real coverage wins. "Coverage"
  // is deliberately most-rows rather than any-rows: a source holding two of
  // eighteen players would give the guard a board with no bottom.
  const ordered = (sources ?? []).map((r) => r.slug).filter((slug) => bySource.has(slug));
  let chosen: Map<string, number> | null = null;
  for (const slug of ordered) {
    const map = bySource.get(slug);
    if (!map) continue;
    if (chosen === null || map.size > chosen.size) chosen = map;
    // A source that prices most of the roster is good enough; stop looking.
    if (chosen.size >= playerIds.length * 0.75) break;
  }
  if (!chosen) {
    for (const map of bySource.values()) {
      if (chosen === null || map.size > chosen.size) chosen = map;
    }
  }

  return chosen ?? out;
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

  const byUser = new Map<string, { teamName: string | null; username: string | null }>();
  for (const u of users ?? []) {
    if (!u.sleeper_user_id) continue;
    byUser.set(u.sleeper_user_id, {
      teamName: u.team_name ?? null,
      username: u.display_name ?? null,
    });
  }
  for (const r of rosters ?? []) {
    const owner = r.owner_user_id ? byUser.get(r.owner_user_id) : undefined;
    const sleeperRosterId = Number(r.sleeper_roster_id);
    out.set(
      sleeperRosterId,
      formatTeamLabel({
        teamName: owner?.teamName,
        username: owner?.username,
        sleeperRosterId,
      }),
    );
  }
  return out;
}
