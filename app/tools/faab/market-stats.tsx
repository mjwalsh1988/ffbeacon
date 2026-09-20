/**
 * What leagues actually pay.
 *
 * The one place on the site that publishes the market behind the calculator:
 * every priced winning bid we hold, as a share of each league's own budget,
 * cut four ways. A reader who does not trust the recommendation can check the
 * recommendation against the room it came from.
 *
 * A SERVER COMPONENT, AND IT HAS TO BE. `loadPriorCellsCached` pulls next/cache
 * and a Supabase client, so it must never reach a client component. The
 * calculator's own browser-side pricing goes through the pure maths in
 * lib/faab/priors-math.ts and one cell fetched by a server action instead.
 *
 * NOTHING HERE IS TYPED INTO THE COPY. Every figure, including the league
 * count, the seasons covered and the build date, is read off the cells. A cell
 * below the admin's own `priors.minCellSamples` renders "Not enough data yet"
 * rather than a number nobody should act on, and a table whose every row is
 * that thin does not render at all. The sample size sits in its own column on
 * every row, so a reader can see what each figure rests on.
 */

import {
  ChartFigure,
  DataTable,
  SERIES_B,
  Td,
  Th,
  makeScale,
} from "@/components/chart-kit";
import { formatEasternDate } from "@/lib/datetime";
import { loadPriorCellsCached } from "@/lib/faab/priors-read";
import type { PriorCell } from "@/lib/faab/priors-math";

/** One row of one table: a label, three quantiles and what they rest on. */
export type MarketRow = {
  label: string;
  sampleSize: number;
  median: number;
  p75: number;
  p90: number;
  /** False when the cell is below the admin's minimum sample size. */
  enough: boolean;
};

export type MarketFacts = {
  leagues: number;
  auctions: number;
  seasonMin: number;
  seasonMax: number;
  builtAt: string;
  /** Median of winning bid over runner-up bid. Null when no contested pairs. */
  runnerUpRatio: number | null;
  byBidders: MarketRow[];
  byPhase: MarketRow[];
  byPosition: MarketRow[];
  chopped: MarketRow[];
};

const BIDDER_ROWS: Array<[string, string]> = [
  ["any|any|any|any|1", "1 team"],
  ["any|any|any|any|2", "2 teams"],
  ["any|any|any|any|3", "3 teams"],
  ["any|any|any|any|4p", "4 or more teams"],
];

const PHASE_ROWS: Array<[string, string]> = [
  ["any|any|any|wk1|any", "Week 1"],
  ["any|any|any|wk2_6|any", "Weeks 2 to 6"],
  ["any|any|any|wk7_10|any", "Weeks 7 to 10"],
  ["any|any|any|wk11_13|any", "Weeks 11 to 13"],
  ["any|any|any|wk14p|any", "Week 14 and later"],
];

const POSITION_ROWS: Array<[string, string]> = [
  ["any|no|QB|any|3", "QB, one-quarterback league"],
  ["any|yes|QB|any|3", "QB, superflex"],
  ["any|any|RB|any|3", "RB"],
  ["any|any|WR|any|3", "WR"],
  ["any|any|TE|any|3", "TE"],
];

const CHOPPED_ROWS: Array<[string, string]> = [
  ["chopped|any|any|alive_50p|any", "Half the field or more still alive"],
  ["chopped|any|any|alive_30_50|any", "30 to 50% still alive"],
  ["chopped|any|any|alive_lt30|any", "Under 30% still alive"],
];

function rowsFor(
  byKey: Map<string, PriorCell>,
  spec: Array<[string, string]>,
  minCellSamples: number,
): MarketRow[] {
  const rows: MarketRow[] = [];
  for (const [key, label] of spec) {
    const cell = byKey.get(key);
    if (!cell) continue;
    rows.push({
      label,
      sampleSize: cell.sampleSize,
      median: cell.p50,
      p75: cell.p75,
      p90: cell.p90,
      enough: cell.sampleSize >= minCellSamples,
    });
  }
  return rows;
}

/**
 * Read the market once.
 *
 * Returns null when the priors have never been built, which is the state a
 * fresh environment starts in. The page renders nothing rather than a section
 * of empty tables, and the FAQ falls back to a sentence with no figures in it.
 */
export async function loadMarketFacts(
  minCellSamples: number,
): Promise<MarketFacts | null> {
  const cells = await loadPriorCellsCached();
  if (cells.length === 0) return null;

  const byKey = new Map(cells.map((cell) => [cell.cellKey, cell]));
  const all = byKey.get("any|any|any|any|any");
  if (!all || all.sampleSize === 0) return null;

  const seasons = all.seasons.length > 0 ? all.seasons : [0];

  return {
    leagues: all.leaguesCount,
    auctions: all.sampleSize,
    seasonMin: Math.min(...seasons),
    seasonMax: Math.max(...seasons),
    builtAt: all.builtAt,
    runnerUpRatio: all.runnerUpRatioP50,
    byBidders: rowsFor(byKey, BIDDER_ROWS, minCellSamples),
    byPhase: rowsFor(byKey, PHASE_ROWS, minCellSamples),
    byPosition: rowsFor(byKey, POSITION_ROWS, minCellSamples),
    chopped: rowsFor(byKey, CHOPPED_ROWS, minCellSamples),
  };
}

/** A share of the budget, without the float noise a quantile can carry. */
function pct(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

function ratio(value: number): string {
  return String(Math.round(value * 10) / 10);
}

export function MarketStats({ facts }: { facts: MarketFacts | null }) {
  if (!facts) return null;

  return (
    <section aria-labelledby="faab-market-stats" className="mt-14 sm:mt-16">
      <h2
        id="faab-market-stats"
        className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl"
      >
        What leagues actually pay
      </h2>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-muted">
        Winning FAAB bids from {facts.leagues.toLocaleString()} Sleeper leagues
        synced to FF Beacon, seasons {facts.seasonMin} to {facts.seasonMax}, as
        a share of each league&apos;s budget. Updated{" "}
        {formatEasternDate(facts.builtAt)}. No league or manager is
        identifiable.
      </p>

      <div className="mt-6 space-y-8">
        <BiddersBlock rows={facts.byBidders} />
        <TableBlock
          id="faab-market-phase"
          heading="By week of the season"
          caption="Median and upper-end winning bids by stretch of the season, as a share of the league's budget."
          firstColumn="Time of season"
          rows={facts.byPhase}
        />
        <TableBlock
          id="faab-market-position"
          heading="By position, when 3 or more teams bid"
          caption="Median and upper-end winning bids by position in contested auctions, as a share of the league's budget. Quarterbacks are split by whether the league starts one or two."
          firstColumn="Position"
          rows={facts.byPosition}
        />
        <TableBlock
          id="faab-market-chopped"
          heading="Chopped and guillotine leagues, by teams left"
          caption="Median and upper-end winning bids in chopped and guillotine leagues by how much of the field is still alive, as a share of the league's budget."
          firstColumn="Field still alive"
          rows={facts.chopped}
        />
      </div>

      {facts.runnerUpRatio !== null && (
        <p className="mt-6 max-w-3xl text-sm leading-relaxed text-ink-muted">
          Winners paid a median of {ratio(facts.runnerUpRatio)} times the
          second-highest bid. That gap is why the calculator prices the
          competition rather than the player alone.
        </p>
      )}
    </section>
  );
}

/**
 * Table 1, with the bar chart the plan asks for.
 *
 * The chart's own disclosure carries the medians it draws, per the ChartFigure
 * contract, and the full table with the upper quantiles and the sample sizes
 * follows underneath. The two are the same medians read at two depths rather
 * than two versions of one figure.
 */
function BiddersBlock({ rows }: { rows: MarketRow[] }) {
  const usable = rows.filter((row) => row.enough);
  if (usable.length === 0) return null;

  const max = Math.max(...usable.map((row) => row.median), 1);
  const barHeight = 26;
  const gap = 10;
  const labelWidth = 120;
  const width = 520;
  const height = usable.length * (barHeight + gap) + gap;
  const x = makeScale(0, max, labelWidth, width - 56);

  const summary = `Median winning bid rises with the number of bidders: ${usable
    .map((row) => `${row.label.toLowerCase()} ${pct(row.median)}`)
    .join(", ")}.`;

  return (
    <div>
      <h3 className="text-lg font-semibold tracking-tight text-ink">
        By how many teams bid
      </h3>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-muted">
        The single biggest thing that decides what a claim costs is how many
        other managers file one.
      </p>

      <div className="mt-3">
        <ChartFigure
          titleLevel={4}
          title="Median winning bid by number of bidders"
          summary={summary}
          tableLabel="View the medians drawn above"
          table={
            <DataTable
              caption="Median winning bid by number of bidders, as a share of the league's budget."
              head={
                <>
                  <Th>Teams bidding</Th>
                  <Th numeric>Median</Th>
                </>
              }
            >
              {usable.map((row) => (
                <tr key={row.label}>
                  <Td>{row.label}</Td>
                  <Td numeric>{pct(row.median)}</Td>
                </tr>
              ))}
            </DataTable>
          }
        >
          <svg
            role="img"
            aria-label={`Horizontal bar chart of the median winning bid for ${usable.length} bidder counts, the bars growing from ${pct(usable[0].median)} to ${pct(usable[usable.length - 1].median)} of the budget.`}
            viewBox={`0 0 ${width} ${height}`}
            className="h-auto w-full"
          >
            {usable.map((row, index) => {
              const y = gap + index * (barHeight + gap);
              const barWidth = Math.max(2, x(row.median) - labelWidth);
              return (
                <g key={row.label}>
                  <text
                    x={0}
                    y={y + barHeight / 2 + 4}
                    fontSize={12}
                    fill="#A8A8B8"
                  >
                    {row.label}
                  </text>
                  <rect
                    x={labelWidth}
                    y={y}
                    width={barWidth}
                    height={barHeight}
                    fill={SERIES_B}
                    opacity={0.85}
                    rx={3}
                  />
                  <text
                    x={labelWidth + barWidth + 8}
                    y={y + barHeight / 2 + 4}
                    fontSize={12}
                    fill="#F4F4F8"
                  >
                    {pct(row.median)}
                  </text>
                </g>
              );
            })}
          </svg>
        </ChartFigure>
      </div>

      <div className="mt-3">
        <MarketTable
          caption="Winning bids by number of bidders, as a share of the league's budget."
          firstColumn="Teams bidding"
          rows={rows}
        />
      </div>
    </div>
  );
}

function TableBlock({
  id,
  heading,
  caption,
  firstColumn,
  rows,
}: {
  id: string;
  heading: string;
  caption: string;
  firstColumn: string;
  rows: MarketRow[];
}) {
  // A table where every row is too thin to publish is not a table, it is four
  // apologies in a grid.
  if (rows.length === 0 || rows.every((row) => !row.enough)) return null;

  return (
    <div>
      <h3 id={id} className="text-lg font-semibold tracking-tight text-ink">
        {heading}
      </h3>
      <div className="mt-3">
        <MarketTable caption={caption} firstColumn={firstColumn} rows={rows} />
      </div>
    </div>
  );
}

/**
 * One table, four columns, no column dropped at any width.
 *
 * The figures are short (a percentage and a count), so all four fit at phone
 * width with the label column wrapping. A row we cannot publish keeps its
 * sample size and says why in the space the numbers would have used.
 */
function MarketTable({
  caption,
  firstColumn,
  rows,
}: {
  caption: string;
  firstColumn: string;
  rows: MarketRow[];
}) {
  return (
    <table className="w-full border-collapse text-left text-xs sm:text-sm">
      <caption className="mb-2 text-left text-xs leading-relaxed text-ink-subtle">
        {caption}
      </caption>
      <thead>
        <tr className="border-b border-line text-[10px] uppercase tracking-wide text-ink-subtle">
          <th scope="col" className="py-1.5 pr-2 font-semibold">
            {firstColumn}
          </th>
          <th scope="col" className="py-1.5 pr-2 text-right font-semibold">
            Median
          </th>
          <th scope="col" className="py-1.5 pr-2 text-right font-semibold">
            1 in 4 paid more than
          </th>
          <th scope="col" className="py-1.5 pr-2 text-right font-semibold">
            1 in 10 paid more than
          </th>
          <th scope="col" className="py-1.5 text-right font-semibold">
            Auctions
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line/60">
        {rows.map((row) => (
          <tr key={row.label}>
            <th scope="row" className="py-2 pr-2 text-left font-medium text-ink">
              {row.label}
            </th>
            {row.enough ? (
              <>
                <td className="py-2 pr-2 text-right tabular-nums text-ink-muted">
                  {pct(row.median)}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums text-ink-muted">
                  {pct(row.p75)}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums text-ink-muted">
                  {pct(row.p90)}
                </td>
              </>
            ) : (
              <td colSpan={3} className="py-2 pr-2 text-right text-ink-subtle">
                Not enough data yet
              </td>
            )}
            <td className="py-2 text-right tabular-nums text-ink-muted">
              {row.sampleSize.toLocaleString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
