/**
 * The Beacon Steals engine. Pure: plain data in, plain data out, no I/O.
 *
 * WHAT THIS FILE IS DEFENDING AGAINST
 *
 * The obvious implementation of "is the market late on this player" is
 * `sleeper_adp - beacon_overall_rank`, sort descending. It was run against
 * production before any of this was written and it fails twice, structurally.
 *
 * TRAP 1: the deep board is noise. In dynasty superflex the top raw gaps were
 * De'Zhaun Stribling (+157), Eli Raridon (+135), and Carson Beck (+104), all
 * ranked past 130 with ADPs past 240 in a market that ranks about 360 players.
 * The raw difference grows precisely where both inputs stop meaning anything.
 * Fixed by `confidence`, which decays with market depth and value depth and
 * multiplies into the score, pulling uncertain names back toward neutral.
 *
 * TRAP 2: it flags every quarterback. In redraft PPR, six of the top twelve were
 * QBs: Mahomes, Herbert, Nix, Caleb Williams, Stroud, Cam Ward. That is not a
 * discovery, it is a unit error. `overall_rank` is a CROSS-POSITION VALUE rank.
 * ADP is a SCARCITY PRICE. In a one-QB league nobody spends pick 50 on QB8 no
 * matter how good he is, so the two disagree on every quarterback in every
 * single-QB format, forever.
 *
 * THE FIX FOR TRAP 2 IS THE SHAPE OF THIS FILE.
 * Do not compare a rank to a pick. Build a PICK LADDER out of points above a
 * replacement STARTER, which prices scarcity the same way a draft room does,
 * blend it with the value ladder by league type, and compare pick to pick.
 *
 *   demand(pos)      = teams * (starters[pos] + flexShare[pos] * flex)
 *   replacement(pos) = the demand(pos)-th best projected season total at pos
 *   par(player)      = projected * reliability * availability - replacement(pos)
 *   parPick          = rank of the player by par, descending
 *   valuePick        = rank of the player by FF Beacon value, descending
 *   ladder           = wValue * valuePick + wPoints * parPick
 *   beacon_pick      = the market's own pick slots, redistributed in ladder order
 *   value_gap        = market_adp - beacon_pick
 *
 * In a one-QB league only twelve quarterbacks are needed, so QB13 sits far down
 * the par ladder however many raw points he scores, and beacon_pick lands near
 * where ADP already had him. The artifact disappears without a positional
 * special case anywhere in the code.
 *
 * That last step, projectOntoMarketScale, is not cosmetic. Subtracting a ladder
 * index from an ADP is a unit error: see its own header for the measurement
 * that proved it, where skipping it made the quarterback artifact worse than
 * the naive implementation.
 *
 * SIGN CONVENTION, matching lib/on-the-clock/adp.ts: POSITIVE means taken later
 * than expected, which is value. A number means the same thing here and in the
 * live draft room.
 */

import type {
  DraftValueSettings,
  StealPosition,
} from "./default-settings";
import { STEAL_POSITIONS } from "./default-settings";

/** Everything the engine knows about one player in one format. */
export interface PlayerInput {
  playerId: string;
  position: StealPosition;
  /** FF Beacon overall value rank within the format. Null when unranked. */
  beaconRank: number | null;
  beaconValue: number | null;
  positionRank: number | null;
  /** Projected season points under the format's canonical scoring. Null when unprojected. */
  projectedPoints: number | null;
  /** From player_projection_accuracy. Null when the player has no graded history. */
  beatRate: number | null;
  shrunkMultiplier: number | null;
  availabilityRate: number | null;
  /** Public market ADP. Null when the market does not rank him. */
  marketAdp: number | null;
  marketAdpKey: string | null;
  marketSource: string | null;
  /** FF Beacon room ADP, already normalized to a 12-team draft. */
  roomAdp: number | null;
  roomPicksSampled: number | null;
}

/** Structural facts about the format being scored. */
export interface FormatShape {
  slug: string;
  leagueType: "redraft" | "dynasty";
  isSuperflex: boolean;
}

export type StealCategory = "steal" | "swing" | "fade" | "fair";

export interface ScoredPlayer {
  playerId: string;
  position: StealPosition;
  beaconRank: number | null;
  beaconValue: number | null;
  positionRank: number | null;
  beaconPick: number | null;
  projectedPoints: number | null;
  pointsAboveReplacement: number | null;
  beatRate: number | null;
  availability: number | null;
  marketAdp: number | null;
  marketAdpKey: string | null;
  marketSource: string | null;
  roomAdp: number | null;
  roomPicksSampled: number | null;
  valueGap: number | null;
  /** value_gap with its position's median gap removed. What the ranking uses. */
  positionAdjustedGap: number | null;
  /**
   * The median gap subtracted for this player's position. Exposed so the verdict
   * can EXPLAIN a row whose raw gap and centered gap disagree in sign, rather
   * than printing a sentence that contradicts the bucket the row is filed under.
   */
  positionGapOffset: number;
  stealScore: number | null;
  confidence: number | null;
  category: StealCategory;
  /** Gap expressed in rounds. Exposed for the verdict copy, not persisted. */
  gapRounds: number | null;
  /** Replacement level used for this player's position. Exposed for copy. */
  replacementPoints: number | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

/**
 * How many starters of a position a whole league needs, including its share of
 * the flex. Superflex adds a quarterback, which is the single biggest reason
 * a QB's honest draft position differs between formats.
 */
export function positionalDemand(
  position: StealPosition,
  shape: FormatShape,
  settings: DraftValueSettings,
): number {
  const ls = settings.leagueShape;
  let dedicated = ls.starters[position] ?? 0;
  if (position === "QB" && shape.isSuperflex && ls.superflexAddsQb) dedicated += 1;

  const share =
    position === "RB"
      ? ls.flexShare.RB
      : position === "WR"
        ? ls.flexShare.WR
        : position === "TE"
          ? ls.flexShare.TE
          : 0;

  return ls.teams * (dedicated + share * ls.flex);
}

/**
 * The replacement-level projected total at each position: what the last starter
 * a league actually needs is projected to score.
 *
 * Absent is not zero. A position with no projections at all gets a null
 * replacement level, and every player at it is scored on value alone rather than
 * being handed a fabricated points edge over an imaginary zero-point baseline.
 */
export function replacementLevels(
  players: readonly PlayerInput[],
  shape: FormatShape,
  settings: DraftValueSettings,
): Record<StealPosition, number | null> {
  const out = {} as Record<StealPosition, number | null>;

  for (const position of STEAL_POSITIONS) {
    const projected = players
      .filter((p) => p.position === position && typeof p.projectedPoints === "number")
      .map((p) => p.projectedPoints as number)
      .sort((a, b) => b - a);

    if (projected.length === 0) {
      out[position] = null;
      continue;
    }

    const demand = positionalDemand(position, shape, settings);
    // Round up: half a flex slot still means somebody starts.
    const index = Math.max(0, Math.ceil(demand) - 1);
    // A shallow board (fewer projected players than the league needs) uses its
    // last projected player as the replacement rather than falling off the end.
    out[position] = projected[Math.min(index, projected.length - 1)];
  }

  return out;
}

/**
 * Reliability and availability multipliers on a projection, from the same
 * player_projection_accuracy rows Power Pulse reads. Both default to 1.0 when a
 * player has no history, so a rookie is neither rewarded nor punished for it.
 */
export function adjustmentMultiplier(
  player: PlayerInput,
  settings: DraftValueSettings,
): number {
  let multiplier = 1;

  if (settings.reliability.enabled && typeof player.shrunkMultiplier === "number") {
    multiplier *= clamp(
      player.shrunkMultiplier,
      settings.reliability.minMultiplier,
      settings.reliability.maxMultiplier,
    );
  }

  if (settings.availability.enabled && typeof player.availabilityRate === "number") {
    const damped =
      player.availabilityRate * (1 - settings.availability.damping) +
      settings.availability.damping;
    multiplier *= clamp(damped, settings.availability.minMultiplier, 1);
  }

  return multiplier;
}

/**
 * Rank a list of (id, score) pairs into 1-based positions, descending by score.
 * Entries with a null score are unranked. Ties break on id so the ladder is
 * stable between runs and a rebuild does not shuffle equal players.
 */
function ladder(
  entries: readonly { id: string; score: number | null }[],
): Map<string, number> {
  const ranked = entries
    .filter((e): e is { id: string; score: number } => typeof e.score === "number")
    .sort((a, b) => (b.score - a.score) || a.id.localeCompare(b.id));
  const out = new Map<string, number>();
  ranked.forEach((e, i) => out.set(e.id, i + 1));
  return out;
}

/**
 * Put our order of preference onto the market's OWN pick scale.
 *
 * A ladder index and an ADP are not the same unit and subtracting them is a
 * scale error, not an insight. A ladder over 800 ranked players tops out at 800;
 * a market that ranks 360 players tops out at 360; and a ladder over 144 players
 * (the first version of the test fixture here) tops out at 144 while the ADP it
 * was being compared against ran to 306. Under that mismatch every player deep
 * in the market reads as an enormous steal purely because the ladder physically
 * cannot produce a number that large. It made the quarterback artifact WORSE
 * than the naive implementation it was meant to fix: 10 of the top 12 instead
 * of 6.
 *
 * So instead of comparing numbers, we redistribute. Take the pick slots the
 * market actually spent, and hand them out in OUR order:
 *
 *   the market drafted these M players at these M pick numbers
 *   -> sort those M pick numbers ascending: that is the slate of real slots
 *   -> walk our ladder; the k-th drafted player we reach gets the k-th slot
 *
 * beacon_pick is then literally "the pick this player would go at if the room
 * drafted the same players in our order", and value_gap is the number of slots
 * he slides. Both sides are the same unit by construction, and the answer is
 * invariant to how deep our board happens to run.
 *
 * A player the market does not rank gets the slot he would displace into, so
 * the board can still say where we would take him. His gap stays null, because
 * there is no market opinion to compare against.
 */
export function projectOntoMarketScale(
  players: readonly PlayerInput[],
  blendedIndex: ReadonlyMap<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();

  const adpScale = players
    .map((p) => p.marketAdp)
    .filter((adp): adp is number => typeof adp === "number" && Number.isFinite(adp))
    .sort((a, b) => a - b);
  if (adpScale.length === 0) return out;

  const ordered = players
    .filter((p) => blendedIndex.has(p.playerId))
    .sort((a, b) => {
      const ai = blendedIndex.get(a.playerId) as number;
      const bi = blendedIndex.get(b.playerId) as number;
      return ai - bi || a.playerId.localeCompare(b.playerId);
    });

  let slot = 0;
  for (const player of ordered) {
    out.set(player.playerId, adpScale[Math.min(slot, adpScale.length - 1)]);
    // Only a player the market actually drafts consumes a slot. An unranked
    // player shares the slot he would displace into rather than pushing every
    // ranked player behind him a pick later.
    if (typeof player.marketAdp === "number") slot += 1;
  }

  return out;
}

/**
 * The median raw gap within each position, which is what gets subtracted before
 * a player is ranked or categorised.
 *
 * WHY THIS EXISTS. A points-above-replacement model and a real draft market
 * disagree about whole POSITIONS, not only about players. Ours puts elite
 * quarterbacks earlier than a one-QB room does. That is the long-running
 * argument between value-over-replacement models and actual draft behaviour, and
 * a steal list is the wrong place to relay it: "the market is late on this
 * player" has to mean late relative to comparable players. A uniform +20 on
 * every quarterback is a strategy claim, and it belongs in the guide's prose,
 * not in thirty-two identical rows.
 *
 * Measured on the synthetic board that reproduces production's per-position
 * offsets, this is the difference between quarterbacks taking all twelve of the
 * top twelve slots and taking a proportionate share of them.
 *
 * The MEDIAN, not the mean, so a handful of genuinely mispriced players at a
 * position cannot drag the correction and hide themselves.
 */
export function positionalGapOffsets(
  players: readonly PlayerInput[],
  rawGapById: ReadonlyMap<string, number>,
  settings: DraftValueSettings,
): Record<StealPosition, number> {
  const out = {} as Record<StealPosition, number>;
  for (const position of STEAL_POSITIONS) out[position] = 0;
  if (!settings.positionCentering.enabled) return out;

  for (const position of STEAL_POSITIONS) {
    const gaps = players
      .filter((p) => p.position === position)
      .map((p) => rawGapById.get(p.playerId))
      .filter((g): g is number => typeof g === "number")
      .sort((a, b) => a - b);

    // Too few graded players and the median is itself noise, so leave the
    // position alone rather than shifting it by an accident.
    if (gaps.length < settings.positionCentering.minPlayers) continue;

    const mid = Math.floor(gaps.length / 2);
    out[position] =
      gaps.length % 2 === 1 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  }

  return out;
}

/**
 * Confidence, 0 to 1. The product of four factors, each of which answers "how
 * much do we actually know here".
 */
export function computeConfidence(
  params: {
    marketAdp: number | null;
    beaconRank: number | null;
    hasProjection: boolean;
    hasHistory: boolean;
    roomAdp: number | null;
    roomPicksSampled: number | null;
    deepestMarketAdp: number;
    teams: number;
  },
  settings: DraftValueSettings,
): number {
  const c = settings.confidence;

  // 1. Market depth. No ADP at all is the least confident state there is.
  let marketFactor: number;
  if (params.marketAdp === null) {
    marketFactor = c.marketFloor;
  } else if (params.marketAdp <= c.marketTrustedDepth) {
    marketFactor = 1;
  } else {
    const span = Math.max(1, params.deepestMarketAdp - c.marketTrustedDepth);
    const past = params.marketAdp - c.marketTrustedDepth;
    marketFactor = clamp(1 - (past / span) * (1 - c.marketFloor), c.marketFloor, 1);
  }

  // 2. Value depth, the same shape against our own board.
  let valueFactor: number;
  if (params.beaconRank === null) {
    valueFactor = c.valueFloor;
  } else if (params.beaconRank <= c.valueTrustedDepth) {
    valueFactor = 1;
  } else {
    const span = Math.max(1, c.valueTrustedDepth);
    const past = params.beaconRank - c.valueTrustedDepth;
    valueFactor = clamp(1 - (past / span) * (1 - c.valueFloor), c.valueFloor, 1);
  }

  // 3. Competitive data.
  const dataFactor = params.hasProjection
    ? params.hasHistory
      ? c.bothDataFactor
      : c.projectionOnlyFactor
    : c.noCompetitiveFactor;

  // 4. Room agreement. Only speaks once our own cohort is deep enough to have an
  // opinion, and it is an ADJUSTMENT rather than a term: our rooms agreeing that
  // a player falls is corroboration, not evidence on its own.
  let roomFactor = 1;
  if (
    params.roomAdp !== null &&
    params.marketAdp !== null &&
    (params.roomPicksSampled ?? 0) >= c.roomMinDrafts
  ) {
    const disagreementRounds = (params.roomAdp - params.marketAdp) / Math.max(1, params.teams);
    const scaled = clamp(disagreementRounds / Math.max(0.1, c.roomAgreementRounds), -1, 1);
    roomFactor =
      scaled >= 0
        ? 1 + scaled * (c.roomAgreementMax - 1)
        : 1 + scaled * (1 - c.roomAgreementMin);
  }

  return round(clamp(marketFactor * valueFactor * dataFactor * roomFactor, 0, 1), 4);
}

/** Category from the gap, the market position, and how much we trust the read. */
export function categorize(
  params: {
    gapRounds: number | null;
    confidence: number;
    marketAdp: number | null;
    par: number | null;
  },
  settings: DraftValueSettings,
): StealCategory {
  const s = settings.scoring;
  const { gapRounds, confidence, marketAdp, par } = params;
  if (gapRounds === null) return "fair";

  const trusted = confidence >= settings.confidence.minConfidence;

  // A steal has to have SOMETHING going for it beyond the gap.
  //
  // Positional centering can lift a player whose own competitive case is
  // terrible: a backup quarterback taken at pick 238 who projects 182 points
  // BELOW a replacement starter came out as a steal on the first build, purely
  // because the room drafts the whole position earlier than our board does. The
  // gap was real and the label was absurd.
  //
  // A NULL par is fine and stays eligible: that is a player we have no
  // projection for (a rookie, a returning injury), where the value board is the
  // whole case. A par we DO have, that says he is below the last starter anyone
  // needs, is a fact and it disqualifies him. Same test the swing bucket below
  // already applies.
  const hasCompetitiveCase = par === null || par > 0;

  if (trusted && hasCompetitiveCase && gapRounds >= s.stealMinRounds) return "steal";
  if (trusted && gapRounds <= -s.fadeMinRounds) return "fade";

  // A late-round swing is allowed to be uncertain. That is what makes it a dart,
  // and the copy says so. It still has to be genuinely available late and still
  // has to project above a replacement starter.
  if (
    marketAdp !== null &&
    marketAdp >= s.lateRoundPick &&
    typeof par === "number" &&
    par > 0 &&
    gapRounds >= s.swingMinRounds
  ) {
    return "swing";
  }

  return "fair";
}

/**
 * Score a whole format's player pool in one pass. The ladders are built across
 * the pool, so this cannot be done per player.
 */
export function scoreFormat(
  players: readonly PlayerInput[],
  shape: FormatShape,
  settings: DraftValueSettings,
): ScoredPlayer[] {
  if (players.length === 0) return [];

  const teams = Math.max(1, settings.leagueShape.teams);
  const replacement = replacementLevels(players, shape, settings);

  // Points above replacement, per player.
  const parById = new Map<string, number | null>();
  for (const player of players) {
    const level = replacement[player.position];
    if (typeof player.projectedPoints !== "number" || level === null) {
      parById.set(player.playerId, null);
      continue;
    }
    const adjusted = player.projectedPoints * adjustmentMultiplier(player, settings);
    parById.set(player.playerId, adjusted - level);
  }

  // The two ladders.
  const parLadder = ladder(
    players.map((p) => ({ id: p.playerId, score: parById.get(p.playerId) ?? null })),
  );
  const valueLadder = ladder(
    players.map((p) => ({
      id: p.playerId,
      // Rank descending by value; a player with no value but a rank still ladders
      // by the inverse of his rank so he keeps his place.
      score:
        typeof p.beaconValue === "number"
          ? p.beaconValue
          : typeof p.beaconRank === "number"
            ? -p.beaconRank
            : null,
    })),
  );

  const weights =
    shape.leagueType === "dynasty" ? settings.blend.dynasty : settings.blend.redraft;
  const weightTotal = weights.value + weights.points;
  const wValue = weightTotal > 0 ? weights.value / weightTotal : 0.5;
  const wPoints = weightTotal > 0 ? weights.points / weightTotal : 0.5;

  // Our order of preference, as a blended ladder index. A player on only one
  // ladder uses that ladder alone; blending against a missing side would drag
  // him toward the middle of a board he is not on.
  const blendedIndex = new Map<string, number>();
  for (const player of players) {
    const parPick = parLadder.get(player.playerId) ?? null;
    const valuePick = valueLadder.get(player.playerId) ?? null;
    if (parPick !== null && valuePick !== null) {
      blendedIndex.set(player.playerId, wValue * valuePick + wPoints * parPick);
    } else if (parPick !== null || valuePick !== null) {
      blendedIndex.set(player.playerId, (parPick ?? valuePick) as number);
    }
  }

  const beaconPickById = projectOntoMarketScale(players, blendedIndex);

  const deepestMarketAdp = players.reduce(
    (max, p) => (typeof p.marketAdp === "number" ? Math.max(max, p.marketAdp) : max),
    settings.confidence.marketTrustedDepth + 1,
  );

  // Raw gaps first, then the per-position centering they feed.
  const rawGapById = new Map<string, number>();
  for (const player of players) {
    const beaconPick = beaconPickById.get(player.playerId);
    if (typeof player.marketAdp === "number" && typeof beaconPick === "number") {
      rawGapById.set(player.playerId, player.marketAdp - beaconPick);
    }
  }
  const positionOffset = positionalGapOffsets(players, rawGapById, settings);

  const out: ScoredPlayer[] = [];

  for (const player of players) {
    const beaconPick = beaconPickById.get(player.playerId) ?? null;
    const par = parById.get(player.playerId) ?? null;
    const hasProjection = typeof player.projectedPoints === "number";
    const hasHistory = typeof player.beatRate === "number";

    const confidence = computeConfidence(
      {
        marketAdp: player.marketAdp,
        beaconRank: player.beaconRank,
        hasProjection,
        hasHistory,
        roomAdp: player.roomAdp,
        roomPicksSampled: player.roomPicksSampled,
        deepestMarketAdp,
        teams,
      },
      settings,
    );

    // value_gap stays the RAW arithmetic, because that is the number the verdict
    // sentence quotes and a reader can check it against the two picks either
    // side of it. The centered gap is what the ranking and the category use.
    const rawGap = rawGapById.get(player.playerId);
    const valueGap = rawGap === undefined ? null : round(rawGap, 2);
    const centeredGap =
      rawGap === undefined ? null : rawGap - (positionOffset[player.position] ?? 0);
    const gapRounds = centeredGap === null ? null : centeredGap / teams;

    const stealScore =
      gapRounds === null
        ? null
        : Math.round(
            clamp(
              50 +
                50 *
                  clamp(gapRounds / Math.max(0.1, settings.scoring.stealSaturationRounds), -1, 1) *
                  confidence,
              0,
              100,
            ),
          );

    out.push({
      playerId: player.playerId,
      position: player.position,
      beaconRank: player.beaconRank,
      beaconValue: player.beaconValue,
      positionRank: player.positionRank,
      beaconPick,
      projectedPoints:
        typeof player.projectedPoints === "number" ? round(player.projectedPoints, 2) : null,
      pointsAboveReplacement: par === null ? null : round(par, 2),
      beatRate: player.beatRate,
      availability: player.availabilityRate,
      marketAdp: player.marketAdp,
      marketAdpKey: player.marketAdpKey,
      marketSource: player.marketSource,
      roomAdp: player.roomAdp,
      roomPicksSampled: player.roomPicksSampled,
      valueGap,
      positionAdjustedGap: centeredGap === null ? null : round(centeredGap, 2),
      positionGapOffset: round(positionOffset[player.position] ?? 0, 2),
      stealScore,
      confidence,
      category: categorize({ gapRounds, confidence, marketAdp: player.marketAdp, par }, settings),
      gapRounds: gapRounds === null ? null : round(gapRounds, 3),
      replacementPoints:
        replacement[player.position] === null
          ? null
          : round(replacement[player.position] as number, 2),
    });
  }

  return out;
}
