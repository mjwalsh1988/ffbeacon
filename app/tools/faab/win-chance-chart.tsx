"use client";

import {
  ChartFigure,
  DataTable,
  SERIES_A,
  SERIES_B,
  Td,
  Th,
  makeScale,
} from "@/components/chart-kit";
import { rungsForGoal, winPercent, type BidView, type CurvePoint } from "./bid-view";
import type { GoalKey } from "@/lib/faab/types";

/**
 * What each dollar buys.
 *
 * A bid is not a price, it is a bet, and this is the odds board: every whole
 * dollar from nothing up to everything the reader holds, against the chance
 * that bid beats the room. The three marked bids are the same three numbers
 * the hero shows, so the chart and the recommendation can never disagree.
 *
 * BOTH MODES PLOT THE SAME CURVE, FROM THE SAME PLACE. `BidLadder.winCurve`
 * is sampled in lib/faab/ladder.ts, every 5% of the reader's budget plus the
 * three marked bids, so a league answer and a manual one cannot be drawn to
 * different rules. An empty curve means nothing could price the bid (no
 * published budgets and no market cell), and then there is no chart at all
 * rather than a line through numbers nobody computed.
 *
 * The shaded band is where the top rival bid most likely lands, p50 to p75.
 * It is the reason the curve turns where it does.
 */

const W = 520;
const H = 200;
const PAD_LEFT = 40;
const PAD_RIGHT = 16;
const PAD_TOP = 14;
const PAD_BOTTOM = 30;

const INK_SUBTLE = "#8A8A9C";
const LINE = "#2A2A47";

type Mark = { label: string; dollars: number; chance: number | null; color: string };

/** A step path: hold the previous chance until the next priced dollar. */
function stepPath(
  points: CurvePoint[],
  x: (d: number) => number,
  y: (p: number) => number,
): string {
  if (points.length === 0) return "";
  const parts: string[] = [];
  points.forEach((point, index) => {
    const px = x(point.dollars);
    const py = y(point.winChance * 100);
    if (index === 0) {
      parts.push(`M${px.toFixed(2)},${py.toFixed(2)}`);
      return;
    }
    parts.push(`L${px.toFixed(2)},${y(points[index - 1].winChance * 100).toFixed(2)}`);
    parts.push(`L${px.toFixed(2)},${py.toFixed(2)}`);
  });
  return parts.join(" ");
}

export function WinChanceChart({ view, goal }: { view: BidView; goal: GoalKey }) {
  const rungs = rungsForGoal(view.ladder, goal, view.remainingBudget);
  const points = [...view.ladder.winCurve].sort((a, b) => a.dollars - b.dollars);
  if (points.length < 2) return null;

  const maxDollars = Math.max(
    1,
    Math.round(view.remainingBudget),
    points[points.length - 1].dollars,
  );
  const x = makeScale(0, maxDollars, PAD_LEFT, W - PAD_RIGHT);
  const y = makeScale(0, 100, H - PAD_BOTTOM, PAD_TOP);

  // The other goal's own number, never the stretch rung: for the sure goal
  // the stretch IS the walk-away, and a second line labelled "value bid"
  // sitting exactly on the walk-away would be two names for one number.
  const other =
    goal === "value" ? view.ladder.bidsByGoal.sure : view.ladder.bidsByGoal.value;

  const marks: Mark[] = [
    {
      label: "Your bid",
      dollars: rungs.bid.dollars,
      chance: rungs.bid.winChance,
      color: SERIES_A,
    },
    {
      label: goal === "value" ? "To be sure" : "Value bid",
      dollars: other.dollars,
      chance: other.winChance,
      color: SERIES_B,
    },
    {
      label: "Walk away",
      dollars: rungs.walkAway.dollars,
      chance: rungs.walkAway.winChance,
      color: INK_SUBTLE,
    },
  ];

  const bidWin = winPercent(rungs.bid);
  const walkWin = winPercent(rungs.walkAway);
  const rivalTop = view.ladder.rivalTop;

  const sentences: string[] = [];
  if (bidWin !== null && walkWin !== null) {
    sentences.push(
      `Bidding ${rungs.bid.dollars} wins about ${bidWin}% of the time; ${rungs.walkAway.dollars} wins about ${walkWin}%.`,
    );
  } else if (bidWin !== null) {
    sentences.push(`Bidding ${rungs.bid.dollars} wins about ${bidWin}% of the time.`);
  }
  if (rivalTop) {
    sentences.push(
      `The most likely top rival bid is ${rivalTop.p50} to ${rivalTop.p75}.`,
    );
  }
  const summary = sentences.join(" ");

  const rows = tableRows(points, marks);

  return (
    <ChartFigure
      titleLevel={4}
      title="Your chance to win at each bid"
      description={`Every 5% of the ${Math.round(view.remainingBudget)} FAAB you hold, plus the three bids above.`}
      summary={summary}
      tableLabel="View the chance at each bid"
      table={
        <DataTable
          caption="Chance to win the claim at each bid, in FAAB."
          head={
            <>
              <Th>Bid</Th>
              <Th numeric>Chance to win</Th>
            </>
          }
        >
          {rows.map((row) => (
            <tr key={row.key}>
              <Td>{row.label}</Td>
              <Td numeric>{row.chance}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <svg
        role="img"
        aria-label={`Step line of the chance to win against the size of the bid, from 0 to ${maxDollars} FAAB, with marks at your bid, the stretch bid and the walk-away figure.`}
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
      >
        {/* Horizontal gridlines at every 25 percent, labelled. */}
        {[0, 25, 50, 75, 100].map((tick) => (
          <g key={tick}>
            <line
              x1={PAD_LEFT}
              y1={y(tick)}
              x2={W - PAD_RIGHT}
              y2={y(tick)}
              stroke={LINE}
              strokeWidth={1}
            />
            <text
              x={PAD_LEFT - 6}
              y={y(tick) + 4}
              textAnchor="end"
              fontSize={12}
              fill={INK_SUBTLE}
            >
              {tick}%
            </text>
          </g>
        ))}

        {/* Where the top rival bid most likely lands. */}
        {rivalTop && rivalTop.p75 > rivalTop.p50 && (
          <rect
            x={x(Math.min(rivalTop.p50, maxDollars))}
            y={PAD_TOP}
            width={Math.max(
              1,
              x(Math.min(rivalTop.p75, maxDollars)) - x(Math.min(rivalTop.p50, maxDollars)),
            )}
            height={H - PAD_BOTTOM - PAD_TOP}
            fill={SERIES_B}
            opacity={0.12}
          />
        )}

        <path
          d={stepPath(points, x, y)}
          fill="none"
          stroke={SERIES_B}
          strokeWidth={2}
          strokeLinejoin="round"
        />

        {/* Labels are stacked rather than placed on one line: two marks can
            sit a dollar apart, and overlapping text is unreadable at any
            width. */}
        {marks.map((mark, index) => (
          <g key={mark.label}>
            <line
              x1={x(Math.min(mark.dollars, maxDollars))}
              y1={PAD_TOP}
              x2={x(Math.min(mark.dollars, maxDollars))}
              y2={H - PAD_BOTTOM}
              stroke={mark.color}
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
            <text
              x={Math.min(x(Math.min(mark.dollars, maxDollars)) + 4, W - PAD_RIGHT - 96)}
              y={PAD_TOP + 12 + index * 15}
              fontSize={12}
              fill={mark.color}
            >
              {mark.label} {mark.dollars}
            </text>
          </g>
        ))}

        {/* The x axis, with the two ends named. */}
        <line
          x1={PAD_LEFT}
          y1={H - PAD_BOTTOM}
          x2={W - PAD_RIGHT}
          y2={H - PAD_BOTTOM}
          stroke={LINE}
          strokeWidth={1}
        />
        <text x={PAD_LEFT} y={H - 10} fontSize={12} fill={INK_SUBTLE}>
          0 FAAB
        </text>
        <text
          x={W - PAD_RIGHT}
          y={H - 10}
          textAnchor="end"
          fontSize={12}
          fill={INK_SUBTLE}
        >
          {maxDollars} FAAB
        </text>

        {/* One hover target per plotted step, carrying its own tooltip. */}
        {points.map((point) => (
          <rect
            key={point.dollars}
            x={x(point.dollars) - 3}
            y={PAD_TOP}
            width={6}
            height={H - PAD_BOTTOM - PAD_TOP}
            fill="transparent"
          >
            <title>
              {point.dollars} FAAB wins {Math.round(point.winChance * 100)}% of the time
            </title>
          </rect>
        ))}
      </svg>
    </ChartFigure>
  );
}

type Row = { key: string; label: string; chance: string };

/**
 * The numbers under the chart.
 *
 * One row per plotted point, which is already every 5% of the budget plus
 * the three marked bids: the ladder samples both into one curve, so the
 * table does not add rows of its own and cannot drift from the line. A row
 * that IS one of the marked bids says which, in the same cell as the figure.
 */
function tableRows(points: CurvePoint[], marks: Mark[]): Row[] {
  const names = new Map<number, string[]>();
  for (const mark of marks) {
    const existing = names.get(mark.dollars) ?? [];
    existing.push(mark.label.toLowerCase());
    names.set(mark.dollars, existing);
  }

  return points.map((point) => {
    const named = names.get(point.dollars);
    return {
      key: `point-${point.dollars}`,
      label: named
        ? `${point.dollars} FAAB, ${named.join(" and ")}`
        : `${point.dollars} FAAB`,
      chance: `${Math.round(point.winChance * 100)}%`,
    };
  });
}
