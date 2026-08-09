/**
 * Draft grades: a letter per team, and enough evidence that the letter is
 * arguable rather than mysterious.
 *
 * Six components, each scored 0 to 100 and each carrying one sentence naming the
 * number it came from:
 *
 *   market        value captured against the market price of the slots spent
 *   lineup        projected starting-lineup points per week (Draft Pulse)
 *   construction  did they actually fill the lineup this league requires
 *   reliability   how often their projected starters beat their projections
 *   future        dynasty only: young core plus the picks they still hold
 *   trades        FF Beacon value margin across the deals they made in-draft
 *
 * HOW THE CURVE WORKS, AND WHY IT IS MOSTLY A CURVE
 * Every team in a startup drains the same player pool. Twelve teams cannot all
 * draft well, and an absolute bar would either hand out twelve As in a weak room
 * or twelve Cs in a strong one. So each component is scored against the league,
 * through the same z-to-display mapping Power Pulse uses, which puts an average
 * team at 50 and the clear best in the high 80s.
 *
 * `absoluteBlend` then pulls part of the way back toward an anchored score, so a
 * room where everyone drafted well is not forced to produce an F, and a room
 * where everyone reached is not handed an A for being least bad. The default
 * leans on the curve because the curve is the honest part.
 *
 * A component with no data is DROPPED and its weight redistributed, never scored
 * zero. A dynasty-only component in a redraft league is not a failure, and a team
 * that made no trades has not lost the trade component; it simply does not have
 * one.
 *
 * Deterministic and pure. The written review is built from templates rather than
 * a model, because a grade frozen into a snapshot has to reproduce exactly and
 * because every sentence here has to be traceable to a number above it.
 */

import { round, zScores, zToDisplay } from "@/lib/power-pulse/math";
import type { DraftPulseTeam } from "./draft-pulse";
import type { TeamRollup } from "./rosters";
import { surplusByRoster, type PickSurplus } from "./surplus";
import type { GradeSettings } from "./types";

/** Bump when a change alters what a grade means, so old snapshots stay readable. */
export const GRADE_VERSION = 1;

export type GradeComponentKey =
  | "market"
  | "lineup"
  | "construction"
  | "reliability"
  | "future"
  | "trades";

export interface GradeComponent {
  key: GradeComponentKey;
  label: string;
  /** 0 to 100 after curve and anchor are blended. */
  score: number;
  /** Share of the final grade this component carried, after redistribution. */
  weight: number;
  /** One sentence naming the number behind the score. */
  evidence: string;
}

export interface DraftGrade {
  rosterId: number;
  ownerName: string;
  teamName: string | null;
  isYou: boolean;
  /** 0 to 100 composite. */
  score: number;
  letter: string;
  /** 1 = best draft in the league. */
  rank: number;
  components: GradeComponent[];
  /** Components that had no data and were left out of the weighting. */
  omitted: { key: GradeComponentKey; label: string; why: string }[];
  review: string;
  bestPick: { playerName: string; pickNo: number; surplus: number } | null;
  worstPick: { playerName: string; pickNo: number; surplus: number } | null;
  /** The slot still costing them the most, from Draft Pulse. Null when unknown. */
  biggestHole: string | null;
}

export interface DraftGradeInput {
  rollups: TeamRollup[];
  pulseTeams: DraftPulseTeam[];
  pickSurpluses: PickSurplus[];
  /** Per roster: net FF Beacon value margin across their completed in-draft trades. */
  tradeMarginByRoster: Map<number, { total: number; trades: number }>;
  /** Draft Pulse's startable slot count, for the construction component. */
  startingSlotCount: number;
  isDynasty: boolean;
  settings: GradeSettings;
  /** True while the draft is still running, which softens the review copy. */
  inProgress: boolean;
}

const LABELS: Record<GradeComponentKey, string> = {
  market: "Value vs the market",
  lineup: "Starting lineup",
  construction: "Roster construction",
  reliability: "Starter reliability",
  future: "Future assets",
  trades: "Trades",
};

/**
 * Anchors for the absolute half of each component. These are the only magic
 * numbers in the file and they are all "what a good team looks like":
 *   MARKET_REFERENCE   value points of surplus per pick that reads as excellent
 *   LINEUP_REFERENCE   projected points per starting slot per week
 *   FUTURE_REFERENCE   share of a roster's value held in picks and young players
 */
const MARKET_REFERENCE = 350;
const LINEUP_REFERENCE = 14;
const FUTURE_REFERENCE = 0.45;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Within-league score, average team at 50. Everyone equal gives everyone 50. */
function curveScores(values: number[]): number[] {
  // The same z-score and the same display mapping Power Pulse uses. zScores
  // returns 0 for a flat set, and zToDisplay(0) is the midpoint, so the
  // everyone-identical case still lands on 50 without a special branch.
  return zScores(values).map((z) => zToDisplay(z, { min: 0, max: 100, sharpness: 1 }));
}

/** Letter for a 0 to 100 composite. */
export function letterFor(score: number): string {
  if (score >= 93) return "A+";
  if (score >= 88) return "A";
  if (score >= 83) return "A-";
  if (score >= 78) return "B+";
  if (score >= 73) return "B";
  if (score >= 68) return "B-";
  if (score >= 63) return "C+";
  if (score >= 58) return "C";
  if (score >= 53) return "C-";
  if (score >= 48) return "D+";
  if (score >= 43) return "D";
  if (score >= 38) return "D-";
  return "F";
}

interface RawComponent {
  key: GradeComponentKey;
  /** Raw value per roster; missing roster means no data for that team. */
  raw: Map<number, number>;
  /** Absolute anchor per roster, 0 to 100. */
  anchor: Map<number, number>;
  /** Evidence sentence per roster. */
  evidence: Map<number, string>;
  /** Why the component is absent, when it is absent for everyone. */
  absentReason: string;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString();
}

/**
 * Grade every team. Returns them ranked, best first.
 */
export function computeDraftGrades(input: DraftGradeInput): DraftGrade[] {
  const { rollups, pulseTeams, pickSurpluses, settings } = input;
  if (rollups.length === 0) return [];

  const rosterIds = rollups.map((r) => r.rosterId);
  const pulseById = new Map(pulseTeams.map((t) => [t.rosterId, t]));

  // ---- market ----
  // surplus.ts already rolls these up, and it also computes the average, which
  // this used to do again a few lines later.
  const surplusTotals = surplusByRoster(pickSurpluses);
  const market: RawComponent = {
    key: "market",
    raw: new Map(),
    anchor: new Map(),
    evidence: new Map(),
    absentReason: "Sleeper ADP is not available for this draft, so there is no market to measure against.",
  };
  for (const id of rosterIds) {
    const entry = surplusTotals.get(id);
    if (!entry || entry.count === 0) continue;
    const perPick = entry.average;
    market.raw.set(id, perPick);
    market.anchor.set(id, 50 + 50 * Math.max(-1, Math.min(1, perPick / MARKET_REFERENCE)));
    market.evidence.set(
      id,
      entry.total >= 0
        ? `Picked up ${fmt(entry.total)} points of value over the market price of their ${entry.count} priced picks.`
        : `Paid ${fmt(Math.abs(entry.total))} points over the market price of their ${entry.count} priced picks.`,
    );
  }

  // ---- lineup ----
  const lineup: RawComponent = {
    key: "lineup",
    raw: new Map(),
    anchor: new Map(),
    evidence: new Map(),
    absentReason: "Weekly projections are not available for this league, so lineups could not be scored.",
  };
  for (const id of rosterIds) {
    const t = pulseById.get(id);
    if (!t || t.projectedCount === 0) continue;
    lineup.raw.set(id, t.meanStartingPoints);
    const perSlot = input.startingSlotCount > 0 ? t.meanStartingPoints / input.startingSlotCount : 0;
    lineup.anchor.set(id, 100 * clamp01(perSlot / LINEUP_REFERENCE));
    lineup.evidence.set(
      id,
      `Projects ${t.meanStartingPoints.toFixed(1)} points a week from their starting lineup, ${ordinalish(t.rank)} in the league.`,
    );
  }

  // ---- construction ----
  const construction: RawComponent = {
    key: "construction",
    raw: new Map(),
    anchor: new Map(),
    evidence: new Map(),
    absentReason: "The league's starting lineup could not be read, so construction was not scored.",
  };
  if (input.startingSlotCount > 0) {
    for (const id of rosterIds) {
      const t = pulseById.get(id);
      if (!t) continue;
      const filled = clamp01(t.startersFilled / input.startingSlotCount);
      construction.raw.set(id, filled);
      construction.anchor.set(id, filled * 100);
      construction.evidence.set(
        id,
        filled >= 0.999
          ? `Fills every one of the ${input.startingSlotCount} starting spots this league requires.`
          : `Fills ${t.startersFilled.toFixed(1)} of ${input.startingSlotCount} starting spots in the average week.`,
      );
    }
  }

  // ---- reliability ----
  const reliability: RawComponent = {
    key: "reliability",
    raw: new Map(),
    anchor: new Map(),
    evidence: new Map(),
    absentReason: "None of these starters have enough projection history to score reliability.",
  };
  for (const id of rosterIds) {
    const t = pulseById.get(id);
    if (!t || t.starterBeatRate == null) continue;
    reliability.raw.set(id, t.starterBeatRate);
    reliability.anchor.set(id, clamp01(t.starterBeatRate) * 100);
    reliability.evidence.set(
      id,
      `Their projected starters have beaten their projections in ${Math.round(t.starterBeatRate * 100)}% of weeks played.`,
    );
  }

  // ---- future (dynasty only) ----
  const future: RawComponent = {
    key: "future",
    raw: new Map(),
    anchor: new Map(),
    evidence: new Map(),
    absentReason: input.isDynasty
      ? "No future pick values are published for this format."
      : "This is a redraft league, so there are no future assets to hold.",
  };
  if (input.isDynasty) {
    for (const r of rollups) {
      if (r.totalValue <= 0) continue;
      const share = r.futurePicksValue / r.totalValue;
      future.raw.set(r.rosterId, share);
      future.anchor.set(r.rosterId, 100 * clamp01(share / FUTURE_REFERENCE));
      future.evidence.set(
        r.rosterId,
        r.futurePicks.length > 0
          ? `Holds ${r.futurePicks.length} future ${r.futurePicks.length === 1 ? "pick" : "picks"} worth ${fmt(r.futurePicksValue)}, ${Math.round(share * 100)}% of everything they own.`
          : "Holds no future picks.",
      );
    }
  }

  // ---- trades ----
  const trades: RawComponent = {
    key: "trades",
    raw: new Map(),
    anchor: new Map(),
    evidence: new Map(),
    absentReason: "Nobody traded during this draft.",
  };
  for (const [rosterId, entry] of input.tradeMarginByRoster) {
    if (entry.trades === 0) continue;
    const perTrade = entry.total / entry.trades;
    trades.raw.set(rosterId, perTrade);
    trades.anchor.set(rosterId, 50 + 50 * Math.max(-1, Math.min(1, perTrade / MARKET_REFERENCE)));
    trades.evidence.set(
      rosterId,
      entry.total >= 0
        ? `Came out ${fmt(entry.total)} points ahead across ${entry.trades} ${entry.trades === 1 ? "trade" : "trades"}.`
        : `Came out ${fmt(Math.abs(entry.total))} points behind across ${entry.trades} ${entry.trades === 1 ? "trade" : "trades"}.`,
    );
  }

  const components: RawComponent[] = [market, lineup, construction, reliability, future, trades];

  // Curve each component across the teams that HAVE it, then blend with its
  // anchor. A team missing a component is not scored on it at all.
  const scored = new Map<GradeComponentKey, Map<number, number>>();
  for (const component of components) {
    const ids = [...component.raw.keys()];
    const curved = curveScores(ids.map((id) => component.raw.get(id) as number));
    const out = new Map<number, number>();
    ids.forEach((id, i) => {
      const anchor = component.anchor.get(id) ?? curved[i];
      out.set(id, (1 - settings.absoluteBlend) * curved[i] + settings.absoluteBlend * anchor);
    });
    scored.set(component.key, out);
  }

  const weightOf: Record<GradeComponentKey, number> = {
    market: settings.weights.market,
    lineup: settings.weights.lineup,
    construction: settings.weights.construction,
    reliability: settings.weights.reliability,
    future: settings.weights.future,
    trades: settings.weights.trades,
  };

  const bestByRoster = new Map<number, PickSurplus>();
  const worstByRoster = new Map<number, PickSurplus>();
  for (const s of pickSurpluses) {
    const best = bestByRoster.get(s.rosterId);
    if (!best || s.surplus > best.surplus) bestByRoster.set(s.rosterId, s);
    const worst = worstByRoster.get(s.rosterId);
    if (!worst || s.surplus < worst.surplus) worstByRoster.set(s.rosterId, s);
  }

  const grades: DraftGrade[] = rollups.map((r) => {
    const present: GradeComponent[] = [];
    const omitted: DraftGrade["omitted"] = [];
    let totalWeight = 0;

    for (const component of components) {
      const score = scored.get(component.key)?.get(r.rosterId);
      const weight = weightOf[component.key];
      if (score === undefined || weight <= 0) {
        omitted.push({
          key: component.key,
          label: LABELS[component.key],
          // A component the admin has zeroed is not a component with no data,
          // and reporting the data reason for it would be untrue.
          why: weight <= 0 ? "Switched off in the grade settings." : component.absentReason,
        });
        continue;
      }
      totalWeight += weight;
      present.push({
        key: component.key,
        label: LABELS[component.key],
        score: round(score, 1),
        weight,
        evidence: component.evidence.get(r.rosterId) ?? "",
      });
    }

    // Redistribute: the weights that survived are renormalized so a team missing
    // a component is judged on what it does have rather than scored zero on what
    // it does not.
    for (const c of present) c.weight = totalWeight > 0 ? round(c.weight / totalWeight, 3) : 0;
    const composite =
      totalWeight > 0 ? present.reduce((sum, c) => sum + c.score * c.weight, 0) : 50;

    const pulse = pulseById.get(r.rosterId) ?? null;
    const best = bestByRoster.get(r.rosterId) ?? null;
    const worst = worstByRoster.get(r.rosterId) ?? null;

    return {
      rosterId: r.rosterId,
      ownerName: r.ownerName,
      teamName: r.teamName,
      isYou: r.isYou,
      score: round(composite, 1),
      letter: letterFor(composite),
      rank: 0,
      components: present,
      omitted,
      review: "",
      bestPick:
        best && best.surplus > 0
          ? { playerName: best.playerName, pickNo: best.pickNo, surplus: Math.round(best.surplus) }
          : null,
      worstPick:
        worst && worst.surplus < 0
          ? { playerName: worst.playerName, pickNo: worst.pickNo, surplus: Math.round(worst.surplus) }
          : null,
      biggestHole: pulse?.weakestSlot ?? null,
    };
  });

  grades.sort((a, b) => b.score - a.score || a.rosterId - b.rosterId);
  grades.forEach((g, i) => {
    g.rank = i + 1;
    g.review = buildReview(g, grades.length, input);
  });
  return grades;
}

function ordinalish(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

const SLOT_WORDS: Record<string, string> = {
  QB: "quarterback",
  RB: "running back",
  WR: "receiver",
  TE: "tight end",
  K: "kicker",
  DEF: "defense",
  DST: "defense",
  FLEX: "flex",
  REC_FLEX: "receiving flex",
  WR_TE: "receiving flex",
  WRRB_FLEX: "flex",
  WRRB_WRT: "flex",
  SUPER_FLEX: "superflex",
  Q_FLEX: "superflex",
};

/**
 * The written review. Built from templates rather than a model, so a grade
 * frozen into a snapshot reproduces exactly and every sentence traces to a
 * number in the components above it.
 */
function buildReview(grade: DraftGrade, teamCount: number, input: DraftGradeInput): string {
  const parts: string[] = [];
  const where = `${ordinalish(grade.rank)} of ${teamCount}`;

  const opening = input.inProgress
    ? `${grade.letter} so far, ${where} in the room with the draft still running.`
    : `${grade.letter}, ${where} in the room.`;
  parts.push(opening);

  // Lead with whichever component was furthest from average, in either direction,
  // because that is the thing that actually decided the letter.
  const sorted = grade.components
    .slice()
    .sort((a, b) => Math.abs(b.score - 50) * b.weight - Math.abs(a.score - 50) * a.weight);
  const driver = sorted[0];
  if (driver?.evidence) parts.push(driver.evidence);
  const second = sorted[1];
  if (second?.evidence) parts.push(second.evidence);

  if (grade.bestPick) {
    parts.push(
      `Their best moment was ${grade.bestPick.playerName} at pick ${grade.bestPick.pickNo}, worth ${fmt(grade.bestPick.surplus)} more than that slot usually costs.`,
    );
  }
  if (grade.worstPick) {
    parts.push(
      `The one to argue about is ${grade.worstPick.playerName} at pick ${grade.worstPick.pickNo}, ${fmt(Math.abs(grade.worstPick.surplus))} over the going rate.`,
    );
  }

  if (grade.biggestHole) {
    const word = SLOT_WORDS[grade.biggestHole] ?? grade.biggestHole;
    parts.push(
      input.inProgress
        ? `The ${word} spot is still costing them the most, so that is where the next pick pays.`
        : `The ${word} spot is where this roster loses the most points on an average week.`,
    );
  }

  return parts.join(" ");
}
