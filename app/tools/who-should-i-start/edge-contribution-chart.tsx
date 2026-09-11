/**
 * Where the edge came from, generalised from two players to two to eight.
 *
 * For two players this is still the diverging chart: each bar is
 * `weight * (shareA - 0.5)`, and the bars sum to exactly `compositeA - 0.5`.
 * GroupEdge is built to reproduce computeEdge's per-side shares at N equal to
 * 2 (edge.test.ts pins that identity), so the signed contribution for the
 * pair is recovered from each side's own (weight, contribution) pair:
 * `sideA.contribution - weight / 2`, which is the same number the old
 * pairwise EdgeContribution.contribution held.
 *
 * A diverging bar stops making sense past two sides (there is no longer a
 * single "toward A or toward B" axis), so for three or more players the chart
 * becomes one StackedShareBar per player: the categories that built THEIR
 * composite, stacked into one bar with a text legend under it. Nothing here
 * is an illustration of the verdict. It is the verdict, itemized, per player.
 *
 * Every chart is wrapped in components/chart-kit.tsx's ChartFigure, which
 * supplies the visible caption, the sr-only summary, and a real <table> of
 * the plotted values under a disclosure.
 *
 * Server component. No SVG, no dependencies beyond the shared chart
 * furniture: a diverging bar or a stacked bar is plain divs, which reflow on
 * a narrow screen where a fixed-viewBox SVG would not.
 */

import { useId } from "react";
import { Scale } from "lucide-react";
import { ChartFigure, DataTable, Th, Td } from "@/components/chart-kit";
import { StackedShareBar, type ShareSegment } from "@/components/manager-pulse/charts";
import type { BreakdownPlayer, GroupEdge } from "@/lib/beacon-breakdown";

/** Contributions below this are rounding noise, not a reason. */
const MIN_VISIBLE = 0.002;

/** Decorative only; every segment's share is also a real text node beside it. */
const CATEGORY_PALETTE = [
  "bg-brand-purple",
  "bg-brand-cyan",
  "bg-signal-success",
  "bg-signal-warning",
  "bg-beacon",
  "bg-ink-subtle",
  "bg-line-accent",
  "bg-brand-purple/60",
  "bg-brand-cyan/60",
  "bg-signal-success/60",
];

function points(contribution: number): string {
  return Math.abs(contribution * 100).toFixed(1);
}

export function EdgeContributionChart({
  sides,
  edge,
}: {
  sides: BreakdownPlayer[];
  edge: GroupEdge;
}) {
  if (edge.metricsUsed === 0) return null;
  if (sides.length === 2) {
    return <PairChart sides={sides} edge={edge} />;
  }
  return <GroupChart sides={sides} edge={edge} />;
}

/* ------------------------------------------------------------------ */
/* Two players: the diverging chart, unchanged in spirit               */
/* ------------------------------------------------------------------ */

function PairChart({ sides, edge }: { sides: BreakdownPlayer[]; edge: GroupEdge }) {
  const [a, b] = sides;
  const [sideA] = edge.sides;

  const shown = sideA.contributions
    .map((c) => ({
      key: c.key,
      label: c.label,
      weight: c.weight,
      // Recovers the old signed-toward-A contribution from the per-side one.
      contribution: c.contribution - c.weight / 2,
    }))
    .filter((c) => Math.abs(c.contribution) >= MIN_VISIBLE);

  if (shown.length === 0) return null;

  const maxAbs = Math.max(...shown.map((c) => Math.abs(c.contribution)));
  const dropped = sideA.contributions.length - shown.length;

  const aTotal = shown.filter((c) => c.contribution > 0).reduce((s, c) => s + c.contribution, 0);
  const bTotal = shown
    .filter((c) => c.contribution < 0)
    .reduce((s, c) => s + Math.abs(c.contribution), 0);

  const aPct = Math.round((edge.sides[0]?.composite ?? 0.5) * 100);
  const bPct = 100 - aPct;

  const summary = `Each category's pull toward ${a.name} or ${b.name}, in percentage points. Totals: ${a.name} ${points(
    aTotal,
  )} points, ${b.name} ${points(bTotal)} points, for a final split of ${aPct} to ${bPct}.`;

  return (
    <ChartFigure
      title="Where the edge comes from"
      description="Each bar is how far that category moved the meter, in percentage points. They add up to the split above."
      summary={summary}
      table={
        <DataTable
          caption={`Category contributions for ${a.name} versus ${b.name}`}
          head={
            <>
              <Th>Category</Th>
              <Th numeric>Weight</Th>
              <Th numeric>Favors</Th>
              <Th numeric>Points</Th>
            </>
          }
        >
          {shown.map((c) => (
            <tr key={c.key}>
              <Td>{c.label}</Td>
              <Td numeric>{Math.round(c.weight * 100)}%</Td>
              <Td numeric>{c.contribution > 0 ? a.name : b.name}</Td>
              <Td numeric>{points(c.contribution)}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      {/* Column key. Decorative: every row below also names its own player in text. */}
      <div
        aria-hidden="true"
        className="grid grid-cols-2 gap-2 border-b border-line pb-2 text-[11px] font-semibold uppercase tracking-wide"
      >
        <span className="text-right text-brand-purple">&#9664; {a.name}</span>
        <span className="text-brand-cyan">{b.name} &#9654;</span>
      </div>

      <ul role="list" className="mt-2 divide-y divide-line/60">
        {shown.map((c) => {
          const favorsA = c.contribution > 0;
          const width = maxAbs > 0 ? (Math.abs(c.contribution) / maxAbs) * 100 : 0;
          const name = favorsA ? a.name : b.name;
          return (
            <li key={c.key} className="py-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-sm font-medium text-ink">{c.label}</p>
                <p className="text-[11px] text-ink-subtle">
                  <span className="sr-only">Weighted at </span>
                  {Math.round(c.weight * 100)}% of this lens
                </p>
              </div>

              <p className="sr-only">
                {c.label}: favors {name} by {points(c.contribution)} percentage points, carrying{" "}
                {Math.round(c.weight * 100)} percent of the weight.
              </p>

              <div aria-hidden="true" className="mt-1.5 flex items-center gap-0">
                <div className="flex h-4 flex-1 justify-end">
                  {favorsA && (
                    <div
                      className="h-full rounded-l-sm"
                      style={{
                        width: `${width}%`,
                        backgroundImage:
                          "linear-gradient(270deg, #A855F7 0%, rgba(168,85,247,0.55) 100%)",
                      }}
                    />
                  )}
                </div>
                <span className="h-5 w-px shrink-0 bg-line" />
                <div className="flex h-4 flex-1 justify-start">
                  {!favorsA && (
                    <div
                      className="h-full rounded-r-sm"
                      style={{
                        width: `${width}%`,
                        backgroundImage:
                          "linear-gradient(90deg, rgba(34,211,238,0.55) 0%, #22D3EE 100%)",
                      }}
                    />
                  )}
                </div>
              </div>

              <p
                aria-hidden="true"
                className={`mt-1 text-[11px] font-semibold tabular-nums ${
                  favorsA ? "text-right text-brand-purple" : "text-brand-cyan"
                }`}
              >
                {points(c.contribution)} pts to {name}
              </p>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-ink-subtle">
        Totals: {a.name} {points(aTotal)} points, {b.name} {points(bTotal)} points, for a final
        split of {aPct} to {bPct}.
        {dropped > 0 && (
          <>
            {" "}
            {dropped} further categor{dropped === 1 ? "y" : "ies"} scored too close to move the
            result.
          </>
        )}
      </p>
    </ChartFigure>
  );
}

/* ------------------------------------------------------------------ */
/* Three or more players: one stacked bar per player                   */
/* ------------------------------------------------------------------ */

function GroupChart({ sides, edge }: { sides: BreakdownPlayer[]; edge: GroupEdge }) {
  // useId, not a literal string: the Head to head tab's lens switch keeps
  // all three lenses' panels mounted at once (only `hidden` toggles), so
  // without a per-instance id three copies of this heading would collide.
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <h3
        id={headingId}
        className="flex items-center gap-1.5 text-lg font-semibold tracking-tight text-ink sm:text-xl"
      >
        <Scale aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
        Where each player&apos;s composite comes from
      </h3>
      <p className="mt-1 text-sm text-ink-muted">
        One bar per player, split into the categories that built it. Weight and contribution are
        for the active lens.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {sides.map((player, index) => (
          <PlayerContributionChart
            key={player.slug}
            player={player}
            groupEdge={edge}
            sideIndex={index}
          />
        ))}
      </div>
    </section>
  );
}

function PlayerContributionChart({
  player,
  groupEdge,
  sideIndex,
}: {
  player: BreakdownPlayer;
  groupEdge: GroupEdge;
  sideIndex: number;
}) {
  const contributions = [...(groupEdge.sides[sideIndex]?.contributions ?? [])]
    .filter((c) => c.contribution >= MIN_VISIBLE)
    .sort((a, b) => b.contribution - a.contribution);

  const composite = groupEdge.sides[sideIndex]?.composite ?? 0.5;
  const compositePct = Math.round(composite * 100);

  if (contributions.length === 0) {
    return (
      <ChartFigure
        title={player.name}
        summary={`We do not hold enough data on ${player.name} to break down the composite.`}
        table={
          <DataTable caption={`Category contributions for ${player.name}`} head={<Th>Category</Th>}>
            <tr>
              <Td>No scored categories</Td>
            </tr>
          </DataTable>
        }
      >
        <p className="text-xs text-ink-subtle">Not enough data to break down.</p>
      </ChartFigure>
    );
  }

  // ShareSegment prints its `count` verbatim beside a share-of-bar percentage,
  // so contributions are rescaled to percentage points (one decimal) rather
  // than the raw 0..1 fraction, which would otherwise print as "0.0523".
  const segments: ShareSegment[] = contributions.map((c, i) => ({
    key: c.key,
    labelText: c.label,
    count: Math.round(c.contribution * 1000) / 10,
    barClass: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length],
  }));

  const summary = `${player.name}'s composite score is ${compositePct}%, built from ${contributions
    .map((c) => `${c.label} ${points(c.contribution)} points`)
    .join(", ")}.`;

  return (
    <ChartFigure
      title={player.name}
      description={`Composite score: ${compositePct}%`}
      summary={summary}
      table={
        <DataTable
          caption={`Category contributions for ${player.name}`}
          head={
            <>
              <Th>Category</Th>
              <Th numeric>Weight</Th>
              <Th numeric>Points</Th>
            </>
          }
        >
          {contributions.map((c) => (
            <tr key={c.key}>
              <Td>{c.label}</Td>
              <Td numeric>{Math.round(c.weight * 100)}%</Td>
              <Td numeric>{points(c.contribution)}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <StackedShareBar segments={segments} />
    </ChartFigure>
  );
}
