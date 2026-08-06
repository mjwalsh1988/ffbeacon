/**
 * The Beacon Edge meter: the branded, at-a-glance verdict.
 *
 * The number here is a weighted average of the category rows in the table below,
 * for the lens the reader has selected. It used to be a single value ratio that
 * had nothing to do with the table, which meant the meter and the evidence could
 * point in opposite directions. Now the split, the rows, and the contribution
 * chart are three renderings of one calculation.
 *
 * Server component. The bar is decorative; the percentages live in high-contrast
 * text beside it, and one spoken summary carries the whole verdict.
 */

import { Gauge } from "lucide-react";
import type { BeaconEdge, BreakdownPlayer } from "@/lib/beacon-breakdown";

export function BeaconEdgeMeter({
  a,
  b,
  edge,
}: {
  a: BreakdownPlayer;
  b: BreakdownPlayer;
  edge: BeaconEdge;
}) {
  const leaderName = edge.leader === "a" ? a.name : edge.leader === "b" ? b.name : null;
  const headline = edge.leader === "even" ? "Toss-Up" : `${edge.label}: ${leaderName}`;

  const scoredOn =
    edge.metricsUsed > 0
      ? `${edge.metricsUsed} scored categor${edge.metricsUsed === 1 ? "y" : "ies"}`
      : "not enough data";

  const summary =
    edge.metricsUsed === 0
      ? `We do not have enough data on ${a.name} and ${b.name} to grade this matchup.`
      : edge.leader === "even"
        ? `The Beacon Edge is a toss-up: ${a.name} ${edge.aPct} percent, ${b.name} ${edge.bPct} percent, averaged over ${scoredOn} weighted for ${edge.basis}.`
        : `${leaderName} holds a ${edge.label} on the Beacon Edge: ${a.name} ${edge.aPct} percent versus ${b.name} ${edge.bPct} percent, averaged over ${scoredOn} weighted for ${edge.basis}.`;

  return (
    <section
      aria-labelledby="beacon-edge-heading"
      className="relative overflow-hidden rounded-modal border border-line bg-surface/60 p-5 sm:p-6"
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-brand-cyan">
          <Gauge aria-hidden="true" className="h-3.5 w-3.5" />
          Beacon Edge
        </p>
        <p className="text-[11px] text-ink-subtle">Weighted for {edge.basis}</p>
      </div>

      <h2
        id="beacon-edge-heading"
        className="mt-2 bg-clip-text text-2xl font-bold tracking-tight text-transparent forced-colors:text-ink sm:text-3xl"
        style={{ backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)" }}
      >
        {headline}
      </h2>

      {/* One spoken summary; the bar itself is decorative for SR. */}
      <p className="sr-only">{summary}</p>

      {/* Labels above the bar: names plus each side's share, kept OUTSIDE the
          bar so the percentages are always high-contrast light text on the dark
          card (never dark text sitting on a translucent bar segment). */}
      <div className="mt-4 flex items-end justify-between gap-3" aria-hidden="true">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-brand-purple">{a.name}</p>
          <p className="mt-0.5 font-mono text-2xl font-bold tabular-nums text-ink">{edge.aPct}%</p>
        </div>
        <div className="min-w-0 text-right">
          <p className="truncate text-sm font-semibold text-brand-cyan">{b.name}</p>
          <p className="mt-0.5 font-mono text-2xl font-bold tabular-nums text-ink">{edge.bPct}%</p>
        </div>
      </div>

      {/* The split meter. Purely visual: the numbers live in the labels. */}
      <div
        aria-hidden="true"
        className="relative mt-2 flex h-4 overflow-hidden rounded-full border border-line bg-base"
      >
        <div
          style={{
            width: `${edge.aPct}%`,
            backgroundImage: "linear-gradient(90deg, #A855F7 0%, rgba(168,85,247,0.65) 100%)",
          }}
        />
        <div
          style={{
            width: `${edge.bPct}%`,
            backgroundImage: "linear-gradient(90deg, rgba(34,211,238,0.65) 0%, #22D3EE 100%)",
          }}
        />
        {/* Center hairline marker. */}
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-base" />
      </div>

      <p className="mt-3 text-sm leading-relaxed text-ink-muted">
        {edge.metricsUsed === 0
          ? "We do not hold enough current data on these two to grade the matchup. Try players with published values and rankings."
          : edge.leader === "even"
            ? "These two grade out nearly even across every category we can measure. The edge is small enough that your roster needs should decide it."
            : `Averaged across ${scoredOn}. The breakdown below shows exactly which ones moved it.`}
      </p>
    </section>
  );
}
