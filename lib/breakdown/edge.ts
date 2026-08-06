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
