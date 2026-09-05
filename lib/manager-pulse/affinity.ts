/**
 * Manager Pulse: who they like (section 6.4).
 *
 * PURE. No Supabase, no fetch, no React, no Date.now(). Takes a
 * `ManagerPulseInput` and returns a plain `ManagerAffinity`.
 *
 * WHAT THIS MEASURES
 *   Exposure: how many distinct league-seasons a manager rostered a player in,
 *   weighted by how deliberately they got him. A drafted player is a
 *   statement; a waiver add is a hole filled. Favourites rank exposure
 *   against how commonly the player is rostered generally, so a universally
 *   owned player never reads as a preference. Avoids are the mirror image,
 *   gated by an opportunity requirement so an absence only counts when the
 *   manager actually had the chance. Repeat drafts are the loudest signal of
 *   all and get their own list.
 *
 * POOLED ACROSS DYNASTY AND REDRAFT, DELIBERATELY
 *   Section 6.0's "never pool a value-priced figure" rule does not apply
 *   here: exposure and repeat-draft counts are not priced in league value,
 *   they are a count of deliberate choices about a player. "Who this person
 *   likes" is a fact about the manager, not a figure on a value scale, so it
 *   is computed once across every league-season in the window regardless of
 *   `category`.
 */

import type {
  ManagerAffinity,
  PlayerExposure,
  RepeatDraftEntry,
} from "./types";
import type {
  ManagerDraftPick,
  ManagerMove,
  ManagerPlayerFacts,
  ManagerPulseInput,
  ManagerTrade,
} from "./input-types";

/**
 * Acquisition weights, most deliberate first. The ORDERING is the claim, not
 * the exact numbers: a draft pick spent inside the early-round cutoff is the
 * single most deliberate way to acquire a player (a manager passed on every
 * other player at that spot), a trade is next (something real was given up
 * for him specifically), a late-round pick and a waiver claim sit below that,
 * and a free-agent add (no waiver process, first come first served) is the
 * least deliberate route onto a roster. These are deliberately coarse: we are
 * not claiming a trade is "exactly 33% more deliberate" than a waiver claim,
 * only that it ranks above one.
 */
const WEIGHT_DRAFTED_EARLY = 3.0;
const WEIGHT_DRAFTED_LATE = 1.5;
const WEIGHT_TRADED_FOR = 2.0;
const WEIGHT_WAIVER_CLAIM = 1.0;
const WEIGHT_FREE_AGENT_ADD = 0.75;

/** One (league, season) pair, used to key a manager's roster window. */
type LeagueSeasonKey = string;

function leagueSeasonKey(sleeperLeagueId: string, season: number): LeagueSeasonKey {
  return `${sleeperLeagueId}::${season}`;
}

/**
 * The highest acquisition weight this player earned in ONE league-season,
 * from drafts, trades, and non-trade moves (waiver claims and free-agent
 * adds). A player touched by more than one route in the same league-season
 * counts once, at the best route: adding the weights would let a manager who
 * drafted a player, cut him, and re-added him off waivers look twice as keen
 * as one who simply kept him, which rewards roster churn rather than
 * preference.
 */
function bestWeightPerLeagueSeason(
  input: ManagerPulseInput,
): Map<string, Map<LeagueSeasonKey, number>> {
  const byPlayer = new Map<string, Map<LeagueSeasonKey, number>>();

  function record(playerId: string, key: LeagueSeasonKey, weight: number) {
    let seasons = byPlayer.get(playerId);
    if (!seasons) {
      seasons = new Map();
      byPlayer.set(playerId, seasons);
    }
    const existing = seasons.get(key);
    if (existing === undefined || weight > existing) {
      seasons.set(key, weight);
    }
  }

  const earlyRoundCutoff = input.settings.draft.earlyRoundCutoff;

  for (const pick of input.picks as ManagerDraftPick[]) {
    if (!pick.playerId || pick.isKeeper) continue;
    const key = leagueSeasonKey(pick.sleeperLeagueId, pick.season);
    const isEarly = pick.round !== null && pick.round <= earlyRoundCutoff;
    record(pick.playerId, key, isEarly ? WEIGHT_DRAFTED_EARLY : WEIGHT_DRAFTED_LATE);
  }

  for (const trade of input.trades as ManagerTrade[]) {
    const key = leagueSeasonKey(trade.sleeperLeagueId, trade.season);
    for (const playerId of trade.incomingPlayerIds) {
      record(playerId, key, WEIGHT_TRADED_FOR);
    }
  }

  for (const move of input.moves as ManagerMove[]) {
    if (move.kind === "trade" || move.kind === "commissioner") continue;
    const key = leagueSeasonKey(move.sleeperLeagueId, move.season);
    const weight = move.kind === "waiver" ? WEIGHT_WAIVER_CLAIM : WEIGHT_FREE_AGENT_ADD;
    for (const playerId of move.addedPlayerIds) {
      record(playerId, key, weight);
    }
  }

  return byPlayer;
}

type ExposureTotals = {
  exposureScore: number;
  leagueSeasonsRostered: number;
};

/** Sum the best-per-league-season weights into one exposure score per player. */
function totalExposure(byPlayer: Map<string, Map<LeagueSeasonKey, number>>): Map<string, ExposureTotals> {
  const totals = new Map<string, ExposureTotals>();
  for (const [playerId, seasons] of byPlayer) {
    let exposureScore = 0;
    for (const weight of seasons.values()) exposureScore += weight;
    totals.set(playerId, { exposureScore, leagueSeasonsRostered: seasons.size });
  }
  return totals;
}

function toExposureEntry(
  playerId: string,
  totals: ExposureTotals,
  player: ManagerPlayerFacts | undefined,
): PlayerExposure {
  return {
    playerId,
    name: player?.name ?? playerId,
    position: player?.position ?? null,
    exposureScore: totals.exposureScore,
    leagueSeasonsRostered: totals.leagueSeasonsRostered,
    // PlayerExposure.leagueWideRosterRate is a plain number, not a nullable
    // one, so an unknown rate has to become SOME number here. Both current
    // callers (buildFavourites, buildAvoids) already filter out a null rate
    // before reaching this function, so the default below is never actually
    // exercised today. It still has to be chosen carefully for the caller
    // that does not filter: favourites scores a player as
    // exposureScore * (1 - rate), so defaulting to 0 (as this used to do)
    // would rank an unknown player at the VERY TOP of the list, which is the
    // opposite of "we do not know". Defaulting to 1 instead sends the score
    // to 0, the bottom, which is the honest failure direction: an unknown
    // player should never outrank a known non-favourite.
    leagueWideRosterRate: player?.leagueWideRosterRate ?? 1,
  };
}

/**
 * Favourites: exposure weighted against how commonly the player is rostered
 * generally, so a nearly-universal roster spot never reads as a preference.
 *
 * A player with a null `leagueWideRosterRate` is EXCLUDED rather than ranked
 * on raw exposure. We have no context for how unusual owning him is, and
 * "we do not know how common he is" is not the same claim as "the manager is
 * unusual for having him." Those excluded players are still counted in the
 * sample size note (favouritesSampleSize counts every player with any
 * exposure at all, known-rate or not) so the list states how much evidence
 * stands behind it.
 */
function buildFavourites(
  totals: Map<string, ExposureTotals>,
  players: Record<string, ManagerPlayerFacts>,
  favouritesShown: number,
): { favourites: PlayerExposure[]; favouritesSampleSize: number } {
  const favouritesSampleSize = totals.size;

  const ranked = [...totals.entries()]
    .map(([playerId, t]) => ({ playerId, totals: t, player: players[playerId] }))
    .filter((row) => row.player !== undefined && row.player.leagueWideRosterRate !== null)
    .map((row) => {
      const rate = row.player!.leagueWideRosterRate as number;
      return {
        entry: toExposureEntry(row.playerId, row.totals, row.player),
        favouriteScore: row.totals.exposureScore * (1 - rate),
      };
    })
    .sort((a, b) => {
      if (b.favouriteScore !== a.favouriteScore) return b.favouriteScore - a.favouriteScore;
      return a.entry.name.localeCompare(b.entry.name);
    })
    .slice(0, favouritesShown)
    .map((row) => row.entry);

  return { favourites: ranked, favouritesSampleSize };
}

/**
 * Avoids: players rostered widely across the league population but never
 * rostered by this manager, gated by the opportunity rule (ABSOLUTE RULE in
 * the task brief): a player who entered the pool last year cannot be
 * "avoided" over a four-season window.
 *
 * OPPORTUNITY IS APPROXIMATED. The input carries one CURRENT
 * `leagueWideRosterRate` per player, not a per-season history of how commonly
 * he was rostered in each season the manager played. Without that history,
 * the best available signal that a player existed as a candidate at all is
 * that he resolves in `input.players`, so the opportunity count used here is
 * the number of distinct seasons the manager played in the window, counted
 * whenever the player is resolvable in `input.players`. This can OVERSTATE
 * opportunity for a player who actually entered the league (was drafted into
 * the NFL, or became fantasy-relevant) partway through the window: he reads
 * as available for the whole window even though he could not have been
 * rostered in its earlier seasons. The correct fix is a per-season
 * `leagueWideRosterRate` on the input; this is a known limitation until that
 * exists, and it is reported to the orchestrator rather than silently
 * assumed away.
 *
 * `minAvoidRosterRate` (settings.samples) is the floor for "commonly
 * rostered". A player below this line is not rostered widely enough for his
 * absence from one manager's history to be interesting; he may simply be a
 * replacement-level player nobody chases. The default, 0.5 (rostered in at
 * least half of leagues we hold), is a reasonable floor for "everyone has a
 * look at this guy" without requiring near-universal ownership, which would
 * leave the avoid list nearly empty.
 */
function buildAvoids(
  totals: Map<string, ExposureTotals>,
  players: Record<string, ManagerPlayerFacts>,
  seasonsPlayed: number,
  minAvoidSeasons: number,
  minAvoidRosterRate: number,
  avoidsShown: number,
): { avoids: PlayerExposure[]; avoidsSampleSize: number } {
  const rosteredPlayerIds = new Set(totals.keys());
  const opportunitySeasons = seasonsPlayed;

  const candidates = Object.values(players).filter((player) => {
    if (rosteredPlayerIds.has(player.playerId)) return false;
    if (player.leagueWideRosterRate === null) return false;
    if (player.leagueWideRosterRate < minAvoidRosterRate) return false;
    if (opportunitySeasons < minAvoidSeasons) return false;
    return true;
  });

  const avoidsSampleSize = candidates.length;

  const avoids = [...candidates]
    .sort((a, b) => {
      const rateDiff = (b.leagueWideRosterRate ?? 0) - (a.leagueWideRosterRate ?? 0);
      if (rateDiff !== 0) return rateDiff;
      return a.name.localeCompare(b.name);
    })
    .slice(0, avoidsShown)
    .map((player) =>
      toExposureEntry(player.playerId, { exposureScore: 0, leagueSeasonsRostered: 0 }, player),
    );

  return { avoids, avoidsSampleSize };
}

/**
 * Players drafted in more than one distinct draft, keepers excluded (a
 * carried keeper is not choosing him again). Counted by distinct
 * `sleeperDraftId`, so two picks of the same player in the same draft (which
 * should not happen, but is not the engine's job to assume away) do not
 * inflate the count.
 */
function buildRepeatDrafts(
  input: ManagerPulseInput,
  repeatDraftsShown: number,
): { repeatDrafts: RepeatDraftEntry[]; repeatDraftsSampleSize: number } {
  const draftIdsByPlayer = new Map<string, Set<string>>();
  const distinctDraftIds = new Set<string>();

  for (const pick of input.picks as ManagerDraftPick[]) {
    distinctDraftIds.add(pick.sleeperDraftId);
    if (!pick.playerId || pick.isKeeper) continue;
    let drafts = draftIdsByPlayer.get(pick.playerId);
    if (!drafts) {
      drafts = new Set();
      draftIdsByPlayer.set(pick.playerId, drafts);
    }
    drafts.add(pick.sleeperDraftId);
  }

  const repeatDrafts: RepeatDraftEntry[] = [...draftIdsByPlayer.entries()]
    .filter(([, drafts]) => drafts.size >= 2)
    .map(([playerId, drafts]) => ({
      playerId,
      name: input.players[playerId]?.name ?? playerId,
      timesDrafted: drafts.size,
    }))
    .sort((a, b) => {
      if (b.timesDrafted !== a.timesDrafted) return b.timesDrafted - a.timesDrafted;
      return a.name.localeCompare(b.name);
    })
    // Capped like every other list in this report. A manager who drafts thirty
    // leagues a year produces hundreds of these, and every one of them ships
    // inside the cached report document as well as onto the screen.
    .slice(0, repeatDraftsShown);

  return { repeatDrafts, repeatDraftsSampleSize: distinctDraftIds.size };
}

export function computeAffinity(input: ManagerPulseInput): ManagerAffinity {
  const byPlayerBySeason = bestWeightPerLeagueSeason(input);
  const totals = totalExposure(byPlayerBySeason);

  const { favourites, favouritesSampleSize } = buildFavourites(
    totals,
    input.players,
    input.settings.display.favouritesShown,
  );

  const distinctSeasonsPlayed = new Set(input.leagueSeasons.map((ls) => ls.season)).size;

  const { avoids, avoidsSampleSize } = buildAvoids(
    totals,
    input.players,
    distinctSeasonsPlayed,
    input.settings.samples.minAvoidSeasons,
    input.settings.samples.minAvoidRosterRate,
    input.settings.display.avoidsShown,
  );

  const { repeatDrafts, repeatDraftsSampleSize } = buildRepeatDrafts(
    input,
    input.settings.display.repeatDraftsShown,
  );

  return {
    favourites,
    favouritesSampleSize,
    avoids,
    avoidsSampleSize,
    repeatDrafts,
    repeatDraftsSampleSize,
  };
}
