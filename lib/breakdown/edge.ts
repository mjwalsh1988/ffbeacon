/**
 * The Beacon Edge: a weighted average of the rows the reader can see.
 *
 * The whole point is additivity. Player A's share is
 *
 *     aShare = sum over metrics of ( weight_i * share_i )
 *
 * with the weights renormalized to sum to 1 over the metrics that actually
 * resolved. Because the weights sum to 1, each metric's pull on the verdict is
 * exactly `weight_i * (share_i - 0.5)`, and those pulls sum to `aShare - 0.5`.
 * That identity is what the contribution chart draws, so the bars are not an
 * illustration of the verdict, they ARE the verdict, decomposed.
 *
 * Renormalization over the resolved set matters. If a player has no projections
 * on file, treating that metric as 0.5 would pull the composite toward a tie for
 * a reason that has nothing to do with the players. Dropping it and letting the
 * survivors share its weight keeps the answer honest about what we measured.
 *
 * Pure. Takes plain data, returns plain data.
 */

import { METRICS, type MetricSide } from "./metrics";
import { winnerFromShare } from "./scoring";
import type {
  BeaconEdge,
  BreakdownRow,
  EdgeContribution,
  EdgeLabel,
  GroupEdge,
  GroupEdgeContribution,
  GroupEdgeSide,
  LensId,
} from "./types";

/**
 * Composite thresholds, deliberately tighter than the old single-metric ones.
 * Averaging many metrics compresses the result toward 0.5, so the 0.53 / 0.58 /
 * 0.67 bands that suited a raw value ratio would have called almost every real
 * matchup a toss-up.
 */
function labelForShare(leaderShare: number): EdgeLabel {
  if (leaderShare < 0.52) return "Toss-Up";
  if (leaderShare < 0.56) return "Slight Edge";
  if (leaderShare < 0.62) return "Clear Edge";
  return "Strong Edge";
}

const LENS_BASIS: Record<LensId, string> = {
  dynasty: "long-term value, age, and market signal",
  "win-now": "rest-of-season projection, production, and reliability",
  "this-week": "next game's projection, matchup, and health",
};

export type EdgeComputation = {
  edge: BeaconEdge;
  rows: BreakdownRow[];
};

/**
 * Score one lens over both sides, producing the meter and the table in a single
 * pass so the two can never be built from different inputs.
 */
export function computeEdge(
  a: MetricSide,
  b: MetricSide,
  lens: LensId,
  valueIsBeacon: boolean,
): EdgeComputation {
  // Pass one: resolve every metric's share once. Metric share functions can be
  // mildly expensive (safetyScore averages several sub-scores), and both the
  // table and the composite need the same number, so it is computed here only.
  const resolved = METRICS.map((metric) => ({
    metric,
    share: metric.share(a, b),
    rawWeight: metric.weights[lens] ?? 0,
  }));

  const weighted = resolved.filter((r) => r.metric.scored && r.share != null && r.rawWeight > 0);
  const weightTotal = weighted.reduce((sum, r) => sum + r.rawWeight, 0);

  const contributions: EdgeContribution[] = [];
  let aShare = 0.5;

  if (weightTotal > 0) {
    aShare = 0;
    for (const r of weighted) {
      const weight = r.rawWeight / weightTotal;
      const share = r.share as number;
      aShare += weight * share;
      contributions.push({
        key: r.metric.key,
        label: r.metric.label,
        share,
        weight,
        contribution: weight * (share - 0.5),
        winner: winnerFromShare(share, r.metric.guard),
      });
    }
    contributions.sort((x, y) => Math.abs(y.contribution) - Math.abs(x.contribution));
  }

  const normalizedWeight = new Map(contributions.map((c) => [c.key, c.weight]));
  const contributionByKey = new Map(contributions.map((c) => [c.key, c.contribution]));

  const rows: BreakdownRow[] = resolved.map(({ metric, share }) => ({
    key: metric.key,
    label: metric.label,
    help: metric.help,
    aDisplay: metric.display(a),
    bDisplay: metric.display(b),
    aNote: metric.note?.(a),
    bNote: metric.note?.(b),
    winner: winnerFromShare(share, metric.guard),
    valueIsBeacon: metric.isBeaconValue ? valueIsBeacon : undefined,
    share,
    contribution: contributionByKey.get(metric.key) ?? null,
    weight: normalizedWeight.get(metric.key) ?? 0,
  }));

  const aPct = Math.round(aShare * 100);
  const leaderShare = Math.max(aShare, 1 - aShare);
  const label = weightTotal > 0 ? labelForShare(leaderShare) : "Toss-Up";
  const leader = label === "Toss-Up" ? "even" : aShare > 0.5 ? "a" : "b";

  return {
    edge: {
      aPct,
      bPct: 100 - aPct,
      leader,
      label,
      basis: weightTotal > 0 ? LENS_BASIS[lens] : "not enough data",
      lens,
      contributions,
      metricsUsed: contributions.length,
    },
    rows,
  };
}

/** One side's value for the rank/"Best"-badge computation below. */
type RankEntry = { index: number; value: number };

/**
 * Turns a list of (side index, value) pairs, higher-is-better, into a rank
 * (1-based, ties averaged) and an isBest flag per entry. Ties share the mean
 * of the positions they occupy, so two sides tied for best both land on rank
 * 1.5 rather than one arbitrarily beating the other; isBest compares the raw
 * value rather than the rank, so both still get the badge.
 */
function rankEntries(
  entries: RankEntry[],
): { index: number; rank: number; isBest: boolean }[] {
  const sorted = [...entries].sort((x, y) => y.value - x.value);
  const bestValue = sorted[0].value;
  const out: { index: number; rank: number; isBest: boolean }[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].value === sorted[i].value) j += 1;
    const rank = (i + 1 + (j + 1)) / 2;
    for (let k = i; k <= j; k += 1) {
      out.push({ index: sorted[k].index, rank, isBest: sorted[k].value === bestValue });
    }
    i = j + 1;
  }
  return out;
}

/**
 * The Beacon Edge for two to eight sides. computeEdge stays the pairwise engine
 * (BEAM and the head-to-head meter call it unchanged); this is the same idea
 * generalised, for the background tabs once more than two players are being
 * compared.
 *
 * Built by construction to reduce to computeEdge at N equal to 2, rather than
 * merely agreeing with it on typical fixtures. For each scored metric and each
 * side i, the side's share of that metric is the mean, over every other side
 * j, of pairShare(i, j): metric.share(side_i, side_j) when i < j, or
 * 1 - metric.share(side_j, side_i) when i > j. That mirroring forces
 * antisymmetry (pairShare(i, j) === 1 - pairShare(j, i)) even on a share()
 * that is not perfectly symmetric on its own, and at N equal to 2 there is
 * only one other side, so side 0's share for a metric IS metric.share(a, b)
 * and side 1's IS its mirror. A metric counts for a side when at least one of
 * its pairs resolved (share() returned non-null); weights renormalize per
 * side over the metrics that counted for it, exactly as computeEdge
 * renormalizes over the metrics that resolved for the pair. So at N equal to
 * 2, side 0's composite is computed from the identical set of metrics, raw
 * weights and share() values as computeEdge's aShare, and is the same number.
 * edge.test.ts pins that identity, including a seeded sweep of generated
 * pairs, rather than a handful of hand-picked fixtures.
 *
 * `contributions[*].contribution` (weight * share) always sums to that side's
 * composite, the same identity computeEdge guarantees for the pairwise meter.
 *
 * rank and isBest (the "Best" badge) are a separate read, never the composite:
 * they come from metric.scalar() when at least two sides have a non-null
 * scalar for the metric, falling back to the pairwise share computed above
 * when they do not (which happens only for a metric whose scalar() disagrees
 * with its own share() about what counts as missing, such as Health, where a
 * healthy status scores 1 but two healthy sides' pairwise share is defined as
 * unresolved). Either way, rank is only computed among the sides that already
 * hold a contribution for the metric, so it can never crown a badge for a side
 * whose composite the metric never touched.
 */
export function computeGroupEdge(sides: MetricSide[], lens: LensId): GroupEdge {
  const n = sides.length;
  const scoredMetrics = METRICS.filter((m) => m.scored);

  const composites = sides.map(() => 0);
  const contributionsBySide: GroupEdgeContribution[][] = sides.map(() => []);
  const countedMetricKeys = new Set<string>();

  for (const metric of scoredMetrics) {
    const rawWeight = metric.weights[lens] ?? 0;
    if (rawWeight <= 0) continue;

    // Pairwise shares, computed once per unordered pair and mirrored for the
    // reverse order so pairShare(i, j) === 1 - pairShare(j, i) always holds,
    // even if metric.share() itself is not perfectly symmetric.
    const upper: (number | null)[][] = Array.from({ length: n }, () => new Array<number | null>(n).fill(null));
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        upper[i][j] = metric.share(sides[i], sides[j]);
      }
    }
    const pairShare = (i: number, j: number): number | null => {
      if (i < j) return upper[i][j];
      const mirrored = upper[j][i];
      return mirrored == null ? null : 1 - mirrored;
    };

    // Per side: the mean pairShare against every other side where it
    // resolved. A metric that never resolves for a side takes no share of it
    // and does not enter that side's weight renormalization.
    const shareBySide = new Map<number, number>();
    for (let i = 0; i < n; i += 1) {
      let sum = 0;
      let count = 0;
      for (let j = 0; j < n; j += 1) {
        if (j === i) continue;
        const v = pairShare(i, j);
        if (v == null) continue;
        sum += v;
        count += 1;
      }
      if (count > 0) shareBySide.set(i, sum / count);
    }
    if (shareBySide.size === 0) continue;

    countedMetricKeys.add(metric.key);
    for (const [index, share] of shareBySide) {
      contributionsBySide[index].push({
        key: metric.key,
        label: metric.label,
        share,
        weight: rawWeight, // renormalized to a per-side total below
        contribution: 0, // filled in once the side's weight total is known
        rank: 1,
        isBest: false,
      });
    }

    // Rank and the Best badge: scalar() first when it can rank at least two
    // of the sides that counted this metric, otherwise the pairwise share
    // computed above stands in for it.
    const scalarEntries: RankEntry[] = [];
    for (const index of shareBySide.keys()) {
      const value = metric.scalar ? metric.scalar(sides[index]) : null;
      if (value != null) scalarEntries.push({ index, value });
    }
    const rankSource: RankEntry[] =
      scalarEntries.length >= 2
        ? scalarEntries
        : [...shareBySide.entries()].map(([index, share]) => ({ index, value: share }));

    for (const { index, rank, isBest } of rankEntries(rankSource)) {
      const entry = contributionsBySide[index].find((c) => c.key === metric.key);
      if (entry) {
        entry.rank = rank;
        entry.isBest = isBest;
      }
    }
  }

  // Renormalize each side's weights to 1 over the metrics that counted for
  // it, exactly as computeEdge renormalizes over the metrics that resolved
  // for the pair, and fold contribution = weight * share into the composite.
  // A side with nothing resolved (no data of its own, or a lens that gives
  // every metric it has zero weight) defaults to 0.5, the same neutral value
  // computeEdge's aShare keeps when its own weightTotal is zero: "we have no
  // comparative information" is not the same answer as "this side has none
  // of the composite", and treating it as a hard zero would show a side with
  // one missing field as though it had lost every category.
  for (let index = 0; index < n; index += 1) {
    const list = contributionsBySide[index];
    const weightTotal = list.reduce((sum, c) => sum + c.weight, 0);
    if (weightTotal <= 0) {
      composites[index] = 0.5;
      continue;
    }
    for (const c of list) {
      c.weight = c.weight / weightTotal;
      c.contribution = c.weight * c.share;
      composites[index] += c.contribution;
    }
    list.sort((x, y) => y.contribution - x.contribution);
  }

  const sidesOut: GroupEdgeSide[] = sides.map((_, index) => ({
    composite: composites[index],
    contributions: contributionsBySide[index],
  }));

  let topIndex = 0;
  for (let idx = 1; idx < n; idx += 1) {
    if (composites[idx] > composites[topIndex]) topIndex = idx;
  }
  let runnerUpIndex = -1;
  for (let idx = 0; idx < n; idx += 1) {
    if (idx === topIndex) continue;
    if (runnerUpIndex === -1 || composites[idx] > composites[runnerUpIndex]) runnerUpIndex = idx;
  }

  const metricsUsed = countedMetricKeys.size;
  const top = composites[topIndex];
  const runnerUp = runnerUpIndex === -1 ? 0 : composites[runnerUpIndex];
  const total = top + runnerUp;
  const leaderShare = metricsUsed > 0 && total > 0 ? top / total : 0.5;
  const label = metricsUsed > 0 ? labelForShare(leaderShare) : "Toss-Up";
  const leader = metricsUsed > 0 && label !== "Toss-Up" ? topIndex : null;

  return {
    lens,
    basis: metricsUsed > 0 ? LENS_BASIS[lens] : "not enough data",
    label,
    leader,
    metricsUsed,
    sides: sidesOut,
  };
}

/**
 * Rows the table should render, in reading order. Metrics with no data on either
 * side are dropped entirely rather than printing a row of dashes: a row that can
 * never say anything is noise, and on mobile it is a whole wasted card.
 *
 * A row that carried weight is ALWAYS kept, even if both cells happen to format
 * as a dash. Dropping one would put a category in the contribution chart that a
 * reader could not then find in the table, which is the same "the verdict cites
 * evidence you cannot check" problem this whole module exists to remove.
 */
export function visibleRows(rows: BreakdownRow[]): BreakdownRow[] {
  return rows.filter((r) => r.weight > 0 || r.aDisplay !== "-" || r.bDisplay !== "-");
}
