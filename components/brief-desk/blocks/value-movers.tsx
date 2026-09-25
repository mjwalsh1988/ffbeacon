/**
 * value_movers: a horizontal bar chart of change_7d, risers and fallers,
 * through chart-kit. The SVG is aria-hidden; the summary paragraph states the
 * conclusion and the biggest move either way; the table under the disclosure
 * carries every number. Bars are purple for a rise and cyan for a fall, and
 * every bar also carries its signed figure as text, so colour never carries
 * the direction alone.
 *
 * Server component.
 */

import Link from "next/link";
import { ChartEmpty, ChartFigure, DataTable, SERIES_A, SERIES_B, Td, Th } from "@/components/chart-kit";
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

  const hasPos = movers.some((m) => m.change > 0);
  const hasNeg = movers.some((m) => m.change < 0);
  const maxAbs = Math.max(1, ...movers.map((m) => Math.abs(m.change)));
  const plotW = W - LABEL_W - VALUE_W * (hasPos && hasNeg ? 2 : 1);
  const zeroX = hasPos && hasNeg ? LABEL_W + VALUE_W + plotW / 2 : hasNeg ? LABEL_W + VALUE_W + plotW : LABEL_W;
  const unit = (hasPos && hasNeg ? plotW / 2 : plotW) / maxAbs;
  const height = TOP * 2 + movers.length * ROW_H;

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
          <svg
            aria-hidden="true"
            viewBox={`0 0 ${W} ${height}`}
            className="h-auto w-full"
            style={{ maxHeight: `${Math.min(height, 520)}px` }}
          >
            <line x1={zeroX} y1={TOP} x2={zeroX} y2={height - TOP} stroke="#6B6B7D" strokeWidth="1" />
            {movers.map((m, i) => {
              const y = TOP + i * ROW_H;
              const len = Math.abs(m.change) * unit;
              const x = m.change >= 0 ? zeroX : zeroX - len;
              const color = m.change >= 0 ? SERIES_A : SERIES_B;
              const valueX = m.change >= 0 ? zeroX + len + 6 : zeroX - len - 6;
              return (
                <g key={`${m.slug ?? m.name}-${i}`}>
                  <text x={LABEL_W - 8} y={y + ROW_H / 2 + 4} textAnchor="end" fontSize="12" fill="#A8A8B8">
                    {m.name.length > 24 ? `${m.name.slice(0, 23)}.` : m.name}
                  </text>
                  <rect x={x} y={y + 5} width={Math.max(2, len)} height={ROW_H - 10} rx="3" fill={color} />
                  <text
                    x={valueX}
                    y={y + ROW_H / 2 + 4}
                    textAnchor={m.change >= 0 ? "start" : "end"}
                    fontSize="12"
                    fontWeight="600"
                    fill={color}
                  >
                    {formatSigned(m.change)}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </ChartFigure>
      <DatasetFooter dataset={dataset} />
    </div>
  );
}
