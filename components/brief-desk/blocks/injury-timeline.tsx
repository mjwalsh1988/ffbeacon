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

/** `standalone`: a link on its own in a card, which takes the house 44px tap target. */
function playerCell(r: TimelineRow, standalone = false) {
  return r.slug ? (
    <Link href={`/players/${r.slug}`} className={standalone ? `inline-flex min-h-11 items-center ${BLOCK_LINK_CLASS}` : BLOCK_LINK_CLASS}>
      {r.name}
    </Link>
  ) : (
    r.name
  );
}

/** How a status reads as a group heading, most serious first. */
const STATUS_GROUPS: Array<{ key: string; label: string }> = [
  { key: "ir", label: "Injured reserve" },
  { key: "pup", label: "PUP list" },
  { key: "out", label: "Out" },
  { key: "doubtful", label: "Doubtful" },
];

/**
 * The reports that gave no return week, as a compact grid grouped by status
 * rather than one long column: each card is the name, the position and team,
 * and a link to the report. Two to three cards a row on a wide screen, one on
 * a phone, and every name stays.
 */
function NoTimelineGrid({ id, rows }: { id: string; rows: TimelineRow[] }) {
  const known = new Set(STATUS_GROUPS.map((g) => g.key));
  const groups = [
    ...STATUS_GROUPS.map((g) => ({ ...g, rows: rows.filter((r) => (r.status ?? "").toLowerCase() === g.key) })),
    { key: "other", label: "Other", rows: rows.filter((r) => !known.has((r.status ?? "").toLowerCase())) },
  ].filter((g) => g.rows.length > 0);
  return (
    <div className="mt-4 rounded-card border border-line bg-base/40 p-4">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">{`No timeline given, ${rows.length} ${rows.length === 1 ? "player" : "players"}`}</h4>
      {groups.map((g) => (
        <div key={g.key} className="mt-3">
          <p id={`block-${id}-${g.key}`} className="text-[11px] font-semibold uppercase tracking-wide text-brand-cyan">
            {`${g.label}, ${g.rows.length}`}
          </p>
          <ul role="list" aria-labelledby={`block-${id}-${g.key}`} className="mt-1.5 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {g.rows
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((r, i) => (
                <li key={`${r.slug ?? r.name}-${i}`} className="flex min-h-11 items-center justify-between gap-2 rounded-md border border-line/70 bg-surface/50 px-3 py-1.5">
                  <span className="min-w-0">
                    <span className="block break-words text-sm">{playerCell(r, true)}</span>
                    {(r.position || r.team) && <span className="block text-[11px] text-ink-subtle">{[r.position, r.team].filter(Boolean).join(", ")}</span>}
                  </span>
                  {r.relaySlug && (
                    <Link
                      href={`/brief/relay/${r.relaySlug}`}
                      className="inline-flex min-h-11 shrink-0 items-center text-xs text-ink-subtle transition-colors hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                    >
                      Report<span className="sr-only">{` on ${r.name}`}</span>
                    </Link>
                  )}
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

const NARROW_W = 340;
const NARROW_ROW_H = 36;
const NARROW_AXIS_H = 24;

/**
 * The same chart for a phone. Scaled down from 640 wide, the wide chart's
 * labels land under 6px on a 390px screen, so below sm each name sits on its
 * own line above its marker and the axis thins its labels to stay legible.
 */
function NarrowTimeline({ dated, minWeek, maxWeek, ticks }: { dated: TimelineRow[]; minWeek: number; maxWeek: number; ticks: number[] }) {
  const x = makeScale(minWeek, maxWeek, 16, NARROW_W - 20);
  const height = NARROW_AXIS_H + PAD * 2 + dated.length * NARROW_ROW_H;
  // About 44 units per "Wk 10" label: every tick is labelled when they fit,
  // every second or third when the window is long. Gridlines stay on all.
  const step = Math.max(1, Math.ceil((44 * ticks.length) / (NARROW_W - 36)));
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${NARROW_W} ${height}`} className="h-auto w-full sm:hidden">
      {ticks.map((w, i) => (
        <g key={w}>
          <line x1={x(w)} y1={NARROW_AXIS_H} x2={x(w)} y2={height - PAD} stroke="#2A2A3C" strokeWidth="1" />
          {i % step === 0 && (
            <text x={x(w)} y={NARROW_AXIS_H - 8} textAnchor="middle" fontSize="12" fill="#A8A8B8">
              {`Wk ${w}`}
            </text>
          )}
        </g>
      ))}
      {dated.map((r, i) => {
        const top = NARROW_AXIS_H + PAD + i * NARROW_ROW_H;
        const cy = top + 25;
        const cx = x(r.returnWeek as number);
        return (
          <g key={`${r.slug ?? r.name}-${i}`}>
            <text x={4} y={top + 12} fontSize="13" fill="#D4D4DE">
              {r.name.length > 34 ? `${r.name.slice(0, 33)}.` : r.name}
            </text>
            <line x1={x(minWeek)} y1={cy} x2={cx} y2={cy} stroke={SERIES_A} strokeWidth="1" strokeDasharray="2 3" />
            <path d={markerPath("circle", cx, cy, 5)} fill={SERIES_A} />
          </g>
        );
      })}
    </svg>
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
          <>
            <svg aria-hidden="true" viewBox={`0 0 ${W} ${height}`} className="hidden h-auto w-full sm:block">
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
            <NarrowTimeline dated={dated} minWeek={minWeek} maxWeek={maxWeek} ticks={ticks} />
          </>
        )}
      </ChartFigure>
      {undated.length > 0 && <NoTimelineGrid id={id} rows={undated} />}
      <DatasetFooter dataset={dataset} />
    </div>
  );
}
