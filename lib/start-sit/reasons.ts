/**
 * lib/start-sit/reasons.ts
 *
 * The sentences under a start/sit board: the verdict line and the reasons
 * list. Both are deterministic templates, the Trade Ideas rule
 * (lib/trade-impact/reasons.ts): every sentence cites a figure that is on a
 * card, and a null figure means that sentence does not fire. Nothing here is
 * generated. A screen reader user hears three to five short facts and can
 * check every one of them against the cards on the same page.
 *
 * PRONOUNS. The project rules forbid guessing anyone's pronouns, so no
 * template ever produces "he", "his" or "him". A player is named again by
 * surname rather than by pronoun ("Robinson projects 2.4 points clear of
 * Josh Jacobs ... 71 percent to outscore Jacobs"). This is a deliberate
 * departure from the literal wording in section 2.5 of the plan ("He
 * projects..."), which this file does not reproduce.
 *
 * THE BORDERLINE PAIR. Every two-player template (projection margin,
 * matchup, reliability, floor or ceiling) compares the same two cards: the
 * last starter (starters[starters.length - 1], the K-th starter, the one
 * closest to being benched) and the first benched player (bench[0], the one
 * closest to being started). Those are the two cards the confidence meter
 * already measures, so a reason citing them is always citing a figure a
 * reader can find right above it. Section 2.6's own worked example for the
 * reliability template names two different bench players ("Jacobs has beaten
 * his projection ... Kamara in 3 of 8"), which does not use the same pair the
 * matchup and margin examples use. This file uses the borderline pair
 * consistently across all four two-player templates instead, so every
 * reason on a given board is always about the same head-to-head the verdict
 * line and the confidence meter already put in front of the reader.
 *
 * Straight ASCII punctuation only: no em dash, en dash, curly quote or
 * ellipsis character. Percentages in the verdict line are spelled out
 * ("71 percent"), matching the plan's own example; points carry one decimal.
 */

import { ordinal } from "@/lib/league-team-status";
import type { PulsePosition, StartSitCandidate, StartSitProjection } from "./types";

/**
 * Weeks of grading below which a beat rate is too small a sample to state as
 * fact. Mirrors the private MIN_GRADED_WEEKS already used for the same
 * purpose in lib/breakdown/metrics.ts (4) and duplicated in
 * app/tools/who-should-i-start/reliability-tab.tsx. Neither of those exports
 * the constant, and lib/breakdown/metrics.ts pulls in the whole Beacon
 * Breakdown scoring registry, which this pure module has no other reason to
 * depend on, so this file carries its own copy rather than importing it. If
 * lib/breakdown/metrics.ts ever exports MIN_GRADED_WEEKS, this should import
 * that instead of keeping a second literal in sync by hand.
 */
export const MIN_GRADED_WEEKS = 4;

/** Most reason sentences shown under one board, per section 2.5 item 4. */
export const MAX_START_SIT_REASONS = 5;

/** Sentence-case position plurals, for "allows the fourth-most points to running backs". */
const POSITION_PLURAL: Record<PulsePosition, string> = {
  QB: "quarterbacks",
  RB: "running backs",
  WR: "wide receivers",
  TE: "tight ends",
  K: "kickers",
  DEF: "defenses",
};

/** Word ordinals for 2 to 10; numeric ordinals (11th, 12th, ...) beyond that. */
const WORD_ORDINALS: Record<number, string> = {
  2: "second",
  3: "third",
  4: "fourth",
  5: "fifth",
  6: "sixth",
  7: "seventh",
  8: "eighth",
  9: "ninth",
  10: "tenth",
};

/**
 * The plain-data input computeStartSit (lib/start-sit/engine.ts) passes
 * directly: the candidates on the board, one projection per candidate for
 * the selected week, the ranked starters and bench, the confidence figure,
 * and the reader's format label. Everything a template can cite lives here;
 * nothing is read from anywhere else.
 */
export type StartSitReasonInput = {
  candidates: StartSitCandidate[];
  /** Keyed by playerId. */
  projections: Record<string, StartSitProjection>;
  /** playerIds, descending points. */
  starters: string[];
  /** playerIds, descending points. */
  bench: string[];
  /** P(starters[last] outscores bench[0]); null when either sigma is missing. */
  confidence: number | null;
  /** The reader's format, for example "PPR" or "Half PPR". */
  formatDisplay: string;
};

/* -------------------------------------------------------------------------- */
/* Small formatting helpers                                                   */
/* -------------------------------------------------------------------------- */

/** One decimal, unsigned. Used for a difference, where the sentence's own verb carries the direction. */
function marginPoints(value: number): string {
  return Math.abs(value).toFixed(1);
}

/** One decimal, signed as given. Used for a plain figure such as a floor, a ceiling or an implied total. */
function rawPoints(value: number): string {
  return value.toFixed(1);
}

/** A 0-to-1 probability as a whole number, spelled "percent" per the plan's own verdict-line example. */
function percentWord(fraction: number): string {
  return `${Math.round(fraction * 100)} percent`;
}

/** The last space-separated token in a name, for a repeat mention within one sentence. */
function surname(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 0 ? parts[parts.length - 1] : name;
}

/** "A", "A and B", "A, B, and C". */
function nameList(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/**
 * "the most" for rank 1, "the fourth-most" for ranks 2 to 10, "the 12th-most"
 * beyond that. defenseRankVsPosition is 1 for the defense that allows the
 * MOST fantasy points to the position (the easiest matchup), per
 * lib/power-pulse/load.ts DefenseRank.
 */
function rankPhrase(rank: number): string {
  if (rank <= 1) return "the most";
  const word = WORD_ORDINALS[rank];
  return word ? `the ${word}-most` : `the ${ordinal(rank)}-most`;
}

function findCandidate(input: StartSitReasonInput, playerId: string): StartSitCandidate | null {
  return input.candidates.find((c) => c.playerId === playerId) ?? null;
}

function findProjection(input: StartSitReasonInput, playerId: string): StartSitProjection | null {
  return input.projections[playerId] ?? null;
}

/** The last starter and the first benched player: the pair the confidence meter already measures. */
function borderlinePair(
  input: StartSitReasonInput,
): { a: StartSitCandidate; aProj: StartSitProjection; b: StartSitCandidate; bProj: StartSitProjection } | null {
  const aId = input.starters[input.starters.length - 1];
  const bId = input.bench[0];
  if (!aId || !bId) return null;
  const a = findCandidate(input, aId);
  const b = findCandidate(input, bId);
  const aProj = a ? findProjection(input, a.playerId) : null;
  const bProj = b ? findProjection(input, b.playerId) : null;
  if (!a || !b || !aProj || !bProj) return null;
  return { a, aProj, b, bProj };
}

/* -------------------------------------------------------------------------- */
/* Reason templates, in priority order                                        */
/* -------------------------------------------------------------------------- */

/** "{A} projects {x} points clear of {B} in {format}." */
function projectionMarginReason(input: StartSitReasonInput): string | null {
  const pair = borderlinePair(input);
  if (!pair) return null;
  const { a, aProj, b, bProj } = pair;
  if (aProj.points == null || bProj.points == null) return null;
  const delta = aProj.points - bProj.points;
  if (delta < 0) return null;
  return `${a.name} projects ${marginPoints(delta)} points clear of ${b.name} in ${input.formatDisplay}.`;
}

/** "{winner} has the better matchup: {opponent} allows {rank phrase} points to {position plural}." */
function matchupReason(input: StartSitReasonInput): string | null {
  const pair = borderlinePair(input);
  if (!pair) return null;
  const { a, aProj, b, bProj } = pair;
  const aRank = aProj.defenseRankVsPosition;
  const bRank = bProj.defenseRankVsPosition;
  if (aRank == null || bRank == null) return null;
  if (aRank === bRank) return null;
  const aBetter = aRank < bRank;
  const winnerCandidate = aBetter ? a : b;
  const winnerProj = aBetter ? aProj : bProj;
  const winnerRank = aBetter ? aRank : bRank;
  if (!winnerProj.opponent) return null;
  return `${winnerCandidate.name} has the better matchup: ${winnerProj.opponent} allows ${rankPhrase(
    winnerRank,
  )} points to ${POSITION_PLURAL[winnerCandidate.position]}.`;
}

/** "{A} has beaten the projection in {m} of {n} graded weeks; {B} in {p} of {q}." */
function reliabilityReason(input: StartSitReasonInput): string | null {
  const pair = borderlinePair(input);
  if (!pair) return null;
  const { a, aProj, b, bProj } = pair;
  if (aProj.beatRate == null || aProj.weeksGraded < MIN_GRADED_WEEKS) return null;
  if (bProj.beatRate == null || bProj.weeksGraded < MIN_GRADED_WEEKS) return null;
  const m = Math.round(aProj.beatRate * aProj.weeksGraded);
  const n = aProj.weeksGraded;
  const p = Math.round(bProj.beatRate * bProj.weeksGraded);
  const q = bProj.weeksGraded;
  return `${a.name} has beaten the projection in ${m} of ${n} graded weeks; ${b.name} in ${p} of ${q}.`;
}

/** "{lowest}'s game has the lowest implied total of the {N}, at {t}." */
function environmentReason(input: StartSitReasonInput): string | null {
  const ids = [...input.starters, ...input.bench];
  const rows: { candidate: StartSitCandidate; total: number }[] = [];
  for (const id of ids) {
    const c = findCandidate(input, id);
    const p = findProjection(input, id);
    if (!c || !p || p.environment == null || p.environment.impliedTotal == null) return null;
    rows.push({ candidate: c, total: p.environment.impliedTotal });
  }
  if (rows.length < 2) return null;
  const lowest = rows.reduce((min, cur) => (cur.total < min.total ? cur : min));
  return `${lowest.candidate.name}'s game has the lowest implied total of the ${rows.length}, at ${rawPoints(
    lowest.total,
  )}.`;
}

/**
 * "If you need a safe floor, {A}'s is {f} to {B}'s {g}." when the confidence
 * favours A (the last starter); "If you're chasing upside, {A}'s ceiling is
 * {f} to {B}'s {g}." when it does not. Only one of the two ever fires for a
 * given board, decided by which side of even the confidence figure sits.
 */
function floorOrCeilingReason(input: StartSitReasonInput): string | null {
  if (input.confidence == null) return null;
  const pair = borderlinePair(input);
  if (!pair) return null;
  const { a, aProj, b, bProj } = pair;
  if (input.confidence >= 0.5) {
    if (aProj.floor == null || bProj.floor == null) return null;
    return `If you need a safe floor, ${a.name}'s is ${rawPoints(aProj.floor)} points to ${b.name}'s ${rawPoints(
      bProj.floor,
    )}.`;
  }
  if (aProj.ceiling == null || bProj.ceiling == null) return null;
  return `If you're chasing upside, ${a.name}'s ceiling is ${rawPoints(
    aProj.ceiling,
  )} points to ${b.name}'s ${rawPoints(bProj.ceiling)}.`;
}

/** One "{C} is on bye." or "{C} is listed {status}." per candidate, in starters-then-bench order. */
function byeAndInjuryReasons(input: StartSitReasonInput): string[] {
  const out: string[] = [];
  for (const id of [...input.starters, ...input.bench]) {
    const c = findCandidate(input, id);
    if (!c) continue;
    const p = findProjection(input, id);
    if (p?.onBye) {
      out.push(`${c.name} is on bye.`);
      continue;
    }
    if (c.injuryStatus) {
      out.push(`${c.name} is listed ${c.injuryStatus}.`);
    }
  }
  return out;
}

/** Fires once when the board mixes positions, since points are being compared directly across them. */
function mixedPositionReason(input: StartSitReasonInput): string | null {
  const positions = new Set<PulsePosition>();
  for (const id of [...input.starters, ...input.bench]) {
    const c = findCandidate(input, id);
    if (c) positions.add(c.position);
  }
  if (positions.size <= 1) return null;
  return "Points are compared directly across positions here; a flex slot is the usual reason to do that.";
}

/**
 * Every candidate reason, in the priority order section 2.6 names, capped at
 * MAX_START_SIT_REASONS. A null template is skipped rather than leaving a
 * gap; bye and injury can contribute more than one sentence, and the cap is
 * applied to the combined list last, so a low-priority template never bumps
 * a higher-priority one out.
 */
export function buildStartSitReasons(input: StartSitReasonInput): string[] {
  const ordered: string[] = [];

  const margin = projectionMarginReason(input);
  if (margin) ordered.push(margin);

  const matchup = matchupReason(input);
  if (matchup) ordered.push(matchup);

  const reliability = reliabilityReason(input);
  if (reliability) ordered.push(reliability);

  const environment = environmentReason(input);
  if (environment) ordered.push(environment);

  const floorOrCeiling = floorOrCeilingReason(input);
  if (floorOrCeiling) ordered.push(floorOrCeiling);

  ordered.push(...byeAndInjuryReasons(input));

  const mixed = mixedPositionReason(input);
  if (mixed) ordered.push(mixed);

  return ordered.slice(0, MAX_START_SIT_REASONS);
}

/* -------------------------------------------------------------------------- */
/* The verdict line, section 2.5 item 1                                       */
/* -------------------------------------------------------------------------- */

/**
 * The one-sentence verdict, role="status" on the board. For a single start it
 * is "Start {A}." plus a clause citing whichever of the margin and the
 * confidence are available, in that order, comma-joined exactly as section
 * 2.5's own example does. For more than one start it is "Start {A} and
 * {B}." plus, when a confidence figure exists for the boundary, "The last
 * spot is close: {last starter} is {x} percent to outscore {first bench}."
 * Either clause is omitted, never invented, when its figure is null.
 */
export function buildStartSitVerdictLine(input: StartSitReasonInput): string {
  const starters = input.starters
    .map((id) => findCandidate(input, id))
    .filter((c): c is StartSitCandidate => c !== null);
  if (starters.length === 0) return "";

  if (starters.length === 1) {
    const a = starters[0];
    let sentence = `Start ${a.name}.`;

    const bId = input.bench[0];
    const b = bId ? findCandidate(input, bId) : null;
    if (!b) return sentence;

    const aProj = findProjection(input, a.playerId);
    const bProj = findProjection(input, b.playerId);

    const clauses: string[] = [];
    let bNamedInFull = false;

    if (aProj?.points != null && bProj?.points != null) {
      const delta = aProj.points - bProj.points;
      if (delta >= 0) {
        clauses.push(
          `${surname(a.name)} projects ${marginPoints(delta)} points clear of ${b.name} in ${input.formatDisplay}`,
        );
        bNamedInFull = true;
      }
    }

    if (input.confidence != null) {
      const pct = percentWord(input.confidence);
      if (clauses.length > 0) {
        clauses.push(`${pct} to outscore ${bNamedInFull ? surname(b.name) : b.name}`);
      } else {
        clauses.push(`${surname(a.name)} is ${pct} to outscore ${b.name}`);
      }
    }

    if (clauses.length > 0) sentence += ` ${clauses.join(", ")}.`;
    return sentence;
  }

  const sentence = `Start ${nameList(starters.map((c) => c.name))}.`;
  const lastStarter = starters[starters.length - 1];
  const bId = input.bench[0];
  const b = bId ? findCandidate(input, bId) : null;
  if (!b || input.confidence == null) return sentence;

  return `${sentence} The last spot is close: ${surname(lastStarter.name)} is ${percentWord(
    input.confidence,
  )} to outscore ${b.name}.`;
}
