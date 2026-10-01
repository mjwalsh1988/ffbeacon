/**
 * value_movers: a horizontal bar chart of change_7d, risers and fallers,
 * through chart-kit. The SVG is aria-hidden; the summary paragraph states the
 * conclusion and the biggest move either way; the table under the disclosure
 * carries every number. Bars are purple for a rise and red for a fall, and
 * every bar also carries its signed figure as text, so colour never carries
 * the direction alone.
 *
 * Server component.
 */

import Link from "next/link";
import { ChartEmpty, ChartFigure, DataTable, SERIES_A, Td, Th } from "@/components/chart-kit";

/** A fall, in the red the game cards and tables use for one (about 6:1 on the card). The sign on every label carries the direction too. */
const FALL_COLOR = "#F87171";
import type { BundleDataset } from "@/lib/brief-desk/types";
import { formatCell, formatSigned, readNumber, readPlayer } from "@/lib/brief-desk/dataset-read";
import { BLOCK_LINK_CLASS, DatasetFooter } from "./block-shell";

const CHANGE_KEYS = ["change_7d", "change", "delta"];
const CURRENT_KEYS = ["current", "value"];

const W = 640;
const LABEL_W = 170;
const VALUE_W = 56;
const ROW_H = 26;
const TOP = 6;

type Mover = {
  name: string;
  slug: string | null;
  position: string | null;
  team: string | null;
  change: number;
  current: number | null;
};

const NARROW_W = 340;
const NARROW_ROW_H = 36;
const NAME_H = 16;

/**
 * The bars, in one of two layouts. "wide" (sm and up) puts the name in a
 * column beside its bar. "narrow" is the phone layout: scaled from 640 wide to
 * a 390px screen the wide chart's labels land under 6px, so each name sits on
 * its own line above its bar and the bars take the full width.
 */
function MoversSvg({ movers, layout }: { movers: Mover[]; layout: "wide" | "narrow" }) {
  const narrow = layout === "narrow";
  const w = narrow ? NARROW_W : W;
  const labelW = narrow ? 0 : LABEL_W;
  const rowH = narrow ? NARROW_ROW_H : ROW_H;
  const nameH = narrow ? NAME_H : 0;
  const barH = narrow ? 12 : ROW_H - 10;
  const fontSize = narrow ? 13 : 12;

  const hasPos = movers.some((m) => m.change > 0);
  const hasNeg = movers.some((m) => m.change < 0);
  // Only a chart with both directions diverges from a centre line. A
  // falls-only chart draws magnitude from the left like the risers chart, so
  // each bar starts beside its name instead of far across the plot.
  const diverging = hasPos && hasNeg;
  const maxAbs = Math.max(1, ...movers.map((m) => Math.abs(m.change)));
  const plotW = w - labelW - VALUE_W * (diverging ? 2 : 1);
  const zeroX = diverging ? labelW + VALUE_W + plotW / 2 : labelW;
  const unit = (diverging ? plotW / 2 : plotW) / maxAbs;
  const height = TOP * 2 + movers.length * rowH;

  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${w} ${height}`}
      className={narrow ? "h-auto w-full sm:hidden" : "hidden h-auto w-full sm:block"}
      style={narrow ? undefined : { maxHeight: `${Math.min(height, 520)}px` }}
    >
      <line x1={zeroX} y1={TOP + nameH} x2={zeroX} y2={height - TOP} stroke="#6B6B7D" strokeWidth="1" />
      {movers.map((m, i) => {
        const y = TOP + i * rowH;
        const barY = narrow ? y + nameH + 2 : y + 5;
        const textY = barY + barH / 2 + 4;
        const len = Math.abs(m.change) * unit;
        const rightward = !diverging || m.change >= 0;
        const x = rightward ? zeroX : zeroX - len;
        const color = m.change >= 0 ? SERIES_A : FALL_COLOR;
        const valueX = rightward ? zeroX + len + 6 : zeroX - len - 6;
        return (
          <g key={`${m.slug ?? m.name}-${i}`}>
            {narrow ? (
              <text x={2} y={y + 12} fontSize={fontSize} fill="#D4D4DE">
                {m.name.length > 34 ? `${m.name.slice(0, 33)}.` : m.name}
              </text>
            ) : (
              <text x={LABEL_W - 8} y={textY} textAnchor="end" fontSize={fontSize} fill="#A8A8B8">
                {m.name.length > 24 ? `${m.name.slice(0, 23)}.` : m.name}
              </text>
            )}
            <rect x={x} y={barY} width={Math.max(2, len)} height={barH} rx="3" fill={color} />
            <text x={valueX} y={textY} textAnchor={rightward ? "start" : "end"} fontSize={fontSize} fontWeight="600" fill={color}>
              {formatSigned(m.change)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function ValueMoversBlock({
  caption,
  conclusion,
  dataset,
  options,
}: {
  id: string;
  caption: string;
  conclusion: string;
  dataset: BundleDataset;
  options: { direction: "up" | "down" | "both"; limit: number };
}) {
  const movers: Mover[] = dataset.rows
    .map((row) => {
      const p = readPlayer(row);
      const change = readNumber(row, CHANGE_KEYS);
      if (change === null) return null;
      return { name: p.name, slug: p.slug, position: p.position, team: p.team, change, current: readNumber(row, CURRENT_KEYS) };
    })
    .filter((m): m is Mover => m !== null)
    .filter((m) => (options.direction === "up" ? m.change > 0 : options.direction === "down" ? m.change < 0 : true))
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, options.limit);

  const biggestRise = movers.filter((m) => m.change > 0).sort((a, b) => b.change - a.change)[0] ?? null;
  const biggestFall = movers.filter((m) => m.change < 0).sort((a, b) => a.change - b.change)[0] ?? null;
  // The conclusion is the figure's visible description already; repeating it
  // as the first sentence of the sr-only summary read it twice in a row.
  const summaryParts: string[] = [];
  if (biggestRise) summaryParts.push(`The biggest rise is ${biggestRise.name} at ${formatSigned(biggestRise.change)}.`);
  if (biggestFall) summaryParts.push(`The biggest fall is ${biggestFall.name} at ${formatSigned(biggestFall.change)}.`);
  if (movers.length === 0) summaryParts.push("No value moves were recorded for this period.");

  return (
    <div className="my-6">
      <ChartFigure
        title={caption || dataset.title || "Value movers"}
        description={conclusion || undefined}
        summary={summaryParts.join(" ")}
        titleLevel={3}
        table={
          <DataTable caption={`${caption || dataset.title}: every player and the seven-day change`} head={
            <>
              <Th>Player</Th>
              <Th>Pos</Th>
              <Th>Team</Th>
              <Th numeric>Value</Th>
              <Th numeric>7-day change</Th>
            </>
          }>
            {movers.map((m) => (
              <tr key={`${m.slug ?? m.name}`}>
                <Td>{m.slug ? <Link href={`/players/${m.slug}`} className={BLOCK_LINK_CLASS}>{m.name}</Link> : m.name}</Td>
                <Td>{m.position ?? "n/a"}</Td>
                <Td>{m.team ?? "n/a"}</Td>
                <Td numeric>{formatCell(m.current)}</Td>
                <Td numeric>{formatSigned(m.change)}</Td>
              </tr>
            ))}
          </DataTable>
        }
      >
        {movers.length === 0 ? (
          <ChartEmpty>No value moves were recorded for this period.</ChartEmpty>
        ) : (
          <>
            <MoversSvg movers={movers} layout="wide" />
            <MoversSvg movers={movers} layout="narrow" />
          </>
        )}
      </ChartFigure>
      <DatasetFooter dataset={dataset} />
    </div>
  );
}
