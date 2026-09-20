import { ChartFigure, DataTable, Td, Th, makeScale } from "@/components/chart-kit";

/**
 * The diagrams in the FAAB guide.
 *
 * EVERY NUMBER HERE IS INVENTED unless the caption says it is a calculator
 * default. The figures teach a shape (the four bid bands, a ladder with a
 * walk-away line, a pickup priced as weeks started times points over the cut),
 * and each caption says so in words. Nothing is read from the database, so
 * nothing here can be mistaken for a live figure about a real player or a real
 * league. The measured tables the guide publishes are read at render in
 * page.tsx instead, where the sample size can travel with them.
 *
 * Every figure goes through ChartFigure, which puts the conclusion in a
 * sentence before the graphic and the plotted values in a real table under a
 * disclosure. The SVG ones mark their <svg> aria-hidden, because the sentence
 * and the table carry the meaning. The DOM-built ones (the ladder and the
 * pickup board) keep their text in the tree, so nothing about them is hidden
 * from a screen reader.
 *
 * The calculator defaults quoted here come from lib/faab/default-settings.ts:
 * the bid curve bands (elite 65 to 100 percent, high-end starter 40 to 65,
 * strong weekly starter 25 to 40, starter-level 14 to 25, useful depth 8 to 14,
 * bench 4 to 8, speculative 1 to 4, flyer 0 to 2), merged into the guide's four
 * buckets. An admin can change them, which is why every caption says "by
 * default".
 *
 * A fourth figure used to live here, drawing the old urgency ramp: 15 percent
 * off a bid through week 3, rising to a 40 percent boost from week 12. The
 * overhaul replaced that ramp with the measured calendar in
 * lib/faab/market.ts calendarMultiplier, so the figure was removed rather than
 * redrawn. The timing lesson now publishes the phase table the new bands came
 * from, live, in page.tsx.
 */

const PURPLE = "#A855F7";
const CYAN = "#22D3EE";
const INK = "#F4F4F8";
const INK_SUBTLE = "#8A8A9C";

/* ---------- Lesson 3: the four bid bands ---------- */

type Band = {
  name: string;
  range: string;
  minPct: number;
  maxPct: number;
  what: string;
};

const BANDS: Band[] = [
  {
    name: "Streamers and flyers",
    range: "0 to 4 percent",
    minPct: 0,
    maxPct: 4,
    what: "A defense or kicker for one matchup, a bye-week fill, a dart throw.",
  },
  {
    name: "Depth and stashes",
    range: "4 to 25 percent",
    minPct: 4,
    maxPct: 25,
    what: "A handcuff, an injured player coming back, a rookie with a path to a role.",
  },
  {
    name: "New weekly starter",
    range: "25 to 65 percent",
    minPct: 25,
    maxPct: 65,
    what: "A role change. A clear lineup upgrade most weeks, not a season-changer.",
  },
  {
    name: "League-winner",
    range: "65 percent and up",
    minPct: 65,
    maxPct: 100,
    what: "A full-time job just landed in his lap. He starts for you every week from here.",
  },
];

export function BidBandsFigure() {
  const W = 640;
  const H = 128;
  const x0 = 16;
  const x1 = W - 16;
  const y = 44;
  const h = 26;
  const x = makeScale(0, 100, x0, x1);
  const fills = ["#2A2A47", "#3B3B5E", CYAN, PURPLE];

  return (
    <ChartFigure
      titleLevel={3}
      title="The four kinds of pickup, as a share of what you have left"
      description="The calculator's default bid bands, merged into the four buckets this guide uses. Each bid is a share of your remaining budget, never of the 100 you started with. Drawn to scale."
      summary="By default the calculator's bands put a streamer or flyer at 0 to 4 percent of your remaining budget, depth and stashes at 4 to 25 percent, a new weekly starter at 25 to 65 percent, and a league-winner at 65 percent up to everything you have."
      table={
        <DataTable
          caption="The four bid buckets and the calculator's default range for each."
          head={
            <>
              <Th>Kind of pickup</Th>
              <Th>Share of remaining budget</Th>
              <Th>What he is</Th>
            </>
          }
        >
          {BANDS.map((b) => (
            <tr key={b.name}>
              <Td>{b.name}</Td>
              <Td>{b.range}</Td>
              <Td>{b.what}</Td>
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
        {BANDS.map((b, i) => (
          <rect
            key={b.name}
            x={x(b.minPct)}
            y={y}
            width={x(b.maxPct) - x(b.minPct)}
            height={h}
            fill={fills[i]}
            opacity={i >= 2 ? 0.9 : 1}
            stroke={i < 2 ? INK_SUBTLE : "none"}
            strokeWidth={1}
          />
        ))}
        {[0, 4, 25, 65, 100].map((tick) => (
          <text
            key={tick}
            x={x(tick)}
            y={y - 10}
            textAnchor={tick === 0 ? "start" : tick === 100 ? "end" : "middle"}
            fontSize="11"
            fontWeight={600}
            fill={INK}
          >
            {tick}%
          </text>
        ))}
        <text
          x={(x(0) + x(4)) / 2}
          y={y + h + 18}
          textAnchor="start"
          fontSize="11"
          fill={INK}
        >
          Flyers
        </text>
        <text
          x={(x(4) + x(25)) / 2}
          y={y + h + 18}
          textAnchor="middle"
          fontSize="11"
          fill={INK}
        >
          Depth
        </text>
        <text
          x={(x(25) + x(65)) / 2}
          y={y + h + 18}
          textAnchor="middle"
          fontSize="11"
          fill={INK}
        >
          New starter
        </text>
        <text
          x={(x(65) + x(100)) / 2}
          y={y + h + 18}
          textAnchor="middle"
          fontSize="11"
          fill={INK}
        >
          League-winner
        </text>
        <text
          x={x1}
          y={y + h + 36}
          textAnchor="end"
          fontSize="10"
          fill={INK_SUBTLE}
        >
          share of what you have left, not of what you started with
        </text>
      </svg>
    </ChartFigure>
  );
}

/* ---------- Lesson 5: the ladder ---------- */

type Rung = {
  label: string;
  amount: number;
  what: string;
  tone: "cyan" | "purple" | "muted";
};

const RUNGS: Rung[] = [
  {
    label: "Bid",
    amount: 27,
    what: "What usually wins, read off the other teams' wallets, how many of them need him, and what claims like this one have cleared at.",
    tone: "cyan",
  },
  {
    label: "Stretch to",
    amount: 36,
    what: "What it takes when you cannot afford to lose him. This is the number the Make sure I win goal returns.",
    tone: "purple",
  },
  {
    label: "Walk away above",
    amount: 40,
    what: "The most he is worth to your lineup. Above this line, winning is the mistake.",
    tone: "muted",
  },
];

const RUNG_TONE: Record<Rung["tone"], string> = {
  cyan: "border-brand-cyan/60 bg-brand-cyan/10",
  purple: "border-brand-purple/60 bg-brand-purple/10",
  muted: "border-line bg-base/60",
};

export function BidLadderFigure() {
  return (
    <ChartFigure
      titleLevel={3}
      title="A ladder, not a number"
      description="The three rungs the calculator returns for every claim, on an invented 71-dollar budget. The first two come from the room. The third comes from your roster, and it is the one that stops you."
      summary="For an invented claim with 71 dollars left, the ladder reads: bid 27, which usually wins; stretch to 36 when you cannot afford to lose him; walk away above 40, because past that the player is worth less than the money."
      tableLabel="View the three rungs as a table"
      table={
        <DataTable
          caption="The invented bid ladder."
          head={
            <>
              <Th>Rung</Th>
              <Th numeric>Dollars</Th>
              <Th>Where it comes from</Th>
            </>
          }
        >
          {RUNGS.map((r) => (
            <tr key={r.label}>
              <Td>{r.label}</Td>
              <Td numeric>{r.amount}</Td>
              <Td>{r.what}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <ol role="list" className="grid gap-2 sm:grid-cols-3">
        {RUNGS.map((r, i) => (
          <li
            key={r.label}
            className={`flex flex-col rounded-card border p-3 ${RUNG_TONE[r.tone]}`}
          >
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
              <span className="sr-only">Rung {i + 1}: </span>
              {r.label}
            </span>
            <span className="mt-1 font-mono text-2xl font-semibold tabular-nums text-ink">
              {r.amount}
              <span className="sr-only"> dollars</span>
            </span>
            <span className="mt-1.5 text-xs leading-relaxed text-ink-muted">
              {r.what}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-4 rounded-card border border-brand-cyan/30 bg-brand-cyan/5 px-3 py-2 text-sm text-ink">
        The first two rungs came from the other teams. The third came from you.
        Keeping them apart is the whole skill.
      </p>
    </ChartFigure>
  );
}

/* ---------- Lesson 2: weeks started times points over the cut ---------- */

export function PickupWorthFigure() {
  // Invented: a waiver back who starts every week for the rest of the season
  // over an 8-a-week flex, and the same back on a team where he never starts.
  const weeksLeft = 13;
  const hisPoints = 14;
  const cutPoints = 8;
  const gain = hisPoints - cutPoints;
  const total = gain * weeksLeft;

  return (
    <ChartFigure
      titleLevel={3}
      title="What a pickup is worth to you, in two numbers"
      description="Made-up weekly projections. The same running back is worth a lot to a team where he starts every week, and almost nothing to a team where he sits. The bid follows the second board, never the highlight."
      summary={`In this invented example the pickup projects ${hisPoints} points a week and the player you cut projects ${cutPoints}, so he adds ${gain} a week. Over ${weeksLeft} weeks as a starter that is about ${total} points, and on a team where he never starts it is zero.`}
      table={
        <DataTable
          caption="The invented arithmetic behind the two boards."
          head={
            <>
              <Th>Team</Th>
              <Th numeric>Weeks started</Th>
              <Th numeric>Points over the cut, a week</Th>
              <Th numeric>Worth to the lineup</Th>
            </>
          }
        >
          <tr>
            <Td>Needs a running back</Td>
            <Td numeric>{weeksLeft}</Td>
            <Td numeric>{gain}</Td>
            <Td numeric>{total}</Td>
          </tr>
          <tr>
            <Td>Already has three good backs</Td>
            <Td numeric>0</Td>
            <Td numeric>{gain}</Td>
            <Td numeric>0</Td>
          </tr>
        </DataTable>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-card border border-brand-cyan/60 bg-base/60 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-cyan">
            A team that needs a back
          </p>
          <dl className="mt-2 space-y-1.5 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-muted">Weeks he starts</dt>
              <dd className="font-mono tabular-nums text-ink">{weeksLeft}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-muted">Points over the cut, a week</dt>
              <dd className="font-mono tabular-nums text-ink">
                {hisPoints} minus {cutPoints}, so {gain}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t border-line pt-1.5">
              <dt className="font-semibold text-ink">Worth to the lineup</dt>
              <dd className="font-mono font-semibold tabular-nums text-brand-cyan">
                about {total} points
              </dd>
            </div>
          </dl>
        </div>
        <div className="rounded-card border border-line bg-base/60 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
            A team with three good backs
          </p>
          <dl className="mt-2 space-y-1.5 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-muted">Weeks he starts</dt>
              <dd className="font-mono tabular-nums text-ink">0</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-muted">Points over the cut, a week</dt>
              <dd className="font-mono tabular-nums text-ink">{gain}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t border-line pt-1.5">
              <dt className="font-semibold text-ink">Worth to the lineup</dt>
              <dd className="font-mono font-semibold tabular-nums text-ink-muted">
                0 points
              </dd>
            </div>
          </dl>
        </div>
      </div>
      <p className="mt-4 rounded-card border border-brand-cyan/30 bg-brand-cyan/5 px-3 py-2 text-sm text-ink">
        Same player, same Sunday, two bids that should be nothing alike. You
        cannot score points from the bench.
      </p>
    </ChartFigure>
  );
}
