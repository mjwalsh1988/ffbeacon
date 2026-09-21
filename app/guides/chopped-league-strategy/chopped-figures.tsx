import {
  ChartFigure,
  DataTable,
  Td,
  Th,
  linePath,
  makeScale,
  markerPath,
  type SeriesStyle,
} from "@/components/chart-kit";
import { simulateSurvival, type SurvivalTeam } from "@/lib/chopped/survival";
import {
  CHAMPION_LEDGER,
  CLUSTER_DROP,
  CLUSTER_WEEK,
  DANGER_RUNGS,
  PACE_TARGETS,
  PRICE_BANDS,
  SEASON_WEEKS,
  TEAMS,
  buildByeClusterRows,
  buildConsistencyRows,
  buildFieldRows,
  type ConsistencyRow,
} from "@/lib/guides/chopped-examples";

/**
 * The diagrams in the chopped league guide.
 *
 * FOUR KINDS OF NUMBER LIVE HERE AND EVERY CAPTION SAYS WHICH IT IS.
 *
 *   - EXACT ARITHMETIC. SurvivalFigure and FieldShrinkFigure are subtraction.
 *     One roster leaves the league every week, so the survival odds of an
 *     average team and the size of the field are both settled before any dice
 *     are rolled.
 *   - PRODUCT CODE ON INVENTED TEAMS. ConsistencyFigure and ByeClusterFigure
 *     run simulateSurvival, the function the FAAB calculator runs on a real
 *     chopped league, over rosters nobody owns. The setups live in
 *     lib/guides/chopped-examples.ts with a test that pins every claim the
 *     page's prose makes about them.
 *   - SHIPPED CONFIGURATION. PriceDecayFigure, PaceFigure and
 *     DangerLadderFigure draw DEFAULT_FAAB_SETTINGS.chopped, read at import
 *     rather than typed out, so a diagram cannot drift from the calculator it
 *     describes. An admin can change all three, and every caption says "by
 *     default".
 *   - PUBLISHED FIGURES AND RULES OF THUMB. The NFFC Eliminator ratios and
 *     the 2024 champion's ledger are other people's published numbers and are
 *     attributed where they appear. EndgameFigure is the guide's own rule of
 *     thumb and says so in its description.
 *
 * Every figure goes through ChartFigure: the conclusion in a sentence before
 * the graphic, and the plotted values in a real table under a disclosure. The
 * SVG ones mark their <svg> aria-hidden because the sentence and the table
 * carry the meaning. The DOM-built ones (the bye comparison, the danger
 * ladder, the endgame board) keep every label in the accessibility tree.
 *
 * NOTHING HERE ENCODES MEANING IN COLOR ALONE. Every multi-series chart gives
 * each series a dash pattern and a marker shape as well as a hue, and every
 * legend entry names its series in text, per components/chart-kit.tsx.
 */

const CYAN = "#22D3EE";
const PURPLE = "#A855F7";
/** The validated third categorical hue from chart-kit's palette. */
const ORANGE = "#FB923C";
const INK = "#F4F4F8";
const INK_SUBTLE = "#8A8A9C";
const LINE = "#2A2A47";

function pct(value: number): number {
  return Math.round(value * 1000) / 10;
}

/** One decimal, for a percentage already expressed 0 to 100. */
function pct1(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

/* ------------------------------------------------------------------ *
 * Lesson 1: the field and the wire
 * ------------------------------------------------------------------ */

const FIELD_ROWS = buildFieldRows();

/**
 * The format in one picture, and the one thing about it that surprises
 * people: the two halves move together. Every roster the league removes is a
 * roster that arrives on the waiver wire, so a single stacked bar of a fixed
 * eighteen says both things at once and needs no second axis.
 *
 * Drawn rather than simulated. Alive plus released is always TEAMS.
 */
export function FieldShrinkFigure() {
  const rows = FIELD_ROWS;
  const balance = rows.find((r) => r.alive === r.released);
  const crossover = rows.find((r) => r.crossover);

  const W = 640;
  const H = 240;
  const padL = 34;
  const padR = 14;
  const padT = 14;
  const padB = 44;
  const x = makeScale(0, rows.length, padL, W - padR);
  const y = makeScale(0, TEAMS, H - padB, padT);
  const bandWidth = (W - padR - padL) / rows.length;
  const barWidth = bandWidth * 0.68;

  return (
    <ChartFigure
      titleLevel={3}
      title="The league and the waiver wire are the same eighteen rosters"
      description="An eighteen-team league chopping one roster a week. Exact arithmetic, not a simulation: every roster the league removes is a roster that lands on the wire, so the two bars always add to eighteen."
      summary={`In an eighteen-team chopped league the field falls by one every week while the waiver wire gains one. Week ${balance?.week ?? 9} is the balance point, with ${balance?.alive ?? 9} rosters still playing and ${balance?.released ?? 9} sitting on the wire. From week ${crossover?.week ?? 10} onward there is more talent available to buy than there is left in the league, which is why a budget held into October buys a different shelf than a budget spent in September.`}
      tableLabel="View the field and the wire week by week"
      table={
        <DataTable
          caption="Rosters still playing and rosters released to the waiver wire, by week, in an eighteen-team league chopping one a week."
          head={
            <>
              <Th>Week</Th>
              <Th numeric>Still playing</Th>
              <Th numeric>On the wire</Th>
            </>
          }
        >
          {rows.map((r) => (
            <tr key={r.week}>
              <Td>
                Week {r.week}
                {r.crossover ? ", the wire overtakes the league" : ""}
              </Td>
              <Td numeric>{r.alive}</Td>
              <Td numeric>{r.released}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <div aria-hidden="true" className="overflow-x-auto">
        <div className="min-w-[30rem]">
          <svg aria-hidden="true" viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
            {[0, 6, 12, 18].map((t) => (
              <g key={t}>
                <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={LINE} strokeWidth={1} />
                <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill={INK_SUBTLE}>
                  {t}
                </text>
              </g>
            ))}

            {rows.map((r, i) => {
              const cx = x(i) + (bandWidth - barWidth) / 2;
              const aliveH = y(0) - y(r.alive);
              const releasedH = y(0) - y(r.released);
              return (
                <g key={r.week}>
                  {/* Still playing, sitting on the baseline. */}
                  <rect x={cx} y={y(r.alive)} width={barWidth} height={aliveH} fill={CYAN} opacity={0.9} />
                  {/* On the wire, stacked above it to the fixed eighteen. */}
                  <rect
                    x={cx}
                    y={y(r.alive + r.released)}
                    width={barWidth}
                    height={releasedH}
                    fill={PURPLE}
                    opacity={0.55}
                  />
                </g>
              );
            })}

            {crossover && (
              <line
                x1={x(crossover.week - 1)}
                x2={x(crossover.week - 1)}
                y1={padT}
                y2={H - padB}
                stroke={INK}
                strokeWidth={1}
                strokeDasharray="3 3"
                opacity={0.6}
              />
            )}

            {rows
              .filter((r) => r.week % 2 === 1)
              .map((r) => (
                <text
                  key={r.week}
                  x={x(r.week - 1) + bandWidth / 2}
                  y={H - padB + 16}
                  textAnchor="middle"
                  fontSize="11"
                  fill={INK_SUBTLE}
                >
                  {r.week}
                </text>
              ))}
            <text x={W - padR} y={H - padB + 34} textAnchor="end" fontSize="10" fill={INK_SUBTLE}>
              week of the season
            </text>
          </svg>
        </div>
      </div>
      <ul
        role="list"
        className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-medium text-ink-muted"
      >
        <li className="flex items-center gap-1.5">
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12">
            <rect x="0" y="0" width="12" height="12" fill={CYAN} opacity={0.9} />
          </svg>
          Rosters still playing, lower block
        </li>
        <li className="flex items-center gap-1.5">
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12">
            <rect x="0" y="0" width="12" height="12" fill={PURPLE} opacity={0.55} />
          </svg>
          Rosters on the waiver wire, upper block
        </li>
      </ul>
    </ChartFigure>
  );
}

/* ------------------------------------------------------------------ *
 * Lesson 2, part one: survival odds for an average team
 * ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ *
 * Lesson 2, part two: the same points, a different spread
 * ------------------------------------------------------------------ */

const CONSISTENCY_ROWS = buildConsistencyRows();

/** Hue, dash and marker per group, so color is never the only channel. */
const CONSISTENCY_STYLE: Record<ConsistencyRow["key"], SeriesStyle> = {
  steady: { color: CYAN, dash: null, marker: "square" },
  average: { color: PURPLE, dash: "6 4", marker: "circle" },
  spiky: { color: ORANGE, dash: "2 3", marker: "diamond" },
};

/**
 * The claim the whole guide rests on, with the product's own simulator behind
 * it: in this format the spread kills you, not the average.
 *
 * Every one of the eighteen rosters scores the same points per week. The only
 * difference between them is how far a given Sunday strays from that average,
 * so the gap between these three curves cannot be explained by one roster
 * being better than another. It is the shape, and nothing else.
 *
 * The headline tiles above the chart carry the number a reader will actually
 * remember, which is the title odds: the steady roster wins this league about
 * twelve times as often as the boom-or-bust one while scoring identically.
 */
export function ConsistencyFigure() {
  const rows = CONSISTENCY_ROWS;
  const steady = rows.find((r) => r.key === "steady")!;
  const average = rows.find((r) => r.key === "average")!;
  const spiky = rows.find((r) => r.key === "spiky")!;
  const weeks = Array.from({ length: SEASON_WEEKS }, (_, i) => i + 1);

  const W = 640;
  const H = 250;
  const padL = 44;
  const padR = 18;
  const padT = 14;
  const padB = 44;
  const x = makeScale(1, SEASON_WEEKS, padL, W - padR);
  const y = makeScale(0, 100, H - padB, padT);

  return (
    <ChartFigure
      titleLevel={3}
      title="Three rosters scoring identical points, ranked by how steady they are"
      description={`Eighteen invented rosters, six of each kind, every one projected for the same ${WEEK_MEAN} points a week. Only the week-to-week spread differs. Played out by the product's own survival simulator with the seed fixed, so nothing here is a forecast about a real league.`}
      summary={`All eighteen rosters score the same points per week, so every difference on this chart is week-to-week spread. The steady roster is chopped in week 1 about ${pct1(steady.pChoppedWeek1 * 100)} percent of the time, the average roster ${pct1(average.pChoppedWeek1 * 100)} percent and the boom-or-bust roster ${pct1(spiky.pChoppedWeek1 * 100)} percent. Over the season the steady roster lasts about ${steady.weeksAlive.toFixed(1)} weeks and wins the league ${pct1(steady.pWin * 100)} percent of the time, against ${spiky.weeksAlive.toFixed(1)} weeks and ${pct1(spiky.pWin * 100)} percent for the boom-or-bust one. Same points, roughly twelve times the title odds.`}
      tableLabel="View every figure behind these three curves"
      table={
        <DataTable
          caption="Weekly spread, week 1 chop risk, weeks survived and title odds for three kinds of roster scoring identical points per week."
          head={
            <>
              <Th>Roster</Th>
              <Th numeric>Weekly spread</Th>
              <Th numeric>Chopped in week 1</Th>
              <Th numeric>Alive after 6</Th>
              <Th numeric>Alive after 12</Th>
              <Th numeric>Weeks survived</Th>
              <Th numeric>Wins the league</Th>
            </>
          }
        >
          {rows.map((r) => (
            <tr key={r.key}>
              <Td>
                {r.label}. {r.what}
              </Td>
              <Td numeric>{r.sigma} pts</Td>
              <Td numeric>{pct1(r.pChoppedWeek1 * 100)}%</Td>
              <Td numeric>{pct1((r.pAliveAfter.get(6) ?? 0) * 100)}%</Td>
              <Td numeric>{pct1((r.pAliveAfter.get(12) ?? 0) * 100)}%</Td>
              <Td numeric>{r.weeksAlive.toFixed(1)}</Td>
              <Td numeric>{pct1(r.pWin * 100)}%</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      {/* The tiles are real text, not part of the graphic, so they are read
          in order and are not hidden with the SVG below them. */}
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {rows.map((r) => {
          const style = CONSISTENCY_STYLE[r.key];
          return (
            <div
              key={r.key}
              className="rounded-card border border-line bg-base/60 px-3 py-2"
              style={{ borderLeftWidth: 4, borderLeftColor: style.color }}
            >
              <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
                {r.label}, {r.sigma} point spread
              </dt>
              <dd className="mt-0.5 font-mono text-base font-semibold tabular-nums text-ink">
                {pct1(r.pWin * 100)}%{" "}
                <span className="font-sans text-xs font-normal text-ink-muted">
                  win the league
                </span>
              </dd>
              <dd className="text-xs text-ink-muted">
                {pct1(r.pChoppedWeek1 * 100)}% chopped in week 1, {r.weeksAlive.toFixed(1)} weeks
                survived
              </dd>
            </div>
          );
        })}
      </dl>

      <div aria-hidden="true" className="mt-3 overflow-x-auto">
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
            {weeks
              .filter((w) => w % 2 === 1)
              .map((w) => (
                <text
                  key={w}
                  x={x(w)}
                  y={H - padB + 16}
                  textAnchor="middle"
                  fontSize="11"
                  fill={INK_SUBTLE}
                >
                  {w}
                </text>
              ))}
            <text x={W - padR} y={H - padB + 34} textAnchor="end" fontSize="10" fill={INK_SUBTLE}>
              week, and the share of that kind of roster still alive
            </text>

            {rows.map((r) => {
              const style = CONSISTENCY_STYLE[r.key];
              const pts = weeks.map((w) => ({
                x: x(w),
                y: y(pct((r.pAliveAfter.get(w) ?? 0))),
              }));
              return (
                <g key={r.key}>
                  <path
                    d={linePath(pts)}
                    fill="none"
                    stroke={style.color}
                    strokeWidth={2}
                    strokeDasharray={style.dash ?? undefined}
                  />
                  {pts.map((p, i) => (
                    <path
                      key={`${r.key}-${weeks[i]}`}
                      d={markerPath(style.marker, p.x, p.y, 3)}
                      fill={style.color}
                    />
                  ))}
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      <ul
        role="list"
        className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-medium text-ink-muted"
      >
        {rows.map((r) => {
          const style = CONSISTENCY_STYLE[r.key];
          return (
            <li key={r.key} className="flex items-center gap-1.5">
              <svg aria-hidden="true" width="18" height="8" viewBox="0 0 18 8">
                <line
                  x1="0"
                  y1="4"
                  x2="18"
                  y2="4"
                  stroke={style.color}
                  strokeWidth="2"
                  strokeDasharray={style.dash ?? undefined}
                />
                <path d={markerPath(style.marker, 9, 4, 3)} fill={style.color} />
              </svg>
              {r.label}, {r.sigma} point spread
            </li>
          );
        })}
      </ul>
    </ChartFigure>
  );
}

/* ------------------------------------------------------------------ *
 * Lesson 3: the scheduled disaster
 * ------------------------------------------------------------------ */

const CLUSTER_ROWS = buildByeClusterRows();

/**
 * What a bye cluster is worth, in the only currency this format has.
 *
 * Both rosters are identical in all sixteen other weeks. One of them is down
 * CLUSTER_DROP points in week CLUSTER_WEEK because three of its starters
 * share a bye. That single scheduled hole takes the week from an ordinary
 * one-in-eleven risk to something closer to a coin flip, which is the
 * lesson's "a scheduled disaster is a scheduled elimination" with a number
 * attached.
 *
 * DOM-built, so every label stays in the accessibility tree. The bars are
 * plain divs sized by percentage rather than an SVG, because there are two of
 * them and a chart frame would be more furniture than data.
 */
export function ByeClusterFigure() {
  const cluster = CLUSTER_ROWS.find((r) => r.key === "cluster")!;
  const spread = CLUSTER_ROWS.find((r) => r.key === "spread")!;
  const ratio = cluster.pChoppedInClusterWeek / spread.pChoppedInClusterWeek;

  const bars = [
    { row: spread, color: CYAN, opacity: 0.9 },
    { row: cluster, color: ORANGE, opacity: 0.9 },
  ];

  return (
    <ChartFigure
      titleLevel={3}
      title={`What a bye cluster costs in week ${CLUSTER_WEEK}`}
      description={`Two invented rosters in an eighteen-team league, identical in every other week of the season. One is ${CLUSTER_DROP} points lighter in week ${CLUSTER_WEEK} because three of its starters share a bye. Run through the product's own survival simulator with the seed fixed.`}
      summary={`Both rosters project identically in all sixteen other weeks. In week ${CLUSTER_WEEK} the roster with three starters on the same bye is chopped about ${pct1(cluster.pChoppedInClusterWeek * 100)} percent of the time, against ${pct1(spread.pChoppedInClusterWeek * 100)} percent for the roster whose byes are spread out. That is roughly ${ratio.toFixed(1)} times the risk, from one week of scheduling. Across the season it costs about ${(spread.weeksAlive - cluster.weeksAlive).toFixed(1)} weeks of survival and drops the title odds from ${pct1(spread.pWin * 100)} percent to ${pct1(cluster.pWin * 100)} percent.`}
      tableLabel="View both rosters' figures"
      table={
        <DataTable
          caption={`Chop risk in week ${CLUSTER_WEEK}, weeks survived and title odds for two otherwise identical rosters, one with a bye cluster.`}
          head={
            <>
              <Th>Roster</Th>
              <Th numeric>Chopped in week {CLUSTER_WEEK}</Th>
              <Th numeric>Weeks survived</Th>
              <Th numeric>Wins the league</Th>
            </>
          }
        >
          {[spread, cluster].map((r) => (
            <tr key={r.key}>
              <Td>{r.label}</Td>
              <Td numeric>{pct1(r.pChoppedInClusterWeek * 100)}%</Td>
              <Td numeric>{r.weeksAlive.toFixed(1)}</Td>
              <Td numeric>{pct1(r.pWin * 100)}%</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <ul role="list" className="space-y-3">
        {bars.map(({ row, color, opacity }) => (
          <li key={row.key}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <p className="text-sm font-medium text-ink">{row.label}</p>
              <p className="font-mono text-sm font-semibold tabular-nums" style={{ color }}>
                {pct1(row.pChoppedInClusterWeek * 100)}%
                <span className="ml-1.5 font-sans text-xs font-normal text-ink-muted">
                  chopped in week {CLUSTER_WEEK}
                </span>
              </p>
            </div>
            {/* Decorative: the percentage is stated in text immediately above. */}
            <div
              aria-hidden="true"
              className="mt-1.5 h-3 w-full overflow-hidden rounded-full bg-base"
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, row.pChoppedInClusterWeek * 100)}%`,
                  backgroundColor: color,
                  opacity,
                }}
              />
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              {row.weeksAlive.toFixed(1)} weeks survived, wins the league{" "}
              {pct1(row.pWin * 100)} percent of the time.
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-ink-subtle">
        The bar is the share of runs in which that roster posted the league&apos;s lowest score in
        week {CLUSTER_WEEK}, counted only among the runs where it was still alive to play it.
      </p>
    </ChartFigure>
  );
}

/* ------------------------------------------------------------------ *
 * Lesson 4: what the shrinking field does to a price
 * ------------------------------------------------------------------ */

/**
 * The published guillotine study the lesson's prose quotes, expressed as a
 * ratio so it can be laid over our own default curve. The NFFC Eliminator's
 * 2025 figures for a top-twelve running back: 28.9 percent of budget with half
 * the field or more alive, 12.8 percent with 30 to 50 percent left, and
 * nothing below that.
 *
 * The ratio of those first two published numbers is 12.8 / 28.9, which is
 * 0.443. The calculator's shipped default for the same band is 0.45. Those
 * were arrived at independently and they agree to within a rounding, which is
 * worth a sentence on the page and is the reason this array is here at all.
 */
const NFFC_POINTS: { band: string; pctOfBudget: number; ratio: number | null }[] = [
  { band: "Half the field or more alive", pctOfBudget: 28.9, ratio: 1 },
  { band: "30 to 50 percent alive", pctOfBudget: 12.8, ratio: 12.8 / 28.9 },
  { band: "Under 30 percent alive", pctOfBudget: 0, ratio: 0 },
];

export function PriceDecayFigure() {
  const bands = PRICE_BANDS;
  const full = bands[0];
  const middle = bands[1];
  const last = bands[bands.length - 1];
  const nffcMiddle = NFFC_POINTS[1];

  const W = 640;
  const H = 230;
  const padL = 44;
  const padR = 18;
  const padT = 16;
  const padB = 46;
  // Left to right is the season's direction of travel: a full field on the
  // left, the last few teams on the right. The domain stays ascending and the
  // RANGE is reversed instead, because makeScale treats a descending domain as
  // a flat series and collapses every point onto one x.
  const x = makeScale(0, 100, W - padR, padL);
  const y = makeScale(0, 1, H - padB, padT);

  // The step function the calculator actually applies, walked from a full
  // field down to nobody left.
  const steps: { from: number; to: number; multiplier: number }[] = bands.map((band, i) => ({
    from: i === 0 ? 100 : bands[i - 1].minFraction * 100,
    to: band.minFraction * 100,
    multiplier: band.multiplier,
  }));

  return (
    <ChartFigure
      titleLevel={3}
      title="What the same player is worth as the field shrinks"
      description="The FAAB calculator's shipped default price curve for chopped leagues, read from its settings rather than typed out, with the NFFC Eliminator's published 2025 figures laid over it. An admin can change the curve, so this is what it does by default."
      summary={`By default the calculator pays full price for a player while at least ${full.minFraction * 100} percent of the field is still alive, ${middle.multiplier} of that price between ${last.minFraction * 100} and ${middle.minFraction * 100} percent, and ${last.multiplier} of it once fewer than ${middle.minFraction * 100} percent remain. The NFFC Eliminator's published figures for a top-twelve running back move the same way: ${NFFC_POINTS[0].pctOfBudget} percent of budget with half the field alive, ${nffcMiddle.pctOfBudget} percent with 30 to 50 percent left, and nothing below that. Their first two numbers are a ratio of ${nffcMiddle.ratio!.toFixed(2)}, against our default of ${middle.multiplier}, which is the same answer from an independent source.`}
      tableLabel="View the default curve and the published figures"
      table={
        <DataTable
          caption="The calculator's default chopped price multiplier by the share of the field still alive, beside the NFFC Eliminator's published 2025 figures for a top-twelve running back."
          head={
            <>
              <Th>Share of the field still alive</Th>
              <Th numeric>Our default multiplier</Th>
              <Th numeric>NFFC, share of budget</Th>
              <Th numeric>NFFC, as a ratio</Th>
            </>
          }
        >
          {steps.map((step, i) => {
            const point = NFFC_POINTS[i];
            return (
              <tr key={step.to}>
                <Td>
                  {step.to === 0
                    ? `Under ${step.from} percent`
                    : `${step.to} to ${step.from} percent`}
                </Td>
                <Td numeric>{step.multiplier.toFixed(2)}</Td>
                <Td numeric>{point ? `${point.pctOfBudget}%` : "Not published"}</Td>
                <Td numeric>{point?.ratio != null ? point.ratio.toFixed(2) : "Not published"}</Td>
              </tr>
            );
          })}
        </DataTable>
      }
    >
      <div aria-hidden="true" className="overflow-x-auto">
        <div className="min-w-[30rem]">
          <svg aria-hidden="true" viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
            {[0, 0.25, 0.5, 0.75, 1].map((t) => (
              <g key={t}>
                <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={LINE} strokeWidth={1} />
                <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill={INK_SUBTLE}>
                  {t.toFixed(2)}
                </text>
              </g>
            ))}
            {[100, 75, 50, 30, 10, 0].map((t) => (
              <text
                key={t}
                x={x(t)}
                y={H - padB + 16}
                textAnchor="middle"
                fontSize="11"
                fill={INK_SUBTLE}
              >
                {t}%
              </text>
            ))}
            <text x={padL} y={H - padB + 34} textAnchor="start" fontSize="10" fill={INK_SUBTLE}>
              share of the field still alive, falling left to right through the season
            </text>

            {/* The step function itself: a flat run per band, a riser between. */}
            {steps.map((step, i) => (
              <g key={step.to}>
                <line
                  x1={x(step.from)}
                  x2={x(step.to)}
                  y1={y(step.multiplier)}
                  y2={y(step.multiplier)}
                  stroke={CYAN}
                  strokeWidth={2.5}
                />
                {i > 0 && (
                  <line
                    x1={x(step.from)}
                    x2={x(step.from)}
                    y1={y(steps[i - 1].multiplier)}
                    y2={y(step.multiplier)}
                    stroke={CYAN}
                    strokeWidth={2.5}
                    strokeDasharray="3 3"
                    opacity={0.7}
                  />
                )}
                <text
                  x={(x(step.from) + x(step.to)) / 2}
                  y={y(step.multiplier) - 8}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight={600}
                  fill={INK}
                >
                  {step.multiplier.toFixed(2)}x
                </text>
              </g>
            ))}

            {/* The published figures, as a ratio, over the top. */}
            {NFFC_POINTS.filter((p) => p.ratio != null).map((point, i) => {
              const at = [75, 40, 12][i];
              return (
                <path
                  key={point.band}
                  d={markerPath("diamond", x(at), y(point.ratio!), 4.5)}
                  fill={PURPLE}
                />
              );
            })}
          </svg>
        </div>
      </div>
      <ul
        role="list"
        className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-medium text-ink-muted"
      >
        <li className="flex items-center gap-1.5">
          <svg aria-hidden="true" width="18" height="8" viewBox="0 0 18 8">
            <line x1="0" y1="4" x2="18" y2="4" stroke={CYAN} strokeWidth="2.5" />
          </svg>
          The calculator&apos;s default multiplier, stepped
        </li>
        <li className="flex items-center gap-1.5">
          <svg aria-hidden="true" width="18" height="10" viewBox="0 0 18 10">
            <path d={markerPath("diamond", 9, 5, 4.5)} fill={PURPLE} />
          </svg>
          NFFC Eliminator&apos;s published figures, as a ratio
        </li>
      </ul>
    </ChartFigure>
  );
}

/* ------------------------------------------------------------------ *
 * Lesson 5: the pace
 * ------------------------------------------------------------------ */

/**
 * The hold targets the calculator ships with, against what one published
 * champion actually did.
 *
 * Both lines are in the lesson's prose already. Drawing them together shows
 * the thing the two sentences cannot: he was ahead of the target for half the
 * season and then went past it in the other direction, spending almost the
 * whole budget between weeks 8 and 14. The plan is not "hold"; it is "hold,
 * then commit", and the shape says so where a pair of numbers does not.
 */
export function PaceFigure() {
  const targets = PACE_TARGETS;
  const ledger = CHAMPION_LEDGER;

  const W = 640;
  const H = 240;
  const padL = 44;
  const padR = 18;
  const padT = 14;
  const padB = 46;
  const lastWeek = Math.max(
    targets[targets.length - 1].throughWeek,
    ledger[ledger.length - 1].throughWeek,
  );
  const x = makeScale(0, lastWeek, padL, W - padR);
  const y = makeScale(0, 100, H - padB, padT);

  // Both series start the season with the whole budget unspent.
  const targetPts = [{ x: x(0), y: y(100) }, ...targets.map((t) => ({ x: x(t.throughWeek), y: y(t.holdPct) }))];
  const ledgerPts = [{ x: x(0), y: y(100) }, ...ledger.map((t) => ({ x: x(t.throughWeek), y: y(t.holdPct) }))];

  return (
    <ChartFigure
      titleLevel={3}
      title="How much of the budget to still be holding, week by week"
      description="The FAAB calculator's shipped default pace targets for a chopped league, read from its settings, against the published ledger of a 2024 guillotine champion. The targets are a default an admin can change. The ledger is one manager in one season, not a plan."
      summary={`The default targets have you still holding ${targets[0].holdPct} percent of the budget after week ${targets[0].throughWeek}, ${targets[1].holdPct} percent after week ${targets[1].throughWeek}, ${targets[2].holdPct} percent after week ${targets[2].throughWeek} and nothing by the end. The published 2024 champion ran tighter than that early, holding ${ledger[1].holdPct} percent after week ${ledger[1].throughWeek} against a target of ${targets[1].holdPct} percent, then spent almost all of it at once: ${ledger[2].holdPct} percent left after week ${ledger[2].throughWeek} and ${ledger[3].holdPct} percent after week ${ledger[3].throughWeek}. The shape of both lines is the same argument, which is that the money is worth most late and worth nothing at all once the season ends.`}
      tableLabel="View both the targets and the champion's ledger"
      table={
        <DataTable
          caption="The calculator's default share of budget to still be holding, by week, against a published 2024 guillotine champion's actual remaining budget."
          head={
            <>
              <Th>Through week</Th>
              <Th numeric>Default target, still holding</Th>
              <Th numeric>The 2024 champion, still holding</Th>
            </>
          }
        >
          {[...new Set([...targets.map((t) => t.throughWeek), ...ledger.map((l) => l.throughWeek)])]
            .sort((a, b) => a - b)
            .map((week) => {
              const target = targets.find((t) => t.throughWeek === week);
              const point = ledger.find((l) => l.throughWeek === week);
              return (
                <tr key={week}>
                  <Td>Week {week}</Td>
                  <Td numeric>{target ? `${target.holdPct}%` : "Not a target week"}</Td>
                  <Td numeric>{point ? `${point.holdPct}%` : "Not published"}</Td>
                </tr>
              );
            })}
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
            {[0, 4, 8, 12, 14, 17].map((w) => (
              <text
                key={w}
                x={x(w)}
                y={H - padB + 16}
                textAnchor="middle"
                fontSize="11"
                fill={INK_SUBTLE}
              >
                {w === 0 ? "Draft" : `Wk ${w}`}
              </text>
            ))}
            <text x={W - padR} y={H - padB + 34} textAnchor="end" fontSize="10" fill={INK_SUBTLE}>
              share of the budget still unspent
            </text>

            <path
              d={linePath(targetPts)}
              fill="none"
              stroke={CYAN}
              strokeWidth={2}
            />
            {targetPts.map((p, i) => (
              <path key={`target-${i}`} d={markerPath("square", p.x, p.y, 3)} fill={CYAN} />
            ))}

            <path
              d={linePath(ledgerPts)}
              fill="none"
              stroke={PURPLE}
              strokeWidth={2}
              strokeDasharray="6 4"
            />
            {ledgerPts.map((p, i) => (
              <path key={`ledger-${i}`} d={markerPath("circle", p.x, p.y, 3)} fill={PURPLE} />
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
          The calculator&apos;s default target, solid line
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
          A published 2024 champion, dashed line
        </li>
      </ul>
    </ChartFigure>
  );
}

/* ------------------------------------------------------------------ *
 * Lesson 5: the danger ladder
 * ------------------------------------------------------------------ */

/** Invented, and said to be. A round number to multiply. */
const LADDER_BASELINE = 200;

/**
 * The danger ladder as the calculator's own multipliers rather than as four
 * paragraphs of advice.
 *
 * The lesson already argues that where you stand should move your bid more
 * than anything about the player does. These are the numbers that argument is
 * worth: a team in the bottom two bids 1.6 times what a mid-pack team bids on
 * the identical player, and a safe team bids 0.8 times it. Twice the number,
 * end to end, for the same footballer.
 *
 * DOM-built, so every figure stays in the accessibility tree.
 */
export function DangerLadderFigure() {
  const rungs = DANGER_RUNGS;
  const top = rungs[0];
  const bottom = rungs[rungs.length - 1];
  const maxMultiplier = Math.max(...rungs.map((r) => r.multiplier));

  const tone: Record<string, { color: string; opacity: number }> = {
    bottomTwo: { color: ORANGE, opacity: 0.95 },
    nearCut: { color: PURPLE, opacity: 0.9 },
    midPack: { color: CYAN, opacity: 0.85 },
    safe: { color: CYAN, opacity: 0.45 },
  };

  return (
    <ChartFigure
      titleLevel={3}
      title="The same player, four different bids"
      description={`The multipliers the FAAB calculator's manual mode puts on a bid for where you say you stand, read from its settings rather than typed out. The $${LADDER_BASELINE} baseline is invented, and is there only to have something round to multiply.`}
      summary={`By default the calculator multiplies a bid by ${top.multiplier} when you are in the bottom two this week and by ${bottom.multiplier} when you are comfortably safe, with the middle of the pack as the baseline of ${rungs.find((r) => r.key === "midPack")!.multiplier}. On an invented $${LADDER_BASELINE} bid that is $${Math.round(LADDER_BASELINE * top.multiplier)} against $${Math.round(LADDER_BASELINE * bottom.multiplier)}: twice the money, end to end, for the identical player in the identical week.`}
      tableLabel="View every rung and its multiplier"
      table={
        <DataTable
          caption={`The calculator's default danger multipliers, and what each does to an invented $${LADDER_BASELINE} bid.`}
          head={
            <>
              <Th>Where you stand</Th>
              <Th numeric>Multiplier</Th>
              <Th numeric>An invented ${LADDER_BASELINE} bid becomes</Th>
              <Th>Why</Th>
            </>
          }
        >
          {rungs.map((r) => (
            <tr key={r.key}>
              <Td>{r.label}</Td>
              <Td numeric>{r.multiplier.toFixed(2)}x</Td>
              <Td numeric>${Math.round(LADDER_BASELINE * r.multiplier)}</Td>
              <Td>{r.what}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <ol role="list" className="space-y-2.5">
        {rungs.map((r) => {
          const style = tone[r.key];
          return (
            <li key={r.key}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-sm font-medium text-ink">{r.label}</p>
                <p className="font-mono text-sm font-semibold tabular-nums text-ink">
                  ${Math.round(LADDER_BASELINE * r.multiplier)}
                  <span className="ml-1.5 font-sans text-xs font-normal text-ink-muted">
                    {r.multiplier.toFixed(2)} times the baseline
                  </span>
                </p>
              </div>
              {/* Decorative: both the dollars and the multiplier are text above. */}
              <div
                aria-hidden="true"
                className="mt-1.5 h-3 w-full overflow-hidden rounded-full bg-base"
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(r.multiplier / maxMultiplier) * 100}%`,
                    backgroundColor: style.color,
                    opacity: style.opacity,
                  }}
                />
              </div>
              <p className="mt-1 text-xs text-ink-muted">{r.what}</p>
            </li>
          );
        })}
      </ol>
    </ChartFigure>
  );
}

/* ------------------------------------------------------------------ *
 * Lesson 6: the endgame
 * ------------------------------------------------------------------ */

type EndgameBand = {
  label: string;
  range: string;
  call: string;
  what: string;
  tone: "cyan" | "purple" | "muted";
};

/**
 * The endgame thresholds. These are the guide's own rules of thumb, not
 * measurements and not settings, and the description says so before the first
 * one is read.
 */
const ENDGAME_BANDS: EndgameBand[] = [
  {
    label: "Two thirds or more left",
    range: "Over $660 of $1,000",
    call: "Be the top bid",
    what: "You are the richest team in a shrinking market and it is about to hand you an elite player. Being outbid here by a team with a quarter of your budget is the worst outcome available to you.",
    tone: "cyan",
  },
  {
    label: "A third to two thirds",
    range: "$330 to $660",
    call: "Pick one slot",
    what: "You cannot win every auction, so stop entering all of them. Buy the best player for the one lineup slot that is genuinely costing you points, and let the rest go.",
    tone: "purple",
  },
  {
    label: "Under a third",
    range: "Under $330",
    call: "Stream it",
    what: "Fill your weakest slot on matchup, bid at or just above the minimum, and accept that your roster is what it is. Winning from here means the draft carried you.",
    tone: "muted",
  },
];

const ENDGAME_TONE: Record<EndgameBand["tone"], string> = {
  cyan: "border-brand-cyan/60 bg-brand-cyan/10",
  purple: "border-brand-purple/60 bg-brand-purple/10",
  muted: "border-line bg-base/60",
};

/**
 * The release cutoffs from the formats the lesson already names, each read at
 * that platform's own rules page. This is the deadline on the money, and it
 * is the one thing in the endgame a reader can look up in August rather than
 * discover in December.
 */
const CUTOFFS: { format: string; cutoff: string; week: number | null }[] = [
  { format: "FFPC Chop Classic", cutoff: "Chopped players locked from week 15", week: 15 },
  { format: "Fantasy Life, 2024", cutoff: "Last release was week 14", week: 14 },
  { format: "NFFC Eliminator", cutoff: "Total-points final, weeks 14 to 17", week: 14 },
  { format: "Sleeper Chopped", cutoff: "Not published, so check your own league", week: null },
];

export function EndgameFigure() {
  return (
    <ChartFigure
      titleLevel={3}
      title="What to do with what is left, and the week it stops mattering"
      description="The guide's own rules of thumb for a $1,000 budget, not measurements and not calculator settings. The cutoffs beside them are each format's published rule, and they are the deadline on your money."
      summary="With two thirds of the budget or more left you should be the top bid on the best player released, because you are the richest team in a market that is still shrinking. Between a third and two thirds, buy one lineup slot properly instead of entering every auction. Under a third you are streaming on matchup at close to the minimum. Against all of that sits your league's release cutoff: the FFPC locks chopped players from week 15, Fantasy Life's last release in 2024 was week 14, and the NFFC Eliminator switches to a total-points final from week 14. Budget you are still holding after that week bought nothing."
      tableLabel="View the thresholds and the published cutoffs"
      table={
        <DataTable
          caption="The guide's budget thresholds with the call for each, and the published release cutoff for four elimination formats."
          head={
            <>
              <Th>Budget left, or format</Th>
              <Th>The call, or the cutoff</Th>
              <Th>Why</Th>
            </>
          }
        >
          {ENDGAME_BANDS.map((b) => (
            <tr key={b.label}>
              <Td>
                {b.label}, {b.range}
              </Td>
              <Td>{b.call}</Td>
              <Td>{b.what}</Td>
            </tr>
          ))}
          {CUTOFFS.map((c) => (
            <tr key={c.format}>
              <Td>{c.format}</Td>
              <Td>{c.cutoff}</Td>
              <Td>
                {c.week == null
                  ? "No published cutoff, so read your own league's settings before the draft."
                  : `Money held past week ${c.week} in this format has already turned into nothing.`}
              </Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <ol role="list" className="grid gap-2 sm:grid-cols-3">
        {ENDGAME_BANDS.map((b) => (
          <li
            key={b.label}
            className={`rounded-card border p-3 ${ENDGAME_TONE[b.tone]}`}
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
              {b.label}
            </p>
            <p className="mt-0.5 font-mono text-xs tabular-nums text-ink-muted">{b.range}</p>
            <p className="mt-1.5 text-sm font-semibold text-ink">{b.call}</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">{b.what}</p>
          </li>
        ))}
      </ol>

      <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
        The week your money expires
      </p>
      <ul role="list" className="mt-2 grid gap-2 sm:grid-cols-2">
        {CUTOFFS.map((c) => (
          <li
            key={c.format}
            className="flex items-baseline justify-between gap-3 rounded-card border border-line bg-base/60 px-3 py-2"
          >
            <span className="text-xs font-medium text-ink">{c.format}</span>
            <span
              className={`shrink-0 text-right text-xs ${
                c.week == null ? "text-ink-subtle" : "font-semibold text-brand-cyan"
              }`}
            >
              {c.week == null ? "Check your league" : `Week ${c.week}`}
            </span>
          </li>
        ))}
      </ul>
    </ChartFigure>
  );
}
