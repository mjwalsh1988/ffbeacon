import Link from "next/link";
import {
  ChartEmpty,
  ChartFigure,
  DataTable,
  POSITION_SERIES,
  Td,
  Th,
  linePath,
  makeScale,
  markerPath,
} from "@/components/chart-kit";
import { formatEasternShortDate } from "@/lib/datetime";
import type { SuperflexPricePairs } from "@/lib/guides/superflex-price-pairs";

/**
 * The diagrams in the superflex guide.
 *
 * EVERY NUMBER HERE IS INVENTED, with one exception. The figures teach a shape
 * (the replacement line moving down the quarterback list, a draft's first two
 * rounds filling with quarterbacks, a quarterback's career outlasting a running
 * back's, two byes landing in the same week), and each caption says so in
 * words. The exception is PricePairsFigure, which is read live from the same
 * cached rankings boards the /rankings pages render, and its caption says
 * that instead, with the source's display name and the date of the values.
 *
 * Every figure goes through ChartFigure, which puts the conclusion in a
 * sentence before the graphic and the plotted values in a real table under a
 * disclosure. The SVG ones mark their <svg> aria-hidden, because the sentence
 * and the table carry the meaning. The DOM-built ones (the two draft strips,
 * the bye grid) keep their text in the tree, so nothing about them is hidden
 * from a screen reader.
 *
 * The one-quarterback and superflex replacement ranks (13 and 25 in a
 * twelve-team league) are arithmetic, not measurement: twelve teams times one
 * starter plus one, twelve teams times two starters plus one. The "about 32"
 * NFL starters is the number of teams in the league.
 */

const PURPLE = "#A855F7";
const CYAN = "#22D3EE";
const INK = "#F4F4F8";
const INK_SUBTLE = "#8A8A9C";
const LINE = "#2A2A47";

/* ---------- Lesson 1: the replacement line moves ---------- */

/** Invented weekly points for the quarterback ranked r, 1 through 32. */
function qbPointsAtRank(r: number): number {
  // Three straight runs: a gentle top, a steeper middle, a flat tail. The
  // anchors are the ones the guide's prose quotes.
  const pts =
    r <= 13
      ? 22.0 - ((r - 1) * (22.0 - 16.5)) / 12
      : r <= 25
        ? 16.5 - ((r - 13) * (16.5 - 11.5)) / 12
        : 11.5 - ((r - 25) * (11.5 - 9.0)) / 7;
  return Math.round(pts * 10) / 10;
}

export function ReplacementLineFigure() {
  const ranks = Array.from({ length: 32 }, (_, i) => i + 1);
  const points = ranks.map(qbPointsAtRank);
  const oneQbLine = 13;
  const superflexLine = 25;
  const gapOneQb = points[0] - points[oneQbLine - 1];
  const gapSuperflex = points[0] - points[superflexLine - 1];

  const W = 640;
  const H = 250;
  const padL = 40;
  const padR = 16;
  const padT = 34;
  const padB = 40;
  const x = makeScale(1, 32, padL, W - padR);
  const y = makeScale(0, 24, H - padB, padT);
  const barW = (x(2) - x(1)) * 0.72;

  const tableRanks = [1, 5, 10, 13, 18, 25, 30, 32];

  return (
    <ChartFigure
      titleLevel={3}
      title="The replacement quarterback moves twelve places"
      description="Invented weekly points for the top 32 quarterbacks in a twelve-team league. The first line is the last starter in a one-quarterback league, QB12, so the free one is QB13. The second is the last starter in superflex, QB24, so the free one is QB25."
      summary={`In this invented league QB1 scores ${points[0].toFixed(1)} points a week. The replacement quarterback in a one-quarterback league is QB13 at ${points[oneQbLine - 1].toFixed(1)}, a gap of ${gapOneQb.toFixed(1)}. In superflex the replacement is QB25 at ${points[superflexLine - 1].toFixed(1)}, a gap of ${gapSuperflex.toFixed(1)}. The same quarterback is worth almost twice as much because the free one got worse.`}
      table={
        <DataTable
          caption="Invented weekly points by quarterback rank, at the ranks that matter."
          head={
            <>
              <Th>Rank</Th>
              <Th numeric>Points a week</Th>
              <Th>What he is</Th>
            </>
          }
        >
          {tableRanks.map((r) => (
            <tr key={r}>
              <Td>QB{r}</Td>
              <Td numeric>{points[r - 1].toFixed(1)}</Td>
              <Td>
                {r === 1
                  ? "The best"
                  : r === oneQbLine
                    ? "Replacement in a one-QB league"
                    : r === superflexLine
                      ? "Replacement in superflex"
                      : r === 32
                        ? "The last NFL starter"
                        : ""}
              </Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="presentation"
      >
        {/* Axis. */}
        <line
          x1={padL}
          y1={H - padB}
          x2={W - padR}
          y2={H - padB}
          stroke={LINE}
        />
        {[1, 8, 16, 24, 32].map((r) => (
          <text
            key={r}
            x={x(r)}
            y={H - padB + 18}
            textAnchor="middle"
            fontSize="11"
            fill={INK_SUBTLE}
          >
            QB{r}
          </text>
        ))}
        {/* Bars: starters in a one-QB league are purple, the extra superflex
            starters are cyan, everyone else is grey. */}
        {ranks.map((r) => {
          const fill = r <= 12 ? PURPLE : r <= 24 ? CYAN : LINE;
          return (
            <rect
              key={r}
              x={x(r) - barW / 2}
              y={y(points[r - 1])}
              width={barW}
              height={H - padB - y(points[r - 1])}
              fill={fill}
              opacity={r <= 24 ? 0.85 : 1}
            />
          );
        })}
        {/* The two replacement lines. */}
        {[
          {
            r: oneQbLine,
            label: "1QB: the free one is QB13",
            color: PURPLE,
            anchor: "start" as const,
            dy: 0,
          },
          // Anchored to its right so the label cannot run off the edge of the
          // chart, and dropped a line so it never collides with the first one.
          {
            r: superflexLine,
            label: "Superflex: the free one is QB25",
            color: CYAN,
            anchor: "end" as const,
            dy: 16,
          },
        ].map((m) => (
          <g key={m.r}>
            <line
              x1={x(m.r)}
              y1={padT - 6}
              x2={x(m.r)}
              y2={H - padB}
              stroke={m.color}
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
            <text
              x={m.anchor === "start" ? x(m.r) + 6 : x(m.r) - 6}
              y={padT + 2 + m.dy}
              textAnchor={m.anchor}
              fontSize="11"
              fontWeight={600}
              fill={INK}
            >
              {m.label}
            </text>
          </g>
        ))}
        {/* Gap labels on QB1. */}
        <text
          x={x(1) + barW}
          y={y(points[0]) - 8}
          fontSize="11"
          fill={INK_SUBTLE}
        >
          QB1: {points[0].toFixed(1)} a week
        </text>
      </svg>
      <ul
        role="list"
        className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-medium"
      >
        <li className="flex items-center gap-1.5 text-brand-purple">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: PURPLE }}
          />
          Starters in a one-QB league
        </li>
        <li className="flex items-center gap-1.5 text-brand-cyan">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: CYAN }}
          />
          The extra twelve starters superflex adds
        </li>
        <li className="flex items-center gap-1.5 text-ink-muted">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: LINE }}
          />
          Left on the wire
        </li>
      </ul>
    </ChartFigure>
  );
}

/* ---------- Lesson 1: the same quarterbacks, priced both ways (live) ---------- */

function valueText(v: number | null): string {
  return v == null ? "no value" : Math.round(v).toLocaleString("en-US");
}

export function PricePairsFigure({ pairs }: { pairs: SuperflexPricePairs }) {
  if (pairs.status !== "ok") {
    return (
      <figure className="mt-6 rounded-card border border-line bg-base/40 p-4">
        <figcaption>
          <h3 className="text-sm font-semibold text-ink">
            The same quarterbacks, priced both ways
          </h3>
        </figcaption>
        <div className="mt-3">
          <ChartEmpty>{pairs.reason}</ChartEmpty>
        </div>
      </figure>
    );
  }

  const { rows, oneQb, superflex, sourceName, asOf } = pairs;
  const withTwin = rows.filter((r) => r.oneQbRank != null);
  const avgDrop =
    withTwin.length > 0
      ? withTwin.reduce(
          (s, r) => s + ((r.oneQbRank ?? 0) - r.superflexRank),
          0,
        ) / withTwin.length
      : 0;

  return (
    <figure className="mt-6 rounded-card border border-brand-cyan/30 bg-base/40 p-4">
      <figcaption>
        <h3 className="text-sm font-semibold text-ink">
          The same quarterbacks, priced both ways
        </h3>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
          Live, not invented. The top {rows.length} quarterbacks on the{" "}
          {superflex.displayName} board by {sourceName}, beside the same
          players&apos; rank and value on the {oneQb.displayName} board from the
          same source.
          {asOf
            ? ` Values as of ${formatEasternShortDate(asOf)}, refreshed with the nightly sync.`
            : ""}
        </p>
      </figcaption>
      <p className="sr-only">
        {withTwin.length > 0
          ? `Across these ${withTwin.length} quarterbacks the overall rank falls by an average of ${Math.round(avgDrop)} places when the league starts one quarterback instead of two. The player did not change; the league did.`
          : "The one-quarterback board does not currently rank these players, so the comparison shows the superflex side only."}
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[30rem] border-collapse text-left text-sm">
          <caption className="sr-only">
            Overall rank and value for the top quarterbacks in{" "}
            {superflex.displayName} and in {oneQb.displayName}, from{" "}
            {sourceName}.
          </caption>
          <thead>
            <tr className="border-b border-line text-[10px] uppercase tracking-wide text-ink-subtle">
              <th scope="col" className="py-1.5 pr-3 font-semibold">
                Quarterback
              </th>
              <th scope="col" className="py-1.5 pr-3 text-right font-semibold">
                Superflex rank
              </th>
              <th scope="col" className="py-1.5 pr-3 text-right font-semibold">
                Superflex value
              </th>
              <th scope="col" className="py-1.5 pr-3 text-right font-semibold">
                1QB rank
              </th>
              <th scope="col" className="py-1.5 pr-3 text-right font-semibold">
                1QB value
              </th>
              <th scope="col" className="py-1.5 text-right font-semibold">
                Places lost
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {rows.map((r) => {
              const drop =
                r.oneQbRank == null ? null : r.oneQbRank - r.superflexRank;
              return (
                <tr key={r.slug}>
                  <th scope="row" className="py-2 pr-3 font-medium text-ink">
                    <Link
                      href={`/players/${r.slug}`}
                      className="inline-flex min-h-11 items-center underline-offset-2 hover:text-brand-cyan hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                    >
                      {r.name}
                    </Link>
                    {r.team ? (
                      <span className="ml-1.5 text-xs text-ink-subtle">
                        {r.team}
                      </span>
                    ) : null}
                  </th>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums text-brand-cyan">
                    {r.superflexRank}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums text-ink-muted">
                    {valueText(r.superflexValue)}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums text-brand-purple">
                    {r.oneQbRank ?? "unranked"}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums text-ink-muted">
                    {valueText(r.oneQbValue)}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums text-ink">
                    {drop == null ? "n/a" : String(drop)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-ink-muted">
        Places lost is the one-quarterback rank minus the superflex rank: how
        many spots the same player drops when the league only needs half as many
        quarterbacks. Full boards:{" "}
        <Link
          href={`/rankings/${superflex.slug}`}
          className="text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80"
        >
          {superflex.displayName}
        </Link>{" "}
        and{" "}
        <Link
          href={`/rankings/${oneQb.slug}`}
          className="text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80"
        >
          {oneQb.displayName}
        </Link>
        .
      </p>
    </figure>
  );
}

/* ---------- Lesson 3: the first two rounds ---------- */

type Pos = "QB" | "RB" | "WR" | "TE";

const ONE_QB_ROUNDS: Pos[] = [
  "RB",
  "WR",
  "RB",
  "WR",
  "RB",
  "WR",
  "RB",
  "WR",
  "TE",
  "RB",
  "WR",
  "WR",
  "RB",
  "WR",
  "WR",
  "RB",
  "QB",
  "WR",
  "RB",
  "TE",
  "WR",
  "RB",
  "WR",
  "RB",
];

const SUPERFLEX_ROUNDS: Pos[] = [
  "QB",
  "RB",
  "QB",
  "WR",
  "QB",
  "RB",
  "QB",
  "WR",
  "QB",
  "RB",
  "QB",
  "WR",
  "QB",
  "WR",
  "RB",
  "QB",
  "WR",
  "QB",
  "TE",
  "RB",
  "QB",
  "WR",
  "QB",
  "RB",
];

const POS_CHIP: Record<Pos, string> = {
  QB: "border-brand-purple/70 bg-brand-purple/15 text-ink",
  RB: "border-brand-cyan/50 bg-brand-cyan/10 text-ink",
  WR: "border-line bg-base/60 text-ink-muted",
  TE: "border-line bg-base/60 text-ink-muted",
};

function countBy(picks: Pos[]): Record<Pos, number> {
  const out: Record<Pos, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const p of picks) out[p] += 1;
  return out;
}

function DraftStrip({ label, picks }: { label: string; picks: Pos[] }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
        {label}
      </p>
      <ol role="list" className="mt-2 grid grid-cols-6 gap-1.5 sm:grid-cols-12">
        {picks.map((p, i) => (
          <li
            key={i}
            className={`flex min-h-9 items-center justify-center rounded-md border text-xs font-semibold ${POS_CHIP[p]}`}
          >
            <span className="sr-only">Pick {i + 1}: </span>
            {p}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function EarlyRoundsFigure() {
  const oneQb = countBy(ONE_QB_ROUNDS);
  const superflex = countBy(SUPERFLEX_ROUNDS);

  return (
    <ChartFigure
      titleLevel={3}
      title="What the first two rounds look like"
      description="Two invented twelve-team drafts, the first 24 picks of each. Not a real draft; the shape of a typical one."
      summary={`In the invented one-quarterback draft, ${oneQb.QB} quarterback goes in the first 24 picks. In the invented superflex draft, ${superflex.QB} do. Those ${superflex.QB - oneQb.QB} extra quarterbacks push ${superflex.QB - oneQb.QB} running backs and receivers out of the first two rounds and into the third and fourth.`}
      tableLabel="View the position counts as a table"
      table={
        <DataTable
          caption="How many of the first 24 picks went to each position in the two invented drafts."
          head={
            <>
              <Th>Position</Th>
              <Th numeric>One-QB draft</Th>
              <Th numeric>Superflex draft</Th>
            </>
          }
        >
          {(["QB", "RB", "WR", "TE"] as Pos[]).map((p) => (
            <tr key={p}>
              <Td>{p}</Td>
              <Td numeric>{oneQb[p]}</Td>
              <Td numeric>{superflex[p]}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <div className="space-y-4">
        <DraftStrip
          label="One-quarterback league, picks 1 to 24"
          picks={ONE_QB_ROUNDS}
        />
        <DraftStrip
          label="Superflex league, picks 1 to 24"
          picks={SUPERFLEX_ROUNDS}
        />
      </div>
      <p className="mt-4 rounded-card border border-brand-purple/30 bg-brand-purple/5 px-3 py-2 text-sm text-ink">
        {superflex.QB} quarterbacks in two rounds instead of {oneQb.QB}. Every
        one of them is a running back or receiver somebody else did not take,
        and that player is still on the board in round three.
      </p>
    </ChartFigure>
  );
}

/* ---------- Lesson 4: the age curve ---------- */

export function AgeCurveFigure() {
  const ages = Array.from({ length: 15 }, (_, i) => 22 + i);
  // Indexed so each position's own peak is 100. The shape, not a measurement.
  const qb = [60, 70, 80, 88, 94, 98, 100, 100, 99, 97, 94, 90, 84, 76, 66];
  const rb = [85, 95, 100, 100, 96, 88, 76, 62, 48, 36, 26, 18, 12, 8, 5];

  const W = 640;
  const H = 240;
  const padL = 40;
  const padR = 20;
  const padT = 24;
  const padB = 40;
  const x = makeScale(22, 36, padL, W - padR);
  const y = makeScale(0, 105, H - padB, padT);
  const qbPts = ages.map((a, i) => ({ x: x(a), y: y(qb[i]) }));
  const rbPts = ages.map((a, i) => ({ x: x(a), y: y(rb[i]) }));
  const qbStyle = POSITION_SERIES.QB;
  const rbStyle = POSITION_SERIES.RB;

  return (
    <ChartFigure
      titleLevel={3}
      title="A quarterback's career is long. A running back's is not."
      description="The typical shape of dynasty value by age, indexed so each position's own peak is 100. A pattern, not a measurement of any real player."
      summary="In the typical shape, a running back's dynasty value peaks around 24 to 25 and has lost half of it by 30. A quarterback's climbs until 28, holds through 31, and is still above three quarters of its peak at 34. In dynasty superflex a 30-year-old quarterback is a long-term asset and a 30-year-old running back is not."
      table={
        <DataTable
          caption="Indexed dynasty value by age for the two positions, invented to show the shape."
          head={
            <>
              <Th>Age</Th>
              <Th numeric>Quarterback</Th>
              <Th numeric>Running back</Th>
            </>
          }
        >
          {ages.map((a, i) => (
            <tr key={a}>
              <Td>{a}</Td>
              <Td numeric>{qb[i]}</Td>
              <Td numeric>{rb[i]}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <ul
        role="list"
        className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-medium"
      >
        <li className="flex items-center gap-1.5 text-brand-purple">
          <svg aria-hidden="true" width="18" height="8" viewBox="0 0 18 8">
            <line
              x1="0"
              y1="4"
              x2="18"
              y2="4"
              stroke={qbStyle.color}
              strokeWidth="2"
            />
            <path
              d={markerPath(qbStyle.marker, 9, 4, 3)}
              fill={qbStyle.color}
            />
          </svg>
          Quarterback
        </li>
        <li className="flex items-center gap-1.5 text-brand-cyan">
          <svg aria-hidden="true" width="18" height="8" viewBox="0 0 18 8">
            <line
              x1="0"
              y1="4"
              x2="18"
              y2="4"
              stroke={rbStyle.color}
              strokeWidth="2"
              strokeDasharray={rbStyle.dash ?? undefined}
            />
            <path
              d={markerPath(rbStyle.marker, 9, 4, 3)}
              fill={rbStyle.color}
            />
          </svg>
          Running back
        </li>
      </ul>
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${W} ${H}`}
        className="mt-2 h-auto w-full"
        role="presentation"
      >
        {[22, 25, 28, 31, 34, 36].map((a) => (
          <text
            key={a}
            x={x(a)}
            y={H - padB + 18}
            textAnchor="middle"
            fontSize="11"
            fill={INK_SUBTLE}
          >
            {a}
          </text>
        ))}
        <text
          x={padL - 8}
          y={y(100) + 4}
          textAnchor="end"
          fontSize="10"
          fill={INK_SUBTLE}
        >
          100
        </text>
        <text
          x={padL - 8}
          y={y(50) + 4}
          textAnchor="end"
          fontSize="10"
          fill={INK_SUBTLE}
        >
          50
        </text>
        <line
          x1={padL}
          y1={H - padB}
          x2={W - padR}
          y2={H - padB}
          stroke={LINE}
        />
        <line
          x1={padL}
          y1={y(50)}
          x2={W - padR}
          y2={y(50)}
          stroke={LINE}
          strokeDasharray="2 4"
        />
        <path
          d={linePath(qbPts)}
          fill="none"
          stroke={qbStyle.color}
          strokeWidth={2.5}
        />
        {qbPts.map((p, i) => (
          <path
            key={`q-${i}`}
            d={markerPath(qbStyle.marker, p.x, p.y, 3.5)}
            fill={qbStyle.color}
          />
        ))}
        <path
          d={linePath(rbPts)}
          fill="none"
          stroke={rbStyle.color}
          strokeWidth={2.5}
          strokeDasharray={rbStyle.dash ?? undefined}
        />
        {rbPts.map((p, i) => (
          <path
            key={`r-${i}`}
            d={markerPath(rbStyle.marker, p.x, p.y, 3.5)}
            fill={rbStyle.color}
          />
        ))}
        <text x={x(30) + 4} y={y(rb[8]) - 10} fontSize="11" fill={INK}>
          RB at 30: half gone
        </text>
        <text x={x(31) + 4} y={y(qb[9]) - 10} fontSize="11" fill={INK}>
          QB at 31: still near the peak
        </text>
      </svg>
    </ChartFigure>
  );
}

/* ---------- Lesson 5: the third quarterback is value, not wins ---------- */

export function ThirdQbFigure() {
  // An invented trade: your third quarterback, who starts twice a year, for a
  // receiver who starts in your flex every week. Value down a little, wins up.
  const valuePct = -6;
  const winsDelta = 0.5;
  const W = 640;
  const H = 170;
  const mid = W / 2;
  const rowY = [58, 122];
  const valueLen = 100;
  const winsLen = 130;

  return (
    <ChartFigure
      titleLevel={3}
      title="Your third quarterback is value, not wins"
      description="A made-up superflex trade: send the quarterback who starts for you twice a year, get a receiver who starts in your flex every week. Value dips, wins rise."
      summary={`In this invented trade the roster loses about ${Math.abs(valuePct)} percent in market value, because a starting NFL quarterback is worth a lot in superflex, and gains about ${winsDelta.toFixed(1)} projected wins, because the quarterback was scoring nothing on your bench and the receiver starts every week.`}
      table={
        <DataTable
          caption="The two readings of the invented trade."
          head={
            <>
              <Th>Reading</Th>
              <Th>Question it answers</Th>
              <Th numeric>Change</Th>
            </>
          }
        >
          <tr>
            <Td>Value</Td>
            <Td>What would the market pay for my roster?</Td>
            <Td numeric>Down {Math.abs(valuePct)} percent</Td>
          </tr>
          <tr>
            <Td>Wins</Td>
            <Td>How many games should my best lineup win from here?</Td>
            <Td numeric>Up {winsDelta.toFixed(1)} wins</Td>
          </tr>
        </DataTable>
      }
    >
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="presentation"
      >
        <line
          x1={mid}
          y1={20}
          x2={mid}
          y2={H - 14}
          stroke={LINE}
          strokeWidth={1.5}
        />
        <text
          x={mid}
          y={14}
          textAnchor="middle"
          fontSize="11"
          fill={INK_SUBTLE}
        >
          no change
        </text>
        <text x={W - 8} y={14} textAnchor="end" fontSize="11" fill={INK_SUBTLE}>
          better for you
        </text>
        <text x={8} y={14} textAnchor="start" fontSize="11" fill={INK_SUBTLE}>
          worse for you
        </text>
        <text
          x={mid + 12}
          y={rowY[0] - 14}
          textAnchor="start"
          fontSize="13"
          fontWeight={600}
          fill={INK}
        >
          Value
        </text>
        <rect
          x={mid - valueLen}
          y={rowY[0] - 10}
          width={valueLen}
          height={20}
          rx={4}
          fill={PURPLE}
        />
        <text
          x={mid - valueLen - 10}
          y={rowY[0] + 5}
          textAnchor="end"
          fontSize="14"
          fontWeight={700}
          fill={PURPLE}
        >
          {valuePct}%
        </text>
        <text
          x={mid - 12}
          y={rowY[1] - 14}
          textAnchor="end"
          fontSize="13"
          fontWeight={600}
          fill={INK}
        >
          Wins
        </text>
        <rect
          x={mid}
          y={rowY[1] - 10}
          width={winsLen}
          height={20}
          rx={4}
          fill={CYAN}
        />
        <text
          x={mid + winsLen + 10}
          y={rowY[1] + 5}
          fontSize="14"
          fontWeight={700}
          fill={CYAN}
        >
          +{winsDelta.toFixed(1)} wins
        </text>
      </svg>
    </ChartFigure>
  );
}

/* ---------- Lesson 6: two byes in one week ---------- */

const BYE_WEEKS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const BYE_ROSTER: { label: string; bye: number }[] = [
  { label: "Your QB1", bye: 7 },
  { label: "Your QB2", bye: 7 },
  { label: "Your QB3", bye: 11 },
];

export function ByeGridFigure() {
  const startsByWeek = BYE_WEEKS.map((w) =>
    Math.min(2, BYE_ROSTER.filter((q) => q.bye !== w).length),
  );
  const shortWeeks = BYE_WEEKS.filter((w, i) => startsByWeek[i] < 2);

  return (
    <ChartFigure
      // Sits under the h3 "Check the byes against each other", so one level down.
      titleLevel={4}
      title="Two byes in the same week is an empty slot"
      description="An invented three-quarterback roster across weeks 5 to 14. Two of the three share a bye, so one week the second slot has nobody to start."
      summary={`On this invented roster the first two quarterbacks both sit in week ${BYE_ROSTER[0].bye}, so that week only one quarterback can start and the superflex slot goes to a bench running back or receiver. The third quarterback's bye in week ${BYE_ROSTER[2].bye} costs nothing because the other two play. Weeks with a hole: ${shortWeeks.join(", ")}.`}
      tableLabel="View the bye grid as a table"
      table={
        <DataTable
          caption="Which quarterbacks play each week on the invented roster, and how many can start."
          head={
            <>
              <Th>Week</Th>
              {BYE_ROSTER.map((q) => (
                <Th key={q.label}>{q.label}</Th>
              ))}
              <Th numeric>Can start</Th>
            </>
          }
        >
          {BYE_WEEKS.map((w, i) => (
            <tr key={w}>
              <Td>Week {w}</Td>
              {BYE_ROSTER.map((q) => (
                <Td key={q.label}>{q.bye === w ? "Bye" : "Plays"}</Td>
              ))}
              <Td numeric>{startsByWeek[i]} of 2</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      {/* A real table, because it is tabular data: a screen reader needs
          "Your QB1, Week 7, Bye" to come out as one association rather than
          as 44 loose cells. The ChartFigure table under the disclosure is the
          transposed view (one row per week) and stays. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] border-separate border-spacing-1 text-xs">
          <caption className="sr-only">
            Which of the three invented quarterbacks plays each week, and how
            many can start.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="text-left font-semibold text-ink">
                <span className="sr-only">Quarterback</span>
              </th>
              {BYE_WEEKS.map((w) => (
                <th
                  key={w}
                  scope="col"
                  className="text-center font-mono text-[11px] font-normal text-ink-subtle"
                >
                  <span aria-hidden="true">Wk {w}</span>
                  <span className="sr-only">Week {w}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {BYE_ROSTER.map((q) => (
              <tr key={q.label}>
                <th scope="row" className="text-left font-semibold text-ink">
                  {q.label}
                </th>
                {BYE_WEEKS.map((w) => (
                  <td
                    key={w}
                    className={`rounded-md border text-center text-[11px] font-semibold ${
                      q.bye === w
                        ? "border-brand-purple/70 bg-brand-purple/15 text-ink"
                        : "border-line bg-base/60 text-ink-muted"
                    }`}
                  >
                    <span className="flex min-h-8 items-center justify-center">
                      {q.bye === w ? "Bye" : "Plays"}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row" className="text-left font-semibold text-ink">
                Can start
              </th>
              {BYE_WEEKS.map((w, i) => (
                <td
                  key={w}
                  className={`rounded-md border text-center font-mono text-[11px] font-semibold ${
                    startsByWeek[i] < 2
                      ? "border-brand-cyan bg-brand-cyan/15 text-ink"
                      : "border-line bg-base/40 text-ink-muted"
                  }`}
                >
                  <span className="flex min-h-8 items-center justify-center">
                    {startsByWeek[i]} of 2
                  </span>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-4 rounded-card border border-brand-cyan/30 bg-brand-cyan/5 px-3 py-2 text-sm text-ink">
        Week {BYE_ROSTER[0].bye}: one quarterback can start. The third
        quarterback was supposed to cover exactly this, and he cannot, because
        the two byes he needed to cover are the same week.
      </p>
    </ChartFigure>
  );
}

/* ---------- Lesson 7: TE premium stacks on top ---------- */

export function TePremiumFigure() {
  // Invented weekly lines. The premium here is half a point per catch, the
  // most common setting; a full point widens every gap further.
  const premium = 0.5;
  const te1 = { pts: 14.0, catches: 5.5 };
  const te12 = { pts: 7.0, catches: 2.8 };
  const te1Tep = te1.pts + te1.catches * premium;
  const te12Tep = te12.pts + te12.catches * premium;
  const gapPpr = te1.pts - te12.pts;
  const gapTep = te1Tep - te12Tep;

  const W = 640;
  const H = 200;
  const padL = 130;
  const padR = 60;
  const x = makeScale(0, 18, padL, W - padR);
  const rows = [
    { label: "TE1, PPR", v: te1.pts, color: LINE },
    { label: "TE12, PPR", v: te12.pts, color: LINE },
    { label: "TE1, TE premium", v: te1Tep, color: PURPLE },
    { label: "TE12, TE premium", v: te12Tep, color: CYAN },
  ];
  const rowH = 30;
  const top = 24;

  return (
    <ChartFigure
      titleLevel={3}
      title="TE premium widens the tight end gap"
      description={`Invented weekly points for the best tight end and the replacement tight end in a twelve-team league, in plain PPR and with a ${premium} point per catch premium.`}
      summary={`In plain PPR the invented TE1 scores ${te1.pts.toFixed(1)} a week and the replacement TE12 scores ${te12.pts.toFixed(1)}, a gap of ${gapPpr.toFixed(1)}. Add ${premium} a catch and the gap grows to ${gapTep.toFixed(1)}, because the best tight end catches twice as many passes as the replacement. The premium pays the top of the position, not the middle.`}
      table={
        <DataTable
          caption="The invented weekly points behind the bars."
          head={
            <>
              <Th>Player</Th>
              <Th numeric>Catches a week</Th>
              <Th numeric>PPR</Th>
              <Th numeric>With the premium</Th>
            </>
          }
        >
          <tr>
            <Td>TE1</Td>
            <Td numeric>{te1.catches.toFixed(1)}</Td>
            <Td numeric>{te1.pts.toFixed(1)}</Td>
            <Td numeric>{te1Tep.toFixed(1)}</Td>
          </tr>
          <tr>
            <Td>TE12 (replacement)</Td>
            <Td numeric>{te12.catches.toFixed(1)}</Td>
            <Td numeric>{te12.pts.toFixed(1)}</Td>
            <Td numeric>{te12Tep.toFixed(1)}</Td>
          </tr>
          <tr>
            <Td>Gap</Td>
            <Td numeric> </Td>
            <Td numeric>{gapPpr.toFixed(1)}</Td>
            <Td numeric>{gapTep.toFixed(1)}</Td>
          </tr>
        </DataTable>
      }
    >
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="presentation"
      >
        {rows.map((r, i) => {
          const yTop = top + i * rowH + (i >= 2 ? 14 : 0);
          return (
            <g key={r.label}>
              <text
                x={padL - 10}
                y={yTop + 15}
                textAnchor="end"
                fontSize="12"
                fill={INK}
              >
                {r.label}
              </text>
              <rect
                x={x(0)}
                y={yTop}
                width={x(r.v) - x(0)}
                height={22}
                rx={4}
                fill={r.color}
                opacity={i < 2 ? 1 : 0.9}
              />
              <text
                x={x(r.v) + 8}
                y={yTop + 15}
                fontSize="12"
                fontWeight={600}
                fill={INK}
              >
                {r.v.toFixed(1)}
              </text>
            </g>
          );
        })}
        <text x={x(0)} y={H - 10} fontSize="11" fill={INK_SUBTLE}>
          gap in PPR: {gapPpr.toFixed(1)}. gap with the premium:{" "}
          {gapTep.toFixed(1)}
        </text>
      </svg>
    </ChartFigure>
  );
}
