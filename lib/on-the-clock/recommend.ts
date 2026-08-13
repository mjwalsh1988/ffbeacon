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
 * TWO ENGINES, AND WHICH ONE RUNS
 *
 * When per-player projections are available (the pulse route supplies them), Team
 * Need is answered in POINTS: how much does this player add to your optimal
 * starting lineup, what does he cost you to wait on, and what is he worth if the
 * starter ahead of him gets hurt. See marginal.ts for that math and for why the
 * weight on points decays as the starting lineup fills.
 *
 * When they are not (a projection outage, a season with nothing published, a
 * player nobody projects), the original heuristic runs unchanged:
 *   blended(p) = wValue * valueScore(p) + wNeed * needScore(p) - wReach * reachScore(p)
 * where needScore is the slot-fill model below. The card says which one it used.
 *
 * The heuristic is kept rather than deleted because it is the only thing that
 * works with no projection data at all, and a draft room that goes blank because
 * Sleeper did not publish is worse than one that reasons from value alone.
 *
 * DST/K are ALWAYS in the room (board / lists / picks) and CAN be Best Available if
 * the user position-filters to them, but Team Need suppresses DST/K until a late
 * roster-need gate passes (admin-tunable round + "team lacks one" + league requires
 * the slot). See ON-THE-CLOCK-PLAN.md section 7.
 */

import type { DraftPosition, RankedPlayer, RecommendationCardData } from "./board-types";
import type { BuildMode, OnTheClockSettings, PlayerPool } from "./types";
import { pickBestByValue } from "./draft-derive";
import { pointsWeightFor, type MarginalOutput, type MarginalResult } from "./marginal";

// ---------------------------------------------------------------------------
// Inputs / outputs
// ---------------------------------------------------------------------------

export interface RecommendInput {
  /** Available board: excludeDrafted + filterPool already applied by the caller. */
  available: RankedPlayer[];
  /**
   * Active pool ("everyone" | "rookies").
   *
   * NOT read by the engine. `available` already has filterPool applied, so the
   * pool cannot change an answer here; the "no ranked players in this pool"
   * copy is written from the empty board rather than from this flag. Kept on the
   * input because every caller has it and because a future rookie-specific
   * ordering would want it, but it is documentation, not a dependency.
   */
  pool: PlayerPool;
  /** Detected FF Beacon format slug (used for Superflex / TEP detection). */
  formatSlug: string;
  /** Detected FF Beacon format display label. Carried for callers, not read here. */
  formatLabel: string;
  /** Sleeper draft.settings (slots_qb/rb/wr/te/flex/super_flex/k/def, teams, rounds). */
  draftSettings: Record<string, number>;
  /**
   * The league's roster_positions, when captured. Preferred over draft.settings
   * for the slot model because it is the only source that separates a receiving
   * flex from a superflex. Optional so callers without it still work.
   */
  rosterPositions?: string[];
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
  /**
   * How the drafter wants this team built. Only meaningful in a dynasty startup;
   * every other room passes the mode its format forces. Defaults to "balanced",
   * which reproduces the pre-mode behaviour exactly.
   */
  mode?: BuildMode;
  /**
   * Marginal starting-lineup values from the pulse route, keyed by player id.
   * Null switches Team Need back to the slot-fill heuristic, and the card says so.
   */
  marginal?: MarginalOutput | null;
  /**
   * Per-player projection summaries for the reason copy and the compete tilt.
   * Keyed by player id; a missing player simply has no points opinion.
   */
  projections?: Record<string, { ppw: number; br: number | null }> | null;
  /**
   * How many selections happen before the connected user's next pick, from the
   * ADP simulation. Drives the scarcity sentence ("nine backs go before you are
   * back up"). Null when the next pick could not be resolved.
   */
  picksUntilNext?: number | null;
  /**
   * Player id to display name for the roster the recommendation is FOR, so the
   * copy can name whoever a pick would displace. The available board cannot
   * supply it: the displaced player is already drafted and therefore off it.
   */
  myRosterNames?: Record<string, string>;
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
  /** The build mode the cards were produced under. */
  mode: BuildMode;
  /** Which engine answered Team Need. */
  engine: "points" | "heuristic";
  /**
   * The format shape the cards were scored under, so the explanatory copy can
   * say WHY a quarterback is priced the way he is here without re-deriving it.
   * Superflex is not a slug test alone: a league carrying a SUPER_FLEX slot
   * counts even when its closest FF Beacon format does not say so.
   */
  superflex: boolean;
  tep: boolean;
  /**
   * How much of Team Need rode on this season's points, 0 to 1. Zero on the
   * heuristic path. Surfaced so the room can explain a full-lineup handover.
   */
  pointsWeight: number;
  /**
   * Ordering score per available player, keyed by id, on the same scale the
   * cards were chosen with. The available list sorts by this so the board a
   * drafter reads always matches the recommendation above it.
   */
  orderScore: Record<string, number>;
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
 * Which SlotModel bucket a Sleeper roster_positions token belongs to. Null for
 * bench / IR / taxi and for tokens we cannot fill (IDP).
 *
 * The receiving flexes (REC_FLEX, WR_TE) and the run-pass flexes (WRRB_FLEX,
 * WRRB_WRT) all fold into FLEX here. This model is deliberately coarse: it
 * drives roster-need copy and the "is the lineup full" checks. The exact
 * eligibility that decides who actually starts lives in PULSE_SLOT_ELIGIBILITY
 * and is used by the lineup optimizer, which is what the points-based
 * recommendation and Draft Pulse score through.
 */
function slotBucketFor(token: string): keyof SlotModel | null {
  switch (token.toUpperCase()) {
    case "QB":
      return "QB";
    case "RB":
      return "RB";
    case "WR":
      return "WR";
    case "TE":
      return "TE";
    case "K":
      return "K";
    case "DEF":
    case "DST":
      return "DEF";
    case "FLEX":
    case "REC_FLEX":
    case "WR_TE":
    case "WRRB_FLEX":
    case "WRRB_WRT":
      return "FLEX";
    case "SUPER_FLEX":
    case "Q_FLEX":
      return "SUPER_FLEX";
    default:
      return null;
  }
}

/** True when the league's own roster_positions produced at least one startable slot. */
function modelFromRosterPositions(rosterPositions: string[]): SlotModel | null {
  const model: SlotModel = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPER_FLEX: 0, K: 0, DEF: 0 };
  let any = false;
  for (const token of rosterPositions) {
    const bucket = slotBucketFor(token);
    if (!bucket) continue;
    model[bucket] += 1;
    any = true;
  }
  return any ? model : null;
}

/**
 * Build the starting-slot model. Three sources, best first:
 *   1. The league's own roster_positions (captured with the league object,
 *      migration 0180). This is the only source that distinguishes a receiving
 *      flex from a superflex, so it is always preferred when present.
 *   2. The Sleeper draft.settings slots_* counts, which flatten the flex family.
 *   3. The admin positionFallbackTargets, when a draft carries neither.
 */
export function buildSlotModel(
  draftSettings: Record<string, number>,
  settings: OnTheClockSettings,
  rosterPositions?: string[],
): SlotModel {
  if (rosterPositions && rosterPositions.length > 0) {
    const fromLeague = modelFromRosterPositions(rosterPositions);
    if (fromLeague) return fromLeague;
  }

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
 * Replacement value per position = the value of the FIRST NON-startable player
 * still available at that position, which is the conventional replacement level.
 * `depth` counts the startable slots league-wide, and a 0-based index of `depth`
 * is the player one past them.
 *
 * (The doc here used to say "last startable player", which is the player one
 * index EARLIER. The code was always the conventional definition; the sentence
 * was the thing that was wrong.)
 *
 * Computed from the AVAILABLE board, so scarcity tracks what is actually left: a
 * run on running backs raises every remaining back's VORP.
 * VORP(p) = max(0, value(p) - replacement[pos]).
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

/**
 * Reason copy for the points engine. Every sentence names the number it came
 * from, because "fills a need" is an assertion and "adds 6.2 points a week to
 * your starters" is a fact the reader can check against the board.
 */
function buildPointsReason(
  player: RankedPlayer,
  m: MarginalResult,
  ctx: {
    mode: BuildMode;
    lineupFull: boolean;
    picksUntilNext: number | null;
    displacedName: string | null;
  },
): string {
  const name = player.name;
  const pts = (n: number) => `${n.toFixed(1)} ${n === 1 ? "point" : "points"}`;

  if (ctx.mode === "rebuild") {
    const age = player.ageDecimal ?? player.age;
    const agePart = typeof age === "number" ? `${age.toFixed(1)} years old` : "young";
    return `You are rebuilding, so the empty spots in this year's lineup are not the point. ${name} is ${agePart} and the best long-term asset on the board for you.`;
  }

  if (m.driver === "scarcity" && m.dropoffEdge > 0.1) {
    const when =
      ctx.picksUntilNext !== null && ctx.picksUntilNext > 0
        ? `before your next pick ${ctx.picksUntilNext} selections from now`
        : "before you are back on the clock";
    return `${name} is ${pts(m.dropoffEdge)} a week better than the best ${player.position} we expect to still be there ${when}. Waiting costs you that.`;
  }

  if (m.driver === "upgrade" && ctx.displacedName) {
    return `${name} starts over ${ctx.displacedName} and adds ${pts(m.startingAdd)} a week to your lineup.`;
  }

  if (m.driver === "starter" && m.startingAdd > 0.1) {
    return `${name} steps straight into your starting lineup and adds ${pts(m.startingAdd)} a week.`;
  }

  if (m.driver === "insurance" && m.insuranceAdd > 0.1) {
    return `Your lineup is set at ${player.position}, but if your starter misses time ${name} is worth ${pts(m.insuranceAdd)} a week to you. That is what a bench spot is for.`;
  }

  if (ctx.lineupFull) {
    return `Your starting lineup is full, so this pick is about the asset rather than this week's points. ${name} is the best value left that fits.`;
  }

  return `${name} is the best combination of value and lineup impact on the board right now.`;
}

// ---------------------------------------------------------------------------
// Build-mode scoring helpers
// ---------------------------------------------------------------------------

/**
 * The age past which a dynasty asset at this position stops being an
 * appreciating one. Running backs fall off years before quarterbacks do, so a
 * single number would call a 26-year-old back young and a 26-year-old
 * quarterback old, and both would be wrong.
 */
const YOUTH_REFERENCE_AGE: Record<DraftPosition, number> = {
  QB: 30,
  RB: 26.5,
  WR: 28.5,
  TE: 29,
  K: 30,
  DEF: 30,
};

/** Years below the reference age that map to a full youth score. */
const YOUTH_SPAN = 7;

/**
 * 0 to 100 on youth, position-adjusted. A player at or past the reference age
 * scores zero rather than negative: a rebuild does not want to be told that a
 * 33-year-old is worse than a 31-year-old, only that neither is the point.
 * Unknown age scores 50, which neither rewards nor punishes a missing birth date.
 */
export function youthScore(player: RankedPlayer): number {
  const age = player.ageDecimal ?? player.age;
  if (typeof age !== "number" || !Number.isFinite(age)) return 50;
  const reference = YOUTH_REFERENCE_AGE[player.position];
  return Math.max(0, Math.min(100, ((reference - age) / YOUTH_SPAN) * 100));
}

/** Percentile of a value within a sorted-descending list, 0 to 1. */
function percentileOf(value: number, sortedDesc: number[]): number {
  if (sortedDesc.length <= 1) return 0.5;
  let below = 0;
  for (const v of sortedDesc) if (v < value) below += 1;
  return below / (sortedDesc.length - 1);
}

/**
 * How far this player's projected production outruns his market price. A player
 * the projections like more than the board does is exactly what a rebuild wants
 * to buy, because the price has not caught up yet. Only positive gaps count;
 * being expensive relative to production is already priced into valueScore.
 */
function upsideScore(
  player: RankedPlayer,
  valuePct: number,
  pointsPct: number | null,
): number {
  if (pointsPct === null) return 0;
  return Math.max(0, pointsPct - valuePct) * 100;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

const FALLBACK_NEED_REASON =
  "No clear roster-need edge yet. Best Available is your safest signal until you make a pick or we can read your team.";

/**
 * The mode-and-engine fields for the degenerate early returns (no board, Team
 * Need switched off, only gated kickers left). Nothing was scored, so nothing is
 * claimed: balanced mode, the heuristic engine, no points weight, no ordering.
 */
const DEGRADED = {
  mode: "balanced" as const,
  engine: "heuristic" as const,
  pointsWeight: 0,
  orderScore: {} as Record<string, number>,
};

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

  const model = buildSlotModel(draftSettings, settings, input.rosterPositions);
  const teams = Number.isFinite(draftSettings.teams) && draftSettings.teams > 0 ? draftSettings.teams : 12;
  const superflex = isSuperflexFormat(formatSlug, model);
  const tep = isTepFormat(formatSlug);

  const have = tallyPositions([...input.myDraftedPositions, ...input.seededPositions]);
  const open = assignToSlots(have, model);
  const replacement = replacementByPosition(available, model, teams, superflex);

  const positionNeeds = summarizeNeeds(open);

  // No players, or the Team-Need card is disabled by admin: degrade gracefully.
  if (available.length === 0) {
    return {
      best,
      need: emptyNeedCard(),
      aligned: false,
      rosterKnown: input.rosterKnown,
      positionNeeds,
      debug: {},
      superflex,
      tep,
      ...DEGRADED,
    };
  }
  if (!settings.recommendation.teamNeedEnabled) {
    return {
      best,
      need: { ...emptyNeedCard(), reason: "Team Need is turned off. Best Available is your signal." },
      aligned: false,
      rosterKnown: input.rosterKnown,
      positionNeeds,
      debug: {},
      superflex,
      tep,
      ...DEGRADED,
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
      superflex,
      tep,
      ...DEGRADED,
    };
  }

  // ---- Normalization shared by both engines ----
  const values = available.map((p) => p.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const sortedValues = values.slice().sort((a, b) => b - a);

  const vorRaw = new Map<string, number>();
  for (const p of available) vorRaw.set(p.playerId, Math.max(0, p.value - replacement[p.position]));
  const maxVor = Math.max(...vorRaw.values(), 0);

  // Projected points per week, for the compete tilt and the upside term. Missing
  // players carry no entry, never a zero: we have no opinion, not a bad one.
  const projections = input.projections ?? null;
  const ppwByPlayer = new Map<string, number>();
  if (projections) {
    for (const p of available) {
      const proj = projections[p.playerId];
      if (proj && Number.isFinite(proj.ppw)) ppwByPlayer.set(p.playerId, proj.ppw);
    }
  }
  // Within-position percentiles, so a quarterback is measured against
  // quarterbacks. A cross-position points comparison would just rank every
  // passer first, which is true of raw points and useless as advice.
  const ppwByPosition = new Map<DraftPosition, number[]>();
  for (const p of available) {
    const ppw = ppwByPlayer.get(p.playerId);
    if (ppw === undefined) continue;
    const list = ppwByPosition.get(p.position) ?? [];
    list.push(ppw);
    ppwByPosition.set(p.position, list);
  }
  for (const list of ppwByPosition.values()) list.sort((a, b) => b - a);
  const pointsPctFor = (p: RankedPlayer): number | null => {
    const ppw = ppwByPlayer.get(p.playerId);
    if (ppw === undefined) return null;
    return percentileOf(ppw, ppwByPosition.get(p.position) ?? []);
  };
  const valuePctFor = (p: RankedPlayer): number => percentileOf(p.value, sortedValues);

  const marginal = input.marginal ?? null;
  const hasMarginal = marginal !== null && Object.keys(marginal.byPlayer).length > 0;
  const mode: BuildMode = input.mode ?? "balanced";
  const bm = settings.buildMode;
  const weights = settings.recommendation.weights;
  const debug: Record<string, ScoreBreakdown> = {};

  // How much of Team Need rides on this season's points. Decays as the starting
  // lineup fills, so a full roster is judged on the asset rather than on a lineup
  // the next pick cannot crack. Compete leans harder on points; rebuild is capped
  // so the long game stays in charge whatever the lineup looks like.
  let pointsWeight = 0;
  if (hasMarginal && marginal) {
    pointsWeight = pointsWeightFor(marginal.fullness, {
      empty: bm.pointsWeightEmpty,
      full: bm.pointsWeightFull,
    });
    if (mode === "compete") pointsWeight = Math.min(1, pointsWeight * bm.competePointsBoost);
    if (mode === "rebuild") pointsWeight = Math.min(pointsWeight, bm.rebuildPointsCap);
  }
  const engine: "points" | "heuristic" = hasMarginal ? "points" : "heuristic";

  // ---- Per-player components ----
  const effectiveAdds: number[] = [];
  if (hasMarginal && marginal) {
    for (const p of eligible) {
      const m = marginal.byPlayer[p.playerId];
      if (m) effectiveAdds.push(m.effectiveAdd);
    }
  }
  const maxEffective = Math.max(...effectiveAdds, 0);
  const minEffective = Math.min(...effectiveAdds, 0);

  // Rebuild scoring, rescaled after the loop so youth and upside land on the same
  // 0-100 scale as everything else.
  const rebuildRaw = new Map<string, number>();

  for (const p of eligible) {
    const valueScore = rescale(p.value, minValue, maxValue);
    const vor = vorRaw.get(p.playerId) ?? 0;
    const vorScore = rescale(vor, 0, maxVor);

    rebuildRaw.set(
      p.playerId,
      valueScore +
        bm.youthWeight * youthScore(p) +
        bm.upsideWeight * upsideScore(p, valuePctFor(p), pointsPctFor(p)),
    );

    const fit = slotFitFor(p.position, open);

    // The heuristic need score. Format multipliers live here and ONLY here: the
    // points engine gets superflex and TE premium for free, because it scores
    // through the league's own scoring settings and its own starting slots, and
    // applying a multiplier on top of that would double count the same effect.
    // That double count is exactly what made tight end win Team Need forever.
    let formatMult = 1;
    if (p.position === "QB" && superflex) formatMult *= settings.positionAdjust.superflexQbMultiplier;
    if (p.position === "TE" && tep) formatMult *= settings.positionAdjust.tePremiumMultiplier;
    const heuristicNeedRaw = fit.factor * formatMult * (50 + 0.25 * valueScore + 0.25 * vorScore);

    debug[p.playerId] = {
      playerId: p.playerId,
      valueComponent: valueScore,
      needComponent: heuristicNeedRaw, // rescaled in the second pass
      reachComponent: reachScoreFor(p, eligible, settings.recommendation.maxReachTierBreak),
      vor,
      blended: 0,
      filledSlot: fit.slot,
    };
  }

  // ---- Blend ----
  const heuristicRaws = eligible.map((p) => debug[p.playerId].needComponent);
  const minNeed = Math.min(...heuristicRaws);
  const maxNeed = Math.max(...heuristicRaws);
  const rebuildValues = [...rebuildRaw.values()];
  const minRebuild = Math.min(...rebuildValues);
  const maxRebuild = Math.max(...rebuildValues);

  const orderScore: Record<string, number> = {};

  for (const p of eligible) {
    const b = debug[p.playerId];
    const heuristicNeedScore = rescale(b.needComponent, minNeed, maxNeed);
    b.needComponent = heuristicNeedScore;

    if (!hasMarginal || !marginal) {
      b.blended =
        weights.value * b.valueComponent +
        weights.need * heuristicNeedScore -
        weights.reach * b.reachComponent;
      orderScore[p.playerId] = b.blended;
      continue;
    }

    // Points path. A player with no projection has no points opinion, so his
    // weight on points is zero and he is judged purely on the asset score. That
    // is honest; scoring him at zero points would bury every unprojected rookie.
    const m = marginal.byPlayer[p.playerId];
    const wp = m ? pointsWeight : 0;
    const pointsScore = m ? rescale(m.effectiveAdd, minEffective, maxEffective) : 0;
    const assetScore =
      mode === "rebuild"
        ? rescale(rebuildRaw.get(p.playerId) ?? 0, minRebuild, maxRebuild)
        : b.valueComponent;

    b.blended = wp * pointsScore + (1 - wp) * assetScore - weights.reach * b.reachComponent;
    orderScore[p.playerId] = b.blended;
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

  // ---- Best Value, tilted by mode ----
  // FF Beacon value stays the spine and the mode adds a bounded tilt on top, so
  // the card is always recognisably an FF Beacon Values card rather than a
  // different ranking wearing its name. Compete tilts toward this season's
  // production WITHIN POSITION, which keeps the tilt roster-independent and stops
  // it simply promoting every quarterback.
  const modeBestPlayer =
    pickBestForMode(available, {
      mode,
      tilt: mode === "compete" ? bm.competeValueTilt : bm.rebuildValueTilt,
      pointsPctFor,
      valuePctFor,
    }) ?? bestPlayer;

  const bestCard: RecommendationCardData = {
    kind: "best",
    player: modeBestPlayer,
    reason: modeBestPlayer
      ? mode === "compete"
        ? "The strongest combination of FF Beacon value and this season's projected production left on the board."
        : mode === "rebuild"
          ? "The strongest combination of FF Beacon value and long-term upside left on the board."
          : "Highest FF Beacon value still on the board."
      : "No ranked players are available in this pool yet.",
    decidingFactor: "value",
    filledSlot: null,
    title:
      mode === "compete"
        ? "Best value for a contender"
        : mode === "rebuild"
          ? "Best value for a rebuild"
          : undefined,
    metrics: modeBestPlayer ? describeMetrics(modeBestPlayer, projections) : [],
    engine,
  };

  // No roster context: keep Team Need honest. The blended winner is still the
  // scarcity/value pick, but we tell the user it is not a roster-tailored edge.
  // aligned stays false so the fallback copy never shows under a "value and need
  // align" header.
  if (!input.rosterKnown) {
    const player = needWinner ?? modeBestPlayer;
    return {
      best: bestCard,
      need: player
        ? {
            kind: "need",
            player,
            reason: FALLBACK_NEED_REASON,
            decidingFactor: "none",
            filledSlot: null,
            engine,
            metrics: describeMetrics(player, projections),
          }
        : emptyNeedCard(),
      aligned: false,
      rosterKnown: false,
      positionNeeds,
      debug,
      mode,
      engine,
      superflex,
      tep,
      pointsWeight,
      orderScore,
    };
  }

  const aligned = Boolean(
    modeBestPlayer && needWinner && modeBestPlayer.playerId === needWinner.playerId,
  );
  const winnerSlot = needWinner ? debug[needWinner.playerId].filledSlot : null;
  const winnerMarginal =
    hasMarginal && marginal && needWinner ? marginal.byPlayer[needWinner.playerId] : undefined;

  const need: RecommendationCardData = needWinner
    ? {
        kind: "need",
        player: needWinner,
        reason: aligned
          ? mode === "rebuild"
            ? "The best long-term asset on the board is also the best fit for your build."
            : "The best value on the board is also your biggest roster need."
          : winnerMarginal
            ? buildPointsReason(needWinner, winnerMarginal, {
                mode,
                lineupFull: (marginal?.fullness ?? 0) >= 0.999,
                picksUntilNext: input.picksUntilNext ?? null,
                displacedName: displacedNameFor(winnerMarginal, input.myRosterNames ?? {}),
              })
            : buildNeedReason(needWinner, winnerSlot, { superflex, tep }),
        decidingFactor: aligned ? "value" : "need",
        filledSlot:
          winnerSlot && winnerSlot !== needWinner.position ? labelForSlot(winnerSlot) : winnerSlot,
        engine,
        metrics: buildNeedMetrics(needWinner, winnerMarginal, projections),
      }
    : emptyNeedCard();

  return {
    best: bestCard,
    need,
    aligned,
    rosterKnown: true,
    positionNeeds,
    debug,
    mode,
    engine,
    superflex,
    tep,
    pointsWeight,
    orderScore,
  };
}

/**
 * Best Value under a build mode. FF Beacon value is the base; the mode adds a
 * bounded multiplicative tilt so a mediocre asset can never leapfrog a great one
 * on the strength of the tilt alone.
 */
function pickBestForMode(
  available: RankedPlayer[],
  ctx: {
    mode: BuildMode;
    tilt: number;
    pointsPctFor: (p: RankedPlayer) => number | null;
    valuePctFor: (p: RankedPlayer) => number;
  },
): RankedPlayer | null {
  if (available.length === 0) return null;
  if (ctx.mode === "balanced" || ctx.tilt <= 0) return pickBestByValue(available);

  let winner: RankedPlayer | null = null;
  let winnerScore = -Infinity;
  for (const p of available) {
    let factor = 0;
    if (ctx.mode === "compete") {
      // No projection means no tilt, which is not the same as a penalty.
      factor = ctx.pointsPctFor(p) ?? 0;
    } else {
      const upside = upsideScore(p, ctx.valuePctFor(p), ctx.pointsPctFor(p)) / 100;
      factor = (youthScore(p) / 100) * 0.7 + upside * 0.3;
    }
    const score = p.value * (1 + ctx.tilt * factor);
    if (
      score > winnerScore ||
      (score === winnerScore && winner !== null && p.overallRank < winner.overallRank)
    ) {
      winner = p;
      winnerScore = score;
    }
  }
  return winner;
}

/** The displaced starter's name, from the caller's roster name map. */
function displacedNameFor(m: MarginalResult, names: Record<string, string>): string | null {
  if (!m.displaces) return null;
  return names[m.displaces.playerId] ?? null;
}

/** Short supporting facts for a card. Empty when nothing was measured. */
function describeMetrics(
  player: RankedPlayer,
  projections: Record<string, { ppw: number; br: number | null }> | null | undefined,
): string[] {
  const out: string[] = [];
  const proj = projections?.[player.playerId];
  if (proj && Number.isFinite(proj.ppw)) {
    out.push(`Projected ${proj.ppw.toFixed(1)} points a week`);
  }
  if (proj && proj.br !== null) {
    out.push(`Beats his projection in ${Math.round(proj.br * 100)}% of weeks`);
  }
  const age = player.ageDecimal ?? player.age;
  if (typeof age === "number") out.push(`${age.toFixed(1)} years old`);
  return out;
}

function buildNeedMetrics(
  player: RankedPlayer,
  m: MarginalResult | undefined,
  projections: Record<string, { ppw: number; br: number | null }> | null | undefined,
): string[] {
  const out: string[] = [];
  if (m) {
    if (m.startingAdd > 0.05) {
      out.push(`Adds ${m.startingAdd.toFixed(1)} points a week to your starters`);
    }
    if (m.dropoffEdge > 0.05) {
      out.push(
        `${m.dropoffEdge.toFixed(1)} points a week better than the next one you could wait for`,
      );
    }
    if (m.insuranceAdd > 0.05) {
      out.push(`Worth ${m.insuranceAdd.toFixed(1)} points a week as injury insurance`);
    }
    if (m.weeksStarting > 0) {
      out.push(`Starts for you in ${m.weeksStarting} of ${m.weeksConsidered} remaining weeks`);
    }
  }
  return out.length > 0 ? out : describeMetrics(player, projections);
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
