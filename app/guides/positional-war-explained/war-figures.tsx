import {
  ChartFigure,
  DataTable,
  POSITION_SERIES,
  Td,
  Th,
  linePath,
  makeScale,
  markerPath,
} from "@/components/chart-kit";

/**
 * The diagrams in the Positional WAR guide.
 *
 * EVERY NUMBER HERE IS INVENTED. The figures teach a shape (where the
 * replacement line sits, why the same points open a different gap at two
 * positions, what a steep line and a flat line look like, why the marker at
 * the last starter is not zero, how a gap in points becomes a gap in wins),
 * and each caption says so in words. Nothing is read from the database, so
 * nothing here can be mistaken for a live figure about a real league.
 *
 * The mechanism the figures depict is the one in lib/positional-war/war.ts:
 * the baseline team is league-average at every slot except one, which holds
 * the replacement player at the evaluated position; the evaluated team swaps
 * the player into that one slot; the win chance of each against a
 * league-average opponent is compared week by week and the differences are
 * summed. The marker at structural demand carries its real value
 * (war_at_demand), never an asserted zero.
 *
 * NAMING RULE. The token WAR always sits beside "Positional" in every title,
 * summary, caption and label here. The team-specific quantity is never named
 * in this file.
 *
 * Every figure goes through ChartFigure, which puts the conclusion in a
 * sentence before the graphic and the plotted values in a real table under a
 * disclosure. The SVG ones mark their <svg> aria-hidden, because the sentence
 * and the table carry the meaning. The DOM-built ones keep their text in the
 * tree, so nothing about them is hidden from a screen reader.
 */

const PURPLE = "#A855F7";
const CYAN = "#22D3EE";
const INK = "#F4F4F8";
const INK_SUBTLE = "#8A8A9C";
const LINE = "#2A2A47";

/* ---------- Lesson 2: the replacement line ---------- */

/**
 * Invented weekly points for the top sixteen quarterbacks in a twelve-team,
 * one-quarterback league. QB1 scores 22.0 and QB13 scores 16.5, the same two
 * numbers the guide's table uses.
 */
const QB_POINTS = [
  22.0, 21.4, 20.9, 20.3, 19.8, 19.4, 18.9, 18.5, 18.0, 17.6, 17.2, 16.8, 16.5,
  16.2, 15.9, 15.6,
];
const QB_STARTERS = 12;

export function ReplacementLineFigure() {
  const W = 640;
  const H = 230;
  const padL = 36;
  const padR = 16;
  const padT = 30;
  const padB = 40;
  const n = QB_POINTS.length;
  const slot = (W - padL - padR) / n;
  const barW = slot * 0.66;
  const y = makeScale(0, 24, H - padB, padT);
  const lineX = padL + slot * QB_STARTERS;
  const replacement = QB_POINTS[QB_STARTERS];

  return (
    <ChartFigure
      titleLevel={3}
      title="Where the replacement line sits"
      description="An invented twelve-team league that starts one quarterback. Twelve quarterbacks are started somewhere; the thirteenth is the best one nobody starts, and he is the replacement player."
      summary={`In this invented one-quarterback league, twelve quarterbacks are started and the line falls after QB12. QB13, at ${replacement.toFixed(1)} points a week, is the replacement player, and every quarterback above the line is measured against him.`}
      table={
        <DataTable
          caption="The invented weekly points by quarterback rank, with the replacement player marked."
          head={
            <>
              <Th>Rank</Th>
              <Th numeric>Points a week</Th>
              <Th>Status</Th>
            </>
          }
        >
          {QB_POINTS.map((pts, i) => (
            <tr key={i}>
              <Td>QB{i + 1}</Td>
              <Td numeric>{pts.toFixed(1)}</Td>
              <Td>
                {i < QB_STARTERS
                  ? "Started somewhere"
                  : i === QB_STARTERS
                    ? "Replacement player"
                    : "Nobody starts him"}
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
        <line
          x1={padL}
          y1={H - padB}
          x2={W - padR}
          y2={H - padB}
          stroke={LINE}
        />
        {QB_POINTS.map((pts, i) => {
          const x = padL + slot * i + (slot - barW) / 2;
          const started = i < QB_STARTERS;
          const isReplacement = i === QB_STARTERS;
          return (
            <g key={i}>
              <rect
                x={x}
                y={y(pts)}
                width={barW}
                height={H - padB - y(pts)}
                rx={3}
                fill={isReplacement ? CYAN : started ? PURPLE : LINE}
                opacity={started ? 0.85 : 1}
              />
              <text
                x={x + barW / 2}
                y={H - padB + 16}
                textAnchor="middle"
                fontSize="10"
                fill={INK_SUBTLE}
              >
                {i + 1}
              </text>
            </g>
          );
        })}
        {/* The line: after the last quarterback anybody starts. */}
        <line
          x1={lineX}
          y1={padT - 6}
          x2={lineX}
          y2={H - padB}
          stroke={INK}
          strokeWidth={1.5}
          strokeDasharray="5 4"
        />
        <text
          x={lineX - 6}
          y={padT}
          textAnchor="end"
          fontSize="11"
          fontWeight={600}
          fill={INK}
        >
          started somewhere
        </text>
        <text
          x={lineX + 6}
          y={padT}
          textAnchor="start"
          fontSize="11"
          fontWeight={600}
          fill={CYAN}
        >
          the replacement
        </text>
        <text
          x={padL + slot * QB_STARTERS + slot / 2}
          y={y(replacement) - 8}
          textAnchor="middle"
          fontSize="11"
          fontWeight={700}
          fill={CYAN}
        >
          {replacement.toFixed(1)}
        </text>
        <text x={padL} y={H - padB + 32} fontSize="10" fill={INK_SUBTLE}>
          quarterback rank, best first
        </text>
      </svg>
    </ChartFigure>
  );
}

/* ---------- Lesson 3: same points, different gap ---------- */

type GapRow = {
  position: string;
  best: number;
  replacement: number;
  replacementLabel: string;
};

const GAP_ROWS: GapRow[] = [
  {
    position: "Quarterback",
    best: 22.0,
    replacement: 16.5,
    replacementLabel: "QB13",
  },
  {
    position: "Running back",
    best: 18.5,
    replacement: 8.5,
    replacementLabel: "about RB28",
  },
];

export function SamePointsDifferentGapFigure() {
  const W = 640;
  const H = 150;
  const labelW = 120;
  const x = makeScale(0, 24, labelW, W - 60);
  const rowY = [46, 110];
  const h = 24;

  return (
    <ChartFigure
      titleLevel={3}
      title="More points, smaller gap"
      description="The invented quarterback and running back from the table above. The muted part of each bar is what the replacement player scores for free; the coloured part is the gap, and the gap is what Positional WAR measures."
      summary={`In this invented league the best quarterback scores ${GAP_ROWS[0].best.toFixed(1)} a week and the best running back ${GAP_ROWS[1].best.toFixed(1)}, yet the running back's gap over his replacement is ${(GAP_ROWS[1].best - GAP_ROWS[1].replacement).toFixed(1)} points against the quarterback's ${(GAP_ROWS[0].best - GAP_ROWS[0].replacement).toFixed(1)}, because the free running back is so much worse. Positional WAR follows the gap, not the total.`}
      table={
        <DataTable
          caption="Best starter, replacement player and the gap between them, invented."
          head={
            <>
              <Th>Position</Th>
              <Th numeric>Best starter</Th>
              <Th numeric>Replacement</Th>
              <Th numeric>Gap</Th>
            </>
          }
        >
          {GAP_ROWS.map((r) => (
            <tr key={r.position}>
              <Td>{r.position}</Td>
              <Td numeric>{r.best.toFixed(1)}</Td>
              <Td numeric>
                {r.replacement.toFixed(1)} ({r.replacementLabel})
              </Td>
              <Td numeric>{(r.best - r.replacement).toFixed(1)}</Td>
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
        {GAP_ROWS.map((r, i) => {
          const color = i === 0 ? PURPLE : CYAN;
          return (
            <g key={r.position}>
              <text
                x={labelW - 10}
                y={rowY[i] + h / 2 + 4}
                textAnchor="end"
                fontSize="12"
                fontWeight={600}
                fill={INK}
              >
                {r.position}
              </text>
              <rect
                x={x(0)}
                y={rowY[i]}
                width={x(r.replacement) - x(0)}
                height={h}
                rx={4}
                fill={LINE}
              />
              <rect
                x={x(r.replacement)}
                y={rowY[i]}
                width={x(r.best) - x(r.replacement)}
                height={h}
                fill={color}
                opacity={0.9}
              />
              <text
                x={x(r.replacement) - 4}
                y={rowY[i] - 6}
                textAnchor="end"
                fontSize="10"
                fill={INK_SUBTLE}
              >
                free: {r.replacement.toFixed(1)}
              </text>
              <text
                x={x(r.best) + 6}
                y={rowY[i] + h / 2 + 4}
                textAnchor="start"
                fontSize="12"
                fontWeight={700}
                fill={color}
              >
                gap {(r.best - r.replacement).toFixed(1)}
              </text>
            </g>
          );
        })}
        <text x={labelW} y={20} fontSize="10" fill={INK_SUBTLE}>
          points a week
        </text>
      </svg>
    </ChartFigure>
  );
}

/* ---------- Lesson 5: a steep line and a flat line ---------- */

const RANKS = Array.from({ length: 24 }, (_, i) => i + 1);
/** Invented Positional WAR by rank. Running back falls fast; quarterback barely falls. */
const RB_CURVE = [
  1.9, 1.7, 1.55, 1.4, 1.25, 1.1, 0.98, 0.86, 0.76, 0.66, 0.58, 0.5, 0.44, 0.38,
  0.33, 0.28, 0.24, 0.2, 0.17, 0.14, 0.11, 0.09, 0.07, 0.05,
];
const QB_CURVE = [
  0.62, 0.56, 0.51, 0.47, 0.43, 0.4, 0.37, 0.34, 0.31, 0.28, 0.25, 0.22, 0.19,
  0.16, 0.13, 0.1, 0.08, 0.06, 0.04, 0.03, 0.02, 0.01, 0.0, 0.0,
];

export function SteepVsFlatFigure() {
  const W = 640;
  const H = 260;
  const padL = 44;
  const padR = 20;
  const padT = 24;
  const padB = 40;
  const x = makeScale(1, 24, padL, W - padR);
  const y = makeScale(0, 2, H - padB, padT);
  const rb = POSITION_SERIES.RB;
  const qb = POSITION_SERIES.QB;
  const rbPts = RANKS.map((r, i) => ({ x: x(r), y: y(RB_CURVE[i]) }));
  const qbPts = RANKS.map((r, i) => ({ x: x(r), y: y(QB_CURVE[i]) }));

  return (
    <ChartFigure
      titleLevel={3}
      title="A steep line and a flat line"
      description="Invented Positional WAR by rank for two positions in a one-quarterback league. Cyan dashed with square markers is running back; purple solid with round markers is quarterback."
      summary={`In this invented league the running back line is steep: Positional WAR falls from ${RB_CURVE[0].toFixed(2)} at RB1 to ${RB_CURVE[9].toFixed(2)} at RB10. The quarterback line is flat: from ${QB_CURVE[0].toFixed(2)} at QB1 to ${QB_CURVE[9].toFixed(2)} at QB10. The steep line is the position worth paying up for.`}
      table={
        <DataTable
          caption="Invented Positional WAR by rank, the two lines plotted above."
          head={
            <>
              <Th>Rank</Th>
              <Th numeric>Running back</Th>
              <Th numeric>Quarterback</Th>
            </>
          }
        >
          {RANKS.map((r, i) => (
            <tr key={r}>
              <Td>{r}</Td>
              <Td numeric>{RB_CURVE[i].toFixed(2)}</Td>
              <Td numeric>{QB_CURVE[i].toFixed(2)}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <ul
        role="list"
        className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-medium"
      >
        <li className="flex items-center gap-1.5 text-brand-cyan">
          <svg aria-hidden="true" width="18" height="8" viewBox="0 0 18 8">
            <line
              x1="0"
              y1="4"
              x2="18"
              y2="4"
              stroke={rb.color}
              strokeWidth="2"
              strokeDasharray={rb.dash ?? undefined}
            />
            <path d={markerPath(rb.marker, 9, 4, 3)} fill={rb.color} />
          </svg>
          Running back (steep)
        </li>
        <li className="flex items-center gap-1.5 text-brand-purple">
          <svg aria-hidden="true" width="18" height="8" viewBox="0 0 18 8">
            <line
              x1="0"
              y1="4"
              x2="18"
              y2="4"
              stroke={qb.color}
              strokeWidth="2"
            />
            <path d={markerPath(qb.marker, 9, 4, 3)} fill={qb.color} />
          </svg>
          Quarterback (flat)
        </li>
      </ul>
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${W} ${H}`}
        className="mt-2 h-auto w-full"
        role="presentation"
      >
        {[0, 0.5, 1, 1.5, 2].map((v) => (
          <g key={v}>
            <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke={LINE} />
            <text
              x={padL - 8}
              y={y(v) + 4}
              textAnchor="end"
              fontSize="10"
              fill={INK_SUBTLE}
            >
              {v.toFixed(1)}
            </text>
          </g>
        ))}
        {[1, 6, 12, 18, 24].map((r) => (
          <text
            key={r}
            x={x(r)}
            y={H - padB + 18}
            textAnchor="middle"
            fontSize="11"
            fill={INK_SUBTLE}
          >
            {r}
          </text>
        ))}
        <text
          x={(padL + W - padR) / 2}
          y={H - 6}
          textAnchor="middle"
          fontSize="10"
          fill={INK_SUBTLE}
        >
          rank at the position, best first
        </text>
        <path
          d={linePath(rbPts)}
          fill="none"
          stroke={rb.color}
          strokeWidth={2.5}
          strokeDasharray={rb.dash ?? undefined}
        />
        {rbPts.map((p, i) => (
          <path
            key={`rb-${i}`}
            d={markerPath(rb.marker, p.x, p.y, 3.2)}
            fill={rb.color}
          />
        ))}
        <path
          d={linePath(qbPts)}
          fill="none"
          stroke={qb.color}
          strokeWidth={2.5}
        />
        {qbPts.map((p, i) => (
          <path
            key={`qb-${i}`}
            d={markerPath(qb.marker, p.x, p.y, 3.2)}
            fill={qb.color}
          />
        ))}
      </svg>
    </ChartFigure>
  );
}

/* ---------- Lesson 5: the marker is not zero ---------- */

/**
 * The running back line again, zoomed into the tail, with the hollow marker at
 * the last starter the league needs (structural demand: 28 in the invented
 * league). The value there is small and real, not zero, because byes thin the
 * position on exactly the weeks a starter matters most.
 */
const TAIL_RANKS = Array.from({ length: 13 }, (_, i) => i + 20);
const TAIL_CURVE = [
  0.4, 0.35, 0.31, 0.27, 0.24, 0.21, 0.18, 0.15, 0.12, 0.08, 0.05, 0.02, 0.0,
];
const DEMAND_RANK = 28;
const DEMAND_VALUE = TAIL_CURVE[TAIL_RANKS.indexOf(DEMAND_RANK)];

export function MarkerFigure() {
  const W = 640;
  const H = 200;
  const padL = 44;
  const padR = 20;
  const padT = 30;
  const padB = 40;
  const x = makeScale(20, 32, padL, W - padR);
  const y = makeScale(0, 0.45, H - padB, padT);
  const rb = POSITION_SERIES.RB;
  const pts = TAIL_RANKS.map((r, i) => ({ x: x(r), y: y(TAIL_CURVE[i]) }));
  const mx = x(DEMAND_RANK);
  const my = y(DEMAND_VALUE);

  return (
    <ChartFigure
      // Sits under the h3 "The marker", so one level down.
      titleLevel={4}
      title="The marker at the last starter is not zero"
      description={`The tail of the invented running back line. The hollow marker sits at RB${DEMAND_RANK}, the last running back this league needs on a week with no byes, and it is labelled with its real value.`}
      summary={`On the invented running back line the hollow marker sits at RB${DEMAND_RANK}, the last starter the league needs on a bye-free week, and its Positional WAR there is ${DEMAND_VALUE.toFixed(2)}, not zero. The line reaches zero a few ranks later, because byes make the last starter worth something on the weeks the position is thin.`}
      table={
        <DataTable
          caption="Invented Positional WAR through the tail of the running back line."
          head={
            <>
              <Th>Rank</Th>
              <Th numeric>Positional WAR</Th>
              <Th>Note</Th>
            </>
          }
        >
          {TAIL_RANKS.map((r, i) => (
            <tr key={r}>
              <Td>RB{r}</Td>
              <Td numeric>{TAIL_CURVE[i].toFixed(2)}</Td>
              <Td>
                {r === DEMAND_RANK ? "The last starter the league needs" : ""}
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
        <line x1={padL} y1={y(0)} x2={W - padR} y2={y(0)} stroke={LINE} />
        <text
          x={padL - 8}
          y={y(0) + 4}
          textAnchor="end"
          fontSize="10"
          fill={INK_SUBTLE}
        >
          0
        </text>
        {TAIL_RANKS.map((r) => (
          <text
            key={r}
            x={x(r)}
            y={H - padB + 18}
            textAnchor="middle"
            fontSize="10"
            fill={INK_SUBTLE}
          >
            {r}
          </text>
        ))}
        <path
          d={linePath(pts)}
          fill="none"
          stroke={rb.color}
          strokeWidth={2.5}
          strokeDasharray={rb.dash ?? undefined}
        />
        {pts.map((p, i) =>
          TAIL_RANKS[i] === DEMAND_RANK ? null : (
            <path
              key={i}
              d={markerPath(rb.marker, p.x, p.y, 3)}
              fill={rb.color}
            />
          ),
        )}
        {/* The hollow marker. */}
        <circle
          cx={mx}
          cy={my}
          r={7}
          fill="#0F0F1A"
          stroke={INK}
          strokeWidth={2}
        />
        <text
          x={mx}
          y={my - 14}
          textAnchor="middle"
          fontSize="12"
          fontWeight={700}
          fill={INK}
        >
          {DEMAND_VALUE.toFixed(2)}, not 0
        </text>
        <text
          x={mx}
          y={H - padB + 32}
          textAnchor="middle"
          fontSize="10"
          fill={INK_SUBTLE}
        >
          last starter the league needs
        </text>
      </svg>
    </ChartFigure>
  );
}

/* ---------- Lesson 4: points to wins ---------- */

/**
 * One invented week. The baseline team is league-average everywhere except
 * one slot, where the replacement running back sits; the evaluated team swaps
 * the running back in question into that slot. Both face a league-average
 * opponent. The win chances are invented to show the shape.
 */
const WEEK = {
  opponent: 120.0,
  baselineMean: 118.5,
  evaluatedMean: 121.5,
  baselineWin: 47.5,
  evaluatedWin: 52.5,
};

function BoardCard({
  label,
  mean,
  win,
  tone,
}: {
  label: string;
  mean: number;
  win: number;
  tone: "muted" | "cyan";
}) {
  const border = tone === "cyan" ? "border-brand-cyan/60" : "border-line";
  const winColor = tone === "cyan" ? "text-brand-cyan" : "text-ink-muted";
  return (
    <div className={`rounded-card border ${border} bg-base/60 p-3`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
        {label}
      </p>
      <dl className="mt-2 space-y-1 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-muted">Projects to</dt>
          <dd className="font-mono tabular-nums text-ink">
            {mean.toFixed(1)}
            <span className="sr-only"> points</span>
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-muted">Opponent projects to</dt>
          <dd className="font-mono tabular-nums text-ink">
            {WEEK.opponent.toFixed(1)}
            <span className="sr-only"> points</span>
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-muted">Chance of winning</dt>
          <dd
            className={`font-mono text-base font-semibold tabular-nums ${winColor}`}
          >
            {win.toFixed(1)}%
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function PointsToWinsFigure() {
  const delta = (WEEK.evaluatedWin - WEEK.baselineWin) / 100;
  return (
    <ChartFigure
      titleLevel={3}
      title="One week, two teams, one slot different"
      description="An invented week. Both teams are league-average at every starting spot except one running back slot. The left team starts the replacement there; the right team starts your guy. Both face an average opponent."
      summary={`In this invented week the team starting the replacement running back projects to ${WEEK.baselineMean.toFixed(1)} against an opponent at ${WEEK.opponent.toFixed(1)} and wins ${WEEK.baselineWin.toFixed(1)} percent of the time. Swap your running back in and it projects to ${WEEK.evaluatedMean.toFixed(1)} and wins ${WEEK.evaluatedWin.toFixed(1)} percent of the time. The difference, ${delta.toFixed(2)} of a win, is his Positional WAR for that week, and the season figure is those weekly differences added up.`}
      tableLabel="View the two teams as a table"
      table={
        <DataTable
          caption="The two invented teams for one week."
          head={
            <>
              <Th>Team</Th>
              <Th numeric>Projects to</Th>
              <Th numeric>Opponent</Th>
              <Th numeric>Win chance</Th>
            </>
          }
        >
          <tr>
            <Td>Starts the replacement</Td>
            <Td numeric>{WEEK.baselineMean.toFixed(1)}</Td>
            <Td numeric>{WEEK.opponent.toFixed(1)}</Td>
            <Td numeric>{WEEK.baselineWin.toFixed(1)}%</Td>
          </tr>
          <tr>
            <Td>Starts your running back</Td>
            <Td numeric>{WEEK.evaluatedMean.toFixed(1)}</Td>
            <Td numeric>{WEEK.opponent.toFixed(1)}</Td>
            <Td numeric>{WEEK.evaluatedWin.toFixed(1)}%</Td>
          </tr>
          <tr>
            <Td>Difference</Td>
            <Td numeric>
              +{(WEEK.evaluatedMean - WEEK.baselineMean).toFixed(1)}
            </Td>
            <Td numeric>same</Td>
            <Td numeric>+{delta.toFixed(2)} wins</Td>
          </tr>
        </DataTable>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <BoardCard
          label="Starts the replacement"
          mean={WEEK.baselineMean}
          win={WEEK.baselineWin}
          tone="muted"
        />
        <BoardCard
          label="Starts your running back"
          mean={WEEK.evaluatedMean}
          win={WEEK.evaluatedWin}
          tone="cyan"
        />
      </div>
      <p className="mt-4 rounded-card border border-brand-cyan/30 bg-brand-cyan/5 px-3 py-2 text-sm text-ink">
        This week he is worth{" "}
        <span className="font-mono font-semibold tabular-nums text-brand-cyan">
          +{delta.toFixed(2)}
        </span>{" "}
        of a win. Add up every week left in the season and that sum is his
        Positional WAR.
      </p>
    </ChartFigure>
  );
}
