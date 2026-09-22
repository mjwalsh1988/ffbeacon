/**
 * The diagrams on the waiver wire hub.
 *
 * TWO KINDS OF NUMBER LIVE HERE AND EVERY CAPTION SAYS WHICH IT IS.
 *
 *   - MEASURED FROM OUR OWN LEAGUES. `ClearingPriceFigure` draws
 *     `faab_market_priors`, the anonymous clearing-price quantiles built from
 *     every waiver auction in every league synced to the site. It is read at
 *     render through `lib/guides/faab-market-figures.ts`, never typed out, and
 *     a cell under the calculator's own publishing threshold prints
 *     "Not enough data yet" rather than a figure nobody should stand behind.
 *   - PLATFORM RULES. `ProcessingTable` and the priority comparison are each
 *     platform's own published defaults, linked at the point of use.
 *
 * Every figure goes through ChartFigure: the conclusion in a sentence before
 * the graphic, and the plotted values in a real table under a disclosure. The
 * SVG one marks its `<svg>` aria-hidden because the sentence and the table
 * carry the meaning. The DOM-built one keeps every label in the tree.
 *
 * NOTHING HERE ENCODES MEANING IN COLOUR ALONE. The two bidding systems are
 * told apart by their headings and their rows, not by their hue, and the price
 * bars carry their value as text beside them.
 */

import { ChartFigure, DataTable, Td, Th, makeScale } from "@/components/chart-kit";
import {
  NOT_ENOUGH,
  moneyPctText,
  pctText,
  sampleText,
  shareText,
  type MarketRead,
} from "@/lib/guides/faab-market-figures";

const CYAN = "#22D3EE";
const PURPLE = "#A855F7";
const INK_SUBTLE = "#8A8A9C";
const LINE = "#2A2A47";

/* ------------------------------------------------------------------ *
 * What a contested claim actually clears at
 * ------------------------------------------------------------------ */

export type ClearingSlice = { label: string; read: MarketRead | null };

/**
 * The price of a claim against how many people wanted him.
 *
 * The single most useful number on this page, and the one nobody else can
 * publish: not what a pundit thinks a player is worth, but what claims like
 * this one have actually settled at across every league we hold. The bars are
 * medians; the table under them carries the upper quantiles, because the
 * median is what you pay to win a normal one and the 90th is what you pay to
 * win the one everybody wants.
 *
 * A slice below the publishing threshold is drawn as an empty track with the
 * words in place of the bar, rather than dropped, so the shape of what we do
 * and do not know is visible.
 */
export function ClearingPriceFigure({
  slices,
  budget,
}: {
  slices: ClearingSlice[];
  budget: number;
}) {
  const usable = slices.filter((s) => s.read?.enough);
  const max = Math.max(4, ...usable.map((s) => s.read?.p90 ?? 0));

  const W = 640;
  const rowH = 46;
  const H = slices.length * rowH + 30;
  const padL = 132;
  const padR = 56;
  const x = makeScale(0, max, padL, W - padR);

  const solo = slices[0]?.read;
  const crowd = slices.at(-1)?.read;

  const summary =
    usable.length === 0
      ? "We do not yet hold enough waiver auctions to publish clearing prices by how many teams were bidding."
      : `Measured across every league synced to FF Beacon, an uncontested claim clears near ${
          solo?.enough ? moneyPctText(solo.p50, budget) : "nothing"
        } while a claim four or more teams wanted clears near ${
          crowd?.enough ? moneyPctText(crowd.p50, budget) : "several times that"
        }. The number of rivals bidding moves the price more than anything else about the player.`;

  return (
    <ChartFigure
      titleLevel={3}
      title="What a waiver claim actually costs, by how many teams wanted him"
      description={`Median winning bid as a share of the league's whole budget, shown as dollars in a $${budget} budget. Measured from real waiver auctions in leagues synced to FF Beacon, not from anybody's opinion.`}
      summary={summary}
      tableLabel="View the prices behind this chart"
      table={
        <DataTable
          caption="Median, 75th and 90th percentile winning bids by number of bidding teams, as a share of the league's whole budget."
          head={
            <>
              <Th>Teams bidding</Th>
              <Th numeric>Median</Th>
              <Th numeric>75th</Th>
              <Th numeric>90th</Th>
              <Th>Sample</Th>
            </>
          }
        >
          {slices.map((slice) => (
            <tr key={slice.label}>
              <Td>{slice.label}</Td>
              <Td numeric>
                {slice.read?.enough ? moneyPctText(slice.read.p50, budget) : NOT_ENOUGH}
              </Td>
              <Td numeric>
                {slice.read?.enough ? moneyPctText(slice.read.p75, budget) : NOT_ENOUGH}
              </Td>
              <Td numeric>
                {slice.read?.enough ? moneyPctText(slice.read.p90, budget) : NOT_ENOUGH}
              </Td>
              <Td>{slice.read ? sampleText(slice.read) : "No auctions yet"}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <div aria-hidden="true" className="overflow-x-auto">
        <div className="min-w-[30rem]">
          <svg aria-hidden="true" viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
            {slices.map((slice, i) => {
              const cy = i * rowH + 26;
              const read = slice.read;
              const enough = !!read?.enough;
              const p50 = read?.p50 ?? 0;
              const p90 = read?.p90 ?? 0;
              return (
                <g key={slice.label}>
                  <text x={padL - 10} y={cy + 4} textAnchor="end" fontSize="12" fill={INK_SUBTLE}>
                    {slice.label}
                  </text>
                  {/* The track, so an empty slice still reads as a row. */}
                  <rect
                    x={padL}
                    y={cy - 10}
                    width={W - padR - padL}
                    height={20}
                    fill={LINE}
                    opacity={0.35}
                    rx={4}
                  />
                  {enough ? (
                    <>
                      {/* The 90th percentile, faint, behind the median. */}
                      <rect
                        x={padL}
                        y={cy - 10}
                        width={Math.max(2, x(p90) - padL)}
                        height={20}
                        fill={PURPLE}
                        opacity={0.28}
                        rx={4}
                      />
                      <rect
                        x={padL}
                        y={cy - 10}
                        width={Math.max(2, x(p50) - padL)}
                        height={20}
                        fill={CYAN}
                        opacity={0.85}
                        rx={4}
                      />
                      <text
                        x={Math.min(W - 6, x(p90) + 8)}
                        y={cy + 4}
                        fontSize="12"
                        fill={INK_SUBTLE}
                      >
                        {pctText(p50)}
                      </text>
                    </>
                  ) : (
                    <text x={padL + 10} y={cy + 4} fontSize="11" fill={INK_SUBTLE}>
                      {NOT_ENOUGH}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </ChartFigure>
  );
}

/* ------------------------------------------------------------------ *
 * Priority against FAAB
 * ------------------------------------------------------------------ */

type ComparisonRow = { question: string; priority: string; faab: string };

const COMPARISON: ComparisonRow[] = [
  {
    question: "How is a tie broken?",
    priority: "It cannot tie. One manager is higher in the queue and they get him.",
    faab: "By waiver priority, or a coin flip, depending on the league. This is why an odd bid wins claims a round one loses.",
  },
  {
    question: "What does winning cost you?",
    priority: "Your place in the queue. You drop to the back and stay there until you climb again.",
    faab: "Money you cannot get back, and nothing else. Your position next week is unchanged.",
  },
  {
    question: "Can you win two in a week?",
    priority: "Rarely. Using priority once usually sends you to the bottom before the next claim processes.",
    faab: "Yes, as many as your budget covers. Every claim is priced on its own.",
  },
  {
    question: "What is the skill?",
    priority: "Patience. Knowing which player is worth spending your spot in line on.",
    faab: "Pricing. Knowing what a player is worth in dollars, and what your rivals can still afford.",
  },
  {
    question: "What runs out?",
    priority: "Nothing. Priority regenerates every time somebody else uses theirs.",
    faab: "The budget. A dollar in week two and a dollar in week fourteen are not the same money.",
  },
];

/**
 * The two systems, side by side.
 *
 * Built from DOM rather than SVG on purpose: every cell is a sentence, and a
 * picture of sentences is a picture nobody can read aloud. It goes through
 * ChartFigure anyway so it keeps the summary and the same furniture as the
 * charts around it, and its "table" disclosure is the same content in a
 * genuinely tabular shape for a reader navigating by column.
 */
export function PriorityVsFaabFigure() {
  return (
    <ChartFigure
      titleLevel={3}
      title="Waiver priority and FAAB are different games"
      description="The two systems your league might use, and what each one actually asks you to spend."
      summary="Waiver priority is a queue: the manager highest in the order gets the player and usually drops to the back for using it, so the question is whether he is worth your spot in line. FAAB is a blind auction: everyone bids from a season-long budget, the highest bid wins, and the question is what he is worth in dollars you cannot get back."
      tableLabel="View this comparison as a table"
      table={
        <DataTable
          caption="Waiver priority compared with FAAB bidding, across five questions."
          head={
            <>
              <Th>Question</Th>
              <Th>Waiver priority</Th>
              <Th>FAAB</Th>
            </>
          }
        >
          {COMPARISON.map((row) => (
            <tr key={row.question}>
              <Td>{row.question}</Td>
              <Td>{row.priority}</Td>
              <Td>{row.faab}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-card border border-line bg-base/50 p-4">
          <h4 className="text-sm font-semibold text-ink">Waiver priority</h4>
          <p className="mt-1 text-xs leading-relaxed text-ink-subtle">
            A queue. Also called rolling waivers or the waiver order.
          </p>
          <ul role="list" className="mt-3 space-y-2.5">
            {COMPARISON.map((row) => (
              <li key={row.question} className="text-sm leading-relaxed">
                <span className="block text-xs font-semibold uppercase tracking-[0.1em] text-brand-purple">
                  {row.question}
                </span>
                <span className="text-ink-muted">{row.priority}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-card border border-brand-cyan/30 bg-brand-cyan/[0.04] p-4">
          <h4 className="text-sm font-semibold text-ink">FAAB</h4>
          <p className="mt-1 text-xs leading-relaxed text-ink-subtle">
            A blind auction. Free agent acquisition budget.
          </p>
          <ul role="list" className="mt-3 space-y-2.5">
            {COMPARISON.map((row) => (
              <li key={row.question} className="text-sm leading-relaxed">
                <span className="block text-xs font-semibold uppercase tracking-[0.1em] text-brand-cyan">
                  {row.question}
                </span>
                <span className="text-ink-muted">{row.faab}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </ChartFigure>
  );
}

/* ------------------------------------------------------------------ *
 * When claims actually run
 * ------------------------------------------------------------------ */

export type ProcessingRow = {
  platform: string;
  day: string;
  defaultSystem: string;
  note: string;
  href: string;
};

/**
 * Each platform's published defaults.
 *
 * Every figure is the platform's own, linked under the table, and every row
 * says "by default" in its note because a commissioner can change all of it.
 * The shape of this question ("when do waivers clear") is one of the most
 * searched and most often answered wrongly, usually by a page that assumes
 * everybody is on ESPN.
 */
export const PROCESSING_ROWS: ProcessingRow[] = [
  {
    platform: "Sleeper",
    day: "Wednesday, early morning",
    defaultSystem: "FAAB in most league templates, priority available",
    note: "Commissioners commonly move it to Tuesday night or turn on daily waivers. Sleeper also offers a waiver budget with a minimum bid a league can set above zero.",
    href: "https://support.sleeper.com/en/articles/3891585-waivers",
  },
  {
    platform: "Yahoo",
    day: "Wednesday, early morning",
    defaultSystem: "Waiver priority, with a continual rolling option",
    note: "Yahoo calls FAAB an auction budget and it is off unless the commissioner turns it on. Yahoo leagues also default to a two-day waiver period on newly dropped players.",
    href: "https://help.yahoo.com/kb/fantasy-football/SLN6796.html",
  },
  {
    platform: "ESPN",
    day: "Wednesday, early morning",
    defaultSystem: "Waiver priority by reverse standings",
    note: "ESPN's FAAB option is per league and the budget defaults to $100 when it is enabled. Standard ESPN leagues also re-run waivers on Thursday for players dropped after Wednesday.",
    href: "https://support.espn.com/hc/en-us/articles/360000067592-Waivers",
  },
  {
    platform: "NFL.com",
    day: "Wednesday, early morning",
    defaultSystem: "Waiver priority, with FAAB available",
    note: "Reverse-order priority by default, resetting weekly rather than rolling, which changes the calculation on whether to spend it.",
    href: "https://support.nfl.com/hc/en-us/articles/4408906134548",
  },
];

export function ProcessingFigure({ rows = PROCESSING_ROWS }: { rows?: ProcessingRow[] }) {
  return (
    <ChartFigure
      titleLevel={3}
      title="When waivers process, by platform"
      description="Each platform's published default. Every one of these is something your commissioner can change, so check your own league settings before you rely on a deadline."
      summary="All four major platforms clear waivers early on Wednesday morning by default, so a claim entered any time from Tuesday runs overnight. What differs is the system underneath: Sleeper leans on FAAB, while Yahoo, ESPN and NFL.com default to a waiver priority queue with FAAB as an option the commissioner turns on."
      tableLabel="View the platform defaults as a table"
      table={
        <DataTable
          caption="Default waiver processing day and bidding system, by fantasy platform, from each platform's own support pages."
          head={
            <>
              <Th>Platform</Th>
              <Th>Processes</Th>
              <Th>Default system</Th>
            </>
          }
        >
          {rows.map((row) => (
            <tr key={row.platform}>
              <Td>{row.platform}</Td>
              <Td>{row.day}</Td>
              <Td>{row.defaultSystem}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <ul role="list" className="grid gap-3 sm:grid-cols-2">
        {rows.map((row) => (
          <li key={row.platform} className="rounded-card border border-line bg-base/50 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h4 className="text-sm font-semibold text-ink">{row.platform}</h4>
              <span className="text-xs font-medium text-brand-cyan">{row.day}</span>
            </div>
            <p className="mt-1.5 text-xs font-medium text-ink-muted">{row.defaultSystem}</p>
            <p className="mt-2 text-xs leading-relaxed text-ink-subtle">{row.note}</p>
            <a
              href={row.href}
              rel="nofollow noopener"
              target="_blank"
              className="mt-2.5 inline-flex min-h-11 items-center text-xs font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              {row.platform}&apos;s own waiver rules
              <span className="sr-only">, opens in a new tab</span>
            </a>
          </li>
        ))}
      </ul>
    </ChartFigure>
  );
}

/* ------------------------------------------------------------------ *
 * How often a claim costs nothing at all
 * ------------------------------------------------------------------ */

/**
 * The share of winning claims that cleared for zero.
 *
 * The one statistic that changes how a beginner plays. Most waiver claims are
 * uncontested and cost nothing, which means the budget exists for the handful
 * that are not, and hoarding it all season is the mistake rather than the
 * discipline.
 */
export function FreeClaimFigure({ read, budget }: { read: MarketRead | null; budget: number }) {
  const enough = !!read?.enough;
  const free = enough ? read.zeroShare : null;

  return (
    <ChartFigure
      titleLevel={3}
      title="Most waiver claims cost nothing"
      description="The share of winning claims that cleared at zero, across every waiver auction in the leagues synced to FF Beacon."
      summary={
        enough && free != null
          ? `${shareText(free)} of winning waiver claims cleared for nothing at all, because nobody else put in for that player. The budget is not for those. It is for the small number of weeks when somebody's job changes and four managers want the same name, where the median winning bid is ${moneyPctText(read.p50, budget)}.`
          : "We do not yet hold enough waiver auctions to publish how often a claim clears for nothing."
      }
      tableLabel="View the numbers behind this"
      table={
        <DataTable
          caption="Share of winning waiver claims that cleared at zero, and the median winning bid, across all measured auctions."
          head={
            <>
              <Th>Figure</Th>
              <Th numeric>Value</Th>
            </>
          }
        >
          <tr>
            <Td>Winning claims that cost nothing</Td>
            <Td numeric>{enough && free != null ? shareText(free) : NOT_ENOUGH}</Td>
          </tr>
          <tr>
            <Td>Median winning bid, all claims</Td>
            <Td numeric>{enough ? moneyPctText(read.p50, budget) : NOT_ENOUGH}</Td>
          </tr>
          <tr>
            <Td>Sample</Td>
            <Td>{read ? sampleText(read) : "No auctions yet"}</Td>
          </tr>
        </DataTable>
      }
    >
      {enough && free != null ? (
        <div>
          <div
            aria-hidden="true"
            className="h-6 w-full overflow-hidden rounded-full border border-line bg-base"
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.round(free * 100)}%`,
                backgroundImage: `linear-gradient(90deg, ${CYAN} 0%, ${PURPLE} 100%)`,
              }}
            />
          </div>
          <p className="mt-2 flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-mono text-xl font-bold tabular-nums text-brand-cyan">
              {shareText(free)}
            </span>
            <span className="text-ink-muted">of winning claims cleared for nothing</span>
          </p>
        </div>
      ) : (
        <p className="text-sm text-ink-subtle">{NOT_ENOUGH}</p>
      )}
    </ChartFigure>
  );
}
