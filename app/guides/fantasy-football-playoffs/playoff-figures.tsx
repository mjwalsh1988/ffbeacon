import {
  ChartFigure,
  DataTable,
  Td,
  Th,
  makeScale,
} from "@/components/chart-kit";
import { winProbability } from "@/lib/power-pulse/math";
import { DEFAULT_POWER_PULSE_SETTINGS } from "@/lib/power-pulse/default-settings";
import {
  DEADLINE_CALL_LABEL,
  ODDS_BANDS,
  ROSTER_WINDOWS,
  VARIANCE_EXAMPLE,
  deadlineCall,
  oddsPercent,
  swingByWeek,
} from "@/lib/guides/playoff-odds";
import { buildLuckExample } from "@/lib/guides/playoff-luck-example";

/**
 * The diagrams in the fantasy football playoffs guide.
 *
 * THREE KINDS OF NUMBER LIVE HERE, AND EACH CAPTION SAYS WHICH IT IS.
 *
 *   - TEACHING MODEL. SwingFigure reads lib/guides/playoff-odds.ts, an exact
 *     calculation for a league of evenly matched teams. Its caption says it is
 *     not Power Pulse and names the assumptions.
 *   - PRODUCT CODE ON INVENTED TEAMS. LuckFigure runs buildLuckRows from
 *     lib/league-schedule/insights.ts, the Schedules page's own function, over
 *     a made-up six-team league. VarianceFigure runs winProbability from
 *     lib/power-pulse/math.ts, the function the Schedules board and the Lineups
 *     what-if use for a weekly matchup (Power Pulse computes the same formula
 *     inline), over made-up lineups. The arithmetic is the
 *     product's; the teams are not real, and the captions say so.
 *   - PUBLISHED RULES. BracketFigure and ConsolationFigure draw what Sleeper's
 *     own help centre and blog say, and name them.
 *
 * DeadlineGridFigure is the guide's own rule of thumb, drawn from the same
 * deadlineCall() the page's prose quotes, so the grid and the words cannot
 * disagree. MatchupRangeFigure uses invented projections and the opponent
 * limits in lib/power-pulse/default-settings.ts (0.85 to 1.15 by default).
 *
 * Every figure goes through ChartFigure: the conclusion in a sentence before
 * the graphic, and the plotted values in a real table under a disclosure. The
 * SVG ones mark their <svg> aria-hidden because the sentence and the table
 * carry the meaning. The DOM-built ones (the bracket, the week strips, the
 * grid, the two brackets for teams that miss) keep all of their text in the
 * accessibility tree.
 */

const PURPLE = "#A855F7";
const CYAN = "#22D3EE";
const INK = "#F4F4F8";
const INK_SUBTLE = "#8A8A9C";
const LINE = "#2A2A47";

/* ---------- Lesson 1: a six-team bracket ---------- */

const ROUNDS: { name: string; weekNote: string; games: string[] }[] = [
  {
    name: "Round 1",
    weekNote: "Week 15 in a league that starts its playoffs there",
    games: [
      "Seed 1: bye",
      "Seed 2: bye",
      "Seed 3 against seed 6",
      "Seed 4 against seed 5",
    ],
  },
  {
    name: "Semifinals",
    weekNote: "Week 16",
    games: [
      "Seed 1 against the lowest seed left",
      "Seed 2 against the other winner",
    ],
  },
  {
    name: "Final",
    weekNote: "Week 17, or weeks 16 and 17 combined in a two-week final",
    games: ["The two semifinal winners"],
  },
];

export function BracketFigure() {
  return (
    <ChartFigure
      titleLevel={3}
      title="A six-team playoff, round by round"
      description="The common six-team shape Sleeper's own blog describes, with reseeding switched on. Your league's settings decide the size, the start week and whether the final runs one week or two."
      summary="In a six-team playoff the top two seeds skip the first round. Seeds 3 and 6 and seeds 4 and 5 play in round one. With reseeding on, seed 1 then meets the lowest seed left. The two winners play for the title, in one week or across two."
      table={
        <DataTable
          caption="The three rounds of a six-team playoff and who plays in each."
          head={
            <>
              <Th>Round</Th>
              <Th>When</Th>
              <Th>Games</Th>
            </>
          }
        >
          {ROUNDS.map((r) => (
            <tr key={r.name}>
              <Td>{r.name}</Td>
              <Td>{r.weekNote}</Td>
              <Td>{r.games.join(". ")}.</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <ol role="list" className="grid gap-3 sm:grid-cols-3">
        {ROUNDS.map((r) => (
          <li
            key={r.name}
            className="rounded-card border border-line bg-base/40 p-3"
          >
            <p className="text-sm font-semibold text-ink">{r.name}</p>
            <p className="text-xs text-ink-subtle">{r.weekNote}</p>
            <ul role="list" className="mt-2 space-y-1.5">
              {r.games.map((g) => (
                <li
                  key={g}
                  className={`rounded-card border px-2.5 py-1.5 text-xs leading-relaxed ${
                    g.includes("bye")
                      ? "border-brand-cyan/60 bg-brand-cyan/10 text-ink"
                      : "border-line bg-base/60 text-ink-muted"
                  }`}
                >
                  {g}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </ChartFigure>
  );
}

/* ---------- Lesson 2: what one game is worth, by week ---------- */

export const SWING_LEAGUE = {
  teams: 12,
  playoffSpots: 6,
  seasonWeeks: 14,
  winChance: 0.5,
};

export function SwingFigure() {
  const rows = swingByWeek(SWING_LEAGUE);
  const first = rows[0];
  const last = rows[rows.length - 1];

  const W = 640;
  const H = 250;
  const padL = 40;
  const padR = 12;
  const padT = 18;
  const padB = 44;
  const y = makeScale(0, 100, H - padB, padT);
  const band = (W - padL - padR) / rows.length;
  const barW = Math.min(18, band / 3);

  return (
    <ChartFigure
      titleLevel={3}
      title="What one game is worth, week by week"
      description="The guide's teaching model, not Power Pulse: a twelve-team league with six playoff spots and a fourteen-week season, every team an even bet each week, standings ties settled by a coin flip. Each pair of bars is a team at .500 going into that week, after a win and after a loss."
      summary={`In this model a team at .500 is a coin flip to make the playoffs every week of the season, but the game in front of it matters more and more. A win in week ${first.week} takes its odds to ${oddsPercent(first.oddsIfWin)} percent and a loss to ${oddsPercent(first.oddsIfLoss)}, a swing of ${oddsPercent(first.swing)} points. In week ${last.week} the same game moves it from ${oddsPercent(last.oddsIfLoss)} to ${oddsPercent(last.oddsIfWin)} percent, a swing of ${oddsPercent(last.swing)} points.`}
      table={
        <DataTable
          caption="Playoff odds for a .500 team after a win and after a loss, by week, in the guide's teaching model."
          head={
            <>
              <Th>Week</Th>
              <Th>Record going in</Th>
              <Th numeric>Odds after a win</Th>
              <Th numeric>Odds after a loss</Th>
              <Th numeric>Swing, points</Th>
            </>
          }
        >
          {rows.map((r) => (
            <tr key={r.week}>
              <Td>Week {r.week}</Td>
              <Td>
                {r.winsBefore}-{r.lossesBefore}
              </Td>
              <Td numeric>{oddsPercent(r.oddsIfWin)}%</Td>
              <Td numeric>{oddsPercent(r.oddsIfLoss)}%</Td>
              <Td numeric>{oddsPercent(r.swing)}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <div aria-hidden="true" className="overflow-x-auto">
        <div className="min-w-[32rem]">
          <svg
            aria-hidden="true"
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full"
          >
            {[0, 25, 50, 75, 100].map((t) => (
              <g key={t}>
                <line
                  x1={padL}
                  x2={W - padR}
                  y1={y(t)}
                  y2={y(t)}
                  stroke={LINE}
                  strokeWidth={1}
                />
                <text
                  x={padL - 6}
                  y={y(t) + 4}
                  textAnchor="end"
                  fontSize="11"
                  fill={INK_SUBTLE}
                >
                  {t}%
                </text>
              </g>
            ))}
            {rows.map((r, i) => {
              const cx = padL + band * i + band / 2;
              const win = oddsPercent(r.oddsIfWin);
              const loss = oddsPercent(r.oddsIfLoss);
              return (
                <g key={r.week}>
                  <rect
                    x={cx - barW - 1}
                    y={y(win)}
                    width={barW}
                    height={y(0) - y(win)}
                    fill={CYAN}
                  />
                  <rect
                    x={cx + 1}
                    y={y(loss)}
                    width={barW}
                    height={y(0) - y(loss)}
                    fill={PURPLE}
                    opacity={0.85}
                  />
                  <text
                    x={cx}
                    y={H - padB + 16}
                    textAnchor="middle"
                    fontSize="11"
                    fill={INK}
                  >
                    Wk {r.week}
                  </text>
                  <text
                    x={cx}
                    y={H - padB + 30}
                    textAnchor="middle"
                    fontSize="10"
                    fill={INK_SUBTLE}
                  >
                    {r.winsBefore}-{r.lossesBefore}
                  </text>
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
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 rounded-sm bg-brand-cyan"
          />
          Left bar: odds after a win
        </li>
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 rounded-sm bg-brand-purple"
          />
          Right bar: odds after a loss
        </li>
      </ul>
    </ChartFigure>
  );
}

/* ---------- Lesson 3: same points, different records ---------- */

export function LuckFigure() {
  const rows = buildLuckExample();
  const a = rows[0];
  const b = rows[1];
  const rec = (r: { wins: number; losses: number }) => `${r.wins}-${r.losses}`;
  const pct = (w: number, l: number) => Math.round((w / (w + l)) * 100);

  return (
    <ChartFigure
      titleLevel={3}
      title="Same points, opposite records"
      description="An invented six-team league where everyone plays everyone once. The scores are made up. The all-play records are worked out by the same code the Luck index on the Schedules page runs."
      summary={`Team A and Team B both scored ${a.pointsFor} points over five weeks. Team A went ${rec(a.record)} and Team B went ${rec(b.record)}. Played against every team every week, Team A was ${a.allPlayWins}-${a.allPlayLosses} and Team B was ${b.allPlayWins}-${b.allPlayLosses}: three all-play wins apart, where their real records are three games apart in five weeks. Team A's all-play record was the best in the league and Team B's sat in the middle of it.`}
      tableLabel="View all six teams as a table"
      table={
        <DataTable
          caption="Every team in the invented league: points, real record, all-play record and the luck figure, which is real win rate minus all-play win rate."
          head={
            <>
              <Th>Team</Th>
              <Th numeric>Points</Th>
              <Th>Record</Th>
              <Th>All-play</Th>
              <Th numeric>Luck, points</Th>
            </>
          }
        >
          {rows.map((r) => (
            <tr key={r.name}>
              <Td>{r.name}</Td>
              <Td numeric>{r.pointsFor}</Td>
              <Td>{rec(r.record)}</Td>
              <Td>
                {r.allPlayWins}-{r.allPlayLosses}
              </Td>
              <Td numeric>
                {r.luck > 0 ? "plus " : r.luck < 0 ? "minus " : ""}
                {Math.abs(Math.round(r.luck * 100))}
              </Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <ul role="list" className="grid gap-3 sm:grid-cols-2">
        {[a, b].map((t) => (
          <li
            key={t.name}
            className="rounded-card border border-line bg-base/40 p-3"
          >
            <p className="text-sm font-semibold text-ink">
              {t.name}: {t.pointsFor} points, {rec(t.record)}
            </p>
            <p className="text-xs text-ink-subtle">
              All-play {t.allPlayWins}-{t.allPlayLosses}, a{" "}
              {pct(t.allPlayWins, t.allPlayLosses)} percent win rate
            </p>
            <ol role="list" className="mt-2 space-y-1">
              {t.weeks.map((w) => (
                <li
                  key={w.week}
                  className={`flex flex-wrap items-baseline justify-between gap-x-2 rounded-card border px-2.5 py-1.5 text-xs ${
                    w.won
                      ? "border-brand-cyan/50 bg-brand-cyan/10"
                      : "border-line bg-base/60"
                  }`}
                >
                  <span className="font-semibold text-ink">
                    Week {w.week}: {w.won ? "Won" : "Lost"}
                  </span>
                  <span className="font-mono tabular-nums text-ink-muted">
                    {w.score} to {w.opponentScore}, against {w.opponent}
                  </span>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ul>
    </ChartFigure>
  );
}

/* ---------- Lesson 4: the deadline grid ---------- */

const CALL_CELL: Record<string, string> = {
  buy: "border-brand-cyan/60 bg-brand-cyan/15",
  "buy-small": "border-brand-cyan/30 bg-brand-cyan/5",
  hold: "border-brand-purple/40 bg-brand-purple/10",
  sell: "border-line bg-base/60",
};

export function DeadlineGridFigure() {
  return (
    <ChartFigure
      titleLevel={3}
      title="Buy, hold or sell, by odds and by roster"
      description="The guide's own rule of thumb, not a model. Find your playoff odds band down the side and your kind of roster across the top."
      summary="Redraft teams buy in every band except out of it, where they hold and play it straight, because nothing they hold is worth anything in January. A young dynasty roster sells only when it is a long shot or worse, holds on the bubble, and buys small when it is likely in. A veteran dynasty roster sells from the bubble down and buys only when it is likely in or safe."
      tableLabel="View the grid with the reason for every cell"
      table={
        <DataTable
          caption="The deadline call for every odds band and kind of roster, with the reason."
          head={
            <>
              <Th>Odds band</Th>
              {ROSTER_WINDOWS.map((w) => (
                <Th key={w.key}>{w.label}</Th>
              ))}
            </>
          }
        >
          {ODDS_BANDS.map((b) => (
            <tr key={b.key}>
              <Td>
                {b.label}, {b.range}
              </Td>
              {ROSTER_WINDOWS.map((w) => {
                const r = deadlineCall(b.key, w.key);
                return (
                  <Td key={w.key}>
                    {DEADLINE_CALL_LABEL[r.call]}. {r.why}
                  </Td>
                );
              })}
            </tr>
          ))}
        </DataTable>
      }
    >
      {/* One card per band, three calls inside it. Cards rather than a wide
          grid so every call and its label stay readable at 320px. */}
      <ol role="list" className="space-y-2">
        {ODDS_BANDS.map((b) => (
          <li
            key={b.key}
            className="rounded-card border border-line bg-base/40 p-2.5"
          >
            <p className="text-xs font-semibold text-ink">
              {b.label}{" "}
              <span className="font-normal text-ink-subtle">({b.range})</span>
            </p>
            <ul role="list" className="mt-1.5 grid gap-1.5 sm:grid-cols-3">
              {ROSTER_WINDOWS.map((w) => {
                const r = deadlineCall(b.key, w.key);
                return (
                  <li
                    key={w.key}
                    className={`rounded-card border px-2.5 py-1.5 text-xs ${CALL_CELL[r.call]}`}
                  >
                    <span className="block text-[11px] text-ink-subtle">
                      {w.label}
                    </span>
                    <span className="block font-semibold text-ink">
                      {DEADLINE_CALL_LABEL[r.call]}
                    </span>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
    </ChartFigure>
  );
}

/* ---------- Lesson 5: how far a matchup can move a projection ---------- */

// Read from the shipped defaults rather than typed, so the drawing moves with
// them. lib/guides/fantasy-football-playoffs.test.ts pins the values the
// copy quotes (15 percent, and zero for receivers and quarterbacks).
const MATCHUP_MIN = DEFAULT_POWER_PULSE_SETTINGS.opponent.minMultiplier;
const MATCHUP_MAX = DEFAULT_POWER_PULSE_SETTINGS.opponent.maxMultiplier;

const MATCHUP_PLAYERS = [
  { name: "Player A", projection: 16 },
  { name: "Player B", projection: 13.5 },
  { name: "Player C", projection: 11 },
];

export function MatchupRangeFigure() {
  const W = 640;
  const H = 170;
  const padL = 80;
  const padR = 24;
  const x = makeScale(8, 20, padL, W - padR);
  const rowH = 38;

  const range = (p: number) => [p * MATCHUP_MIN, p * MATCHUP_MAX] as const;
  const fmt = (n: number) => n.toFixed(1);

  return (
    <ChartFigure
      titleLevel={3}
      title="How far a matchup can move a projection"
      description="Three invented players. Each bar runs from the worst matchup to the best, using the limits FF Beacon's projections apply by default: at most 15 percent down or 15 percent up. The white tick is the projection itself. By default receivers and quarterbacks get no matchup adjustment at all."
      summary={`With a 15 percent limit either way, Player A's 16 points can fall no lower than ${fmt(16 * MATCHUP_MIN)} and Player C's 11 can rise no higher than ${fmt(11 * MATCHUP_MAX)}, so no matchup makes Player C the better start. Player B's 13.5 points overlap Player A's range, so between A and B a matchup can decide it.`}
      table={
        <DataTable
          caption="Each invented player's projection and the range a matchup can move it to."
          head={
            <>
              <Th>Player</Th>
              <Th numeric>Projection</Th>
              <Th numeric>Worst matchup</Th>
              <Th numeric>Best matchup</Th>
            </>
          }
        >
          {MATCHUP_PLAYERS.map((p) => {
            const [lo, hi] = range(p.projection);
            return (
              <tr key={p.name}>
                <Td>{p.name}</Td>
                <Td numeric>{fmt(p.projection)}</Td>
                <Td numeric>{fmt(lo)}</Td>
                <Td numeric>{fmt(hi)}</Td>
              </tr>
            );
          })}
        </DataTable>
      }
    >
      <div aria-hidden="true" className="overflow-x-auto">
        <div className="min-w-[32rem]">
          <svg
            aria-hidden="true"
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full"
          >
            {[8, 10, 12, 14, 16, 18, 20].map((t) => (
              <g key={t}>
                <line
                  x1={x(t)}
                  x2={x(t)}
                  y1={10}
                  y2={H - 26}
                  stroke={LINE}
                  strokeWidth={1}
                />
                <text
                  x={x(t)}
                  y={H - 10}
                  textAnchor="middle"
                  fontSize="11"
                  fill={INK_SUBTLE}
                >
                  {t} pts
                </text>
              </g>
            ))}
            {MATCHUP_PLAYERS.map((p, i) => {
              const [lo, hi] = range(p.projection);
              const cy = 26 + i * rowH;
              return (
                <g key={p.name}>
                  <text
                    x={padL - 8}
                    y={cy + 4}
                    textAnchor="end"
                    fontSize="12"
                    fill={INK}
                  >
                    {p.name}
                  </text>
                  <rect
                    x={x(lo)}
                    y={cy - 7}
                    width={x(hi) - x(lo)}
                    height={14}
                    rx={3}
                    fill={CYAN}
                    opacity={0.35}
                  />
                  <line
                    x1={x(p.projection)}
                    x2={x(p.projection)}
                    y1={cy - 10}
                    y2={cy + 10}
                    stroke={INK}
                    strokeWidth={2}
                  />
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </ChartFigure>
  );
}

/* ---------- Lesson 7: steady or streaky ---------- */

export function VarianceFigure() {
  const ex = VARIANCE_EXAMPLE;
  const p = (o: { mean: number; sigma: number }) =>
    Math.round(
      winProbability(o.mean, o.sigma, ex.opponentMean, ex.opponentSigma) * 100,
    );
  const groups = [
    {
      name: `Underdog, projected ${ex.underdog[0].mean}`,
      options: ex.underdog,
    },
    {
      name: `Favorite, projected ${ex.favorite[0].mean}`,
      options: ex.favorite,
    },
  ];

  const W = 640;
  const H = 210;
  const padL = 150;
  const padR = 50;
  const x = makeScale(0, 100, padL, W - padR);

  const bars = groups.flatMap((g) =>
    g.options.map((o) => ({
      group: g.name,
      label: o.label,
      sigma: o.sigma,
      win: p(o),
    })),
  );

  return (
    <ChartFigure
      titleLevel={3}
      title="Steady or streaky, against the same opponent"
      description={`Invented lineups against an opponent projected for ${ex.opponentMean} points. Each pair projects for the same total; the streaky one has twice the spread. The win chances come from the same formula Power Pulse uses for a weekly matchup.`}
      summary={`As the underdog, projected ${ex.underdog[0].mean} to ${ex.opponentMean}, the steady lineup wins ${p(ex.underdog[0])} percent of the time and the streaky one ${p(ex.underdog[1])} percent. As the favorite, projected ${ex.favorite[0].mean}, it flips: the steady lineup wins ${p(ex.favorite[0])} percent and the streaky one ${p(ex.favorite[1])}. Same points either way; only the spread changed.`}
      table={
        <DataTable
          caption="Win chance for each invented lineup."
          head={
            <>
              <Th>Situation</Th>
              <Th>Lineup</Th>
              <Th numeric>Spread, points</Th>
              <Th numeric>Win chance</Th>
            </>
          }
        >
          {bars.map((b) => (
            <tr key={`${b.group}-${b.label}`}>
              <Td>{b.group}</Td>
              <Td>{b.label}</Td>
              <Td numeric>{b.sigma}</Td>
              <Td numeric>{b.win}%</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <div aria-hidden="true" className="overflow-x-auto">
        <div className="min-w-[32rem]">
          <svg
            aria-hidden="true"
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full"
          >
            <line
              x1={x(50)}
              x2={x(50)}
              y1={8}
              y2={H - 22}
              stroke={INK_SUBTLE}
              strokeDasharray="4 3"
            />
            <text
              x={x(50)}
              y={H - 6}
              textAnchor="middle"
              fontSize="11"
              fill={INK_SUBTLE}
            >
              50%
            </text>
            {bars.map((b, i) => {
              const cy = 22 + i * 44 + (i >= 2 ? 10 : 0);
              return (
                <g key={`${b.group}-${b.label}`}>
                  <text
                    x={padL - 8}
                    y={cy - 2}
                    textAnchor="end"
                    fontSize="11"
                    fill={INK_SUBTLE}
                  >
                    {i % 2 === 0 ? (i === 0 ? "Underdog" : "Favorite") : ""}
                  </text>
                  <text
                    x={padL - 8}
                    y={cy + 12}
                    textAnchor="end"
                    fontSize="12"
                    fill={INK}
                  >
                    {b.label}
                  </text>
                  <rect
                    x={x(0)}
                    y={cy}
                    width={x(b.win) - x(0)}
                    height={16}
                    fill={b.label.startsWith("Streaky") ? PURPLE : CYAN}
                  />
                  <text x={x(b.win) + 6} y={cy + 12} fontSize="12" fill={INK}>
                    {b.win}%
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </ChartFigure>
  );
}

/* ---------- Lesson 8: two brackets for teams that miss ---------- */

const BRACKETS = [
  {
    name: "Consolation bracket",
    rule: "The winner of each game advances.",
    end: "The last team standing is the consolation winner.",
    want: "Win",
  },
  {
    name: "Toilet Bowl",
    rule: "The loser of each game advances.",
    end: "The last team left is the league's last place.",
    want: "Win, to get out early",
  },
];

export function ConsolationFigure() {
  return (
    <ChartFigure
      titleLevel={3}
      title="Two ways Sleeper runs the bracket for teams that miss"
      description="From Sleeper's help centre. Up to eight of the teams with the worst records enter whichever one your league uses."
      summary="In a consolation bracket the winner of each game moves on and the last team standing wins it. In a Toilet Bowl the loser moves on, so every team is trying to win its way out, and the last team left finishes last in the league."
      table={
        <DataTable
          caption="How the two brackets for non-playoff teams work on Sleeper."
          head={
            <>
              <Th>Bracket</Th>
              <Th>Who advances</Th>
              <Th>How it ends</Th>
              <Th>What you want each week</Th>
            </>
          }
        >
          {BRACKETS.map((b) => (
            <tr key={b.name}>
              <Td>{b.name}</Td>
              <Td>{b.rule}</Td>
              <Td>{b.end}</Td>
              <Td>{b.want}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <ul role="list" className="grid gap-3 sm:grid-cols-2">
        {BRACKETS.map((b) => (
          <li
            key={b.name}
            className="rounded-card border border-line bg-base/40 p-3"
          >
            <p className="text-sm font-semibold text-ink">{b.name}</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              {b.rule}
            </p>
            <p className="text-xs leading-relaxed text-ink-muted">{b.end}</p>
            <p className="mt-2 text-xs font-semibold text-brand-cyan">
              Each week: {b.want.toLowerCase()}
            </p>
          </li>
        ))}
      </ul>
    </ChartFigure>
  );
}
