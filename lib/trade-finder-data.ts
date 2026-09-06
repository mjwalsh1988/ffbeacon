/**
 * Everything Trade Finder needs about one league, read once.
 *
 * The engine is pure and knows nothing about Postgres. This is the seam: it
 * gathers rosters, values, projections, picks, ages, and the Contender /
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
import { getNflState, type SleeperLeague } from "@/lib/sleeper";
import { resolveCurrentWeek } from "@/lib/league-matchups";
import { resolveLeagueContext } from "@/lib/league-format-resolution";
import { buildPickPositionResolver, NO_PICK_POSITIONS } from "@/lib/league-pick-position";
import { formatPickLabel } from "@/lib/trade-ideas/pick-label";
import { loadLeagueTeamCards, type TeamCardData } from "@/lib/league-view-data";
import { loadPowerPulseView } from "@/lib/league-power-pulse-data";
import { pulseSnapshotFor } from "@/lib/trade-finder/pulse";
import { startingSlots } from "@/lib/power-pulse/lineup";
import { formatTeamLabel } from "@/lib/team-label";
import { type ScoringSettings } from "@/lib/league-scoring";
import { loadAdjustedProjections } from "@/lib/projections/read";
import { computeAgeDecimal } from "@/lib/player-age";
import type { FinderPick, FinderPlayer, FinderTeam } from "@/lib/trade-finder/types";
import {
  matchViewerRoster,
  type ViewerCandidate,
} from "@/lib/league-viewer";

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
 * Average ADJUSTED projected points per week for each player, in this
 * league's scoring.
 *
 * Routed through lib/projections/read.ts loadAdjustedProjections rather than
 * scored straight off the raw Sleeper column, so a suggested package is
 * priced with the same opponent-strength, reliability, availability and
 * injury adjustments lib/trade-impact/evaluate.ts already runs through its
 * Monte Carlo for the impact verdict on this same page. Before this, the two
 * numbers on one screen came from two different models.
 *
 * Averaged over the weeks that actually carried a projection rather than over
 * the window length, so a bye inside the window does not read as a week the
 * player was projected to score nothing. A player with no rows at all comes
 * back absent, and the engine treats that as unknown rather than as zero.
 *
 * Trade Finder does not currently load each player's Sleeper injury_status
 * (lib/league-view-data.ts's player select omits it), so no injury map is
 * passed here; loadAdjustedProjections treats an absent one as "everyone
 * healthy", the same default the injury multiplier itself falls back to.
 */
async function loadProjectedPoints(
  supabase: AnySupabase,
  playerIds: string[],
  season: number,
  fromWeek: number,
  scoring: ScoringSettings,
  positionByPlayer: Map<string, string>,
  currentWeek: number,
): Promise<Map<string, number>> {
  if (playerIds.length === 0) return new Map();

  const { byPlayer } = await loadAdjustedProjections({
    supabase,
    playerIds,
    season,
    fromWeek,
    toWeek: fromWeek + WEEK_HORIZON - 1,
    scoringSettings: scoring,
    positionByPlayer,
    currentWeek,
  });

  const out = new Map<string, number>();
  for (const [playerId, summary] of byPlayer) {
    if (summary.perWeek !== null) out.set(playerId, summary.perWeek);
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


/**
 * Which roster belongs to the reader, from whatever the caller knows.
 *
 * Delegates to `matchViewerRoster`, which is the one implementation of this
 * precedence (explicit roster, then Sleeper user id, then co-owner id, then
 * display name). It used to be hand-rolled here, agreeing with the canonical
 * rule by coincidence and with a comment that already named it as canonical.
 */
function resolveMyRosterId(
  teams: TeamCardData[],
  identity: RosterIdentity,
  ownerByRoster: Map<number, string[]>,
): number | null {
  const candidates: ViewerCandidate[] = teams.map((t) => {
    const owners = ownerByRoster.get(t.sleeperRosterId) ?? [];
    return {
      sleeperRosterId: t.sleeperRosterId,
      ownerSleeperUsername: t.ownerSleeperUsername,
      // The first entry is rosters.owner_user_id, the rest are co_owners.
      ownerSleeperUserId: owners[0] ?? null,
      coOwnerIds: owners.slice(1),
    };
  });
  return matchViewerRoster(
    candidates,
    identity.username,
    identity.rosterId,
    identity.sleeperUserId,
  );
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
  const [cards, pulseView, rosterRows, pickValues, poolMax, pickPositions] = await Promise.all([
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
      .select("sleeper_roster_id, owner_user_id, co_owners, reserve_ids, taxi_ids")
      .eq("league_id", league.id),
    isDynasty
      ? loadPickValues(
          supabase,
          context.formatConfigId,
          context.pickSource?.slug ?? context.sourceSlug,
        )
      : Promise.resolve(new Map<string, number>()),
    loadPoolMax(supabase, context.formatConfigId, context.sourceSlug),
    isDynasty
      ? buildPickPositionResolver(supabase as SupabaseClient<Database>, league.id)
      : Promise.resolve(NO_PICK_POSITIONS),
  ]);

  if (cards.length < 2) return null;

  // Owner AND co-owners. A co-owner is an owner for the purpose of "which team
  // is mine", and omitting them found a co-owner's team on the league overview
  // and not here. lib/league-viewer.ts matchViewerRoster is the canonical rule.
  const ownerByRoster = new Map<number, string[]>();
  const inactiveByRoster = new Map<number, Set<string>>();
  for (const row of rosterRows.data ?? []) {
    const rosterId = Number(row.sleeper_roster_id);
    const owners = [
      row.owner_user_id,
      ...(Array.isArray(row.co_owners) ? row.co_owners : []),
    ].filter((id): id is string => typeof id === "string" && id.length > 0);
    ownerByRoster.set(rosterId, owners);
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

  // For the injury multiplier's week-to-week discount, matching how
  // lib/league-power-pulse.ts resolves the same value: Sleeper's own NFL
  // state clamped into the league's regular season, so the preseason and
  // offseason both resolve to week 1 rather than an empty remaining slate.
  const nflState = await getNflState();
  const rawPlayoffWeekStart = Number(sleeperLeague.settings?.playoff_week_start);
  const playoffWeekStart =
    Number.isFinite(rawPlayoffWeekStart) && rawPlayoffWeekStart > 0
      ? rawPlayoffWeekStart
      : 15;
  const currentWeek = resolveCurrentWeek(nflState, season, playoffWeekStart);

  const [projected, ages] = await Promise.all([
    loadProjectedPoints(
      supabase,
      playerIds,
      season,
      fromWeek,
      (league.scoring_settings ?? {}) as ScoringSettings,
      positionByPlayer,
      currentWeek,
    ),
    loadAges(supabase, playerIds),
  ]);

  const pulseByRoster = new Map(
    (pulseView?.teams ?? []).map((t) => [t.sleeperRosterId, t]),
  );

  // Every team's weekly means and spreads, indexed once. The sensitivity of a
  // matchup needs both sides of it, and rebuilding this per team would be the
  // same walk twelve times over.
  const weeklyByRoster = new Map<number, Map<number, { mean: number; sigma: number }>>();
  for (const t of pulseView?.teams ?? []) {
    const byWeek = new Map<number, { mean: number; sigma: number }>();
    for (const week of t.weekly) byWeek.set(week.week, { mean: week.mean, sigma: week.sigma });
    weeklyByRoster.set(t.sleeperRosterId, byWeek);
  }

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
          const originalRosterId = Number(pick.original_roster_id);
          // A roster's own future picks carry no slot, and defaulting them all
          // to "mid" priced a contender's 1st and a bottom team's 1st the same.
          // The published draft order answers first, the projected finish of the
          // pick's ORIGINAL team second, "mid" only when neither can.
          const placed = pickPositions.resolve(originalRosterId, Number(pick.season));
          const position = (pick.pick_position ??
            placed?.position ??
            "mid") as FinderPick["pickPosition"];
          const value =
            pickValues.get(`${pick.season}|${pick.round}|${position}`) ??
            pickValues.get(`${pick.season}|${pick.round}|mid`) ??
            0;
          // Who it came from, in the same preference order the team card uses:
          // handle, then team name. Both read off the card, which already
          // carries the whole league's lookup for exactly this purpose.
          const isOwnPick = originalRosterId === card.sleeperRosterId;
          const shape = {
            season: Number(pick.season),
            round: Number(pick.round),
            pickPosition: position,
            originalRosterId,
            isOwnPick,
            originalOwnerHandle: isOwnPick
              ? null
              : (card.rosterIdToOwnerUsername[originalRosterId] ?? null),
            originalTeamName: isOwnPick
              ? null
              : (card.rosterIdToTeamName[originalRosterId] ?? null),
          };
          return {
            // Keyed on the ORIGINAL roster, not on season and round. A roster in
            // a real league holds nine different 2027 1sts; without this they
            // are one asset with one value and eight of them cannot be traded.
            key: `pick:${pick.season}:${pick.round}:${originalRosterId}`,
            ...shape,
            // A published draft order is a fact. A projected finish is not, and
            // the label says which one answered.
            positionEstimated: pick.pick_position ? false : (placed?.estimated ?? true),
            label: formatPickLabel(shape),
            value,
            hasValue: value > 0,
          };
        })
      : [];

    return {
      rosterId: card.sleeperRosterId,
      // Paired here rather than in the engine, because every suggestion the
      // engine writes drops this straight into a sentence and a bare team name
      // is the half that goes stale.
      teamName: formatTeamLabel({
        teamName: card.teamName,
        username: card.ownerSleeperUsername,
        sleeperRosterId: card.sleeperRosterId,
      }),
      ownerHandle: card.ownerSleeperUsername,
      statusKey: pulse?.status?.key ?? null,
      // The prose form, because every consumer of this field puts it after an
      // indefinite article ("they read as a ___"). "a Bubble" is not a sentence
      // and "a Bubble team" is. The tag itself renders from `status` directly.
      statusLabel: pulse?.status?.phrase ?? null,
      pulseRank: pulse?.pulseRank ?? null,
      valueRank: pulse?.valueRank ?? null,
      // Null rather than a zeroed object on a league Power Pulse has not
      // scored. The engine leans on this to decide how much a deal is worth
      // to THIS team, and a fabricated zero would tell it every trade is
      // worth nothing on the field.
      // Power Pulse's own headline figures (projected wins, playoff odds) are
      // deliberately not carried across. Nothing in the engine reads them and
      // they are already on the Power Pulse page; a field kept in case
      // somebody wants it later is a field nobody can tell is stale.
      pulse: pulse ? pulseSnapshotFor(pulse.weekly, weeklyByRoster) : null,
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
