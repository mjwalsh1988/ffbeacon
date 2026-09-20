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
import { scoreStatMap } from "@/lib/league-scoring";
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
  /**
   * The smallest bid this league accepts, from Sleeper's waiver_bid_min.
   * Most leagues allow a zero bid; the high-stakes formats set a floor, and
   * recommending a bid the league would reject is worse than no bid at all.
   */
  minBid: number;
  /** Sleeper's settings.type. 0 redraft, 1 keeper, 2 dynasty, 3 chopped. */
  sleeperType: number | null;
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

  return {
    totalBudget,
    budgets,
    minBid: Math.max(0, Math.floor(numberFrom(meta.settings?.waiver_bid_min) ?? 0)),
    sleeperType: numberFrom(meta.settings?.type),
  };
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
 * One waiver auction in this league: every bid that was placed on one player in
 * one week, winner and losers together, sorted high to low.
 *
 * The losing bids are the point. Sleeper keeps a failed claim's amount intact,
 * and a failure whose note reads "This player was claimed by another owner" is
 * a real bid that lost, not a claim that was never in the running. Our synced
 * leagues hold 7,063 of those against 16,937 completed claims, and without them
 * there is no way to know what it took to win anything: a winner with no rival
 * and a winner who beat four teams look identical.
 *
 * Other failure notes (roster full, over budget, dropped a player who had
 * already started, still drafting) are dropped. Those teams never competed.
 */
export type LeagueBid = { rosterId: number; amount: number; won: boolean };
export type LeagueAuction = {
  season: number;
  week: number;
  playerSleeperId: string;
  /** Sorted high to low. Exactly one entry has won true. */
  bids: LeagueBid[];
};

/** The columns groupAuctions needs, as stored. */
export type AuctionTransactionRow = {
  season: number | null;
  week: number | null;
  type: string;
  status: string | null;
  adds: unknown;
  roster_ids: unknown;
  metadata: unknown;
};

const LOST_TO_RIVAL_NOTE = "this player was claimed by another owner";

function jsonObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

/** The single player id an add-one transaction is about, or null. */
function soleAddedPlayerId(row: AuctionTransactionRow): string | null {
  const meta = jsonObject(row.metadata);
  const adds = jsonObject(row.adds) ?? jsonObject(meta?.adds);
  if (!adds) return null;
  const keys = Object.keys(adds);
  return keys.length === 1 ? keys[0] : null;
}

/** The claiming roster: Sleeper puts it first in roster_ids. */
function claimingRosterId(row: AuctionTransactionRow): number | null {
  const meta = jsonObject(row.metadata);
  const raw = Array.isArray(row.roster_ids)
    ? row.roster_ids
    : Array.isArray(meta?.roster_ids)
      ? (meta.roster_ids as unknown[])
      : null;
  if (!raw || raw.length === 0) return null;
  return numberFrom(raw[0]);
}

function bidAmount(row: AuctionTransactionRow): number | null {
  const meta = jsonObject(row.metadata);
  const settings = jsonObject(meta?.settings);
  // A zero bid is a real bid on Sleeper and Yahoo, so only a missing one is
  // rejected. Reading "falsy" as "absent" here would delete the cheapest half
  // of the market.
  return numberFrom(settings?.waiver_bid);
}

function isLosingBid(row: AuctionTransactionRow): boolean {
  if (row.status !== "failed") return false;
  const meta = jsonObject(row.metadata);
  const inner = jsonObject(meta?.metadata);
  const notes = typeof inner?.notes === "string" ? inner.notes : "";
  return notes.toLowerCase().startsWith(LOST_TO_RIVAL_NOTE);
}

/**
 * Group stored waiver transactions into auctions. Pure, so it can be tested
 * without a client, and shared by the league read and the priors builder.
 *
 * A group is kept only when exactly one row won it. Two winners on one player
 * in one week means our grouping key is wrong for that league (a repeated
 * claim after a drop, say), and a guess there would corrupt the price.
 */
export function groupAuctions(rows: AuctionTransactionRow[]): LeagueAuction[] {
  const groups = new Map<string, LeagueAuction>();

  for (const row of rows) {
    if (row.type !== "waiver") continue;
    const won = row.status === "complete";
    if (!won && !isLosingBid(row)) continue;

    const playerSleeperId = soleAddedPlayerId(row);
    if (!playerSleeperId) continue;
    const rosterId = claimingRosterId(row);
    if (rosterId === null) continue;
    const amount = bidAmount(row);
    if (amount === null || amount < 0) continue;
    const season = numberFrom(row.season);
    const week = numberFrom(row.week);
    if (season === null || week === null) continue;

    const key = `${season}|${week}|${playerSleeperId}`;
    const group = groups.get(key) ?? { season, week, playerSleeperId, bids: [] };
    group.bids.push({ rosterId, amount, won });
    groups.set(key, group);
  }

  const out: LeagueAuction[] = [];
  for (const group of groups.values()) {
    if (group.bids.filter((b) => b.won).length !== 1) continue;
    group.bids.sort((a, b) => b.amount - a.amount || Number(b.won) - Number(a.won));
    out.push(group);
  }
  out.sort((a, b) => a.season - b.season || a.week - b.week);
  return out;
}

/** Every auction this league has run in the given seasons. */
export async function loadAuctionHistory(
  supabase: ServiceClient,
  leagueRowId: string,
  seasons: number[],
): Promise<LeagueAuction[]> {
  if (seasons.length === 0) return [];

  const rows: AuctionTransactionRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("league_transactions")
      .select("season, week, type, status, adds, roster_ids, metadata")
      .eq("league_id", leagueRowId)
      .eq("type", "waiver")
      .in("season", seasons)
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    rows.push(...(data as AuctionTransactionRow[]));
    if (data.length < PAGE) break;
  }

  return groupAuctions(rows);
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
 * Sleeper's `settings.type` is 0 redraft, 1 keeper, 2 dynasty, 3 chopped. It is
 * the fallback for a league whose scoring shape matched no format of ours,
 * where `format_config_id` is null and there is no board to read.
 *
 * Type 3 is NOT a keeper league. It is a one-season elimination league, and
 * reading "3 is at least 1" as keeper ran the keeper cut guard (protect the
 * bottom 40% of the roster by dynasty market value) over a league where nobody
 * keeps anybody. Chopped is checked by equality, never by a range.
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
    config?.league_type === "dynasty" || sleeperType === 1 || sleeperType === 2;

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
  /**
   * The source the READER chose. Without it this function picks by registry
   * priority, which is how the cut guard ended up quoting one board while the
   * page beside it quoted another. When the caller knows the reader's source,
   * it wins outright, and we fall back to priority only if it has no rows.
   */
  preferredSource?: string | null,
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

  // The reader's own source first, when they have one and it covers anybody.
  if (preferredSource) {
    const preferred = bySource.get(preferredSource);
    if (preferred && preferred.size > 0) return preferred;
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

/**
 * One roster's Power Pulse rank, READ ONLY.
 *
 * Used to tell a contender from a rebuilder, which decides how much of a
 * dynasty bid comes from the player's market value rather than from the
 * weeks he adds. This never computes Power Pulse and must never be made to:
 * that model is on demand through the league deep view, for scaling reasons
 * written out in CLAUDE.md. A league with no cached row gets no status, and
 * the blend falls back to the middle.
 */
export async function loadPulseRank(
  supabase: ServiceClient,
  leagueRowId: string,
  season: number,
  sleeperRosterId: number,
): Promise<number | null> {
  // The cache keys on the rosters row id, not on Sleeper's roster number, so
  // the uuid is looked up first. Two small indexed reads.
  const { data: rosterRow } = await supabase
    .from("rosters")
    .select("id")
    .eq("league_id", leagueRowId)
    .eq("sleeper_roster_id", sleeperRosterId)
    .maybeSingle();
  if (!rosterRow?.id) return null;

  const { data } = await supabase
    .from("league_power_pulse_cache")
    .select("pulse_rank")
    .eq("league_id", leagueRowId)
    .eq("season", season)
    .eq("roster_id", rosterRow.id)
    .maybeSingle();
  const rank = numberFrom(data?.pulse_rank);
  return rank && rank > 0 ? rank : null;
}

/**
 * What he has actually scored lately, under THIS league's rules.
 *
 * The projection a source published for a breakout is often a week or two
 * behind his new role: a back who has taken over a backfield still carries
 * the projection of the back who was splitting it. When the opportunity
 * signal says the role has genuinely changed, this is the number the model
 * blends toward, and it is scored under the league's own settings rather
 * than under a canonical base, so a TE premium league sees a TE premium.
 */
export async function loadRecentPointsPerGame(
  supabase: ServiceClient,
  playerId: string,
  season: number,
  scoring: Parameters<typeof scoreStatMap>[1],
  games: number,
): Promise<number | null> {
  if (games <= 0) return null;
  const { data } = await supabase
    .from("player_stats")
    .select("week, gp, metadata")
    .eq("player_id", playerId)
    .eq("season", season)
    .order("week", { ascending: false })
    .limit(Math.max(1, games * 2));
  if (!data || data.length === 0) return null;

  const scored: number[] = [];
  for (const row of data) {
    if (Number(row.gp ?? 0) <= 0) continue;
    // The raw Sleeper stat object, preserved at ingestion under the
    // original-source rule, is what the league's own scoring runs over.
    const stats = (row.metadata as { sleeper?: Record<string, unknown> } | null)?.sleeper ?? null;
    const points = scoreStatMap(stats as Record<string, number> | null, scoring);
    if (points === null) continue;
    scored.push(points);
    if (scored.length >= games) break;
  }

  if (scored.length === 0) return null;
  return scored.reduce((sum, p) => sum + p, 0) / scored.length;
}

/**
 * The depth chart at one NFL team and position, with injury designations.
 *
 * Sleeper publishes a depth_chart_order on every player, which we already
 * store inside `players.metadata.sleeper`. This reads it back for the
 * candidate's own team so the model can see the one thing that most often
 * makes a waiver claim expensive: the man in front of him being out.
 */
export type TeamDepthEntry = {
  playerId: string;
  name: string;
  depthOrder: number | null;
  injuryStatus: string | null;
};

export async function loadTeamDepth(
  supabase: ServiceClient,
  team: string | null,
  position: string | null,
): Promise<TeamDepthEntry[]> {
  if (!team || !position) return [];
  const { data } = await supabase
    .from("players")
    .select("id, full_name, first_name, last_name, metadata")
    .eq("team", team)
    .eq("position", position)
    .limit(40);

  return (data ?? []).map((row) => {
    const meta = (row.metadata as { sleeper?: Record<string, unknown> } | null)?.sleeper ?? {};
    const order = numberFrom(meta.depth_chart_order);
    const status = typeof meta.injury_status === "string" ? meta.injury_status : null;
    const name =
      row.full_name ??
      [row.first_name, row.last_name].filter(Boolean).join(" ").trim() ??
      "A teammate";
    return {
      playerId: row.id,
      name: name || "A teammate",
      depthOrder: order && order > 0 ? order : null,
      injuryStatus: status,
    };
  });
}

/** Injury designations that mean the man in front is not playing. */
const STARTER_OUT_STATUSES = new Set(["OUT", "IR", "PUP", "SUS", "DOUBTFUL", "NA", "DNR"]);

/** The hurt starter ahead of this player, when there is one. */
export function starterAheadOf(
  depth: TeamDepthEntry[],
  candidatePlayerId: string,
): { name: string; status: string; depthOrder: number | null } | null {
  const me = depth.find((d) => d.playerId === candidatePlayerId);
  const myOrder = me?.depthOrder ?? null;
  if (myOrder === null || myOrder < 2) return null;

  const ahead = depth
    .filter((d) => d.playerId !== candidatePlayerId)
    .filter((d) => d.depthOrder !== null && d.depthOrder < myOrder)
    .filter((d) => d.injuryStatus && STARTER_OUT_STATUSES.has(d.injuryStatus.toUpperCase()))
    .sort((a, b) => (a.depthOrder ?? 99) - (b.depthOrder ?? 99));

  const first = ahead[0];
  if (!first || !first.injuryStatus) return null;
  return { name: first.name, status: first.injuryStatus, depthOrder: first.depthOrder };
}

/**
 * What a player at a given overall rank is worth on this board.
 *
 * The scale a dynasty bid is measured against. Without it a "share of elite
 * value" is a fraction with no denominator, and the same player would price
 * differently on two boards purely because one publishes bigger numbers.
 */
export async function loadEliteValue(
  supabase: ServiceClient,
  formatConfigId: string | null,
  rank: number,
  preferredSource?: string | null,
): Promise<number | null> {
  if (!formatConfigId) return null;
  let query = supabase
    .from("player_value_trends")
    .select("current_value, source")
    .eq("format_config_id", formatConfigId)
    .order("current_value", { ascending: false })
    .range(Math.max(0, rank - 1), Math.max(0, rank - 1));
  if (preferredSource) query = query.eq("source", preferredSource);
  const { data } = await query;
  const value = numberFrom(data?.[0]?.current_value);
  return value && value > 0 ? value : null;
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
