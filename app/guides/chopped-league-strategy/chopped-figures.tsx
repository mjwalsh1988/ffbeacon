import {
  ChartFigure,
  DataTable,
  Td,
  Th,
  linePath,
  makeScale,
  markerPath,
} from "@/components/chart-kit";
import { simulateSurvival, type SurvivalTeam } from "@/lib/chopped/survival";

/**
 * The survival figure in lesson 2 of the chopped league guide (task FB-G02).
 *
 * WHAT THE NUMBERS ARE. Not a forecast, and not measured. This is the product's
 * own simulator, lib/chopped/survival.ts, the same function the FAAB
 * calculator runs on a real chopped league, given eighteen teams with
 * identical weekly projections and a fixed seed. The caption says so, and the
 * page's prose around it says the same thing in words.
 *
 * WHY SIMULATE SOMETHING WITH A CLOSED FORM. There is a closed form for the
 * average team and the simulator lands on it: exactly one roster is chopped
 * every week, so in every single run the teams alive after week k is 18 minus
 * k, and averaged across all eighteen rosters the survival odds are (18 - k)
 * over 18 whatever the seed and however many runs. That is the point. The
 * arithmetic in the lesson's prose and the line on this chart are the same
 * statement, produced two different ways, and the code that produced the
 * chart is the code that prices a real league.
 *
 * The run count therefore buys nothing here, which is why it is small: a
 * guide page should not spend a tenth of a second on a figure it could have
 * derived with a division.
 */

const TEAMS = 18;
const WEEKS = Array.from({ length: TEAMS - 1 }, (_, i) => i + 1);
const RUNS = 1000;
const SEED = 20260919;
/** Identical for every team, which is the whole assumption of the figure. */
const WEEK_MEAN = 105;
const WEEK_SIGMA = 26;

export type SurvivalRow = {
  week: number;
  /** Teams still in the league when the week kicks off. */
  teamsBefore: number;
  teamsAfter: number;
  /** Chance an average team is still alive once the week resolved. */
  pAlive: number;
  /** Chance of being this week's lowest score, given you started the week. */
  pChoppedIfAlive: number;
};

function buildSurvivalRows(): SurvivalRow[] {
  const teams: SurvivalTeam[] = Array.from({ length: TEAMS }, (_, i) => ({
    rosterId: i + 1,
    seasonPoints: 0,
    weeks: new Map(WEEKS.map((w) => [w, { mean: WEEK_MEAN, sigma: WEEK_SIGMA }])),
  }));

  const results = simulateSurvival(teams, WEEKS, {
    runs: RUNS,
    seed: SEED,
    choppedPerWeek: 1,
  });

  const rows: SurvivalRow[] = [];
  let previous = 1;
  for (const week of WEEKS) {
    let total = 0;
    for (const result of results.values()) total += result.pAliveAfter.get(week) ?? 0;
    const pAlive = total / TEAMS;
    rows.push({
      week,
      teamsBefore: TEAMS - (week - 1),
      teamsAfter: TEAMS - week,
      pAlive,
      pChoppedIfAlive: previous > 0 ? (previous - pAlive) / previous : 0,
    });
    previous = pAlive;
  }
  return rows;
}

export const SURVIVAL_ROWS = buildSurvivalRows();

const CYAN = "#22D3EE";
const PURPLE = "#A855F7";
const INK_SUBTLE = "#8A8A9C";
const LINE = "#2A2A47";

function pct(value: number): number {
  return Math.round(value * 1000) / 10;
}

export function SurvivalFigure() {
  const rows = SURVIVAL_ROWS;
  const first = rows[0];
  const sixth = rows[5];
  const twelfth = rows[11];
  const last = rows[rows.length - 1];

  const W = 640;
  const H = 260;
  const padL = 44;
  const padR = 18;
  const padT = 18;
  const padB = 46;
  const x = makeScale(rows[0].week, rows[rows.length - 1].week, padL, W - padR);
  const y = makeScale(0, 100, H - padB, padT);

  const alivePts = rows.map((r) => ({ x: x(r.week), y: y(pct(r.pAlive)) }));
  const riskPts = rows.map((r) => ({ x: x(r.week), y: y(pct(r.pChoppedIfAlive)) }));

  return (
    <ChartFigure
      titleLevel={3}
      title="Survival odds through an eighteen-team season"
      description="Equal-strength teams, illustration. Eighteen rosters given identical weekly projections, played out by the same survival simulator the FAAB calculator runs on a real chopped league, with the seed fixed. No real league is equal-strength, so read the shape rather than the decimals."
      summary={`An average team in an eighteen-team chopped league survives week ${first.week} about ${pct(first.pAlive)} percent of the time. After ${sixth.week} weeks it is still alive ${pct(sixth.pAlive)} percent of the time, with ${sixth.teamsAfter} teams left, and after ${twelfth.week} weeks ${pct(twelfth.pAlive)} percent, with ${twelfth.teamsAfter} left. The second line is the danger in the week itself: being the lowest score is a ${pct(first.pChoppedIfAlive)} percent risk in week ${first.week} and a ${pct(last.pChoppedIfAlive)} percent risk in week ${last.week}, when only ${last.teamsBefore} teams are left to be worse than you.`}
      tableLabel="View the survival odds week by week"
      table={
        <DataTable
          caption="Survival odds and weekly chop risk for an average team in an eighteen-team league of equal-strength teams."
          head={
            <>
              <Th>Week</Th>
              <Th numeric>Teams in it</Th>
              <Th numeric>Chopped this week</Th>
              <Th numeric>Still alive after it</Th>
            </>
          }
        >
          {rows.map((r) => (
            <tr key={r.week}>
              <Td>Week {r.week}</Td>
              <Td numeric>{r.teamsBefore}</Td>
              <Td numeric>{pct(r.pChoppedIfAlive)}%</Td>
              <Td numeric>{pct(r.pAlive)}%</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <div aria-hidden="true" className="overflow-x-auto">
        <div className="min-w-[30rem]">
          <svg aria-hidden="true" viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
            {[0, 25, 50, 75, 100].map((t) => (
              <g key={t}>
                <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={LINE} strokeWidth={1} />
                <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill={INK_SUBTLE}>
                  {t}%
                </text>
              </g>
            ))}
            {rows
              .filter((r) => r.week % 2 === 1)
              .map((r) => (
                <text
                  key={r.week}
                  x={x(r.week)}
                  y={H - padB + 18}
                  textAnchor="middle"
                  fontSize="11"
                  fill={INK_SUBTLE}
                >
                  Wk {r.week}
                </text>
              ))}

            <path d={linePath(alivePts)} fill="none" stroke={CYAN} strokeWidth={2} />
            {alivePts.map((p, i) => (
              <path key={`alive-${rows[i].week}`} d={markerPath("square", p.x, p.y, 3)} fill={CYAN} />
            ))}

            <path
              d={linePath(riskPts)}
              fill="none"
              stroke={PURPLE}
              strokeWidth={2}
              strokeDasharray="6 4"
            />
            {riskPts.map((p, i) => (
              <path key={`risk-${rows[i].week}`} d={markerPath("circle", p.x, p.y, 3)} fill={PURPLE} />
            ))}
          </svg>
        </div>
      </div>
      <ul
        role="list"
        className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-medium text-ink-muted"
      >
        <li className="flex items-center gap-1.5">
          <svg aria-hidden="true" width="18" height="8" viewBox="0 0 18 8">
            <line x1="0" y1="4" x2="18" y2="4" stroke={CYAN} strokeWidth="2" />
            <rect x="6" y="1" width="6" height="6" fill={CYAN} />
          </svg>
          Still alive after the week, solid line
        </li>
        <li className="flex items-center gap-1.5">
          <svg aria-hidden="true" width="18" height="8" viewBox="0 0 18 8">
            <line
              x1="0"
              y1="4"
              x2="18"
              y2="4"
              stroke={PURPLE}
              strokeWidth="2"
              strokeDasharray="4 3"
            />
            <circle cx="9" cy="4" r="3" fill={PURPLE} />
          </svg>
          Chopped in the week itself, dashed line
        </li>
      </ul>
    </ChartFigure>
  );
}
