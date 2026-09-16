import {
  ChartFigure,
  DataTable,
  Td,
  Th,
  linePath,
  makeScale,
} from "@/components/chart-kit";

/**
 * The diagrams in the trade guide.
 *
 * EVERY NUMBER HERE IS INVENTED. The figures teach a shape (value and wins
 * pulling apart, a price falling while a role holds, a pick's value through a
 * calendar year), and each caption says so in words. Nothing is read from the
 * database, so nothing here can be mistaken for a live figure about a real
 * player or a real league.
 *
 * Every figure goes through ChartFigure, which puts the conclusion in a
 * sentence before the graphic and the plotted values in a real table under a
 * disclosure. The SVG ones mark their <svg> aria-hidden, because the sentence
 * and the table carry the meaning. The DOM-built ones (the two-for-one board
 * and the calendar) keep their text in the tree, so nothing about them is
 * hidden from a screen reader.
 *
 * The Signal Check bands in MarginScaleFigure are the DEFAULTS in
 * lib/signal-check/settings.ts (2.5 percent and 20 percent). An admin can
 * change them, which is why the caption says "by default".
 */

const PURPLE = "#A855F7";
const CYAN = "#22D3EE";
const INK_SUBTLE = "#8A8A9C";
const LINE = "#2A2A47";

/* ---------- Lesson 1: value and wins pull apart ---------- */

export function TwoScalesFigure() {
  // An invented trade: a rebuilding team sends a 29-year-old receiver for a
  // 23-year-old receiver and a first. Value up, wins down.
  const valuePct = 9;
  const winsDelta = -0.8;
  const W = 640;
  const H = 170;
  const mid = W / 2;
  const rowY = [58, 122];
  const valueLen = 150;
  const winsLen = 120;

  return (
    <ChartFigure
      titleLevel={3}
      title="One trade, two answers"
      description="A made-up dynasty trade: send a 29-year-old WR1 and a second, get a 23-year-old WR2 and a first. The value scale and the wins scale point in opposite directions."
      summary="In this invented trade the roster gains about 9 percent in market value and loses about 0.8 projected wins over the rest of the season. Value went up, wins went down, and both readings are correct."
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
            <Td numeric>Up 9 percent</Td>
          </tr>
          <tr>
            <Td>Wins</Td>
            <Td>How many games should my best lineup win from here?</Td>
            <Td numeric>Down 0.8 wins</Td>
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
        {/* Center line: zero for both rows. */}
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

        {/* Value row: points right. */}
        <text
          x={mid - 12}
          y={rowY[0] - 14}
          textAnchor="end"
          fontSize="13"
          fontWeight={600}
          fill="#F4F4F8"
        >
          Value
        </text>
        <rect
          x={mid}
          y={rowY[0] - 10}
          width={valueLen}
          height={20}
          rx={4}
          fill={PURPLE}
        />
        <text
          x={mid + valueLen + 10}
          y={rowY[0] + 5}
          fontSize="14"
          fontWeight={700}
          fill={PURPLE}
        >
          +{valuePct}%
        </text>

        {/* Wins row: points left. */}
        <text
          x={mid + 12}
          y={rowY[1] - 14}
          textAnchor="start"
          fontSize="13"
          fontWeight={600}
          fill="#F4F4F8"
        >
          Wins
        </text>
        <rect
          x={mid - winsLen}
          y={rowY[1] - 10}
          width={winsLen}
          height={20}
          rx={4}
          fill={CYAN}
        />
        <text
          x={mid - winsLen - 10}
          y={rowY[1] + 5}
          textAnchor="end"
          fontSize="14"
          fontWeight={700}
          fill={CYAN}
        >
          {winsDelta.toFixed(1)} wins
        </text>
      </svg>
    </ChartFigure>
  );
}

/* ---------- Lesson 2: the calculator's bands ---------- */

export function MarginScaleFigure({
  neutralPct = 2.5,
  blowoutPct = 20,
}: {
  neutralPct?: number;
  blowoutPct?: number;
}) {
  const W = 640;
  const H = 120;
  const x0 = 16;
  const x1 = W - 16;
  const y = 48;
  const h = 26;
  // Schematic, not to scale: the even band is a sliver in reality.
  const evenEnd = x0 + (x1 - x0) * 0.16;
  const winnerEnd = x0 + (x1 - x0) * 0.62;

  return (
    <ChartFigure
      titleLevel={3}
      title="How the calculator reads a margin"
      description={`The margin is the gap between the two sides divided by their total. As the calculator is set today, a margin under ${neutralPct} percent is called even, and one at ${blowoutPct} percent or more is called a blowout. Drawn schematically, not to scale.`}
      summary={`Signal Check names no winner when the margin is under ${neutralPct} percent, names a winner between ${neutralPct} and ${blowoutPct} percent, and calls the trade a blowout at ${blowoutPct} percent or more, as it is set today.`}
      table={
        <DataTable
          caption="The three verdict bands, using the calculator's current thresholds."
          head={
            <>
              <Th>Band</Th>
              <Th>Margin</Th>
              <Th>What it means</Th>
            </>
          }
        >
          <tr>
            <Td>Even</Td>
            <Td>Under {neutralPct} percent</Td>
            <Td>Too close to call. No side is named.</Td>
          </tr>
          <tr>
            <Td>One side wins</Td>
            <Td>
              {neutralPct} to {blowoutPct} percent
            </Td>
            <Td>A real edge, named with its size.</Td>
          </tr>
          <tr>
            <Td>Blowout</Td>
            <Td>{blowoutPct} percent and up</Td>
            <Td>Lopsided on value. Somebody is giving something away.</Td>
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
        <rect
          x={x0}
          y={y}
          width={evenEnd - x0}
          height={h}
          rx={6}
          fill="#2A2A47"
          stroke={INK_SUBTLE}
          strokeWidth={1.5}
        />
        <rect
          x={evenEnd}
          y={y}
          width={winnerEnd - evenEnd}
          height={h}
          fill={CYAN}
          opacity={0.85}
        />
        <rect
          x={winnerEnd}
          y={y}
          width={x1 - winnerEnd}
          height={h}
          rx={6}
          fill={PURPLE}
          opacity={0.9}
        />

        <text x={x0} y={y - 12} fontSize="11" fill={INK_SUBTLE}>
          0%
        </text>
        <text
          x={evenEnd}
          y={y - 12}
          textAnchor="middle"
          fontSize="11"
          fontWeight={600}
          fill="#F4F4F8"
        >
          {neutralPct}%
        </text>
        <text
          x={winnerEnd}
          y={y - 12}
          textAnchor="middle"
          fontSize="11"
          fontWeight={600}
          fill="#F4F4F8"
        >
          {blowoutPct}%
        </text>

        <text
          x={(x0 + evenEnd) / 2}
          y={y + h + 22}
          textAnchor="middle"
          fontSize="12"
          fill="#F4F4F8"
        >
          Even
        </text>
        <text
          x={(evenEnd + winnerEnd) / 2}
          y={y + h + 22}
          textAnchor="middle"
          fontSize="12"
          fill="#F4F4F8"
        >
          One side wins
        </text>
        <text
          x={(winnerEnd + x1) / 2}
          y={y + h + 22}
          textAnchor="middle"
          fontSize="12"
          fill="#F4F4F8"
        >
          Blowout
        </text>
      </svg>
    </ChartFigure>
  );
}

/* ---------- Lesson 3: the two-for-one board ---------- */

type BoardPlayer = { label: string; pts: number; note?: string };

function PlayerChip({
  player,
  tone,
}: {
  player: BoardPlayer;
  tone: "out" | "in" | "wire";
}) {
  const border =
    tone === "out"
      ? "border-line"
      : tone === "in"
        ? "border-brand-purple/60"
        : "border-brand-cyan/60";
  return (
    <li
      className={`flex items-center justify-between gap-3 rounded-card border ${border} bg-base/60 px-3 py-2.5`}
    >
      <span className="text-sm text-ink">
        {player.label}
        {player.note && (
          <span className="block text-xs text-ink-subtle">{player.note}</span>
        )}
      </span>
      <span className="font-mono text-sm tabular-nums text-ink-muted">
        {player.pts.toFixed(1)}
        <span className="sr-only"> points a week</span>
      </span>
    </li>
  );
}

export function TwoForOneFigure() {
  const outgoing: BoardPlayer[] = [
    { label: "Your RB2", pts: 11.5, note: "starts for you now" },
    { label: "Your WR3", pts: 10.0, note: "starts in your flex" },
  ];
  const incoming: BoardPlayer[] = [
    { label: "Their WR1", pts: 17.5, note: "starts every week" },
  ];
  const wire: BoardPlayer[] = [
    { label: "Best free agent", pts: 7.5, note: "fills the spot you emptied" },
  ];
  const before = outgoing.reduce((s, p) => s + p.pts, 0);
  const after = incoming[0].pts + wire[0].pts;
  const gain = after - before;

  return (
    <ChartFigure
      titleLevel={3}
      title="A two-for-one is really a two-for-two"
      description="Made-up weekly projections. You send two starters, receive one better one, and the roster spot you get back is filled by the best player on your waiver wire."
      summary={`In this invented two-for-one, the two players you send score ${before.toFixed(1)} points a week between them. The one you receive scores ${incoming[0].pts.toFixed(1)}, and the free agent who fills the empty spot scores ${wire[0].pts.toFixed(1)}, so the lineup gains ${gain.toFixed(1)} points a week.`}
      table={
        <DataTable
          caption="The lineup arithmetic behind the invented two-for-one."
          head={
            <>
              <Th>Side</Th>
              <Th>Players</Th>
              <Th numeric>Points a week</Th>
            </>
          }
        >
          <tr>
            <Td>Before</Td>
            <Td>Your RB2 plus your WR3</Td>
            <Td numeric>{before.toFixed(1)}</Td>
          </tr>
          <tr>
            <Td>After</Td>
            <Td>Their WR1 plus the best free agent</Td>
            <Td numeric>{after.toFixed(1)}</Td>
          </tr>
          <tr>
            <Td>Change</Td>
            <Td>What your lineup gains</Td>
            <Td numeric>+{gain.toFixed(1)}</Td>
          </tr>
        </DataTable>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
            You send
          </p>
          <ul role="list" className="mt-2 space-y-2">
            {outgoing.map((p) => (
              <PlayerChip key={p.label} player={p} tone="out" />
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-muted">
            Together:{" "}
            <span className="font-mono tabular-nums text-ink">
              {before.toFixed(1)}
            </span>{" "}
            a week
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-purple">
            You receive
          </p>
          <ul role="list" className="mt-2 space-y-2">
            {incoming.map((p) => (
              <PlayerChip key={p.label} player={p} tone="in" />
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-cyan">
            The empty spot
          </p>
          <ul role="list" className="mt-2 space-y-2">
            {wire.map((p) => (
              <PlayerChip key={p.label} player={p} tone="wire" />
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-muted">
            Together:{" "}
            <span className="font-mono tabular-nums text-ink">
              {after.toFixed(1)}
            </span>{" "}
            a week
          </p>
        </div>
      </div>
      <p className="mt-4 rounded-card border border-brand-cyan/30 bg-brand-cyan/5 px-3 py-2 text-sm text-ink">
        Your lineup gains{" "}
        <span className="font-mono font-semibold tabular-nums text-brand-cyan">
          +{gain.toFixed(1)}
        </span>{" "}
        points a week, and the whole gain depends on what that free agent is
        worth.
      </p>
    </ChartFigure>
  );
}

/* ---------- Lesson 4: price versus role ---------- */

export function PriceVsRoleFigure() {
  const weeks = [1, 2, 3, 4, 5, 6, 7, 8];
  // Market price, indexed to draft day = 100. Falls through a quiet stretch.
  const price = [100, 102, 96, 84, 78, 72, 70, 71];
  // Target share, in percent. Holds flat the whole time.
  const share = [24, 25, 23, 24, 26, 24, 25, 24];

  const W = 640;
  const H = 260;
  const padL = 44;
  const padR = 44;
  const padT = 22;
  const padB = 40;
  const x = makeScale(1, 8, padL, W - padR);
  const yPrice = makeScale(60, 110, H - padB, padT);
  const yShare = makeScale(10, 35, H - padB, padT);

  const pricePts = weeks.map((w, i) => ({ x: x(w), y: yPrice(price[i]) }));
  const sharePts = weeks.map((w, i) => ({ x: x(w), y: yShare(share[i]) }));
  const drop = Math.round(100 - price[price.length - 1]);

  return (
    <ChartFigure
      titleLevel={3}
      title="The price fell. The role did not."
      description="An invented receiver over eight weeks. Purple is what the room thinks he is worth, indexed to draft day. Cyan is his share of his team's targets."
      summary={`Over eight invented weeks the receiver's market price fell about ${drop} percent while his target share stayed between 23 and 26 percent. A price that falls while the role holds is the shape of a buy-low.`}
      table={
        <DataTable
          caption="The invented weekly values plotted above."
          head={
            <>
              <Th>Week</Th>
              <Th numeric>Market price (draft day = 100)</Th>
              <Th numeric>Target share</Th>
            </>
          }
        >
          {weeks.map((w, i) => (
            <tr key={w}>
              <Td>Week {w}</Td>
              <Td numeric>{price[i]}</Td>
              <Td numeric>{share[i]}%</Td>
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
              stroke={PURPLE}
              strokeWidth="2"
            />
            <circle cx="9" cy="4" r="3" fill={PURPLE} />
          </svg>
          Market price
        </li>
        <li className="flex items-center gap-1.5 text-brand-cyan">
          <svg aria-hidden="true" width="18" height="8" viewBox="0 0 18 8">
            <line
              x1="0"
              y1="4"
              x2="18"
              y2="4"
              stroke={CYAN}
              strokeWidth="2"
              strokeDasharray="4 3"
            />
            <rect x="6" y="1" width="6" height="6" fill={CYAN} />
          </svg>
          Target share
        </li>
      </ul>
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${W} ${H}`}
        className="mt-2 h-auto w-full"
        role="presentation"
      >
        {/* Gridlines and week labels. */}
        {weeks.map((w) => (
          <g key={w}>
            <line
              x1={x(w)}
              y1={padT}
              x2={x(w)}
              y2={H - padB}
              stroke={LINE}
              strokeWidth={1}
            />
            <text
              x={x(w)}
              y={H - padB + 18}
              textAnchor="middle"
              fontSize="11"
              fill={INK_SUBTLE}
            >
              Wk {w}
            </text>
          </g>
        ))}
        {/* Left axis: price. Right axis: share. */}
        <text
          x={padL - 8}
          y={yPrice(100) + 4}
          textAnchor="end"
          fontSize="10"
          fill={PURPLE}
        >
          100
        </text>
        <text
          x={padL - 8}
          y={yPrice(70) + 4}
          textAnchor="end"
          fontSize="10"
          fill={PURPLE}
        >
          70
        </text>
        <text
          x={W - padR + 8}
          y={yShare(25) + 4}
          textAnchor="start"
          fontSize="10"
          fill={CYAN}
        >
          25%
        </text>
        <text
          x={W - padR + 8}
          y={yShare(15) + 4}
          textAnchor="start"
          fontSize="10"
          fill={CYAN}
        >
          15%
        </text>

        <path
          d={linePath(pricePts)}
          fill="none"
          stroke={PURPLE}
          strokeWidth={2.5}
        />
        {pricePts.map((p, i) => (
          <circle key={`p-${i}`} cx={p.x} cy={p.y} r={4} fill={PURPLE} />
        ))}
        <path
          d={linePath(sharePts)}
          fill="none"
          stroke={CYAN}
          strokeWidth={2.5}
          strokeDasharray="6 4"
        />
        {sharePts.map((p, i) => (
          <rect
            key={`s-${i}`}
            x={p.x - 3.5}
            y={p.y - 3.5}
            width={7}
            height={7}
            fill={CYAN}
          />
        ))}

        {/* The window. */}
        <rect
          x={x(5) - 6}
          y={padT}
          width={x(8) - x(5) + 12}
          height={H - padB - padT}
          fill={CYAN}
          opacity={0.06}
        />
        <text
          x={x(6.5)}
          y={padT + 14}
          textAnchor="middle"
          fontSize="11"
          fontWeight={600}
          fill="#F4F4F8"
        >
          the buy window
        </text>
      </svg>
    </ChartFigure>
  );
}

/* ---------- Lesson 6: a pick through the calendar ---------- */

export function PickCalendarFigure() {
  const months = [
    "Sep",
    "Oct",
    "Nov",
    "Dec",
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
  ];
  // Indexed so the rookie-draft peak is 100. The shape, not a measurement.
  const value = [72, 68, 66, 68, 75, 82, 88, 95, 100, 92, 85, 78];

  const W = 640;
  const H = 230;
  const padL = 40;
  const padR = 20;
  const padT = 24;
  const padB = 40;
  const x = makeScale(0, months.length - 1, padL, W - padR);
  const y = makeScale(55, 105, H - padB, padT);
  const pts = value.map((v, i) => ({ x: x(i), y: y(v) }));
  const low = Math.min(...value);
  const lowIdx = value.indexOf(low);

  return (
    <ChartFigure
      titleLevel={3}
      title="A rookie pick has a season of its own"
      description="The typical shape of a future first's price through a year, indexed so the rookie draft is 100. A pattern, not a measurement of any real pick."
      summary={`In the typical shape of a pick's year, the price bottoms out around ${months[lowIdx]} in the middle of the season, climbs through the offseason, and peaks around the rookie draft in May.`}
      table={
        <DataTable
          caption="The indexed pick value by month, invented to show the shape."
          head={
            <>
              <Th>Month</Th>
              <Th numeric>Indexed value</Th>
            </>
          }
        >
          {months.map((m, i) => (
            <tr key={m}>
              <Td>{m}</Td>
              <Td numeric>{value[i]}</Td>
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
        {months.map((m, i) => (
          <text
            key={m}
            x={x(i)}
            y={H - padB + 18}
            textAnchor="middle"
            fontSize="11"
            fill={INK_SUBTLE}
          >
            {m}
          </text>
        ))}
        <line
          x1={padL}
          y1={H - padB}
          x2={W - padR}
          y2={H - padB}
          stroke={LINE}
        />
        {/* In-season shade. */}
        <rect
          x={x(0) - 10}
          y={padT}
          width={x(4) - x(0)}
          height={H - padB - padT}
          fill={PURPLE}
          opacity={0.06}
        />
        <text
          x={x(2)}
          y={padT + 12}
          textAnchor="middle"
          fontSize="11"
          fill="#F4F4F8"
        >
          NFL season: buy
        </text>
        <rect
          x={x(7)}
          y={padT}
          width={x(9) - x(7) + 10}
          height={H - padB - padT}
          fill={CYAN}
          opacity={0.06}
        />
        <text
          x={x(8) + 5}
          y={padT + 12}
          textAnchor="middle"
          fontSize="11"
          fill="#F4F4F8"
        >
          rookie draft: sell
        </text>
        <path d={linePath(pts)} fill="none" stroke={PURPLE} strokeWidth={2.5} />
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={i === 8 || i === lowIdx ? 5 : 3.5}
            fill={i === 8 ? CYAN : PURPLE}
          />
        ))}
      </svg>
    </ChartFigure>
  );
}

/* ---------- Lesson 7: the in-season trade calendar ---------- */

type Phase = {
  weeks: string;
  name: string;
  what: string;
  tone: "purple" | "cyan" | "muted";
  span: number;
};

const PHASES: Phase[] = [
  {
    weeks: "Weeks 1 to 3",
    name: "The overreaction",
    what: "Everyone is pricing two games as a season. Sell a hot start you do not believe. Buy almost nothing.",
    tone: "muted",
    span: 3,
  },
  {
    weeks: "Weeks 4 to 8",
    name: "The evidence window",
    what: "Roles are real now. Buy the slump with a steady role. Byes stack up, and a team with three starters out will pay for depth.",
    tone: "cyan",
    span: 5,
  },
  {
    weeks: "Weeks 9 to the deadline",
    name: "Consolidation",
    what: "Contenders turn two good players into one great one. Rebuilders sell every veteran to whoever is most desperate.",
    tone: "purple",
    span: 4,
  },
  {
    weeks: "After the deadline",
    name: "Waivers only",
    what: "No trades. Whatever roster you have is the one you finish with, plus the wire.",
    tone: "muted",
    span: 5,
  },
];

const PHASE_TONE: Record<Phase["tone"], string> = {
  purple: "border-brand-purple/60 bg-brand-purple/10",
  cyan: "border-brand-cyan/60 bg-brand-cyan/10",
  muted: "border-line bg-base/60",
};

export function TradeCalendarFigure() {
  return (
    <ChartFigure
      titleLevel={3}
      title="The in-season trade calendar"
      description="Where most leagues' trade deadlines fall, the season splits into four stretches, and the right move changes in each one. The week ranges are typical rather than fixed."
      summary="The season has four trading stretches: weeks 1 to 3 are an overreaction market where you sell hot starts and buy little, weeks 4 to 8 are when roles are real and slumps are worth buying, weeks 9 to the deadline are for consolidating, and after the deadline the only moves left are on waivers."
      tableLabel="View the four stretches as a table"
      table={
        <DataTable
          caption="The four stretches of the trading season."
          head={
            <>
              <Th>Weeks</Th>
              <Th>Stretch</Th>
              <Th>What to do</Th>
            </>
          }
        >
          {PHASES.map((p) => (
            <tr key={p.name}>
              <Td>{p.weeks}</Td>
              <Td>{p.name}</Td>
              <Td>{p.what}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <ol role="list" className="grid gap-2 sm:grid-cols-[3fr_5fr_4fr_5fr]">
        {PHASES.map((p, i) => (
          <li
            key={p.name}
            className={`flex flex-col rounded-card border p-3 ${PHASE_TONE[p.tone]}`}
          >
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-subtle">
              <span className="sr-only">Stretch {i + 1}: </span>
              {p.weeks}
            </span>
            <span className="mt-1 text-sm font-semibold text-ink">
              {p.name}
            </span>
            <span className="mt-1.5 text-xs leading-relaxed text-ink-muted">
              {p.what}
            </span>
          </li>
        ))}
      </ol>
    </ChartFigure>
  );
}
