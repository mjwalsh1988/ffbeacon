/**
 * On The Clock recommendation engine (Phase 6B).
 *
 * Pure, browser-safe, deterministic. NOTHING here touches Sleeper, Supabase, or
 * fetch. It turns the already-derived draft inputs (the available board, the
 * connected user's roster/picks, the league format, and the admin settings) into
 * two recommendation cards:
 *   - Best Available: pure FF Beacon value (the same pick draft-derive.pickBestByValue
 *     produces; reused here so both cards come from one call).
 *   - Team Need: value-aware roster need. NOT "the empty position", NOT "the top
 *     player again". It blends normalized value, a VORP-style scarcity signal, and a
 *     slot-fill roster model, with league-format multipliers (Superflex raises QB,
 *     TE premium raises TE) and a tier-gated positional reach penalty so a needed
 *     position is never vetoed for sitting below an unrelated global top.
 *
 * One canonical equation (all components rescaled 0-100):
 *   blended(p) = wValue * valueScore(p) + wNeed * needScore(p) - wReach * reachScore(p)
 *
 * DST/K are ALWAYS in the room (board / lists / picks) and CAN be Best Available if
 * the user position-filters to them, but Team Need suppresses DST/K until a late
 * roster-need gate passes (admin-tunable round + "team lacks one" + league requires
 * the slot). See ON-THE-CLOCK-PLAN.md section 7.
 */

import type { DraftPosition, RankedPlayer, RecommendationCardData } from "./board-types";
import type { OnTheClockSettings, PlayerPool } from "./types";
import { pickBestByValue } from "./draft-derive";

// ---------------------------------------------------------------------------
// Inputs / outputs
// ---------------------------------------------------------------------------

export interface RecommendInput {
  /** Available board: excludeDrafted + filterPool already applied by the caller. */
  available: RankedPlayer[];
  /** Active pool ("everyone" | "rookies"). Drives the rookie-pool degrade copy. */
  pool: PlayerPool;
  /** Detected FF Beacon format slug (used for Superflex / TEP detection). */
  formatSlug: string;
  /** Detected FF Beacon format display label (for copy). */
  formatLabel: string;
  /** Sleeper draft.settings (slots_qb/rb/wr/te/flex/super_flex/k/def, teams, rounds). */
  draftSettings: Record<string, number>;
  /** Positions of the connected user's in-draft picks. */
  myDraftedPositions: DraftPosition[];
  /** Positions of the connected user's pre-draft roster (dynasty only; [] otherwise). */
  seededPositions: DraftPosition[];
  /** True when we can attribute a roster to the user (seat detected or any pick/seed). */
  rosterKnown: boolean;
  /** Round on the clock (1-based); 0 when complete/unknown (disables the DST/K gate). */
  currentRound: number;
  /** Admin settings (weights, DST/K gate, format multipliers, fallback targets). */
  settings: OnTheClockSettings;
}

/** Per-player score breakdown, returned in debug for tests (never rendered raw). */
export interface ScoreBreakdown {
  playerId: string;
  valueComponent: number;
  needComponent: number;
  reachComponent: number;
  vor: number;
  blended: number;
  filledSlot: SlotLabel | null;
}

/** A still-open roster slot summary. */
export interface PositionNeed {
  slot: SlotLabel;
  openSlots: number;
  label: string;
}

export interface RecommendResult {
  best: RecommendationCardData;
  need: RecommendationCardData;
  /** True when Best Available is also the Team Need pick ("value and need align"). */
  aligned: boolean;
  /** False when no roster could be attributed (Team Need degrades to value/scarcity). */
  rosterKnown: boolean;
  /** Open-slot summary, most-needed first. */
  positionNeeds: PositionNeed[];
  /** Per-player breakdowns keyed by playerId, for tests. Not for noisy UI. */
  debug: Record<string, ScoreBreakdown>;
}

// ---------------------------------------------------------------------------
// Slot / roster model
// ---------------------------------------------------------------------------

export type SlotLabel = "QB" | "RB" | "WR" | "TE" | "K" | "DEF" | "FLEX" | "SUPER_FLEX";

/** Starting-slot counts for a league (bench is irrelevant to need). */
export interface SlotModel {
  QB: number;
  RB: number;
  WR: number;
  TE: number;
  FLEX: number; // RB/WR/TE
  SUPER_FLEX: number; // QB/RB/WR/TE
  K: number;
  DEF: number;
}

const ZERO_HAVE: Record<DraftPosition, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };

/**
 * Build the starting-slot model from the Sleeper draft.settings slot counts. When
 * no slot keys are present (some drafts omit them), fall back to the admin
 * positionFallbackTargets. slots_rec_flex (WR/TE) is folded into FLEX for MVP.
 */
export function buildSlotModel(
  draftSettings: Record<string, number>,
  settings: OnTheClockSettings,
): SlotModel {
  const s = draftSettings;
  const num = (k: string) => (Number.isFinite(s[k]) ? s[k] : 0);
  const slotsPresent =
    num("slots_qb") + num("slots_rb") + num("slots_wr") + num("slots_te") + num("slots_flex") + num("slots_super_flex") >
    0;

  if (!slotsPresent) {
    const t = settings.positionFallbackTargets;
    return {
      QB: t.QB,
      RB: t.RB,
      WR: t.WR,
      TE: t.TE,
      FLEX: t.FLEX,
      SUPER_FLEX: t.SUPER_FLEX,
      K: t.K,
      DEF: t.DEF,
    };
  }

  return {
    QB: num("slots_qb"),
    RB: num("slots_rb"),
    WR: num("slots_wr"),
    TE: num("slots_te"),
    FLEX: num("slots_flex") + num("slots_rec_flex"),
    SUPER_FLEX: num("slots_super_flex"),
    K: num("slots_k"),
    DEF: num("slots_def"),
  };
}

/** Open starting slots after greedily assigning the user's `have` players. */
export interface OpenSlots {
  QB: number;
  RB: number;
  WR: number;
  TE: number;
  FLEX: number;
  SUPER_FLEX: number;
  K: number;
  DEF: number;
}

/**
 * Greedy slot assignment: dedicated slots first (QB/RB/WR/TE/K/DEF), then spill
 * leftover RB/WR/TE into FLEX, then leftover QB/RB/WR/TE into SUPER_FLEX. A drafted
 * QB therefore correctly reduces SUPER_FLEX need.
 */
export function assignToSlots(have: Record<DraftPosition, number>, model: SlotModel): OpenSlots {
  const open: OpenSlots = {
    QB: model.QB,
    RB: model.RB,
    WR: model.WR,
    TE: model.TE,
    FLEX: model.FLEX,
    SUPER_FLEX: model.SUPER_FLEX,
    K: model.K,
    DEF: model.DEF,
  };
  const left: Record<DraftPosition, number> = { ...have };

  const dedicated: DraftPosition[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
  for (const pos of dedicated) {
    const fill = Math.min(left[pos], open[pos]);
    open[pos] -= fill;
    left[pos] -= fill;
  }
  for (const pos of ["RB", "WR", "TE"] as DraftPosition[]) {
    if (open.FLEX <= 0) break;
    const fill = Math.min(left[pos], open.FLEX);
    open.FLEX -= fill;
    left[pos] -= fill;
  }
  for (const pos of ["QB", "RB", "WR", "TE"] as DraftPosition[]) {
    if (open.SUPER_FLEX <= 0) break;
    const fill = Math.min(left[pos], open.SUPER_FLEX);
    open.SUPER_FLEX -= fill;
    left[pos] -= fill;
  }
  return open;
}

/** Tally positions into a have-count record. Unknown buckets are ignored. */
export function tallyPositions(positions: DraftPosition[]): Record<DraftPosition, number> {
  const have: Record<DraftPosition, number> = { ...ZERO_HAVE };
  for (const p of positions) {
    if (p in have) have[p] += 1;
  }
  return have;
}

/**
 * Which open slot a player of `pos` fills, and the slot-fill weight. Dedicated
 * open slot is the strongest signal; FLEX/SUPER_FLEX are partial; bench-only depth
 * is weak (we still value depth, but lightly).
 */
export function slotFitFor(
  pos: DraftPosition,
  open: OpenSlots,
): { factor: number; slot: SlotLabel | null } {
  if (open[pos] > 0) return { factor: 1, slot: pos };
  if ((pos === "RB" || pos === "WR" || pos === "TE") && open.FLEX > 0) {
    return { factor: 0.7, slot: "FLEX" };
  }
  if ((pos === "QB" || pos === "RB" || pos === "WR" || pos === "TE") && open.SUPER_FLEX > 0) {
    return { factor: 0.7, slot: "SUPER_FLEX" };
  }
  return { factor: 0.25, slot: null };
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

/** Superflex when the league carries a SUPER_FLEX slot or the format slug says so. */
export function isSuperflexFormat(formatSlug: string, model: SlotModel): boolean {
  return model.SUPER_FLEX > 0 || /sflex|superflex/i.test(formatSlug);
}

/** TE premium when the format slug carries the TEP marker. */
export function isTepFormat(formatSlug: string): boolean {
  return /tep/i.test(formatSlug);
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

/** Rescale a raw value to 0-100 across [min,max]; flat ranges map to 0. */
function rescale(raw: number, min: number, max: number): number {
  if (max <= min) return 0;
  return (100 * (raw - min)) / (max - min);
}

/** Startable depth per team at a position (folds FLEX/SF into the skill spots). */
function startableDepth(pos: DraftPosition, model: SlotModel, superflex: boolean): number {
  switch (pos) {
    case "QB":
      return model.QB + (superflex ? model.SUPER_FLEX : 0);
    case "RB":
    case "WR":
    case "TE":
      return model[pos] + model.FLEX + model.SUPER_FLEX;
    default:
      return 1; // K / DEF: one starter
  }
}

/**
 * Replacement value per position = the value of the league-wide last startable
 * player still AVAILABLE at that position. Computed from the available board, so
 * scarcity tracks what is actually left (a run on RBs raises every remaining RB's
 * VORP). VORP(p) = max(0, value(p) - replacement[pos]).
 */
function replacementByPosition(
  available: RankedPlayer[],
  model: SlotModel,
  teams: number,
  superflex: boolean,
): Record<DraftPosition, number> {
  const byPos = new Map<DraftPosition, number[]>();
  for (const p of available) {
    const arr = byPos.get(p.position) ?? [];
    arr.push(p.value);
    byPos.set(p.position, arr);
  }
  const replacement: Record<DraftPosition, number> = { ...ZERO_HAVE };
  for (const pos of ["QB", "RB", "WR", "TE", "K", "DEF"] as DraftPosition[]) {
    const values = (byPos.get(pos) ?? []).slice().sort((a, b) => b - a);
    if (values.length === 0) {
      replacement[pos] = 0;
      continue;
    }
    const depth = Math.max(1, Math.round(teams * startableDepth(pos, model, superflex)));
    const idx = Math.min(depth, values.length - 1);
    replacement[pos] = values[idx];
  }
  return replacement;
}

// ---------------------------------------------------------------------------
// DST/K gate
// ---------------------------------------------------------------------------

/**
 * Whether a DST/K position is eligible for a Team-Need recommendation. DST/K are
 * always in the room; this gates only the recommendation. Defaults are
 * conservative: suppressed until late, the league requires the slot, and the user
 * lacks one.
 */
export function dstkRecommendable(
  pos: "K" | "DEF",
  ctx: {
    settings: OnTheClockSettings;
    currentRound: number;
    model: SlotModel;
    have: Record<DraftPosition, number>;
  },
): boolean {
  const { settings, currentRound, model, have } = ctx;
  const behavior = settings.dstk.recommendBehavior;
  if (behavior === "never") return false;
  if (behavior === "always_allowed") return true;

  // suppress_until_need: late round + league requires the slot + team lacks one.
  const minRound = pos === "DEF" ? settings.dstk.minRoundForDst : settings.dstk.minRoundForK;
  if (currentRound <= 0 || currentRound < minRound) return false;
  if (settings.dstk.requireStartingSlot && model[pos] <= 0) return false;
  if (have[pos] > 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Reason copy
// ---------------------------------------------------------------------------

const SLOT_WORD: Record<SlotLabel, string> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  K: "kicker",
  DEF: "defense",
  FLEX: "flex",
  SUPER_FLEX: "superflex",
};

const POS_WORD: Record<DraftPosition, string> = {
  QB: "quarterback",
  RB: "running back",
  WR: "wide receiver",
  TE: "tight end",
  K: "kicker",
  DEF: "defense",
};

function buildNeedReason(
  player: RankedPlayer,
  slot: SlotLabel | null,
  flags: { superflex: boolean; tep: boolean },
): string {
  const name = player.name;
  const pos = player.position;

  if (pos === "K" || pos === "DEF") {
    return `It is late and your lineup still needs a ${SLOT_WORD[pos]}. ${name} is the best ${SLOT_WORD[pos]} left on the board.`;
  }
  if (pos === "QB" && flags.superflex) {
    return `Superflex leagues lean hard on quarterbacks, and ${name} is strong value that fills your lineup gap.`;
  }
  if (pos === "TE" && flags.tep) {
    return `Tight end premium gives this position a boost, and ${name} fills a roster need at good value.`;
  }
  if (slot === "FLEX" || slot === "SUPER_FLEX") {
    return `${name} fills your open ${SLOT_WORD[slot]} spot and is strong value here.`;
  }
  if (slot && (slot === "RB" || slot === "WR" || slot === "TE" || slot === "QB")) {
    return `You are light at ${POS_WORD[pos]} for this league's lineup, and ${name} is the best value that fits.`;
  }
  // Depth pick (no open starting slot left): value-led.
  return `Your starting lineup is set, so ${name} is the best value to add for depth and upside.`;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

const FALLBACK_NEED_REASON =
  "No clear roster-need edge yet. Best Available is your safest signal until you make a pick or we can read your team.";

function emptyNeedCard(): RecommendationCardData {
  return {
    kind: "need",
    player: null,
    reason: "No ranked players are available in this pool yet.",
    decidingFactor: "none",
    filledSlot: null,
  };
}

/**
 * Compute Best Available + Team Need. Deterministic and pure. Team Need = the
 * highest blended score among recommendable players (DST/K gated out unless the
 * late roster-need gate passes); Best Available = the highest raw value among ALL
 * available players. When they are the same player, `aligned` is true.
 */
export function recommend(input: RecommendInput): RecommendResult {
  const { available, settings, draftSettings, formatSlug } = input;

  const bestPlayer = pickBestByValue(available);
  const best: RecommendationCardData = {
    kind: "best",
    player: bestPlayer,
    reason: bestPlayer
      ? "Highest FF Beacon value still on the board."
      : "No ranked players are available in this pool yet.",
    decidingFactor: "value",
    filledSlot: null,
  };

  const model = buildSlotModel(draftSettings, settings);
  const teams = Number.isFinite(draftSettings.teams) && draftSettings.teams > 0 ? draftSettings.teams : 12;
  const superflex = isSuperflexFormat(formatSlug, model);
  const tep = isTepFormat(formatSlug);

  const have = tallyPositions([...input.myDraftedPositions, ...input.seededPositions]);
  const open = assignToSlots(have, model);
  const replacement = replacementByPosition(available, model, teams, superflex);

  const positionNeeds = summarizeNeeds(open);

  // No players, or the Team-Need card is disabled by admin: degrade gracefully.
  if (available.length === 0) {
    return { best, need: emptyNeedCard(), aligned: false, rosterKnown: input.rosterKnown, positionNeeds, debug: {} };
  }
  if (!settings.recommendation.teamNeedEnabled) {
    return {
      best,
      need: { ...emptyNeedCard(), reason: "Team Need is turned off. Best Available is your signal." },
      aligned: false,
      rosterKnown: input.rosterKnown,
      positionNeeds,
      debug: {},
    };
  }

  // Recommendable pool: all available minus gated-out DST/K.
  const eligible = available.filter((p) => {
    if (p.position === "K" || p.position === "DEF") {
      return dstkRecommendable(p.position, { settings, currentRound: input.currentRound, model, have });
    }
    return true;
  });

  // No skill players left to recommend (only gated DST/K remain): degrade to value.
  // aligned stays false so the UI shows the honest fallback copy in the need card,
  // never the "value and need align" single-card treatment.
  if (eligible.length === 0) {
    return {
      best,
      need: bestPlayer
        ? { kind: "need", player: bestPlayer, reason: FALLBACK_NEED_REASON, decidingFactor: "none", filledSlot: null }
        : emptyNeedCard(),
      aligned: false,
      rosterKnown: input.rosterKnown,
      positionNeeds,
      debug: {},
    };
  }

  // valueScore / vorScore are normalized across the available board.
  const values = available.map((p) => p.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const vorRaw = new Map<string, number>();
  for (const p of available) vorRaw.set(p.playerId, Math.max(0, p.value - replacement[p.position]));
  const vorValues = [...vorRaw.values()];
  const maxVor = Math.max(...vorValues, 0);

  const weights = settings.recommendation.weights;
  const debug: Record<string, ScoreBreakdown> = {};

  for (const p of eligible) {
    const valueScore = rescale(p.value, minValue, maxValue);
    const vor = vorRaw.get(p.playerId) ?? 0;
    const vorScore = rescale(vor, 0, maxVor);

    const fit = slotFitFor(p.position, open);
    let formatMult = 1;
    if (p.position === "QB" && superflex) formatMult *= settings.positionAdjust.superflexQbMultiplier;
    if (p.position === "TE" && tep) formatMult *= settings.positionAdjust.tePremiumMultiplier;

    // Need blends a slot-fill base (so an open starting slot matters even for a
    // lower-value player, and the format multiplier has something to scale) with
    // scarcity (vorScore) and raw value, weighted by slot fit and the format
    // multiplier, then rescaled 0-100 below. Inner range is 50..100.
    const needRaw = fit.factor * formatMult * (50 + 0.25 * valueScore + 0.25 * vorScore);

    const reachComponent = reachScoreFor(p, eligible, settings.recommendation.maxReachTierBreak);

    debug[p.playerId] = {
      playerId: p.playerId,
      valueComponent: valueScore,
      needComponent: needRaw, // rescaled in the second pass
      reachComponent,
      vor,
      blended: 0,
      filledSlot: fit.slot,
    };
  }

  // Rescale needRaw across the eligible pool, then compute blended.
  const needRaws = eligible.map((p) => debug[p.playerId].needComponent);
  const minNeed = Math.min(...needRaws);
  const maxNeed = Math.max(...needRaws);
  for (const p of eligible) {
    const b = debug[p.playerId];
    const needScore = rescale(b.needComponent, minNeed, maxNeed);
    b.needComponent = needScore;
    b.blended =
      weights.value * b.valueComponent + weights.need * needScore - weights.reach * b.reachComponent;
  }

  // Team Need = highest blended, deterministic tie-break: blended -> raw value ->
  // better position rank -> lowest player id.
  let needWinner: RankedPlayer | null = null;
  for (const p of eligible) {
    if (!needWinner) {
      needWinner = p;
      continue;
    }
    const a = debug[p.playerId].blended;
    const b = debug[needWinner.playerId].blended;
    if (
      a > b ||
      (a === b && p.value > needWinner.value) ||
      (a === b && p.value === needWinner.value && p.positionRank < needWinner.positionRank) ||
      (a === b &&
        p.value === needWinner.value &&
        p.positionRank === needWinner.positionRank &&
        p.playerId < needWinner.playerId)
    ) {
      needWinner = p;
    }
  }

  // No roster context: keep Team Need honest. The blended winner is still the
  // scarcity/value pick, but we tell the user it is not a roster-tailored edge.
  // aligned stays false so the fallback copy never shows under a "value and need
  // align" header.
  if (!input.rosterKnown) {
    const player = needWinner ?? bestPlayer;
    return {
      best,
      need: player
        ? { kind: "need", player, reason: FALLBACK_NEED_REASON, decidingFactor: "none", filledSlot: null }
        : emptyNeedCard(),
      aligned: false,
      rosterKnown: false,
      positionNeeds,
      debug,
    };
  }

  const aligned = Boolean(bestPlayer && needWinner && bestPlayer.playerId === needWinner.playerId);
  const winnerSlot = needWinner ? debug[needWinner.playerId].filledSlot : null;

  const need: RecommendationCardData = needWinner
    ? {
        kind: "need",
        player: needWinner,
        reason: aligned
          ? "The best value on the board is also your biggest roster need."
          : buildNeedReason(needWinner, winnerSlot, { superflex, tep }),
        decidingFactor: aligned ? "value" : "need",
        filledSlot: winnerSlot && winnerSlot !== needWinner.position ? labelForSlot(winnerSlot) : winnerSlot,
      }
    : emptyNeedCard();

  return { best, need, aligned, rosterKnown: true, positionNeeds, debug };
}

/**
 * Positional reach: how far p sits below the best AVAILABLE player at the SAME
 * position, gated by a tier break (only nonzero once p is more than
 * maxReachTierBreak tiers below the best same-position option). Each tier beyond
 * the gate adds 25 reach points. Positional (never global), so filling a needed
 * position is never penalized for sitting below an unrelated top player.
 */
export function reachScoreFor(
  player: RankedPlayer,
  pool: RankedPlayer[],
  maxReachTierBreak: number,
): number {
  let bestTier = player.tier;
  let bestValue = -Infinity;
  for (const q of pool) {
    if (q.position !== player.position) continue;
    if (q.value > bestValue) {
      bestValue = q.value;
      bestTier = q.tier;
    }
  }
  const tiersBelow = player.tier - bestTier - maxReachTierBreak;
  if (tiersBelow <= 0) return 0;
  return Math.min(100, tiersBelow * 25);
}

function labelForSlot(slot: SlotLabel): string {
  return slot === "SUPER_FLEX" ? "Superflex" : slot === "FLEX" ? "Flex" : slot;
}

function summarizeNeeds(open: OpenSlots): PositionNeed[] {
  const order: SlotLabel[] = ["QB", "RB", "WR", "TE", "SUPER_FLEX", "FLEX", "DEF", "K"];
  return order
    .filter((slot) => open[slot] > 0)
    .map((slot) => ({ slot, openSlots: open[slot], label: labelForSlot(slot) }));
}
