/**
 * The sentences that go on a trade card.
 *
 * Every number this engine produces is already on the screen as a figure. These
 * lines exist because a column of deltas does not tell a manager whether to send
 * the offer, and because the person this site is built for is listening to the
 * page rather than scanning it. A screen reader user should be able to hear four
 * or five lines and know what the deal does.
 *
 * HARD RULE: every reason cites a figure present in the input. Nothing is
 * generated, nothing is estimated, and nothing is rounded into a claim the input
 * does not support. If a figure is null the reason does not fire, rather than
 * being softened into something vague. This is the same contract
 * lib/trade-finder/explain.ts holds, and it is why these are deterministic
 * templates and not a language model: a generated sentence can be plausible and
 * wrong, and the first time it is wrong about somebody's league the whole
 * feature loses its credibility.
 *
 * The cost reasons are NEVER omitted or truncated: a card that shows the upside
 * and buries the downside is a sales pitch. Ordering puts the good news first
 * because that is how a reader scans, but nothing is dropped to make room, and
 * there is no cap on how many bad-tone reasons come back.
 *
 * Percentages are spelled "percent" rather than written with the symbol, because
 * these strings are read aloud and screen readers handle the word more reliably
 * than the glyph. Points carry one decimal; percentages and trade value are
 * whole numbers, because a tenth of a percentage point of playoff odds is below
 * what the simulation can actually resolve.
 *
 * Pure. No database, no React, no clock.
 */

import { ordinal } from "@/lib/league-team-status";
import type { SuggestionGrade } from "@/lib/trade-finder-grade";
import type { ImpactGaps, TeamImpact, TradeReason, TradeReasonKind } from "./types";

/**
 * The floors below which a figure is noise rather than news.
 *
 * `lineupNoise` is half a point a week. Weekly projections are not accurate to a
 * tenth, so a card that announced a 0.2 point gain would be claiming a precision
 * the model does not have.
 *
 * `valueNoisePct` is measured as a share of the reader's own roster, not as a
 * raw number, because 400 points is a rounding error on two first-round dynasty
 * assets and a real gap on two bench pieces.
 */
export const REASON_THRESHOLDS: {
  lineupNoise: number;
  valueNoisePct: number;
  ageNoise: number;
  startsOftenPct: number;
  startsRarelyPct: number;
} = {
  lineupNoise: 0.5,
  valueNoisePct: 0.03,
  ageNoise: 0.3,
  startsOftenPct: 0.7,
  startsRarelyPct: 0.3,
};

export type ReasonInput = {
  mine: TeamImpact;
  theirs: TeamImpact;
  gaps: ImpactGaps;
  weeksConsidered: number;
  isDynasty: boolean;
  grade: SuggestionGrade | null;
  /** Slot label of my weakest starting slot before and after, when known. */
  weakestSlot?: { label: string; before: number; after: number } | null;
  /** Position whose starter output dropped most, with the next-man-up gap. */
  depthCost?: { position: string; gap: number } | null;
};

/** Tone rank for ordering. Good news reads first, costs read last. */
const TONE_ORDER: Record<TradeReason["tone"], number> = {
  good: 0,
  neutral: 1,
  bad: 2,
};

const LINEUP_KINDS = new Set<TradeReasonKind>([
  "lineup-gain",
  "lineup-loss",
  "lineup-flat",
]);

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** One decimal, unsigned. The sentence carries the direction in its verb. */
function points(value: number): string {
  return Math.abs(value).toFixed(1);
}

/** Whole trade-value points, grouped. */
function value(amount: number): string {
  return Math.round(Math.abs(amount)).toLocaleString("en-US");
}

/** A 0-to-1 probability as a whole number of percent. */
function percent(fraction: number): string {
  return String(Math.round(fraction * 100));
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** "week 12", "weeks 12 and 15", "weeks 12, 14, and 15". */
function weekPhrase(weeks: number[]): string {
  const noun = plural(weeks.length, "week", "weeks");
  if (weeks.length === 1) return `${noun} ${weeks[0]}`;
  if (weeks.length === 2) return `${noun} ${weeks[0]} and ${weeks[1]}`;
  return `${noun} ${weeks.slice(0, -1).join(", ")}, and ${weeks[weeks.length - 1]}`;
}

/** "Chase", "Chase and Nabers", "A, B, and C". */
function nameList(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function remainingWeeks(count: number): string {
  return `${count} remaining ${plural(count, "week", "weeks")}`;
}

/** Player id to display name, for the assets arriving on the reader's side. */
function incomingNames(mine: TeamImpact): Map<string, string> {
  const out = new Map<string, string>();
  for (const asset of mine.incoming) {
    if (asset.kind === "player") out.set(asset.playerId, asset.name);
  }
  return out;
}

function pickLabels(assets: TeamImpact["incoming"]): string[] {
  return assets.filter((a) => a.kind === "pick").map((a) => a.label);
}

/**
 * Lineup change, and whether it is worth calling a change at all.
 *
 * The flat case gets its own kind rather than being silence. A reader who traded
 * a starter for a starter and hears nothing about their lineup will assume we
 * did not measure it.
 */
function lineupReason(input: ReasonInput): TradeReason | null {
  const delta = input.mine.lineupDelta;
  if (input.gaps.lineup || !finite(delta)) return null;
  const span = remainingWeeks(input.weeksConsidered);

  if (delta > REASON_THRESHOLDS.lineupNoise) {
    return {
      kind: "lineup-gain",
      label: "Lineup gains points",
      detail: `Your starting lineup gains ${points(delta)} points a week over your ${span}.`,
      tone: "good",
    };
  }
  if (delta < -REASON_THRESHOLDS.lineupNoise) {
    return {
      kind: "lineup-loss",
      label: "Lineup loses points",
      detail: `Your starting lineup loses ${points(delta)} points a week over your ${span}.`,
      tone: "bad",
    };
  }
  return {
    kind: "lineup-flat",
    label: "Lineup barely moves",
    detail: `Your starting lineup changes by ${points(delta)} points a week, close enough to call it level.`,
    tone: "neutral",
  };
}

/**
 * How often an arriving player actually plays.
 *
 * Two reasons rather than one, because they answer different questions and a
 * multi-player deal can honestly trigger both: the headline arrival starts every
 * week, and the second piece never does. The thresholds do not overlap, so a
 * single incoming player can only produce one of them.
 */
function startsReasons(input: ReasonInput): TradeReason[] {
  const out: TradeReason[] = [];
  const weeks = input.weeksConsidered;
  if (input.gaps.lineup || weeks <= 0) return out;

  // A player with no name resolved is dropped rather than named "undefined".
  const names = incomingNames(input.mine);
  const entries: { name: string; starts: number }[] = [];
  for (const [id, starts] of Object.entries(input.mine.incomingStartWeeks)) {
    const name = names.get(id);
    if (name && Number.isFinite(starts)) entries.push({ name, starts });
  }
  if (entries.length === 0) return out;

  entries.sort((a, b) => b.starts - a.starts);
  const top = entries[0];
  const low = entries[entries.length - 1];

  if (top.starts / weeks >= REASON_THRESHOLDS.startsOftenPct) {
    out.push({
      kind: "starts-often",
      label: "Starts most weeks",
      detail: `${top.name} starts for you in ${top.starts} of your ${remainingWeeks(weeks)}.`,
      tone: "good",
    });
  }

  if (low.starts / weeks <= REASON_THRESHOLDS.startsRarelyPct) {
    out.push({
      kind: "starts-rarely",
      label: "Rarely cracks the lineup",
      detail: `${low.name} only cracks your lineup in ${low.starts} of ${weeks}, so he is depth rather than weekly points.`,
      tone: "neutral",
    });
  }

  return out;
}

/**
 * Weeks the trade moves across the coin-flip line.
 *
 * A tenth of a point of win probability is not a result. Crossing 0.5 is, because
 * it changes which side of a matchup the reader is on, and it is the one lineup
 * figure that maps onto something a manager already thinks in.
 */
function swingsReason(input: ReasonInput): TradeReason | null {
  if (input.gaps.lineup) return null;
  const gained: number[] = [];
  const lost: number[] = [];
  for (const week of input.mine.weeks) {
    if (!finite(week.winProbBefore) || !finite(week.winProbAfter)) continue;
    if (week.winProbBefore < 0.5 && week.winProbAfter >= 0.5) gained.push(week.week);
    else if (week.winProbBefore >= 0.5 && week.winProbAfter < 0.5) lost.push(week.week);
  }
  if (gained.length === 0 && lost.length === 0) return null;

  const clauses: string[] = [];
  if (gained.length > 0) {
    clauses.push(
      `It turns ${gained.length} projected ${plural(gained.length, "loss", "losses")} into ${plural(gained.length, "a coin flip", "coin flips")}, in ${weekPhrase(gained)}`,
    );
  }
  if (lost.length > 0) {
    clauses.push(
      `${gained.length > 0 ? "and it costs you the edge in " : "It costs you the edge in "}${weekPhrase(lost)}`,
    );
  }

  const tone =
    gained.length > lost.length
      ? "good"
      : gained.length < lost.length
        ? "bad"
        : "neutral";

  return {
    kind: "swings-weeks",
    label: "Swings close matchups",
    detail: `${clauses.join(" ")}.`,
    tone,
  };
}

/**
 * Where the gains land.
 *
 * Only fires when they are concentrated. A deal that adds the same two points
 * every week has no timing story, and inventing one ("the gains come at the
 * right time") would be exactly the kind of unfounded claim this file exists to
 * avoid. The opponent is named only when the input carries a name.
 */
function scheduleTimingReason(input: ReasonInput): TradeReason | null {
  if (input.gaps.lineup) return null;
  const weeks = input.mine.weeks.filter((w) => finite(w.delta));
  if (weeks.length < 3) return null;

  const average = weeks.reduce((sum, w) => sum + w.delta, 0) / weeks.length;
  const ranked = [...weeks].sort((a, b) => b.delta - a.delta);

  // Two gates, doing different jobs. The first asks whether the gains are
  // concentrated at all: the best week has to be worth at least twice the
  // typical week, or there is no timing story to tell. The second decides how
  // many weeks to name, and a second week only earns a mention when it also
  // clears the average by more than the noise floor.
  const best = ranked[0];
  if (best.delta <= REASON_THRESHOLDS.lineupNoise || best.delta < average * 2)
    return null;

  const top = ranked
    .slice(0, 2)
    .filter(
      (w) =>
        w.delta > REASON_THRESHOLDS.lineupNoise &&
        w.delta >= average + REASON_THRESHOLDS.lineupNoise,
    );
  if (top.length === 0) return null;

  const describe = (w: (typeof top)[number]) =>
    w.opponentName
      ? `week ${w.week}, plus ${points(w.delta)} points against ${w.opponentName}`
      : `week ${w.week}, plus ${points(w.delta)} points`;

  const detail =
    top.length === 1
      ? `The biggest gain lands in ${describe(top[0])}.`
      : `The biggest gains land in ${describe(top[0])}, and ${describe(top[1])}.`;

  return {
    kind: "schedule-timing",
    label: "Gains land in key weeks",
    detail,
    tone: "neutral",
  };
}

/** Projected wins and playoff odds, from the seeded season simulation. */
function oddsReason(input: ReasonInput): TradeReason | null {
  const m = input.mine;
  if (input.gaps.simulation || input.gaps.lineup || !finite(m.lineupDelta)) return null;
  if (!finite(m.playoffOddsBefore) || !finite(m.playoffOddsAfter)) return null;

  const parts: string[] = [];
  if (finite(m.projectedWinsBefore) && finite(m.projectedWinsAfter)) {
    parts.push(
      `Projected wins go from ${m.projectedWinsBefore.toFixed(1)} to ${m.projectedWinsAfter.toFixed(1)}.`,
    );
  }
  parts.push(
    `Playoff odds go from ${percent(m.playoffOddsBefore)} percent to ${percent(m.playoffOddsAfter)} percent.`,
  );
  if (
    finite(m.titleOddsBefore) &&
    finite(m.titleOddsAfter) &&
    percent(m.titleOddsBefore) !== percent(m.titleOddsAfter)
  ) {
    parts.push(
      `Title odds go from ${percent(m.titleOddsBefore)} percent to ${percent(m.titleOddsAfter)} percent.`,
    );
  }

  const shift = m.playoffOddsAfter - m.playoffOddsBefore;
  return {
    kind: "odds",
    label: "Season odds move",
    detail: parts.join(" "),
    tone: shift > 0.005 ? "good" : shift < -0.005 ? "bad" : "neutral",
  };
}

/** Trade value, as a share of the reader's roster wherever we can measure one. */
function valueReason(input: ReasonInput): TradeReason | null {
  const m = input.mine;
  if (!finite(m.valueDelta)) return null;

  const hasBase = finite(m.valueBefore) && m.valueBefore > 0;
  const share = hasBase ? Math.abs(m.valueDelta) / m.valueBefore : 0;
  if (hasBase ? share < REASON_THRESHOLDS.valueNoisePct : Math.abs(m.valueDelta) < 1) {
    return null;
  }

  const shareClause = hasBase ? `, about ${percent(share)} percent of your roster` : "";
  if (m.valueDelta > 0) {
    return {
      kind: "value-gain",
      label: "You gain trade value",
      detail: `You come out ${value(m.valueDelta)} points of trade value ahead${shareClause}.`,
      tone: "good",
    };
  }
  return {
    kind: "value-loss",
    label: "You give up value",
    detail: `You give up ${value(m.valueDelta)} points of trade value${shareClause}.`,
    tone: "bad",
  };
}

/**
 * Age, in dynasty only.
 *
 * A redraft manager does not care that the player arriving is 27. The figure is
 * real either way, so the gate is on the format rather than on the number.
 *
 * THE SENTENCE NAMES WHAT WAS MEASURED. `ageDelta` compares the two PACKAGES,
 * not the two rosters: it is the value-weighted age of what you receive against
 * the value-weighted age of what you send. An earlier draft said "your roster
 * gets 7.0 years younger", which is arithmetic nobody can do to a thirty man
 * roster with one trade, and which a reader would rightly stop believing the
 * rest of the card over.
 */
function ageReason(input: ReasonInput): TradeReason | null {
  const delta = input.mine.ageDelta;
  if (!input.isDynasty || !finite(delta)) return null;
  if (Math.abs(delta) < REASON_THRESHOLDS.ageNoise) return null;

  if (delta < 0) {
    return {
      kind: "younger",
      label: "You get younger",
      detail: `What you receive is ${points(delta)} years younger than what you send, weighted by value.`,
      tone: "good",
    };
  }
  return {
    kind: "older",
    label: "You get older",
    detail: `What you receive is ${points(delta)} years older than what you send, weighted by value.`,
    tone: "bad",
  };
}

/**
 * Picks, named rather than counted where the labels exist.
 *
 * Both directions can fire on the same deal. A three-for-a-two is a pick in and
 * a pick out, and reporting only the net would hide half of what the reader is
 * agreeing to.
 */
function pickReasons(input: ReasonInput): TradeReason[] {
  const out: TradeReason[] = [];
  if (input.gaps.picks) return out;

  const incoming = pickLabels(input.mine.incoming);
  const outgoing = pickLabels(input.mine.outgoing);

  if (incoming.length > 0) {
    out.push({
      kind: "picks-in",
      label: "You add draft picks",
      detail: `You add ${nameList(incoming)}.`,
      tone: "good",
    });
  }
  if (outgoing.length > 0) {
    out.push({
      kind: "picks-out",
      label: "You send draft picks",
      detail: `You send ${nameList(outgoing)}.`,
      tone: "bad",
    });
  }
  return out;
}

/** What the deal costs behind the starter it moves. */
function depthCostReason(input: ReasonInput): TradeReason | null {
  const cost = input.depthCost;
  if (!cost || !finite(cost.gap) || cost.gap <= REASON_THRESHOLDS.lineupNoise)
    return null;
  return {
    kind: "depth-cost",
    label: "It thins a position",
    detail: `It thins your ${cost.position}. Your next man up projects ${points(cost.gap)} points a week below the ${cost.position} you are sending.`,
    tone: "bad",
  };
}

/** The weakest starting slot, when the deal lands on it. */
function fillsHoleReason(input: ReasonInput): TradeReason | null {
  const slot = input.weakestSlot;
  if (!slot || !finite(slot.before) || !finite(slot.after)) return null;
  if (slot.after - slot.before <= REASON_THRESHOLDS.lineupNoise) return null;
  return {
    kind: "fills-hole",
    label: "It fixes a weak slot",
    detail: `It fixes your weakest starting slot. Your ${slot.label} goes from ${points(slot.before)} to ${points(slot.after)} points a week.`,
    tone: "good",
  };
}

/**
 * Whether the deal points the same way the roster does.
 *
 * A competitor is judged on the lineup and a rebuilder on the value, because
 * those are the two different things the two teams are playing for. A mid-tier
 * team gets neither reason: there is no direction to agree or disagree with, and
 * asserting one would be a claim the status classifier declined to make.
 *
 * Exactly one of fit and clash can fire. They are branches of the same test.
 */
function directionReason(input: ReasonInput): TradeReason | null {
  const m = input.mine;
  if (!m.statusLabel) return null;

  const status = m.statusLabel.toLowerCase();
  const rankClause = finite(m.pulseRank)
    ? `You are ranked ${ordinal(m.pulseRank)} by Power Pulse`
    : `You read as a ${m.statusLabel}`;

  if (status.includes("competitor")) {
    const delta = m.lineupDelta;
    if (input.gaps.lineup || !finite(delta)) return null;
    if (delta > REASON_THRESHOLDS.lineupNoise) {
      return {
        kind: "direction-fit",
        label: "Fits your direction",
        detail: `${rankClause}, and this deal adds ${points(delta)} points a week to your lineup, which is the direction a team trying to win now wants.`,
        tone: "good",
      };
    }
    if (delta < -REASON_THRESHOLDS.lineupNoise) {
      return {
        kind: "direction-clash",
        label: "Against your direction",
        detail: `${rankClause}, and this deal costs you ${points(delta)} points a week. That is the wrong direction for a team trying to win now.`,
        tone: "bad",
      };
    }
    return null;
  }

  if (status.includes("rebuild")) {
    if (!finite(m.valueDelta) || !finite(m.valueBefore) || m.valueBefore <= 0)
      return null;
    const share = Math.abs(m.valueDelta) / m.valueBefore;
    if (share < REASON_THRESHOLDS.valueNoisePct) return null;
    if (m.valueDelta > 0) {
      return {
        kind: "direction-fit",
        label: "Fits your direction",
        detail: `${rankClause}, and this deal adds ${value(m.valueDelta)} points of trade value, which is the trade a rebuilding team wants.`,
        tone: "good",
      };
    }
    return {
      kind: "direction-clash",
      label: "Against your direction",
      detail: `${rankClause}, and this deal gives up ${value(m.valueDelta)} points of trade value. That is the wrong direction for a team that is not winning now.`,
      tone: "bad",
    };
  }

  return null;
}

/** Signal Check, quoted rather than paraphrased. */
function gradeReason(grade: SuggestionGrade | null): TradeReason | null {
  if (!grade) return null;
  return {
    kind: "grade",
    label: "Signal Check second opinion",
    detail: `On ${grade.formatDisplay} values, Signal Check returns ${grade.verdictLabel}.`,
    tone: grade.favours === "you" ? "good" : grade.favours === "them" ? "bad" : "neutral",
  };
}

/**
 * The other manager's side.
 *
 * Always present, always last. The reader has to send this offer to a person who
 * will read it from their own end, and a card that never says what the other
 * team gets is a card that cannot tell them whether to expect a yes.
 */
function theirSideReason(input: ReasonInput): TradeReason {
  const t = input.theirs;
  const clauses: string[] = [];

  if (finite(t.valueDelta)) {
    clauses.push(
      `${t.valueDelta >= 0 ? "plus" : "minus"} ${value(t.valueDelta)} points of value`,
    );
  }
  if (!input.gaps.lineup && finite(t.lineupDelta)) {
    clauses.push(
      `${t.lineupDelta >= 0 ? "plus" : "minus"} ${points(t.lineupDelta)} points a week in their lineup`,
    );
  }

  const ledger =
    clauses.length > 0 ? clauses.join(" and ") : "close to level on both counts";
  const appealing =
    (finite(t.valueDelta) && t.valueDelta > 0) ||
    (!input.gaps.lineup && finite(t.lineupDelta) && t.lineupDelta > 0);
  const closer = appealing
    ? "which is why they might say yes"
    : "so you will need a reason for them to take it";

  return {
    kind: "their-side",
    label: "What they get",
    detail: `For ${t.teamName} it is ${ledger}, ${closer}.`,
    tone: "neutral",
  };
}

/**
 * Build the ordered reason list.
 *
 * Order is tone first, good to bad, with two exceptions written into the sort
 * rather than left to luck. The odds line sits directly after the lineup line
 * because it is the same story measured a second way, and splitting them across
 * the card makes a listener re-derive the connection. The other team's side sits
 * last because it is the only line not about the reader.
 */
export function buildTradeReasons(input: ReasonInput): TradeReason[] {
  const collected: (TradeReason | null)[] = [
    lineupReason(input),
    ...startsReasons(input),
    swingsReason(input),
    scheduleTimingReason(input),
    valueReason(input),
    ageReason(input),
    ...pickReasons(input),
    depthCostReason(input),
    fillsHoleReason(input),
    directionReason(input),
    gradeReason(input.grade),
  ];

  const reasons = collected.filter((r): r is TradeReason => r !== null);
  const odds = oddsReason(input);

  // Stable sort: ties keep the generation order above, which already reads in a
  // sensible sequence within a tone.
  const ordered = reasons
    .map((reason, index) => ({ reason, index }))
    .sort(
      (a, b) =>
        TONE_ORDER[a.reason.tone] - TONE_ORDER[b.reason.tone] || a.index - b.index,
    )
    .map((entry) => entry.reason);

  if (odds) {
    const lineupIndex = ordered.findIndex((r) => LINEUP_KINDS.has(r.kind));
    if (lineupIndex >= 0) ordered.splice(lineupIndex + 1, 0, odds);
    else ordered.push(odds);
  }

  ordered.push(theirSideReason(input));
  return ordered;
}

/**
 * What would make a number above misleading if it went unsaid.
 *
 * Kept out of the reason list on purpose. A reason is an argument about the
 * deal; a caveat is a statement about how far the arithmetic reached. Mixing
 * them lets a limitation read as a con, and lets a con read as a footnote.
 */
export function buildTradeCaveats(
  input: ReasonInput & {
    unpricedNames: string[];
    pickSourceDisplay: string | null;
    inactiveNames: string[];
  },
): string[] {
  const out: string[] = [];

  if (input.gaps.lineup) {
    out.push(
      "No weekly projections are loaded for this league, so this deal is measured on trade value alone.",
    );
  }

  if (input.unpricedNames.length > 0) {
    const shown = input.unpricedNames.slice(0, 3);
    const extra = input.unpricedNames.length - shown.length;
    const who = extra > 0 ? `${nameList(shown)} and ${extra} more` : nameList(shown);
    out.push(
      `No projection published for ${who}, so ${plural(input.unpricedNames.length, "he is", "they are")} priced on value only.`,
    );
  }

  if (input.inactiveNames.length > 0) {
    const who = nameList(input.inactiveNames);
    out.push(
      `${who} ${plural(input.inactiveNames.length, "is", "are")} on IR or taxi and cannot start without a roster move.`,
    );
  }

  if (input.gaps.simulation) {
    out.push("This league has no remaining games, so the odds figures are unavailable.");
  }

  const hasPicks =
    pickLabels(input.mine.incoming).length > 0 ||
    pickLabels(input.mine.outgoing).length > 0;
  if (hasPicks && input.gaps.picks) {
    out.push(
      "No pick values are published for this league, so the picks in this deal count for nothing above.",
    );
  } else if (hasPicks && input.pickSourceDisplay) {
    out.push(
      `Pick values come from ${input.pickSourceDisplay}. Your chosen source does not publish them.`,
    );
  }

  return out;
}
