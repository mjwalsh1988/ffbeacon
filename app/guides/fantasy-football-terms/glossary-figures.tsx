import { ChartFigure, DataTable, Td, Th, makeScale } from "@/components/chart-kit";
import type { AbbreviationTone } from "@/lib/guides/fantasy-football-terms";

/**
 * The diagrams in the glossary.
 *
 * Every figure goes through ChartFigure, which states the point in a sentence
 * before the graphic and keeps the values in a real table under a disclosure.
 * The SVG figure marks its <svg> aria-hidden because the sentence and the table
 * carry the meaning. The DOM-built ones either keep their text in the tree or,
 * where reading every cell aloud would be noise (the snake draft grid), hide
 * the grid and say the same thing in a visible line under each row.
 *
 * No number here is a player's real figure. The calendar, the lineup slots,
 * the draft order and the usage benchmarks restate what the glossary entries
 * themselves say, and each caption says where a league's own settings differ.
 */

const PURPLE = "#A855F7";
const CYAN = "#22D3EE";
const INK = "#F4F4F8";
const INK_SUBTLE = "#8A8A9C";
const LINE = "#2A2A47";

/* ---------- Badge tones, shared with the abbreviations board ---------- */

export const TONE_CLASS: Record<AbbreviationTone, string> = {
  cyan: "border-brand-cyan/60 bg-brand-cyan/10 text-brand-cyan",
  purple: "border-brand-purple/60 bg-brand-purple/10 text-[#C084FC]",
  amber: "border-[#FDE047]/60 bg-[#FDE047]/10 text-[#FDE047]",
  orange: "border-[#FB923C]/60 bg-[#FB923C]/10 text-[#FB923C]",
  rose: "border-[#FB7185]/60 bg-[#FB7185]/10 text-[#FB7185]",
  muted: "border-line bg-base/60 text-ink",
};

/* ---------- League formats: how much of the roster you keep ---------- */

const FORMATS = [
  {
    name: "Redraft",
    kept: "Nobody",
    share: 0,
    read: "Value is this season's points and nothing else.",
    href: "#redraft",
  },
  {
    name: "Keeper",
    kept: "Usually 1 to 4 players",
    share: 0.2,
    read: "Value is this season, plus what a player costs to keep.",
    href: "#keeper-league",
  },
  {
    name: "Dynasty",
    kept: "The whole roster",
    share: 1,
    read: "Value is every season he has left, and picks are currency.",
    href: "#dynasty",
  },
];

export function FormatSpectrumFigure() {
  return (
    <ChartFigure
      titleLevel={3}
      title="How much of your team you keep"
      description="The three main league formats on one line, from keeping nobody to keeping everybody. The keeper share is drawn at a typical few players out of a full roster."
      summary="Redraft keeps nobody from last season, a keeper league usually keeps one to four players, and dynasty keeps the whole roster. The more you keep, the more a player's future is worth next to his points this season."
      tableLabel="View the three formats as a table"
      table={
        <DataTable
          caption="The three main league formats and how many players carry over."
          head={
            <>
              <Th>Format</Th>
              <Th>Players kept from last season</Th>
              <Th>What a player is worth</Th>
            </>
          }
        >
          {FORMATS.map((f) => (
            <tr key={f.name}>
              <Td>{f.name}</Td>
              <Td>{f.kept}</Td>
              <Td>{f.read}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <ol role="list" className="grid gap-2 sm:grid-cols-3">
        {FORMATS.map((f) => (
          <li key={f.name} className="flex flex-col rounded-card border border-line bg-surface/60 p-3">
            <a
              href={f.href}
              className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-ink underline decoration-line underline-offset-4 hover:text-brand-cyan hover:decoration-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              {f.name}
            </a>
            <span className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
              Kept: {f.kept}
            </span>
            {/* The meter repeats the words above it. Decorative. */}
            <span aria-hidden="true" className="mt-2 block h-2 w-full overflow-hidden rounded-full bg-base">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.max(f.share * 100, 3)}%`,
                  backgroundImage: `linear-gradient(90deg, ${PURPLE} 0%, ${CYAN} 100%)`,
                }}
              />
            </span>
            <span className="mt-2 text-xs leading-relaxed text-ink-muted">{f.read}</span>
          </li>
        ))}
      </ol>
    </ChartFigure>
  );
}

/* ---------- Roster and lineup: which slot takes which position ---------- */

const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;
type Pos = (typeof POSITIONS)[number];

const SLOTS: { slot: string; label: string; takes: Pos[]; href: string }[] = [
  { slot: "QB", label: "Quarterback", takes: ["QB"], href: "#abbr-positions" },
  { slot: "RB", label: "Running back", takes: ["RB"], href: "#abbr-positions" },
  { slot: "WR", label: "Wide receiver", takes: ["WR"], href: "#abbr-positions" },
  { slot: "TE", label: "Tight end", takes: ["TE"], href: "#abbr-positions" },
  { slot: "FLEX, W/R/T", label: "Flex", takes: ["RB", "WR", "TE"], href: "#flex" },
  { slot: "W/T", label: "Receiver flex", takes: ["WR", "TE"], href: "#abbr-wrt" },
  {
    slot: "SF, OP, Q/W/R/T",
    label: "Superflex",
    takes: ["QB", "RB", "WR", "TE"],
    href: "#superflex",
  },
  { slot: "K", label: "Kicker", takes: ["K"], href: "#kicker" },
  { slot: "DEF, D/ST", label: "Team defense", takes: ["DEF"], href: "#dst" },
];

export function LineupSlotsFigure() {
  return (
    <figure className="rounded-card border border-line bg-base/40 p-4">
      <figcaption>
        <h3 className="text-sm font-semibold text-ink">Which lineup slot takes which position</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
          One row per slot label you will meet on a lineup screen. A filled dot means the slot accepts
          that position. Your league picks which of these slots it uses and how many of each.
        </p>
      </figcaption>
      <p className="mt-3 text-sm leading-relaxed text-ink">
        A flex takes a running back, receiver or tight end. A superflex takes all of those plus a
        quarterback, which is why it changes quarterback value so much. Bench, IR and taxi slots
        hold any position but score nothing.
      </p>
      <div
        className="mt-3 overflow-x-auto rounded-card border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
        tabIndex={0}
        role="region"
        aria-label="Lineup slots and the positions each accepts"
      >
        <table className="w-full min-w-[26rem] border-collapse text-left text-xs">
          <caption className="sr-only">
            Lineup slot labels, and whether each slot accepts a quarterback, running back, wide
            receiver, tight end, kicker or team defense.
          </caption>
          <thead>
            <tr className="border-b border-line text-[10px] uppercase tracking-wide text-ink-subtle">
              <th scope="col" className="px-3 py-2 font-semibold">
                Slot
              </th>
              {POSITIONS.map((p) => (
                <th key={p} scope="col" className="px-2 py-2 text-center font-semibold">
                  {p}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {SLOTS.map((s) => (
              <tr key={s.slot}>
                <th scope="row" className="px-3 py-2 text-left font-normal">
                  <a
                    href={s.href}
                    className="inline-flex min-h-11 min-w-11 flex-col justify-center hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                  >
                    <span className="font-mono font-semibold text-ink">{s.slot}</span>
                    <span className="text-[11px] text-ink-subtle">{s.label}</span>
                  </a>
                </th>
                {POSITIONS.map((p) => {
                  const yes = s.takes.includes(p);
                  return (
                    <td key={p} className="px-2 py-2 text-center">
                      <span
                        aria-hidden="true"
                        className={`inline-block h-3 w-3 rounded-full ${
                          yes ? "" : "border border-line"
                        }`}
                        style={
                          yes
                            ? { backgroundImage: `linear-gradient(135deg, ${PURPLE}, ${CYAN})` }
                            : undefined
                        }
                      />
                      <span className="sr-only">{yes ? "Yes" : "No"}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

/* ---------- Drafting: the snake ---------- */

const TEAMS = 12;
const MY_TEAM = 3;

type DraftRound = { label: string; round: number; order: number[]; note: string };

/** Pick notation for team 3 in one round: "2.10". */
function pickLabel(round: number, order: number[]): string {
  return `${round}.${String(order.indexOf(MY_TEAM) + 1).padStart(2, "0")}`;
}

function snakeRounds(): DraftRound[] {
  const forward = Array.from({ length: TEAMS }, (_, i) => i + 1);
  const backward = [...forward].reverse();
  // Overall pick numbers for team 3 in a 12-team league: 3, 22 and 27.
  return [
    {
      label: "Round 1",
      round: 1,
      order: forward,
      note: `Team ${MY_TEAM} picks ${pickLabel(1, forward)}, the 3rd pick overall.`,
    },
    {
      label: "Round 2",
      round: 2,
      order: backward,
      note: `The order flips. Team ${MY_TEAM} picks ${pickLabel(2, backward)}, the 22nd pick overall.`,
    },
    {
      label: "Round 3",
      round: 3,
      order: forward,
      note: `It flips back. Team ${MY_TEAM} picks ${pickLabel(3, forward)}, the 27th pick overall.`,
    },
    {
      label: "Round 3, third-round reversal",
      round: 3,
      order: backward,
      note: `With a third-round reversal, round 3 repeats round 2's order, so team ${MY_TEAM} picks ${pickLabel(3, backward)} instead.`,
    },
  ];
}

export function SnakeDraftFigure() {
  const rounds = snakeRounds();
  return (
    <ChartFigure
      titleLevel={3}
      title="A snake draft, seen from the 3rd pick"
      description="A 12-team draft, three rounds, with team 3 highlighted. The last row shows how a third-round reversal changes round 3. The labels use pick notation: 2.10 is round two, pick ten."
      summary="In a 12-team snake draft the team picking 3rd takes pick 1.03, then 2.10 when the order reverses, then 3.03. Under a third-round reversal it picks 3.10 instead, which is the whole point of the rule: it softens the advantage of picking early."
      tableLabel="View team 3's picks as a table"
      table={
        <DataTable
          caption="Team 3's pick in each round of a 12-team snake draft."
          head={
            <>
              <Th>Round</Th>
              <Th>Order runs</Th>
              <Th>Team 3 picks</Th>
            </>
          }
        >
          {rounds.map((r) => (
            <tr key={r.label}>
              <Td>{r.label}</Td>
              <Td>{r.order[0] === 1 ? "Team 1 to team 12" : "Team 12 to team 1"}</Td>
              <Td>{pickLabel(r.round, r.order)}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <ol role="list" className="space-y-3">
        {rounds.map((r, i) => (
          <li key={r.label}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
              {r.label}
            </p>
            {/* The grid draws the order. It is aria-hidden because twelve cells
                read aloud say less than the one sentence under it. */}
            <div aria-hidden="true" className="mt-1.5 grid grid-cols-12 gap-0.5 sm:gap-1">
              {r.order.map((team) => {
                const mine = team === MY_TEAM;
                return (
                  <span
                    key={team}
                    className={`flex h-7 items-center justify-center rounded font-mono text-[10px] tabular-nums sm:text-xs ${
                      mine
                        ? "font-bold text-black"
                        : i === 3
                          ? "border border-dashed border-line text-ink-subtle"
                          : "border border-line text-ink-subtle"
                    }`}
                    style={
                      mine
                        ? { backgroundImage: `linear-gradient(135deg, ${PURPLE}, ${CYAN})` }
                        : undefined
                    }
                  >
                    {team}
                  </span>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{r.note}</p>
          </li>
        ))}
      </ol>
    </ChartFigure>
  );
}

/* ---------- In-season: the calendar ---------- */

export function SeasonCalendarFigure() {
  const weeks = Array.from({ length: 18 }, (_, i) => i + 1);
  const W = 640;
  const H = 188;
  const padL = 12;
  const padR = 12;
  const x = makeScale(0.5, 18.5, padL, W - padR);
  const cell = x(2) - x(1);

  const bands = [
    { label: "Bye weeks", from: 5, to: 14, y: 30, color: INK_SUBTLE },
    { label: "Trade deadline window", from: 10, to: 13, y: 66, color: PURPLE },
    { label: "Fantasy playoffs, most leagues", from: 15, to: 17, y: 102, color: CYAN },
  ];

  return (
    <ChartFigure
      titleLevel={3}
      title="A fantasy season, week by week"
      description="A typical calendar. Waivers process every week of the season. Your league's settings decide the exact deadline and playoff weeks."
      summary="Bye weeks run from roughly week 5 to week 14. Most trade deadlines fall between week 10 and week 13. Most fantasy playoffs run weeks 15 to 17, so the stretch between the deadline and the playoffs is where contenders buy and everyone else sells."
      tableLabel="View the calendar as a table"
      table={
        <DataTable
          caption="The parts of a typical fantasy season and the weeks they cover."
          head={
            <>
              <Th>What happens</Th>
              <Th>Weeks, typically</Th>
            </>
          }
        >
          <tr>
            <Td>Draft</Td>
            <Td>Before week 1</Td>
          </tr>
          <tr>
            <Td>Waivers process</Td>
            <Td>Every week</Td>
          </tr>
          {bands.map((b) => (
            <tr key={b.label}>
              <Td>{b.label}</Td>
              <Td>
                {b.from} to {b.to}
              </Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      {/* At phone width a 640-wide drawing shrinks its labels past reading, so
          below 32rem it keeps its size and scrolls sideways inside this box
          instead. The summary and the table carry the same facts either way. */}
      <div
        className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-cyan"
        tabIndex={0}
        role="region"
        aria-label="The season calendar drawing, scrolls sideways on a small screen"
      >
      <svg aria-hidden="true" viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[32rem]">
        {bands.map((b) => (
          <g key={b.label}>
            <rect
              x={x(b.from) - cell / 2 + 1}
              y={b.y}
              width={x(b.to) - x(b.from) + cell - 2}
              height={22}
              rx={4}
              fill={b.color}
              opacity={b.color === INK_SUBTLE ? 0.25 : 0.3}
              stroke={b.color}
              strokeWidth={1}
            />
            {/* A band that starts late in the season is labelled from its right
                edge, so the words do not run off the end of the drawing. */}
            <text
              x={b.from >= 15 ? x(b.to) + cell / 2 - 8 : x(b.from) - cell / 2 + 8}
              y={b.y + 16}
              textAnchor={b.from >= 15 ? "end" : "start"}
              fontSize="14"
              fontWeight={600}
              fill={INK}
            >
              {b.label}
            </text>
          </g>
        ))}
        {/* Waivers: a tick every week. */}
        {weeks.map((w) => (
          <g key={w}>
            <line x1={x(w)} y1={132} x2={x(w)} y2={140} stroke={CYAN} strokeWidth={2} />
            <rect
              x={x(w) - cell / 2 + 1}
              y={146}
              width={cell - 2}
              height={22}
              rx={3}
              fill="none"
              stroke={LINE}
            />
            <text x={x(w)} y={162} textAnchor="middle" fontSize="13" fill={INK_SUBTLE}>
              {w}
            </text>
          </g>
        ))}
        <text x={x(1) - cell / 2} y={126} fontSize="12" fill={INK_SUBTLE}>
          waivers every week
        </text>
        <text x={W - padR} y={185} textAnchor="end" fontSize="12" fill={INK_SUBTLE}>
          NFL week
        </text>
      </svg>
      </div>
    </ChartFigure>
  );
}

/* ---------- Analytics: the usage benchmarks ---------- */

/**
 * Two reference points per stat, both taken from the glossary entries they
 * link to. Nothing between them is drawn, because the entries do not claim
 * anything about the middle and neither does this.
 */
const BENCHMARKS = [
  {
    metric: "Target share",
    href: "#target-share",
    first: "About 25 percent: a clear number one option",
    second: "Above 30 percent: a genuine focal point of the offense",
    firstLabel: "Strong",
    secondLabel: "Top end",
  },
  {
    metric: "Snap share",
    href: "#snap-share",
    first: "40 percent: no path to production in a quiet week",
    second: "85 percent: a path to production even in a quiet week",
    firstLabel: "Low",
    secondLabel: "High",
  },
  {
    metric: "Yards per route run",
    href: "#yards-per-route-run",
    first: "Above 2.0: very good",
    second: "Above 2.5: elite",
    firstLabel: "Strong",
    secondLabel: "Top end",
  },
  {
    metric: "aDOT",
    href: "#adot",
    first: "About 6 yards: a checkdown and slot role that lives on volume",
    second: "About 14 yards: a deep threat whose weeks swing hard",
    firstLabel: "Short",
    secondLabel: "Deep",
  },
];

export function UsageBenchmarksFigure() {
  return (
    <ChartFigure
      titleLevel={3}
      title="Reading the usage numbers at a glance"
      description="Two reference points for each of four usage stats, taken from the entries below. They are rules of thumb for reading a stat line, not cutoffs a player has to clear."
      summary="As rules of thumb: a target share around 25 percent marks a clear number one receiver and above 30 percent a focal point; a receiver on the field for 85 percent of snaps has a path to production and one at 40 percent does not; yards per route run above 2.0 is very good and above 2.5 elite; and an aDOT near 6 yards is a volume role while near 14 is a deep threat."
      tableLabel="View the reference points as a table"
      table={
        <DataTable
          caption="Two reference points each for four usage stats."
          head={
            <>
              <Th>Stat</Th>
              <Th>First reference point</Th>
              <Th>Second reference point</Th>
            </>
          }
        >
          {BENCHMARKS.map((b) => (
            <tr key={b.metric}>
              <Td>{b.metric}</Td>
              <Td>{b.first}</Td>
              <Td>{b.second}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <ul role="list" className="grid gap-2 sm:grid-cols-2">
        {BENCHMARKS.map((b) => (
          <li key={b.metric} className="rounded-card border border-line bg-surface/60 p-3">
            <a
              href={b.href}
              className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-ink underline decoration-line underline-offset-4 hover:text-brand-cyan hover:decoration-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              {b.metric}
            </a>
            {/* The gradient runs from the first point to the second. Decorative. */}
            <span
              aria-hidden="true"
              className="mt-2 block h-1.5 w-full rounded-full"
              style={{ backgroundImage: `linear-gradient(90deg, ${PURPLE} 0%, ${CYAN} 100%)` }}
            />
            <dl className="mt-2 space-y-1 text-xs leading-relaxed">
              <div className="flex gap-2">
                <dt className="w-14 shrink-0 font-semibold text-[#C084FC]">{b.firstLabel}</dt>
                <dd className="text-ink-muted">{b.first}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-14 shrink-0 font-semibold text-brand-cyan">{b.secondLabel}</dt>
                <dd className="text-ink-muted">{b.second}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </ChartFigure>
  );
}
