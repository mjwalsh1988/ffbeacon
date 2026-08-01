/**
 * Read layer for Power Pulse surfaces.
 *
 * Shapes league_power_pulse_cache into what the league overview table and the
 * Power Pulse tab render, including the value comparison. The divergence
 * between a team's Power Pulse rank and its trade-value rank is the single most
 * interesting number on the page: it separates the contenders from the teams
 * hoarding assets they cannot start.
 *
 * Everything returned here is plain JSON so it survives the server to client
 * component boundary (no Maps, no Dates).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

export type PulseDriver = {
  label: string;
  detail: string;
  tone: "good" | "bad" | "neutral";
};

export type PulseWeek = {
  week: number;
  opponentRosterId: number | null;
  opponentName: string | null;
  mean: number;
  sigma: number;
  winProb: number | null;
};

export type PulseTeam = {
  rosterRowId: string;
  sleeperRosterId: number;
  teamName: string;
  ownerHandle: string | null;
  ownerAvatarId: string | null;
  record: { wins: number; losses: number; ties: number };

  powerPulse: number;
  pulseRank: number | null;

  scorePoints: number | null;
  scorePointsRank: number | null;
  scoreSchedule: number | null;
  scoreScheduleRank: number | null;
  scoreDepth: number | null;
  scoreDepthRank: number | null;
  scoreForm: number | null;
  scoreFormRank: number | null;

  expectedPointsPerWeek: number | null;
  expectedPointsStdev: number | null;
  projectedWins: number | null;
  projectedLosses: number | null;
  playoffOdds: number | null;
  byeOdds: number | null;
  titleOdds: number | null;
  lastPlaceOdds: number | null;

  sosPoints: number | null;
  sosRank: number | null;
  lineupEfficiency: number | null;
  lineupEfficiencyRank: number | null;
  lineupPointsLost: number | null;
  reliabilityScore: number | null;
  reliabilityRank: number | null;

  positionPoints: Record<string, number>;
  positionRanks: Record<string, number | null>;
  starters: Array<{ playerId: string; name: string; position: string; points: number }>;
  depthDropoffPct: number | null;

  weekly: PulseWeek[];
  drivers: PulseDriver[];

  /** Total trade value for the resolved (format, source). Null when uncovered. */
  totalValue: number | null;
  /** League rank by trade value, 1 = most valuable. */
  valueRank: number | null;
  /**
   * valueRank minus pulseRank. Positive means the team competes better than its
   * assets suggest; negative means it is holding value it cannot start.
   */
  rankDivergence: number | null;
};

export type PowerPulseView = {
  teams: PulseTeam[];
  season: number;
  throughWeek: number;
  generatedAt: string | null;
  modelVersion: string | null;
  /** True when the season has not started, which changes the copy. */
  preseason: boolean;
};

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Load the Power Pulse view for a league, joined to team identity and to the
 * trade-value cache for the resolved (format, source).
 *
 * Returns null when no Power Pulse rows exist yet, so callers can render the
 * "building" state rather than an empty table.
 */
export async function loadPowerPulseView(
  supabase: AnySupabase,
  leagueRowId: string,
  season: number,
  formatConfigId: string | null,
  sourceSlug: string | null,
): Promise<PowerPulseView | null> {
  const [pulseRes, rostersRes, usersRes, valueRes] = await Promise.all([
    supabase
      .from("league_power_pulse_cache")
      .select("*")
      .eq("league_id", leagueRowId)
      .eq("season", season),
    supabase
      .from("rosters")
      .select("id, sleeper_roster_id, owner_user_id, wins, losses, ties")
      .eq("league_id", leagueRowId),
    supabase
      .from("league_users")
      .select("sleeper_user_id, display_name, team_name, avatar")
      .eq("league_id", leagueRowId),
    formatConfigId && sourceSlug
      ? supabase
          .from("league_power_rankings_cache")
          .select("roster_id, total_value")
          .eq("league_id", leagueRowId)
          .eq("format_config_id", formatConfigId)
          .eq("source", sourceSlug)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const pulseRows = pulseRes.data ?? [];
  if (pulseRows.length === 0) return null;

  const rosters = rostersRes.data ?? [];
  const usersById = new Map((usersRes.data ?? []).map((u) => [u.sleeper_user_id, u]));
  const rosterById = new Map(rosters.map((r) => [r.id, r]));

  // Value rank across the league, computed here so it matches whatever
  // (format, source) the league view resolved to.
  const valueByRoster = new Map<string, number>();
  for (const row of (valueRes.data ?? []) as Array<{ roster_id: string; total_value: number }>) {
    valueByRoster.set(row.roster_id, Number(row.total_value));
  }
  const valueRankByRoster = new Map<string, number>();
  [...valueByRoster.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([rosterId], i) => valueRankByRoster.set(rosterId, i + 1));

  const teams: PulseTeam[] = pulseRows.map((row) => {
    const roster = rosterById.get(row.roster_id);
    const user = roster?.owner_user_id ? usersById.get(roster.owner_user_id) : null;
    const components = (row.components ?? {}) as {
      positionPoints?: Record<string, number>;
      positionRanks?: Record<string, number | null>;
      starters?: Array<{ playerId: string; name: string; position: string; points: number }>;
      depthDropoffPct?: number;
    };

    const pulseRank = row.pulse_rank === null ? null : Number(row.pulse_rank);
    const valueRank = valueRankByRoster.get(row.roster_id) ?? null;

    return {
      rosterRowId: row.roster_id,
      sleeperRosterId: roster?.sleeper_roster_id ?? 0,
      teamName:
        user?.team_name ||
        user?.display_name ||
        `Team ${roster?.sleeper_roster_id ?? "?"}`,
      ownerHandle: user?.display_name ?? null,
      ownerAvatarId: user?.avatar ?? null,
      record: {
        wins: Number(roster?.wins ?? 0),
        losses: Number(roster?.losses ?? 0),
        ties: Number(roster?.ties ?? 0),
      },

      powerPulse: Number(row.power_pulse),
      pulseRank,

      scorePoints: num(row.score_points),
      scorePointsRank: num(row.score_points_rank),
      scoreSchedule: num(row.score_schedule),
      scoreScheduleRank: num(row.score_schedule_rank),
      scoreDepth: num(row.score_depth),
      scoreDepthRank: num(row.score_depth_rank),
      scoreForm: num(row.score_form),
      scoreFormRank: num(row.score_form_rank),

      expectedPointsPerWeek: num(row.expected_points_per_week),
      expectedPointsStdev: num(row.expected_points_stdev),
      projectedWins: num(row.projected_wins),
      projectedLosses: num(row.projected_losses),
      playoffOdds: num(row.playoff_odds),
      byeOdds: num(row.bye_odds),
      titleOdds: num(row.title_odds),
      lastPlaceOdds: num(row.last_place_odds),

      sosPoints: num(row.sos_points),
      sosRank: num(row.sos_rank),
      lineupEfficiency: num(row.lineup_efficiency),
      lineupEfficiencyRank: num(row.lineup_efficiency_rank),
      lineupPointsLost: num(row.lineup_points_lost),
      reliabilityScore: num(row.reliability_score),
      reliabilityRank: num(row.reliability_rank),

      positionPoints: components.positionPoints ?? {},
      positionRanks: components.positionRanks ?? {},
      starters: components.starters ?? [],
      depthDropoffPct: components.depthDropoffPct ?? null,

      weekly: ((row.weekly ?? []) as unknown as PulseWeek[]) ?? [],
      drivers: ((row.drivers ?? []) as unknown as PulseDriver[]) ?? [],

      totalValue: valueByRoster.get(row.roster_id) ?? null,
      valueRank,
      rankDivergence: valueRank !== null && pulseRank !== null ? valueRank - pulseRank : null,
    };
  });

  teams.sort(
    (a, b) =>
      (a.pulseRank ?? Number.MAX_SAFE_INTEGER) - (b.pulseRank ?? Number.MAX_SAFE_INTEGER) ||
      b.powerPulse - a.powerPulse,
  );

  const first = pulseRows[0];
  const throughWeek = Number(first.through_week ?? 0);

  return {
    teams,
    season,
    throughWeek,
    generatedAt: first.generated_at ?? null,
    modelVersion: first.model_version ?? null,
    preseason: throughWeek === 0,
  };
}

/** Award-style league leaders for the Power Pulse tab. */
export type PulseLeader = {
  id: string;
  title: string;
  /** What the winning team achieved, in plain language. */
  blurb: string;
  team: PulseTeam;
  value: string;
};

export function buildPulseLeaders(teams: PulseTeam[]): PulseLeader[] {
  if (teams.length === 0) return [];
  const leaders: PulseLeader[] = [];

  /**
   * The leader on one metric, plus how many teams share the top value.
   * Ties matter here: six teams commonly sit at 100% lineup efficiency, and
   * handing one of them a trophy with no qualifier reads as a bug. The tie
   * count gets surfaced in the card's blurb instead.
   */
  const best = (
    pick: (t: PulseTeam) => number | null,
    direction: "high" | "low" = "high",
  ): { team: PulseTeam; tiedWith: number } | null => {
    const scored = teams
      .map((t) => ({ t, v: pick(t) }))
      .filter((e): e is { t: PulseTeam; v: number } => e.v !== null && Number.isFinite(e.v));
    if (scored.length === 0) return null;
    scored.sort((a, b) => (direction === "high" ? b.v - a.v : a.v - b.v));
    const top = scored[0].v;
    const tiedWith = scored.filter((e) => Math.abs(e.v - top) < 1e-9).length - 1;
    return { team: scored[0].t, tiedWith };
  };

  /** Append an honest tie qualifier when the leader is not alone. */
  const withTie = (blurb: string, tiedWith: number): string =>
    tiedWith > 0
      ? `${blurb} Tied with ${tiedWith} other team${tiedWith === 1 ? "" : "s"}.`
      : blurb;

  const favorite = best((t) => t.titleOdds);
  if (favorite && (favorite.team.titleOdds ?? 0) > 0) {
    leaders.push({
      id: "title-favorite",
      title: "Title favorite",
      blurb: withTie(
        "Wins the championship most often across every simulated season.",
        favorite.tiedWith,
      ),
      team: favorite.team,
      value: `${Math.round((favorite.team.titleOdds ?? 0) * 100)}%`,
    });
  }

  const efficient = best((t) => t.lineupEfficiency);
  if (efficient && efficient.team.lineupEfficiency !== null) {
    leaders.push({
      id: "lineup-efficiency",
      title: "Sharpest lineup",
      blurb: withTie(
        "Starts the closest thing to its best possible lineup this week.",
        efficient.tiedWith,
      ),
      team: efficient.team,
      value: `${(efficient.team.lineupEfficiency * 100).toFixed(0)}%`,
    });
  }

  const wasteful = best((t) => t.lineupPointsLost);
  if (wasteful && (wasteful.team.lineupPointsLost ?? 0) > 1) {
    leaders.push({
      id: "lineup-waste",
      title: "Most left on the bench",
      blurb: withTie(
        "Loses the most projected points to a suboptimal starting lineup.",
        wasteful.tiedWith,
      ),
      team: wasteful.team,
      value: `${(wasteful.team.lineupPointsLost ?? 0).toFixed(1)} pts`,
    });
  }

  const reliable = best((t) => t.reliabilityScore);
  if (reliable && reliable.team.reliabilityScore !== null) {
    leaders.push({
      id: "reliability",
      title: "Most reliable starters",
      blurb: withTie(
        "Its starters beat their own projections more often than anyone else's.",
        reliable.tiedWith,
      ),
      team: reliable.team,
      value: `${reliable.team.reliabilityScore >= 1 ? "+" : ""}${((reliable.team.reliabilityScore - 1) * 100).toFixed(1)}%`,
    });
  }

  const gauntlet = best((t) => t.sosPoints);
  if (gauntlet && gauntlet.team.sosPoints !== null) {
    leaders.push({
      id: "schedule",
      title: "Toughest road",
      blurb: withTie(
        "Faces the strongest set of opponents over the remaining schedule.",
        gauntlet.tiedWith,
      ),
      team: gauntlet.team,
      value: `${gauntlet.team.sosPoints.toFixed(1)} opp`,
    });
  }

  const deepest = best((t) => (t.depthDropoffPct === null ? null : t.depthDropoffPct), "low");
  if (deepest && deepest.team.depthDropoffPct !== null) {
    leaders.push({
      id: "depth",
      title: "Deepest roster",
      blurb: withTie(
        "Loses the least output when a position's best starter goes down.",
        deepest.tiedWith,
      ),
      team: deepest.team,
      value: `-${(deepest.team.depthDropoffPct * 100).toFixed(0)}%`,
    });
  }

  const overachiever = best((t) => t.rankDivergence);
  if (overachiever && (overachiever.team.rankDivergence ?? 0) > 0) {
    leaders.push({
      id: "overachiever",
      title: "Punches above its value",
      blurb: withTie(
        "Competes far better than its trade-value ranking suggests.",
        overachiever.tiedWith,
      ),
      team: overachiever.team,
      value: `+${overachiever.team.rankDivergence} spots`,
    });
  }

  const underachiever = best((t) => (t.rankDivergence === null ? null : t.rankDivergence), "low");
  if (underachiever && (underachiever.team.rankDivergence ?? 0) < 0) {
    leaders.push({
      id: "underachiever",
      title: "Assets it cannot start",
      blurb: withTie(
        "Holds far more trade value than its lineup converts into wins.",
        underachiever.tiedWith,
      ),
      team: underachiever.team,
      value: `${underachiever.team.rankDivergence} spots`,
    });
  }

  return leaders;
}
