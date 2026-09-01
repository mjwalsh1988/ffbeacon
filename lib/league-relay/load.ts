import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import type { SleeperLeague } from "@/lib/sleeper";
import { resolveLeagueContext } from "@/lib/league-format-resolution";
import { scoreWithFallback, type ScoringSettings } from "@/lib/league-scoring";
import { buildRelayHeader } from "./header";
import type { RelayLeague, RelayTeam } from "./types";
import type { WaiverPlayer } from "./waiver-writeup";

type Admin = SupabaseClient<Database>;

/**
 * The reads the relay makes that nothing else already does.
 *
 * Everything expensive (Signal Check's batch grade, the trade impact world, the
 * schedule board) is loaded by the module that owns it. What is left is the
 * league identity, the roster-to-manager map, and the cheap per-player facts a
 * waiver writeup needs. Those live here so the orchestrator reads each of them
 * ONCE PER LEAGUE PER RUN rather than once per message: a Wednesday morning
 * with eleven waiver claims would otherwise make eleven identical roster reads.
 */

/** The league row, in the shape every builder wants. */
export async function loadRelayLeague(
  admin: Admin,
  leagueRowId: string,
  watermarkAt: string,
): Promise<RelayLeague | null> {
  const { data } = await admin
    .from("leagues")
    .select("id, sleeper_league_id, name, season, total_rosters, roster_positions, metadata")
    .eq("id", leagueRowId)
    .maybeSingle();
  if (!data) return null;

  const rosterPositions = Array.isArray(data.roster_positions)
    ? (data.roster_positions as unknown[]).filter((p): p is string => typeof p === "string")
    : [];

  return {
    id: data.id,
    sleeperLeagueId: data.sleeper_league_id,
    name: data.name,
    season: Number(data.season),
    // A league whose roster count never synced is still a league. One is the
    // safe floor: every band calculation divides by (total - 1) and guards it.
    totalRosters: Number(data.total_rosters ?? 0) || rosterPositions.length || 12,
    rosterPositions,
    metadata: data.metadata,
    watermarkAt,
    // Built here, once, because a busy tick sends a dozen messages from this
    // league and the header is identical on every one of them.
    header: buildRelayHeader({
      leagueName: data.name,
      season: Number(data.season),
      totalRosters: Number(data.total_rosters ?? 0) || rosterPositions.length || 12,
      rosterPositions,
      sleeperLeague: (data.metadata ?? null) as SleeperLeague | null,
    }),
  };
}

/**
 * Every roster in the league, named by its manager's SLEEPER USERNAME.
 *
 * THE USERNAME, NOT THE TEAM NAME, AND DELIBERATELY SO. A team name is a
 * costume: it changes on a whim, it is often a joke that only makes sense for
 * one week, and two managers in the same league regularly pick similar ones.
 * The username is how everybody in the Discord already refers to each other, it
 * is what Sleeper shows in the app's own transaction feed, and it does not move
 * between one post and the next. In a channel carrying several leagues that
 * stability is the whole point.
 *
 * Falls back to the team name when a roster has no claimed owner, and to
 * "Team 4" when it has neither. Unlike Would You Rather, this feature NAMES
 * PEOPLE on purpose: it posts into the league's own Discord, where anonymity
 * would make every message unreadable.
 */
export async function loadRelayTeams(
  admin: Admin,
  leagueRowId: string,
): Promise<Map<number, RelayTeam>> {
  const [{ data: rosters }, { data: users }] = await Promise.all([
    admin
      .from("rosters")
      .select("sleeper_roster_id, owner_user_id, wins, losses, ties")
      .eq("league_id", leagueRowId),
    admin
      .from("league_users")
      .select("sleeper_user_id, display_name, team_name")
      .eq("league_id", leagueRowId),
  ]);

  const byUser = new Map<string, { display: string | null; team: string | null }>();
  for (const u of users ?? []) {
    byUser.set(u.sleeper_user_id, {
      display: u.display_name ?? null,
      team: (u as { team_name?: string | null }).team_name ?? null,
    });
  }

  const out = new Map<number, RelayTeam>();
  for (const r of rosters ?? []) {
    const rosterId = Number(r.sleeper_roster_id);
    if (!Number.isFinite(rosterId)) continue;
    const owner = r.owner_user_id ? byUser.get(r.owner_user_id) : undefined;
    out.set(rosterId, {
      sleeperRosterId: rosterId,
      name: owner?.display ?? owner?.team ?? `Team ${rosterId}`,
      handle: owner?.display ?? null,
      teamName: owner?.team ?? null,
      record: {
        wins: Number(r.wins ?? 0),
        losses: Number(r.losses ?? 0),
        ties: Number(r.ties ?? 0),
      },
    });
  }
  return out;
}

/** Power Pulse rank per roster, for the standings colour in every writeup. */
export async function loadPulseRanks(
  admin: Admin,
  leagueRowId: string,
  season: number,
): Promise<Map<number, number>> {
  const { data } = await admin
    .from("league_power_pulse_cache")
    .select("pulse_rank, rosters!inner(sleeper_roster_id)")
    .eq("league_id", leagueRowId)
    .eq("season", season);

  const out = new Map<number, number>();
  for (const row of data ?? []) {
    const joined = (row as { rosters?: { sleeper_roster_id?: unknown } }).rosters;
    const rosterId = Number(joined?.sleeper_roster_id);
    const rank = Number(row.pulse_rank);
    if (Number.isFinite(rosterId) && Number.isFinite(rank)) out.set(rosterId, rank);
  }
  return out;
}

/**
 * Everything cheap we know about a set of players, keyed by SLEEPER id.
 *
 * Three indexed reads regardless of how many players are asked for, which is
 * why the orchestrator collects every player across a run's transactions and
 * asks once. Per-transaction lookups would be three reads each.
 *
 * `projectedPoints` is scored under the LEAGUE'S OWN scoring settings, not
 * under a canonical PPR column, so a superflex TE-premium league sees the
 * number its managers will actually get. That is the same `scoreWithFallback`
 * Power Pulse uses, so the two never disagree about a player.
 */
export async function loadWaiverPlayers(
  admin: Admin,
  params: {
    sleeperPlayerIds: string[];
    season: number;
    /** Weeks to average the projection over. Usually the next three. */
    weeks: number[];
    scoring: ScoringSettings | null;
    formatConfigId: string | null;
    sourceSlug: string | null;
  },
): Promise<Map<string, WaiverPlayer>> {
  const ids = Array.from(new Set(params.sleeperPlayerIds.filter((id) => id && id !== "0")));
  const out = new Map<string, WaiverPlayer>();
  if (ids.length === 0) return out;

  const { data: players } = await admin
    .from("players")
    // `injury_status` is NOT a column on players. Sleeper's designation lives
    // inside metadata.sleeper, which is where lib/power-pulse/load.ts reads it
    // from too, so the two surfaces agree about who is hurt.
    .select("id, full_name, first_name, last_name, slug, position, team, external_ids, metadata")
    .in("external_ids->>sleeper", ids);

  const bySleeper = new Map<
    string,
    { id: string; name: string; position: string; team: string | null; injury: string | null }
  >();
  for (const p of players ?? []) {
    const sleeperId = (p.external_ids as { sleeper?: unknown } | null)?.sleeper;
    if (typeof sleeperId !== "string") continue;
    const meta = (p.metadata as { sleeper?: Record<string, unknown> } | null)?.sleeper ?? {};
    const injury = meta.injury_status;
    bySleeper.set(sleeperId, {
      id: p.id,
      name: p.full_name ?? (`${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || p.slug),
      position: (p.position ?? "").toUpperCase(),
      team: p.team ?? null,
      injury: typeof injury === "string" && injury.length > 0 ? injury : null,
    });
  }

  const playerIds = Array.from(bySleeper.values()).map((p) => p.id);

  const [{ data: projections }, { data: trends }] = await Promise.all([
    params.weeks.length > 0
      ? admin
          .from("player_weekly_projections")
          .select(
            "sleeper_player_id, week, stat_line, projected_pts_ppr, projected_pts_half_ppr, projected_pts_std",
          )
          .eq("season", params.season)
          .in("sleeper_player_id", ids)
          .in("week", params.weeks)
      : Promise.resolve({ data: [] as never[] }),
    params.formatConfigId && playerIds.length > 0
      ? admin
          .from("player_value_trends")
          .select("player_id, current_value, change_30d_pct, data_points_30d")
          .eq("format_config_id", params.formatConfigId)
          .eq("source", params.sourceSlug ?? "")
          .in("player_id", playerIds)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  // Average over the weeks Sleeper actually published, not over the window
  // length, so a bye inside the window does not read as a week he was projected
  // to score nothing.
  const projSum = new Map<string, { total: number; weeks: number }>();
  for (const row of projections ?? []) {
    const scored = scoreWithFallback(
      row.stat_line as Record<string, unknown> | null,
      {
        ppr: row.projected_pts_ppr,
        half_ppr: row.projected_pts_half_ppr,
        std: row.projected_pts_std,
      },
      params.scoring,
      bySleeper.get(row.sleeper_player_id)?.position ?? null,
    );
    if (scored.points === null) continue;
    const acc = projSum.get(row.sleeper_player_id) ?? { total: 0, weeks: 0 };
    acc.total += scored.points;
    acc.weeks += 1;
    projSum.set(row.sleeper_player_id, acc);
  }

  const trendByPlayer = new Map<string, { value: number; change: number | null }>();
  for (const t of trends ?? []) {
    trendByPlayer.set(t.player_id, {
      value: Number(t.current_value),
      // Below the display threshold the site itself refuses to show a trend, so
      // the writeup does not get to either. Seven points is the same gate the
      // UI uses (CLAUDE.md, Pre-Calculated Tables).
      change: Number(t.data_points_30d ?? 0) >= 7 ? Number(t.change_30d_pct) : null,
    });
  }

  for (const [sleeperId, p] of bySleeper) {
    const proj = projSum.get(sleeperId);
    const trend = trendByPlayer.get(p.id);
    out.set(sleeperId, {
      name: p.name,
      position: p.position,
      nflTeam: p.team,
      injuryStatus: p.injury,
      projectedPoints: proj && proj.weeks > 0 ? proj.total / proj.weeks : null,
      value: trend?.value ?? null,
      change30dPct: trend?.change ?? null,
      // Filled in by the caller when it has the positional board; a per-player
      // rank query here would be one read each, which is the thing this
      // function exists to avoid.
      positionRank: null,
    });
  }

  return out;
}

/**
 * The league's format and value source, resolved the way every league view
 * resolves it.
 *
 * ABSOLUTE RULE, restated because this is a NON-page caller and the rule is
 * easy to lose there: inside anything league-scoped the format comes from the
 * league's own Sleeper scoring settings, never from a user's global toggle.
 * There is no user in a cron, so there is nothing to be tempted by, but the
 * resolver is still the only correct way to get the format and it is what keeps
 * the Discord post agreeing with the league page.
 */
export async function resolveRelayContext(
  admin: Admin,
  league: RelayLeague,
): Promise<{
  formatConfigId: string | null;
  formatDisplay: string | null;
  sourceSlug: string | null;
  sourceDisplay: string | null;
}> {
  const sleeperLeague = (league.metadata ?? {}) as unknown as SleeperLeague;
  try {
    const context = await resolveLeagueContext(admin, sleeperLeague, null);
    // `coverage: "none"` is the empty variant, which carries no format at all.
    // Narrowed rather than optional-chained so a future field on either variant
    // cannot be read off the wrong one.
    if (context.coverage === "none" || !context.formatConfigId) {
      return {
        formatConfigId: null,
        formatDisplay: null,
        sourceSlug: context.sourceSlug,
        sourceDisplay: context.sourceDisplay,
      };
    }
    return {
      formatConfigId: context.formatConfigId,
      formatDisplay: context.formatDisplay,
      sourceSlug: context.sourceSlug,
      sourceDisplay: context.sourceDisplay,
    };
  } catch {
    return {
      formatConfigId: null,
      formatDisplay: null,
      sourceSlug: null,
      sourceDisplay: null,
    };
  }
}

/**
 * The median winning FAAB bid in this league's season.
 *
 * The comparison that makes a bid mean something. A 40 in a league where nobody
 * has gone above 12 is a different sentence to a 40 in a league where the
 * median is 35, and neither is legible without the other number.
 *
 * Null when there is nothing to compare against, which is honest: a league four
 * claims into its season has no median worth quoting.
 */
export async function loadFaabMedian(
  admin: Admin,
  leagueRowId: string,
  season: number,
): Promise<number | null> {
  const { data } = await admin
    .from("league_transactions")
    .select("waiver_budget, metadata")
    .eq("league_id", leagueRowId)
    .eq("season", season)
    .eq("type", "waiver")
    .eq("status", "complete")
    .limit(500);

  const bids: number[] = [];
  for (const row of data ?? []) {
    const bid = readFaabBid(row.metadata, row.waiver_budget);
    if (bid !== null && bid > 0) bids.push(bid);
  }
  if (bids.length < 4) return null;
  bids.sort((a, b) => a - b);
  const mid = Math.floor(bids.length / 2);
  return bids.length % 2 === 0 ? Math.round((bids[mid - 1] + bids[mid]) / 2) : bids[mid];
}

/**
 * What a waiver claim cost.
 *
 * Sleeper puts the winning bid in `settings.waiver_bid` on the transaction, and
 * `waiver_budget` is a different thing entirely: it is FAAB moving BETWEEN two
 * managers as part of a trade. Reading the second as the first reports every
 * claim as free, so both are handled and the bid wins.
 */
export function readFaabBid(metadata: Json | null, waiverBudget: Json | null): number | null {
  const settings = (metadata as { settings?: { waiver_bid?: unknown } } | null)?.settings;
  const bid = Number(settings?.waiver_bid);
  if (Number.isFinite(bid)) return bid;
  // A trade's FAAB transfer, which is not a bid. Deliberately not returned as
  // one; the caller asks for a bid and would print it as one.
  void waiverBudget;
  return null;
}

/** The league's total FAAB budget, from its own Sleeper settings. */
export function readFaabBudget(metadata: unknown): number | null {
  const budget = Number(
    (metadata as { settings?: { waiver_budget?: unknown } } | null)?.settings?.waiver_budget,
  );
  return Number.isFinite(budget) && budget > 0 ? budget : null;
}
