/**
 * The Beacon Edge meter, generalised from two players to two to eight.
 *
 * The headline still names the single clearest leader ("Toss-Up" when the top
 * two are within computeGroupEdge's own definition of a tie, `leader: null`).
 * Below it, every player's composite becomes one row of a ranked bar list
 * (RankedBars from components/manager-pulse/charts.tsx) inside a ChartFigure,
 * so a screen reader gets the full N-way ranking as a real <table> under a
 * disclosure rather than just the two headline percentages a pairwise meter
 * could get away with.
 *
 * Server component. The bars are decorative; every composite lives in
 * high-contrast text beside its bar, and one sr-only sentence carries the
 * whole ranking.
 */

import { useId } from "react";
import { Gauge } from "lucide-react";
import { ChartFigure, DataTable, Th, Td } from "@/components/chart-kit";
import { RankedBars, type RankedBarRow } from "@/components/manager-pulse/charts";
import type { BreakdownPlayer, GroupEdge } from "@/lib/beacon-breakdown";

/** Decorative only; every bar's number is also a real text node beside it. */
const BAR_PALETTE = [
  "bg-brand-purple",
  "bg-brand-cyan",
  "bg-signal-success",
  "bg-signal-warning",
  "bg-beacon",
  "bg-ink-subtle",
  "bg-line-accent",
  "bg-brand-purple/60",
];

export function BeaconEdgeMeter({
  sides,
  edge,
}: {
  sides: BreakdownPlayer[];
  edge: GroupEdge;
}) {
  // useId, not a literal string: the Head to head tab's lens switch keeps
  // all three lenses' panels mounted at once (only `hidden` toggles), so
  // without a per-instance id three copies of this heading would collide.
  const headingId = useId();
  const leaderName = edge.leader != null ? (sides[edge.leader]?.name ?? null) : null;
  const headline = edge.leader == null || leaderName == null ? "Toss-Up" : `${edge.label}: ${leaderName}`;

  const ranked = sides
    .map((player, index) => ({
      player,
      index,
      composite: edge.sides[index]?.composite ?? 0.5,
    }))
    .sort((x, y) => y.composite - x.composite);

  const scoredOn =
    edge.metricsUsed > 0
      ? `${edge.metricsUsed} scored categor${edge.metricsUsed === 1 ? "y" : "ies"}`
      : "not enough data";

  const namesList = sides.map((s) => s.name).join(", ");

  const summary =
    edge.metricsUsed === 0
      ? `We do not have enough data on ${namesList} to grade this matchup.`
      : edge.leader == null || leaderName == null
        ? `The Beacon Edge is a toss-up among the top players, averaged over ${scoredOn} weighted for ${edge.basis}. Ranked by composite: ${ranked
            .map((r) => `${r.player.name} ${Math.round(r.composite * 100)}%`)
            .join(", ")}.`
        : `${leaderName} holds a ${edge.label.toLowerCase()} on the Beacon Edge, averaged over ${scoredOn} weighted for ${edge.basis}. Ranked by composite: ${ranked
            .map((r) => `${r.player.name} ${Math.round(r.composite * 100)}%`)
            .join(", ")}.`;

  const rows: RankedBarRow[] = ranked.map(({ player, index, composite }, rank) => ({
    key: player.slug,
    label: player.name,
    value: composite,
    display: `${Math.round(composite * 100)}%`,
    barClass: BAR_PALETTE[rank % BAR_PALETTE.length],
    lead: index === edge.leader,
  }));

  return (
    <section
      aria-labelledby={headingId}
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

      <h3
        id={headingId}
        className="mt-2 bg-clip-text text-2xl font-bold tracking-tight text-transparent forced-colors:text-ink sm:text-3xl"
        style={{ backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)" }}
      >
        {headline}
      </h3>

      {/* One spoken summary carrying the whole ranking, not just the leader. */}
      <p className="sr-only">{summary}</p>

      <p className="mt-3 text-sm leading-relaxed text-ink-muted">
        {edge.metricsUsed === 0
          ? "We do not hold enough current data on this group to grade the matchup. Try players with published values and rankings."
          : edge.leader == null || leaderName == null
            ? "These players grade out nearly even across every category we can measure. The edge is small enough that your roster needs should decide it."
            : `Averaged across ${scoredOn}. The table below shows exactly which players and categories moved it.`}
      </p>

      <div className="mt-4">
        <ChartFigure
          title="Composite score by player"
          description="Every player's share of the weighted average, ranked."
          summary={summary}
          table={
            <DataTable
              caption="Composite score by player, ranked"
              head={
                <>
                  <Th>Player</Th>
                  <Th numeric>Composite</Th>
                </>
              }
            >
              {ranked.map((r) => (
                <tr key={r.player.slug}>
                  <Td>
                    {r.player.name}
                    {r.index === edge.leader ? " (leader)" : ""}
                  </Td>
                  <Td numeric>{Math.round(r.composite * 100)}%</Td>
                </tr>
              ))}
            </DataTable>
          }
        >
          <RankedBars rows={rows} />
        </ChartFigure>
      </div>
    </section>
  );
}
