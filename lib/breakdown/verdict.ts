/**
 * The plain-English payoff: five scannable takeaways and one bottom line.
 *
 * Everything here is assembled from the same shares the meter and the table use,
 * so a takeaway can never name a winner the table contradicts. Where a sentence
 * quotes a number, that number is the measured one, not a restatement of the
 * verdict in words.
 *
 * The verdict deliberately names the two categories that moved the result most.
 * "Player A holds a clear edge" is an assertion; "Player A holds a clear edge,
 * driven by rest-of-season points and beat rate" is a claim the reader can go
 * check in the table directly underneath.
 */

import { computeEdge } from "./edge";
import { type MetricSide } from "./metrics";
import { shareHigh, shareSigned, winnerFromShare } from "./scoring";
import type { BeaconEdge, BreakdownPlayer, EdgeWinner, LensId, Takeaway } from "./types";

function nameFor(a: BreakdownPlayer, b: BreakdownPlayer, w: EdgeWinner): string {
  if (w === "a") return a.name;
  if (w === "b") return b.name;
  return "Too close to call";
}

/** First name only, so a five-sentence verdict does not read like a roll call. */
function shortName(full: string): string {
  const first = full.trim().split(/\s+/)[0];
  return first && first.length > 1 ? first : full;
}

function pct(n: number | null | undefined, digits = 0): string | null {
  return n == null ? null : `${(n * 100).toFixed(digits)}%`;
}

/**
 * The two lens composites the takeaways and the verdict both need.
 *
 * Computed once by the caller and threaded through, because computeEdge
 * evaluates every metric's share function and several of those average a handful
 * of sub-scores. Building it inside both consumers ran the full metric set five
 * times per page render for one answer.
 */
export type LensEdges = {
  dynasty: BeaconEdge;
  winNow: BeaconEdge;
};

export function resolveLensEdges(
  a: MetricSide,
  b: MetricSide,
  active: { lens: LensId; edge: BeaconEdge },
): LensEdges {
  return {
    dynasty:
      active.lens === "dynasty" ? active.edge : computeEdge(a, b, "dynasty", false).edge,
    winNow:
      active.lens === "win-now" ? active.edge : computeEdge(a, b, "win-now", false).edge,
  };
}

export function buildTakeaways(a: MetricSide, b: MetricSide, lenses: LensEdges): Takeaway[] {
  const pa = a.player;
  const pb = b.player;
  const out: Takeaway[] = [];

  // Each of the first two is the full lens composite, so the card and the meter
  // agree exactly when the reader flips to that lens.
  const { dynasty, winNow } = lenses;

  {
    const w: EdgeWinner =
      dynasty.leader === "even" ? "even" : dynasty.leader === "a" ? "a" : "b";
    const lead = Math.max(dynasty.aPct, dynasty.bPct);
    out.push({
      key: "long-term",
      label: "Best long-term value",
      winner: dynasty.metricsUsed === 0 ? "na" : w,
      detail:
        dynasty.metricsUsed === 0
          ? "We do not hold enough long-term signal on these two to call it."
          : w === "even"
            ? "Their dynasty profiles grade out even."
            : `${nameFor(pa, pb, w)} takes ${lead}% of the dynasty signal on value and age.`,
    });
  }

  {
    const w: EdgeWinner = winNow.leader === "even" ? "even" : winNow.leader === "a" ? "a" : "b";
    const lead = Math.max(winNow.aPct, winNow.bPct);
    out.push({
      key: "win-now",
      label: "Best win-now option",
      winner: winNow.metricsUsed === 0 ? "na" : w,
      detail:
        winNow.metricsUsed === 0
          ? "We have no rest-of-season projections for these two yet."
          : w === "even"
            ? "Both offer similar value for the rest of this season."
            : `${nameFor(pa, pb, w)} takes ${lead}% of the win-now signal for the games left.`,
    });
  }

  // Safer floor: measured consistency and availability first, market steadiness
  // only as a fallback, because a steady trade value tells you nothing about
  // whether he will score 4 points on Sunday.
  {
    const relA = a.extras.reliability;
    const relB = b.extras.reliability;
    const consistency = relA?.ratioStdev != null && relB?.ratioStdev != null
      ? shareHigh(1 / Math.max(relA.ratioStdev, 0.05), 1 / Math.max(relB.ratioStdev, 0.05))
      : null;
    const availability = shareHigh(relA?.availabilityRate ?? null, relB?.availabilityRate ?? null);
    const marketSteady = shareHigh(
      pa.change30dPct != null ? 1 / (1 + Math.abs(pa.change30dPct)) : null,
      pb.change30dPct != null ? 1 / (1 + Math.abs(pb.change30dPct)) : null,
    );
    const parts = [consistency, availability, marketSteady].filter(
      (x): x is number => x != null,
    );
    const share = parts.length > 0 ? parts.reduce((s, x) => s + x, 0) / parts.length : null;
    const w = winnerFromShare(share, 0.04);
    const winnerRel = w === "a" ? relA : w === "b" ? relB : null;
    const availText = pct(winnerRel?.availabilityRate);
    out.push({
      key: "floor",
      label: "Safer floor",
      winner: w,
      detail:
        w === "even"
          ? "Neither carries meaningfully more week-to-week risk than the other."
          : w === "na"
            ? "We have not graded enough games to judge their floors."
            : availText
              ? `${nameFor(pa, pb, w)} is the steadier weekly hold, and has been available for ${availText} of his projected games.`
              : `${nameFor(pa, pb, w)} has the steadier, lower-risk profile.`,
    });
  }

  // Higher upside: ceiling projection when we have one, momentum and youth when
  // we do not.
  {
    const ceilA = a.extras.projection?.ceilingPoints ?? null;
    const ceilB = b.extras.projection?.ceilingPoints ?? null;
    const ceilingShare = shareHigh(ceilA, ceilB);
    const momentum = shareSigned(pa.change30dPct, pb.change30dPct);
    const parts = [ceilingShare, momentum].filter((x): x is number => x != null);
    const share = parts.length > 0 ? parts.reduce((s, x) => s + x, 0) / parts.length : null;
    const w = winnerFromShare(share, 0.04);
    const ceiling = w === "a" ? ceilA : w === "b" ? ceilB : null;
    out.push({
      key: "upside",
      label: "Higher upside",
      winner: w,
      detail:
        w === "even"
          ? "Their ceilings look comparable right now."
          : w === "na"
            ? "We do not have enough forward data to compare their ceilings."
            : ceiling != null
              ? `${nameFor(pa, pb, w)} has the bigger ceiling, up to ${ceiling.toFixed(0)} points across the games left.`
              : `${nameFor(pa, pb, w)} has more room to climb from here.`,
    });
  }

  // Better trade target: value plus momentum, the classic buy-low read.
  {
    const vShare = shareHigh(pa.value, pb.value);
    const mShare = shareSigned(pa.change30dPct, pb.change30dPct);
    const share =
      vShare != null && mShare != null ? 0.7 * vShare + 0.3 * mShare : (vShare ?? mShare);
    const w = winnerFromShare(share, 0.03);
    out.push({
      key: "trade-target",
      label: "Better trade target",
      winner: w,
      detail:
        w === "even"
          ? "Value and momentum are a wash between them."
          : w === "na"
            ? "We have no current value on at least one of them."
            : `${nameFor(pa, pb, w)} carries the stronger, more in-demand signal.`,
    });
  }

  return out;
}

/**
 * The bottom line for the active lens.
 *
 * Three shapes, in order of how much they help the reader:
 *   1. Too close to call, so the tie-breaker is their own roster.
 *   2. The lenses disagree, which is the genuinely interesting case and the one
 *      worth spelling out.
 *   3. One player leads, named alongside the two categories that got him there.
 */
export function buildVerdict(
  a: MetricSide,
  b: MetricSide,
  edge: BeaconEdge,
  lens: LensId,
  lenses: LensEdges,
): string {
  const pa = a.player;
  const pb = b.player;

  if (edge.metricsUsed === 0) {
    return `We do not hold enough data on ${pa.name} and ${pb.name} to grade this matchup yet. Try two players with current values and rankings.`;
  }

  const { dynasty, winNow } = lenses;

  if (edge.label === "Toss-Up") {
    return `This one is close. ${pa.name} and ${pb.name} grade out nearly even at ${edge.aPct} to ${edge.bPct}, so your roster needs and league format should break the tie.`;
  }

  const leaderName = edge.leader === "a" ? pa.name : pb.name;
  const otherName = edge.leader === "a" ? pb.name : pa.name;

  // The two rows that actually moved it. Contributions are already sorted.
  const drivers = edge.contributions
    .filter((c) => (edge.leader === "a" ? c.contribution > 0 : c.contribution < 0))
    .slice(0, 2)
    .map((c) => c.label.toLowerCase());
  const driverText =
    drivers.length === 2
      ? `${drivers[0]} and ${drivers[1]}`
      : drivers.length === 1
        ? drivers[0]
        : null;

  const lensLabel =
    lens === "dynasty" ? "for a dynasty roster" : lens === "win-now" ? "for the rest of this season" : "for this week";

  const headline = driverText
    ? `${leaderName} holds a ${edge.label.toLowerCase()} ${lensLabel} at ${Math.max(edge.aPct, edge.bPct)} to ${Math.min(edge.aPct, edge.bPct)}, driven by ${driverText}.`
    : `${leaderName} holds a ${edge.label.toLowerCase()} ${lensLabel} at ${Math.max(edge.aPct, edge.bPct)} to ${Math.min(edge.aPct, edge.bPct)}.`;

  // The split-profile case: worth calling out because it is the one situation
  // where the "winner" depends entirely on what the reader is trying to do.
  const dynW = dynasty.leader;
  const winW = winNow.leader;
  if (
    dynasty.metricsUsed > 0 &&
    winNow.metricsUsed > 0 &&
    dynW !== "even" &&
    winW !== "even" &&
    dynW !== winW
  ) {
    const dynName = dynW === "a" ? pa.name : pb.name;
    const winName = winW === "a" ? pa.name : pb.name;
    return `${headline} It is a genuine split, though: ${shortName(dynName)} is the better long-term hold while ${shortName(winName)} helps you more between now and the playoffs. Pick the one that matches where your roster actually is.`;
  }

  return `${headline} ${otherName} is the fallback rather than the favorite here.`;
}
