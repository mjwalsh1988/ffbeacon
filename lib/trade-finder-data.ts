/**
 * Everything Trade Finder needs about one league, read once.
 *
 * The engine is pure and knows nothing about Postgres. This is the seam: it
 * gathers rosters, values, projections, picks, ages, and the Competitor /
 * Rebuilder call, shapes them into the engine's plain input, and stops.
 *
 * READS ONLY, AND NEVER SYNCS. Every table here is one the league deep view has
 * already filled. A league nobody has opened comes back null, and the surface
 * says so rather than starting a Sleeper pull behind a button press that the
 * reader thought was a search.
 *
 * FORMAT IS THE LEAGUE'S, NOT THE READER'S. This sits under a league view, so it
 * goes through resolveLeagueContext like every other surface there: the format
 * comes from the league's own Sleeper scoring and the global format toggle is
 * ignored. Source stays the reader's. Picks fall back to KTC when the chosen
 * source does not publish them.
 *
 * WHY THE PROJECTION WINDOW IS SHORT
 *   Lineup impact is measured over the next few weeks rather than the whole
 *   remaining season. Two reasons, one honest and one practical. A trade's
 *   effect on your lineup is a question about the roster you have now, and
 *   sixteen weeks of projections for a player who will be waived in three is
 *   false precision. And the row count is the one thing here that scales with
 *   the season: a full slate for a twelve-team league is several thousand rows,
 *   most of which would be averaged into the same number the short window
 *   produces.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import type { SleeperLeague } from "@/lib/sleeper";
import { resolveLeagueContext } from "@/lib/league-format-resolution";
import { loadLeagueTeamCards, type TeamCardData } from "@/lib/league-view-data";
import { loadPowerPulseView } from "@/lib/league-power-pulse-data";
import { startingSlots } from "@/lib/power-pulse/lineup";
import { scoreWithFallback, type ScoringSettings } from "@/lib/league-scoring";
import { computeAgeDecimal } from "@/lib/player-age";
import type { FinderPick, FinderPlayer, FinderTeam } from "@/lib/trade-finder/types";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/** How many weeks ahead the lineup arithmetic looks. */
const WEEK_HORIZON = 6;

/** PostgREST pages at 1000 rows; projections blow past that in one league. */
const PAGE = 1000;

export type TradeFinderLeague = {
  leagueRowId: string;
  sleeperLeagueId: string;
  leagueName: string;
  season: number;
  /** The reader's own roster in this league. Null when we cannot identify them. */
  myRosterId: number | null;
  teams: FinderTeam[];
  startingSlots: string[];
  isDynasty: boolean;
  allowPicks: boolean;
  formatDisplay: string;
  sourceDisplay: string;
  /** Set when picks are valued by a different source than the players. */
  pickSourceDisplay: string | null;
  /** Top player value in this format and source, for the consolidation curve. */
  poolMax: number | null;
  /** The Sleeper league object, for the Signal Check grade. */
  sleeperLeague: SleeperLeague;
};

/** How the caller knows which roster belongs to the reader. */
export type RosterIdentity = {
  sleeperUserId?: string | null;
  username?: string | null;
  rosterId?: number | null;
};

function asStringArray(value: Json | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is string => typeof v === "string" && v.length > 0 && v !== "0",
  );
}

/**
 * Average projected points per week for each player, in this league's scoring.
 *
 * Averaged over the weeks Sleeper actually published rather than over the window
 * length, so a bye inside the window does not read as a week the player was
 * projected to score nothing. A player with no rows at all comes back absent,
 * and the engine treats that as unknown rather than as zero.
 */
async function loadProjectedPoints(
  supabase: AnySupabase,
  playerIds: string[],
  season: number,
  fromWeek: number,
  scoring: ScoringSettings,
  positionByPlayer: Map<string, string>,
): Promise<Map<string, number>> {
  const totals = new Map<string, { sum: number; weeks: number }>();
  if (playerIds.length === 0) return new Map();

  const toWeek = fromWeek + WEEK_HORIZON - 1;
  const CHUNK = 150;
  for (let i = 0; i < playerIds.length; i += CHUNK) {
    const chunk = playerIds.slice(i, i + CHUNK);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("player_weekly_projections")
        .select(
          "player_id, week, stat_line, projected_pts_ppr, projected_pts_half_ppr, projected_pts_std",
        )
        .eq("season", season)
        .eq("season_type", "regular")
        .gte("week", fromWeek)
        .lte("week", toWeek)
        .in("player_id", chunk)
        .range(from, from + PAGE - 1);
      if (error || !data || data.length === 0) break;

      for (const row of data) {
        if (!row.player_id) continue;
        const { points } = scoreWithFallback(
          (row.stat_line as Record<string, unknown> | null) ?? null,
          {
            ppr: row.projected_pts_ppr === null ? null : Number(row.projected_pts_ppr),
            half_ppr:
              row.projected_pts_half_ppr === null
                ? null
                : Number(row.projected_pts_half_ppr),
            std: row.projected_pts_std === null ? null : Number(row.projected_pts_std),
          },
          scoring,
          positionByPlayer.get(row.player_id) ?? null,
        );
        if (points === null || !Number.isFinite(points)) continue;
        const entry = totals.get(row.player_id) ?? { sum: 0, weeks: 0 };
        entry.sum += points;
        entry.weeks += 1;
        totals.set(row.player_id, entry);
      }
      if (data.length < PAGE) break;
    }
  }

  const out = new Map<string, number>();
  for (const [playerId, entry] of totals) {
    if (entry.weeks > 0) out.set(playerId, entry.sum / entry.weeks);
  }
  return out;
}

/** Birth dates for the rostered players, so the engine can reason about age. */
async function loadAges(
  supabase: AnySupabase,
  playerIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const CHUNK = 300;
  for (let i = 0; i < playerIds.length; i += CHUNK) {
    const chunk = playerIds.slice(i, i + CHUNK);
    const { data } = await supabase
      .from("players")
      .select("id, birth_date")
      .in("id", chunk);
    for (const row of data ?? []) {
      const age = computeAgeDecimal(row.birth_date);
      if (age !== null) out.set(row.id, age);
    }
  }
  return out;
}

/**
 * The most valuable player in this format and source.
 *
 * The consolidation curve needs a yardstick for "how big is this asset in the
 * grand scheme". Taken from the pool rather than from the league, because a
 * league where nobody happens to own an elite player would otherwise grade its
 * best available body as though it were one.
 */
async function loadPoolMax(
  supabase: AnySupabase,
  formatConfigId: string,
  source: string,
): Promise<number | null> {
  const { data } = await supabase
    .from("player_value_trends")
    .select("current_value")
    .eq("format_config_id", formatConfigId)
    .eq("source", source)
    .order("current_value", { ascending: false })
    .limit(1)
    .maybeSingle();
  const value = data?.current_value;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** Pick prices for one (format, source), keyed season|round|position. */
async function loadPickValues(
  supabase: AnySupabase,
  formatConfigId: string,
  source: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("draft_pick_values")
      .select("season, round, pick_position, value, captured_at")
      .eq("format_config_id", formatConfigId)
      .eq("source", source)
      .order("captured_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const row of data) {
      const key = `${row.season}|${row.round}|${row.pick_position}`;
      // Ordered newest first, so the first row for a key is the current price.
      if (!out.has(key)) out.set(key, Number(row.value));
    }
    if (data.length < PAGE) break;
  }
  return out;
}

const ROUND_LABEL: Record<number, string> = { 1: "1st", 2: "2nd", 3: "3rd" };

function pickLabel(season: number, round: number, position: string): string {
  const ordinal = ROUND_LABEL[round] ?? `${round}th`;
  const slot = position === "unknown" ? "" : ` (${position})`;
  return `${season} ${ordinal}${slot}`;
}

/** Which roster belongs to the reader, from whatever the caller knows. */
function resolveMyRosterId(
  teams: TeamCardData[],
  identity: RosterIdentity,
  ownerByRoster: Map<number, string | null>,
): number | null {
  if (identity.rosterId != null) {
    const hit = teams.find((t) => t.sleeperRosterId === identity.rosterId);
    if (hit) return hit.sleeperRosterId;
  }
  if (identity.sleeperUserId) {
    for (const [rosterId, ownerId] of ownerByRoster) {
      if (ownerId === identity.sleeperUserId) return rosterId;
    }
  }
  if (identity.username) {
    const wanted = identity.username.trim().toLowerCase();
    const hit = teams.find(
      (t) => (t.ownerSleeperUsername ?? "").trim().toLowerCase() === wanted,
    );
    if (hit) return hit.sleeperRosterId;
  }
  return null;
}

/**
 * Load one league into engine input.
 *
 * Returns null when the league has not been synced, when no source covers its
 * format, or when there are fewer than two rosters to trade between. Each of
 * those is a real state the surfaces render differently, so none of them throws.
 */
export async function loadTradeFinderLeague(
  supabase: AnySupabase,
  params: {
    sleeperLeagueId: string;
    sourceSlug: string | null;
    identity: RosterIdentity;
  },
): Promise<TradeFinderLeague | null> {
  const { data: league } = await supabase
    .from("leagues")
    .select(
      "id, sleeper_league_id, name, season, status, total_rosters, roster_positions, scoring_settings, metadata",
    )
    .eq("sleeper_league_id", params.sleeperLeagueId)
    .maybeSingle();
  if (!league) return null;

  const sleeperLeague = (league.metadata ?? {}) as unknown as SleeperLeague;
  const context = await resolveLeagueContext(
    supabase as SupabaseClient<Database>,
    sleeperLeague,
    params.sourceSlug,
  );
  if (context.coverage === "none" || !context.formatConfigId) return null;

  const season = Number(league.season);
  const isDynasty = context.derived.league_type === "dynasty";

  // Pick prices need only the format, so they are fetched alongside the rosters
  // rather than waiting behind them with the reads that need player ids.
  const [cards, pulseView, rosterRows, pickValues, poolMax] = await Promise.all([
    loadLeagueTeamCards(
      supabase,
      league.id,
      context.formatConfigId,
      context.sourceSlug,
      league.season != null ? String(league.season) : null,
      league.status ?? null,
      isDynasty,
    ),
    loadPowerPulseView(
      supabase,
      league.id,
      season,
      context.formatConfigId,
      context.sourceSlug,
    ),
    supabase
      .from("rosters")
      .select("sleeper_roster_id, owner_user_id, reserve_ids, taxi_ids")
      .eq("league_id", league.id),
    isDynasty
      ? loadPickValues(
          supabase,
          context.formatConfigId,
          context.pickSource?.slug ?? context.sourceSlug,
        )
      : Promise.resolve(new Map<string, number>()),
    loadPoolMax(supabase, context.formatConfigId, context.sourceSlug),
  ]);

  if (cards.length < 2) return null;

  const ownerByRoster = new Map<number, string | null>();
  const inactiveByRoster = new Map<number, Set<string>>();
  for (const row of rosterRows.data ?? []) {
    const rosterId = Number(row.sleeper_roster_id);
    ownerByRoster.set(rosterId, row.owner_user_id ?? null);
    inactiveByRoster.set(
      rosterId,
      new Set([...asStringArray(row.reserve_ids), ...asStringArray(row.taxi_ids)]),
    );
  }

  const myRosterId = resolveMyRosterId(cards, params.identity, ownerByRoster);

  // Everyone rostered anywhere in the league, resolved once.
  const allPlayerIds = new Set<string>();
  const positionByPlayer = new Map<string, string>();
  for (const card of cards) {
    for (const p of card.players) {
      allPlayerIds.add(p.id);
      positionByPlayer.set(p.id, p.position);
    }
  }
  const playerIds = [...allPlayerIds];

  // Projections start from the week after the last one Power Pulse has scored,
  // which is the first week a trade made today could affect.
  const fromWeek = pulseView ? Math.max(1, pulseView.throughWeek + 1) : 1;

  const [projected, ages] = await Promise.all([
    loadProjectedPoints(
      supabase,
      playerIds,
      season,
      fromWeek,
      (league.scoring_settings ?? {}) as ScoringSettings,
      positionByPlayer,
    ),
    loadAges(supabase, playerIds),
  ]);

  const pulseByRoster = new Map(
    (pulseView?.teams ?? []).map((t) => [t.sleeperRosterId, t]),
  );

  const teams: FinderTeam[] = cards.map((card) => {
    const inactive = inactiveByRoster.get(card.sleeperRosterId) ?? new Set<string>();
    const pulse = pulseByRoster.get(card.sleeperRosterId) ?? null;

    const players: FinderPlayer[] = card.players.map((p) => {
      const trend = card.trends[p.id];
      const value = trend ? Number(trend.current_value) : 0;
      const projPoints = projected.get(p.id);
      return {
        playerId: p.id,
        sleeperId: p.sleeper_id,
        name: p.full_name,
        position: (p.position ?? "").toUpperCase(),
        team: p.team,
        value,
        hasValue: Boolean(trend) && value > 0,
        age: ages.get(p.id) ?? null,
        projPoints: projPoints === undefined ? null : projPoints,
        isInactive: inactive.has(p.sleeper_id),
      };
    });

    const picks: FinderPick[] = isDynasty
      ? card.draftPicks.map((pick) => {
          const position = (pick.pick_position ?? "mid") as FinderPick["pickPosition"];
          const value =
            pickValues.get(`${pick.season}|${pick.round}|${position}`) ??
            pickValues.get(`${pick.season}|${pick.round}|mid`) ??
            0;
          return {
            key: `pick:${pick.season}:${pick.round}:${pick.original_roster_id}`,
            season: Number(pick.season),
            round: Number(pick.round),
            pickPosition: position,
            label: pickLabel(Number(pick.season), Number(pick.round), position),
            value,
            hasValue: value > 0,
          };
        })
      : [];

    return {
      rosterId: card.sleeperRosterId,
      teamName: card.teamName,
      ownerHandle: card.ownerSleeperUsername,
      statusKey: pulse?.status?.key ?? null,
      statusLabel: pulse?.status?.label ?? null,
      pulseRank: pulse?.pulseRank ?? null,
      valueRank: pulse?.valueRank ?? null,
      players,
      picks,
    };
  });

  return {
    leagueRowId: league.id,
    sleeperLeagueId: league.sleeper_league_id,
    leagueName: league.name,
    season,
    myRosterId,
    teams,
    startingSlots: startingSlots(asStringArray(league.roster_positions)),
    isDynasty,
    allowPicks: isDynasty,
    formatDisplay: context.formatDisplay,
    sourceDisplay: context.sourceDisplay,
    pickSourceDisplay:
      context.pickSource && context.pickSource.slug !== context.sourceSlug
        ? context.pickSource.display
        : null,
    poolMax,
    sleeperLeague,
  };
}

export const TRADE_FINDER_DATA_LIMITS = { WEEK_HORIZON };
