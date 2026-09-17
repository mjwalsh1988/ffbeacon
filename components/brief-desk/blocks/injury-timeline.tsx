/**
 * injury_timeline: one marker per player at the expected return week, drawn
 * with chart-kit's scale, and the players whose report gave no timeline
 * listed under it in words. The SVG is aria-hidden; the summary says who is
 * back when; the table carries every row including the status and the
 * timeline text as reported.
 *
 * Server component.
 */

import Link from "next/link";
import { ChartEmpty, ChartFigure, DataTable, makeScale, markerPath, SERIES_A, Td, Th } from "@/components/chart-kit";
import type { BundleDataset } from "@/lib/brief-desk/types";
import { readNumber, readPlayer, readText } from "@/lib/brief-desk/dataset-read";
import { BLOCK_LINK_CLASS, DatasetFooter } from "./block-shell";

const RETURN_KEYS = ["expected_return_week", "return_week", "expected_week"];
const STATUS_KEYS = ["availability", "status"];
const TIMELINE_KEYS = ["timeline", "timeline_text"];
const RELAY_SLUG_KEYS = ["relay_slug", "permalink_slug"];

const W = 640;
const LABEL_W = 170;
const ROW_H = 24;
const AXIS_H = 22;
const PAD = 8;

export type TimelineRow = {
  name: string;
  slug: string | null;
  position: string | null;
  team: string | null;
  status: string | null;
  timeline: string | null;
  returnWeek: number | null;
  relaySlug: string | null;
};

export function readTimelineRows(dataset: BundleDataset): TimelineRow[] {
  return dataset.rows.map((row) => {
    const p = readPlayer(row);
    const wk = readNumber(row, RETURN_KEYS);
    return {
      name: p.name,
      slug: p.slug,
      position: p.position,
      team: p.team,
      status: readText(row, STATUS_KEYS),
      timeline: readText(row, TIMELINE_KEYS),
      returnWeek: wk !== null && wk >= 1 && wk <= 22 ? Math.round(wk) : null,
      relaySlug: readText(row, RELAY_SLUG_KEYS),
    };
  });
}

function playerCell(r: TimelineRow) {
  return r.slug ? (
    <Link href={`/players/${r.slug}`} className={BLOCK_LINK_CLASS}>
      {r.name}
    </Link>
  ) : (
    r.name
  );
}

export function InjuryTimelineBlock({
  id,
  caption,
  conclusion,
  dataset,
}: {
  id: string;
  caption: string;
  conclusion: string;
  dataset: BundleDataset;
}) {
  const rows = readTimelineRows(dataset);
  const dated = rows.filter((r) => r.returnWeek !== null).sort((a, b) => (a.returnWeek as number) - (b.returnWeek as number) || a.name.localeCompare(b.name));
  const undated = rows.filter((r) => r.returnWeek === null);

  const weeks = dated.map((r) => r.returnWeek as number);
  const minWeek = weeks.length ? Math.min(...weeks) : 1;
  const maxWeek = weeks.length ? Math.max(minWeek + 1, Math.max(...weeks)) : 2;
  const x = makeScale(minWeek, maxWeek, LABEL_W + 12, W - 24);
  const height = AXIS_H + PAD * 2 + dated.length * ROW_H;
  const ticks: number[] = [];
  for (let w = minWeek; w <= maxWeek; w += 1) ticks.push(w);

  // The conclusion is the figure's visible description already; repeating it
  // as the first sentence of the sr-only summary read it twice in a row.
  const summaryParts: string[] = [];
  if (dated.length > 0) {
    const soonest = dated[0];
    const latest = dated[dated.length - 1];
    summaryParts.push(
      `${dated.length} ${dated.length === 1 ? "player has" : "players have"} an expected return between week ${soonest.returnWeek} (${soonest.name}) and week ${latest.returnWeek} (${latest.name}).`,
    );
  }
  if (undated.length > 0) summaryParts.push(`${undated.length} ${undated.length === 1 ? "report gave" : "reports gave"} no timeline.`);
  if (rows.length === 0) summaryParts.push("No injuries with a timeline were reported this period.");

  return (
    <div className="my-6" id={`block-${id}`}>
      <ChartFigure
        title={caption || dataset.title || "Injury timeline"}
        description={conclusion || undefined}
        summary={summaryParts.join(" ")}
        titleLevel={3}
        table={
          <DataTable
            caption={`${caption || dataset.title || "Injury timeline"}: every player, the status, the timeline as reported and the expected return week`}
            head={
              <>
                <Th>Player</Th>
                <Th>Team</Th>
                <Th>Status</Th>
                <Th>Timeline as reported</Th>
                <Th numeric>Expected return</Th>
              </>
            }
          >
            {[...dated, ...undated].map((r, i) => (
              <tr key={`${r.slug ?? r.name}-${i}`}>
                <Td>{playerCell(r)}</Td>
                <Td>{r.team ?? "n/a"}</Td>
                <Td>{r.status ?? "n/a"}</Td>
                <Td>{r.timeline ?? "No timeline given"}</Td>
                <Td numeric>{r.returnWeek !== null ? `Week ${r.returnWeek}` : "n/a"}</Td>
              </tr>
            ))}
          </DataTable>
        }
      >
        {dated.length === 0 ? (
          <ChartEmpty>
            {rows.length === 0
              ? "No injuries with a timeline were reported this period."
              : "None of this period's injury reports gave a return week; each is listed below."}
          </ChartEmpty>
        ) : (
          <svg aria-hidden="true" viewBox={`0 0 ${W} ${height}`} className="h-auto w-full">
            {ticks.map((w) => (
              <g key={w}>
                <line x1={x(w)} y1={AXIS_H} x2={x(w)} y2={height - PAD} stroke="#2A2A3C" strokeWidth="1" />
                <text x={x(w)} y={AXIS_H - 8} textAnchor="middle" fontSize="11" fill="#A8A8B8">
                  {`Wk ${w}`}
                </text>
              </g>
            ))}
            {dated.map((r, i) => {
              const cy = AXIS_H + PAD + i * ROW_H + ROW_H / 2;
              const cx = x(r.returnWeek as number);
              return (
                <g key={`${r.slug ?? r.name}-${i}`}>
                  <text x={LABEL_W} y={cy + 4} textAnchor="end" fontSize="12" fill="#A8A8B8">
                    {r.name.length > 24 ? `${r.name.slice(0, 23)}.` : r.name}
                  </text>
                  <line x1={LABEL_W + 12} y1={cy} x2={cx} y2={cy} stroke={SERIES_A} strokeWidth="1" strokeDasharray="2 3" />
                  <path d={markerPath("circle", cx, cy, 5)} fill={SERIES_A} />
                </g>
              );
            })}
          </svg>
        )}
      </ChartFigure>
      {undated.length > 0 && (
        <div className="mt-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">No timeline given</h4>
          <ul role="list" className="mt-1.5 space-y-1 text-sm text-ink-muted">
            {undated.map((r, i) => (
              <li key={`${r.slug ?? r.name}-${i}`}>
                {playerCell(r)}
                {r.status ? `, ${r.status}` : ""}
                {r.relaySlug && (
                  <>
                    {" "}
                    (
                    <Link href={`/brief/relay/${r.relaySlug}`} className={BLOCK_LINK_CLASS}>
                      the report
                    </Link>
                    )
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <DatasetFooter dataset={dataset} />
    </div>
  );
}
