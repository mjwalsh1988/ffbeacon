/**
 * Every read for one start/sit board, in three waves so the header paints
 * before the numbers do (section 2.6 of docs/seo/who-should-i-start-and-site-seo-plan.md).
 *
 * Server only, matching lib/breakdown/load-extras.ts: an AnySupabase client
 * in, plain data out, nothing here throws.
 *
 * ONE MODEL, NOT TWO. Every number comes from a function Power Pulse,
 * Lineups, FAAB and Trade Ideas already use. Wave 2 is the one call this file
 * exists to make: loadAdjustedProjections (lib/projections/read.ts), which
 * resolves the projection source, loads accuracy and defensive splits scoped
 * to that SAME source, and runs projectPlayerWeek per player. That is the
 * shared read path both lib/projections/source-guard.test.ts and
 * lib/projections/raw-column-guard.test.ts exist to protect, so this module
 * needs no allow-list entry in either: it never calls loadProjections or
 * loadAccuracy directly, and it never selects a projected_pts_* column.
 *
 * PROJECTION SOURCE CONTRACT. `projectionSource` on the returned board is the
 * slug loadAdjustedProjections actually resolved to, never a hardcoded word
 * and never lib/projections/current-source.ts currentProjectionSourceCached()
 * (a different question: "what season do we hold", pinned to Sleeper by
 * design). The two direct reads of player_weekly_projections this file makes
 * (availability per candidate, and the freshest updated_at for the header
 * timestamp) are both filtered to that resolved source, and select no
 * projected_pts_* column, so the raw-column guard has nothing to catch here.
 *
 * TWO ROUTES INTO FORMAT AND SOURCE. The page resolves format/source through
 * the site header's normal chain (resolveFormatSlug / resolveSourceSlug
 * against the raw ?format= and ?source= params, exactly like
 * lib/beacon-breakdown.ts loadBreakdown), so it passes formatParam /
 * sourceParam. The OG route (section 2.10) already knows the exact slug it
 * wants baked into the image, so it passes formatSlug / sourceSlug directly
 * and this file skips the resolver chain entirely. An explicit slug always
 * wins when both are supplied.
 *
 * BYE DETECTION. A candidate's week can be absent from loadAdjustedProjections'
 * output for three different reasons (a bye, an unpublished week, an
 * unprojectable position), and a null is the same absence in every one of
 * them; this file does not need to tell them apart to rank correctly. It DOES
 * need to tell "on bye" apart from "not published yet" for the card's own
 * copy ("On bye" replaces the whole projection block; an unpublished week
 * gets a different sentence). loadGameEnvironment reads whatever
 * nfl_game_odds already holds for the week, which is normally just the
 * current slate: the odds sync has not necessarily reached a future week the
 * week select still offers, so an empty or partial map means "not fetched
 * yet", not "nobody plays this week". detectOnBye therefore only trusts an
 * absence once the map looks like a COMPLETE slate (at least
 * MIN_COMPLETE_SLATE_TEAMS distinct teams), and only when the same player
 * also has no projected points for the week, which guards against a team-code
 * mismatch between players.team and the odds table (see detectOnBye's own
 * comment). A team present in the map with no implied total yet is "no line
 * published", a different and unrelated absence.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { closestScoringBase, scoringSettingsForFormat } from "@/lib/league-scoring";
import { resolveFormatSlug, resolveSourceSlug } from "@/lib/preferences";
import { readSleeperId, sleeperMeta, type PlayerRow } from "@/lib/player-profile";
import { getActiveFormats } from "@/lib/source";
import { loadAdjustedProjections, type AdjustedProjectionSummary } from "@/lib/projections/read";
import { SLEEPER_SOURCE } from "@/lib/projections/source-constants";
import { loadDefenseRanks, type DefenseRank } from "@/lib/power-pulse/load";
import { PULSE_POSITIONS } from "@/lib/power-pulse/types";
import {
  loadGameEnvironment,
  environmentTier,
  EMPTY_GAME_ENVIRONMENT,
  type GameEnvironment,
  type GameEnvironmentWeek,
} from "@/lib/nfl-game-environment";
import { normalizeEspnTeam } from "@/lib/nfl-odds";
import { resolveSeasonClock } from "@/lib/start-sit/clock";
import { clampStartCount } from "@/lib/start-sit/rank";
import {
  MAX_START_SIT_PLAYERS,
  DEFAULT_START_COUNT,
  type StartSitCandidate,
  type StartSitProjection,
  type PulsePosition,
} from "@/lib/start-sit/types";

type AnySupabase =
  | SupabaseClient<Database>
  | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/**
 * Mirrors lib/beacon-breakdown.ts's private PLAYER_SELECT (that file is
 * outside this task's scope, so the column list is duplicated here rather
 * than importing an unexported constant). Keep the two in step by hand.
 */
const PLAYER_SELECT =
  "id, slug, first_name, last_name, full_name, position, team, status, birth_date, external_ids, metadata, years_experience";

/** Sleeper publishes an 18-week regular season. Own copy, matching clock.ts and load-extras.ts. */
const MAX_REGULAR_SEASON_WEEK = 18;

/**
 * The fewest distinct teams the week's game environment map can hold and
 * still be trusted as a COMPLETE slate. Up to 6 of the league's 32 teams sit
 * out on the heaviest bye weeks, so a fully fetched regular season week never
 * drops below 32 - 6 = 26 teams. Below this count the odds sync simply has
 * not reached this week yet (see the BYE DETECTION note above), so an absent
 * team is "not fetched", not "on bye".
 */
export const MIN_COMPLETE_SLATE_TEAMS = 26;

/**
 * The format row shape, structured so `scoringSettingsForFormat(board.format)`
 * works directly: `scoring_type` and `te_premium_bonus` keep the snake_case
 * names that function's FormatScoringInput reads, rather than being renamed
 * to camelCase like the rest of this file's output.
 */
export type StartSitFormat = {
  slug: string;
  display: string;
  formatConfigId: string | null;
  scoring_type: string;
  te_premium_bonus: number | null;
};

/** A requested slug whose player exists but plays a position this tool does not evaluate. */
export type StartSitRefusedPlayer = {
  slug: string;
  name: string;
  position: string;
};

export type StartSitBoard = {
  /**
   * Null only when no source holds a single player_weekly_projections row
   * for any season (an empty database). Every other field below is still
   * well-formed in that case: empty candidates, empty projections, every
   * requested slug lost either to notFoundSlugs or nowhere (players table
   * may still resolve them) so the page can say plainly that nothing can be
   * evaluated yet rather than guessing at a season.
   */
  season: number | null;
  /** The week this board evaluates, already resolved (see resolveBoardWeek). */
  week: number;
  /** The live week, one past the newest completed game. */
  currentWeek: number;
  /** currentWeek..18 inclusive, for the week select. Empty once the season is over. */
  remainingWeeks: number[];
  format: StartSitFormat;
  /** The value source slug (site header chip). Drives the Market tab only, never the verdict. */
  sourceSlug: string | null;
  /** The RESOLVED projection source, from the same read that produced every number below. */
  projectionSource: string;
  /** Freshest player_weekly_projections.updated_at for this source and week, across every player. Null with no rows yet. */
  updatedAt: string | null;
  /** ?start=K, clamped into 1..N-1 by lib/start-sit/rank.ts clampStartCount. */
  startCount: number;
  candidates: StartSitCandidate[];
  /** One entry per candidate, same order. */
  projections: StartSitProjection[];
  /** Requested slugs that matched no active player. */
  notFoundSlugs: string[];
  /** Requested slugs that matched a player outside QB/RB/WR/TE/K/DEF. */
  refusedPlayers: StartSitRefusedPlayer[];
};

export type LoadStartSitBoardParams = {
  supabase: AnySupabase;
  /** Raw ?p= slugs (already split on commas by the caller), in the reader's add order. */
  slugs: string[];
  /** Raw ?week= value. */
  weekParam?: string | string[] | undefined;
  /** Raw ?start= value. */
  startParam?: string | string[] | undefined;
  /** Explicit format slug, already resolved by the caller (the OG route). Wins over formatParam. */
  formatSlug?: string;
  /** Explicit source slug, already resolved by the caller (the OG route). Wins over sourceParam. */
  sourceSlug?: string;
  /** Raw ?format= value, resolved through the normal site-header chain when formatSlug is absent. */
  formatParam?: string | string[];
  /** Raw ?source= value, resolved through the normal site-header chain when sourceSlug is absent. */
  sourceParam?: string | string[];
};

/* ------------------------------------------------------------------ */
/* Pure helpers. Exported so load.test.ts can exercise them without a DB. */
/* ------------------------------------------------------------------ */

/**
 * Dedupe preserving the reader's add order, then cap at MAX_START_SIT_PLAYERS.
 * Blank entries (a stray comma in ?p=) are dropped rather than counted.
 */
export function normalizeStartSitSlugs(rawSlugs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of rawSlugs) {
    const slug = raw.trim();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
    if (out.length >= MAX_START_SIT_PLAYERS) break;
  }
  return out;
}

/**
 * ?week=W, falling back to the live week when W is missing, unparseable, or
 * outside currentWeek..maxWeek. A played week is refused here: the reader
 * cannot ask this board to grade the past (that is the Decisions page's
 * question), and a future week beyond the regular season has no projections.
 */
export function resolveBoardWeek(
  weekParam: string | string[] | undefined,
  currentWeek: number,
  maxWeek: number = MAX_REGULAR_SEASON_WEEK,
): number {
  const candidate = Array.isArray(weekParam) ? weekParam[0] : weekParam;
  const parsed = candidate ? Number.parseInt(candidate, 10) : NaN;
  if (!Number.isFinite(parsed)) return currentWeek;
  if (parsed < currentWeek || parsed > maxWeek) return currentWeek;
  return parsed;
}

/** currentWeek..maxWeek inclusive. Empty once the regular season has finished. */
export function remainingWeeksFrom(
  currentWeek: number,
  maxWeek: number = MAX_REGULAR_SEASON_WEEK,
): number[] {
  const out: number[] = [];
  for (let week = currentWeek; week <= maxWeek; week += 1) out.push(week);
  return out;
}

/** ?start=K as an integer, defaulting to DEFAULT_START_COUNT on anything unparseable. */
export function parseStartCountParam(input: string | string[] | undefined): number {
  const candidate = Array.isArray(input) ? input[0] : input;
  if (!candidate) return DEFAULT_START_COUNT;
  const parsed = Number.parseInt(candidate, 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_START_COUNT;
}

/** "DST" is folded into "DEF" (players.position spelling); anything else outside the six is refused. */
export function normalizeCandidatePosition(position: string): PulsePosition | null {
  const upper = position.trim().toUpperCase();
  const mapped = upper === "DST" ? "DEF" : upper;
  return (PULSE_POSITIONS as readonly string[]).includes(mapped) ? (mapped as PulsePosition) : null;
}

/** floor = max(0, points - sigma), ceiling = points + sigma. Either null propagates both to null. */
export function floorCeiling(
  points: number | null,
  sigma: number | null,
): { floor: number | null; ceiling: number | null } {
  if (points === null || sigma === null) return { floor: null, ceiling: null };
  return { floor: Math.max(0, points - sigma), ceiling: points + sigma };
}

/**
 * A player is on bye only when all three hold: the week's slate is complete
 * (the map holds at least MIN_COMPLETE_SLATE_TEAMS teams, so its absences
 * mean something), his team is absent from it, and he still has no projected
 * points for the week.
 *
 * WHY THIS STRICT. loadGameEnvironment's map is built from whatever
 * nfl_game_odds already holds, which is normally just the current slate. On
 * a week the odds sync has not reached yet, the map can be empty or partial,
 * and every requested player's team would read as absent; without the
 * slate-size guard that called every player on bye and told the card to sit
 * every one of them, on any week the sync had not caught up to. The points
 * check is a second, independent guard against a team-code mismatch between
 * players.team and the map's keys (nfl-odds.ts carries a WSH/WAS alias, so a
 * mismatch is a real possibility, not a hypothetical): a player who somehow
 * still has a real projection for a "missing" team is not on bye, he just
 * has no game-environment row yet, so his card keeps its projection instead
 * of being told he does not play. Only when the slate is complete, the team
 * is genuinely absent, AND there is no projection either does the absence
 * mean a bye; any other combination leaves onBye false and the player shows
 * as having no projection published yet, which is the honest answer.
 *
 * A player with no team on file (should not happen for the six evaluated
 * positions) is never called on bye.
 */
export function detectOnBye(
  team: string | null,
  byTeam: Map<string, GameEnvironment>,
  points: number | null,
): boolean {
  if (!team) return false;
  if (byTeam.size < MIN_COMPLETE_SLATE_TEAMS) return false;
  if (byTeam.has(normalizeEspnTeam(team))) return false;
  return points === null;
}

function playerDisplayName(row: PlayerRow): string {
  const full = row.full_name?.trim();
  if (full) return full;
  const combined = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
  return combined.length > 0 ? combined : row.slug;
}

/** Sleeper's injury designation off players.metadata.sleeper, or null when healthy. Mirrors lib/beacon-breakdown.ts's private injuryStatusFor. */
function injuryStatusFrom(row: PlayerRow): string | null {
  const meta = sleeperMeta(row);
  const raw = meta.injury_status;
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

/**
 * Load everything one start/sit board needs, in three waves.
 *
 * Never throws: every read that can fail degrades to an empty result the
 * same way lib/breakdown/load-extras.ts and lib/nfl-game-environment.ts do,
 * because a start/sit board should still render with fewer reasons rather
 * than not render at all.
 */
export async function loadStartSitBoard(params: LoadStartSitBoardParams): Promise<StartSitBoard> {
  const db = params.supabase as SupabaseClient<Database>;
  const normalizedSlugs = normalizeStartSitSlugs(params.slugs);

  /* ---- Wave 1: the season clock, the players, the format and the value source. ---- */
  const [clock, playersRes, activeFormats, formatResolution, sourceResolution] = await Promise.all([
    resolveSeasonClock(db),
    normalizedSlugs.length > 0
      ? db.from("players").select(PLAYER_SELECT).in("slug", normalizedSlugs)
      : Promise.resolve({ data: [] as unknown[] }),
    getActiveFormats(db),
    params.formatSlug
      ? Promise.resolve({ slug: params.formatSlug })
      : resolveFormatSlug(db, params.formatParam),
    params.sourceSlug
      ? Promise.resolve({ slug: params.sourceSlug as string | null })
      : resolveSourceSlug(db, params.sourceParam),
  ]);

  const formatConfig = activeFormats.find((f) => f.slug === formatResolution.slug) ?? null;
  const format: StartSitFormat = {
    slug: formatResolution.slug,
    display: formatConfig?.display_name ?? formatResolution.slug,
    formatConfigId: formatConfig?.id ?? null,
    // A format slug the active list does not recognise (a stale link, a typo)
    // falls back to plain PPR scoring rather than failing the whole board.
    scoring_type: formatConfig?.scoring_type ?? "ppr",
    te_premium_bonus: formatConfig?.te_premium_bonus ?? null,
  };
  const sourceSlug = sourceResolution.slug;

  const bySlug = new Map<string, PlayerRow>();
  for (const row of (playersRes.data ?? []) as unknown as PlayerRow[]) {
    bySlug.set(row.slug, row);
  }

  const candidates: StartSitCandidate[] = [];
  const notFoundSlugs: string[] = [];
  const refusedPlayers: StartSitRefusedPlayer[] = [];

  for (const slug of normalizedSlugs) {
    const row = bySlug.get(slug);
    if (!row) {
      notFoundSlugs.push(slug);
      continue;
    }
    const position = normalizeCandidatePosition(row.position);
    const name = playerDisplayName(row);
    if (!position) {
      refusedPlayers.push({ slug, name, position: row.position });
      continue;
    }
    candidates.push({
      playerId: row.id,
      slug: row.slug,
      sleeperId: readSleeperId(row),
      name,
      position,
      team: row.team,
      injuryStatus: injuryStatusFrom(row),
    });
  }

  const currentWeek = clock.currentWeek;
  const remainingWeeks = remainingWeeksFrom(currentWeek);
  const week = resolveBoardWeek(params.weekParam, currentWeek);
  const startCount = clampStartCount(parseStartCountParam(params.startParam), candidates.length);

  const scoringSettings = scoringSettingsForFormat(format);
  const scoringBase = closestScoringBase(scoringSettings);
  const playerIds = candidates.map((c) => c.playerId);
  const positionByPlayer = new Map(candidates.map((c) => [c.playerId, c.position]));
  const injuryByPlayer = new Map(candidates.map((c) => [c.playerId, c.injuryStatus]));

  /* ---- Wave 2: the shared adjusted-projection read for the one selected week. ---- */
  // RATE LIMIT SEAM. The base board is uncapped past the MAX_START_SIT_PLAYERS
  // guard (section 2.6, "Rate limiting"). If load testing later shows the
  // Sunday-morning peak needs one, claimRateLimitSlot (lib/rate-limit-claim.ts)
  // goes here, after validation and before this wave, failing to a visible
  // "busy" state the way the Lineups free-agent panel does.
  let projectionSource = SLEEPER_SOURCE;
  let byPlayer = new Map<string, AdjustedProjectionSummary>();
  if (clock.season != null && playerIds.length > 0) {
    const result = await loadAdjustedProjections({
      supabase: db,
      playerIds,
      season: clock.season,
      fromWeek: week,
      toWeek: week,
      scoringSettings,
      positionByPlayer,
      injuryByPlayer,
      currentWeek,
    });
    projectionSource = result.source;
    byPlayer = result.byPlayer;
  }

  /* ---- Wave 3: game environment, defense ranks, availability and the freshness timestamp, in parallel. ---- */
  const [gameEnv, defenseRanks, availabilityRes, freshestRes] = await Promise.all([
    clock.season != null
      ? loadGameEnvironment(db, clock.season, week)
      : Promise.resolve<GameEnvironmentWeek>(EMPTY_GAME_ENVIRONMENT),
    clock.season != null
      ? loadDefenseRanks(db, scoringBase, clock.season)
      : Promise.resolve(new Map<string, DefenseRank>()),
    clock.season != null && playerIds.length > 0
      ? db
          .from("player_weekly_projections")
          .select("player_id, availability, updated_at")
          .eq("season", clock.season)
          .eq("season_type", "regular")
          .eq("week", week)
          .eq("source", projectionSource)
          .in("player_id", playerIds)
      : Promise.resolve({ data: [] as { player_id: string | null; availability: string }[] }),
    clock.season != null
      ? db
          .from("player_weekly_projections")
          .select("updated_at")
          .eq("season", clock.season)
          .eq("season_type", "regular")
          .eq("week", week)
          .eq("source", projectionSource)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null as { updated_at: string } | null }),
  ]);

  const availabilityByPlayer = new Map<string, "projected" | "out">();
  for (const row of availabilityRes.data ?? []) {
    if (!row.player_id) continue;
    availabilityByPlayer.set(row.player_id, row.availability === "out" ? "out" : "projected");
  }
  const updatedAt = freshestRes.data?.updated_at ?? null;

  const projections: StartSitProjection[] = candidates.map((candidate) => {
    const summary = byPlayer.get(candidate.playerId);
    const weekData = summary?.byWeek.get(week);
    const points = weekData?.points ?? null;
    const sigma = weekData?.sigma ?? null;
    const { floor, ceiling } = floorCeiling(points, sigma);
    const opponent = weekData?.opponent ?? null;
    const defenseRank: DefenseRank | null = opponent
      ? defenseRanks.get(`${opponent.trim().toUpperCase()}|${candidate.position}`) ?? null
      : null;
    const environment = candidate.team
      ? gameEnv.byTeam.get(candidate.team.trim().toUpperCase()) ?? null
      : null;
    const onBye = detectOnBye(candidate.team, gameEnv.byTeam, points);

    return {
      playerId: candidate.playerId,
      week,
      points,
      rawPoints: weekData?.rawPoints ?? null,
      sigma,
      floor,
      ceiling,
      opponent,
      opponentMultiplier: weekData?.opponentMultiplier ?? null,
      defenseRankVsPosition: defenseRank?.rank ?? null,
      // AdjustedProjection calls this weeksPlayed; StartSitProjection calls
      // the same figure weeksGraded (section 2.6's StartSitProjection shape).
      beatRate: weekData?.beatRate ?? null,
      availabilityRate: weekData?.availabilityRate ?? null,
      weeksGraded: weekData?.weeksPlayed ?? 0,
      environment,
      environmentTier: environment ? environmentTier(environment.impliedTotal, gameEnv.average) : null,
      onBye,
      availability: availabilityByPlayer.get(candidate.playerId) ?? null,
    };
  });

  return {
    season: clock.season,
    week,
    currentWeek,
    remainingWeeks,
    format,
    sourceSlug,
    projectionSource,
    updatedAt,
    startCount,
    candidates,
    projections,
    notFoundSlugs,
    refusedPlayers,
  };
}
