/**
 * Why a dynasty claim costs more than the same claim in a redraft league.
 *
 * The page already published the market four ways, and every one of those cuts
 * pooled dynasty and redraft together. That hid the single largest split in the
 * whole dataset: the two formats price an UNCONTESTED claim almost identically
 * and diverge to nearly two to one the moment a fourth manager files, which is
 * a different statement from "dynasty bids run higher" and a more useful one.
 *
 * NOTHING HERE IS TYPED INTO THE COPY. Every figure, every ratio and every
 * sample size is read off the same `faab_market_priors` cells the calculator
 * itself prices from, through the same `MarketRow` shape and the same `pct`
 * rounding as `market-stats.tsx`. A cell below the admin's own
 * `priors.minCellSamples` renders as "Not enough data yet" rather than a number
 * nobody should act on, and a comparison with no publishable pair on either
 * side does not render at all.
 *
 * A SERVER COMPONENT. It takes the already-loaded `MarketFacts`, so it adds no
 * query to the page: the market read is made once in `page.tsx` and shared by
 * the FAQ, the market tables and this.
 *
 * THE CHART IS NOT THE ONLY PLACE THE POINT IS MADE. `ChartFigure` carries a
 * spoken summary that states the conclusion, a real table of the plotted
 * values behind a disclosure, and a visible caption. The `<svg>` is
 * `aria-hidden` per the chart-kit contract, because every mark it draws is
 * already in that table and a screen reader that read both would hear the
 * whole comparison twice.
 */

import Link from "next/link";

import { ChartFigure, DataTable, SERIES_A, SERIES_B, Td, Th, makeScale } from "@/components/chart-kit";
import { MarketTable, pct, type MarketFacts, type MarketRow } from "./market-stats";

/** One bidder count with both formats' medians beside it. */
type Pair = {
  label: string;
  redraft: MarketRow;
  dynasty: MarketRow;
};

/**
 * Zip the two lists on their shared labels.
 *
 * Only pairs where BOTH sides clear the sample minimum survive. A bar drawn
 * against a missing counterpart is a comparison with one side of it, which
 * reads as a finding and is not one.
 */
function pairsOf(facts: MarketFacts): Pair[] {
  const redraftByLabel = new Map(facts.redraftByBidders.map((row) => [row.label, row]));
  const pairs: Pair[] = [];
  for (const dynasty of facts.dynastyByBidders) {
    const redraft = redraftByLabel.get(dynasty.label);
    if (!redraft || !redraft.enough || !dynasty.enough) continue;
    pairs.push({ label: dynasty.label, redraft, dynasty });
  }
  return pairs;
}

/** "1.8 times" rather than "1.7857142857 times". */
function times(dynasty: number, redraft: number): string | null {
  if (redraft <= 0) return null;
  return `${Math.round((dynasty / redraft) * 10) / 10} times`;
}

export function DynastySection({ facts }: { facts: MarketFacts | null }) {
  if (!facts) return null;

  const pairs = pairsOf(facts);
  const positions = facts.dynastyByPosition.filter((row) => row.enough);
  // Without the comparison there is no section. The position table alone is a
  // fifth market table, not an argument about dynasty.
  if (pairs.length < 2) return null;

  const contested = pairs[pairs.length - 1];
  const uncontested = pairs[0];
  const gap = times(contested.dynasty.median, contested.redraft.median);

  const dynastyAuctions = facts.dynastyByBidders.reduce(
    (total, row) => total + row.sampleSize,
    0,
  );
  const redraftAuctions = facts.redraftByBidders.reduce(
    (total, row) => total + row.sampleSize,
    0,
  );

  // The costliest position in a contested dynasty auction, named rather than
  // assumed: the order is whatever the data says this month.
  const dearest = positions.reduce<MarketRow | null>(
    (best, row) => (best === null || row.median > best.median ? row : best),
    null,
  );
  const cheapest = positions.reduce<MarketRow | null>(
    (worst, row) => (worst === null || row.median < worst.median ? row : worst),
    null,
  );

  return (
    <section aria-labelledby="faab-dynasty" className="mt-14 sm:mt-16">
      <h2
        id="faab-dynasty"
        className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl"
      >
        How dynasty FAAB is different
      </h2>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-muted">
        Dynasty and keeper managers are not bidding on the rest of a season.
        They are bidding on a player they intend to own next year as well, out
        of a budget that does not come back. That changes what a claim is worth,
        and our own auctions show exactly where it changes and where it does
        not.
      </p>

      <div className="mt-6 space-y-8">
        <div>
          <h3 className="text-lg font-semibold tracking-tight text-ink">
            Dynasty against redraft, by how many teams bid
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-muted">
            The headline is not that dynasty bids run higher. It is that they
            run higher only when somebody else wants the player.{" "}
            {uncontested.dynasty.median <= uncontested.redraft.median ? (
              <>
                An unopposed claim clears at {pct(uncontested.dynasty.median)} of
                budget in dynasty against {pct(uncontested.redraft.median)} in
                redraft, which is the same nothing.
              </>
            ) : (
              <>
                An unopposed claim clears at {pct(uncontested.dynasty.median)} of
                budget in dynasty against {pct(uncontested.redraft.median)} in
                redraft.
              </>
            )}{" "}
            {gap && (
              <>
                With {contested.label.toLowerCase()} in, the dynasty median is{" "}
                {pct(contested.dynasty.median)} against redraft&apos;s{" "}
                {pct(contested.redraft.median)}, {gap} the price.
              </>
            )}{" "}
            The gap widens with every manager who joins, because in dynasty the
            losing bidders are not buying a rental either.
          </p>

          <div className="mt-3">
            <ChartFigure
              titleLevel={4}
              title="Median winning bid, dynasty against redraft"
              description="As a share of each league's own FAAB budget."
              summary={`Dynasty and redraft price an unopposed claim the same, and diverge as bidders join. ${pairs
                .map(
                  (pair) =>
                    `With ${pair.label.toLowerCase()} bidding, redraft ${pct(pair.redraft.median)} and dynasty ${pct(pair.dynasty.median)}`,
                )
                .join(". ")}.`}
              tableLabel="View the medians drawn above"
              table={
                <DataTable
                  caption="Median winning bid by number of bidders in redraft against dynasty and keeper leagues, as a share of the league's budget."
                  head={
                    <>
                      <Th>Teams bidding</Th>
                      <Th numeric>Redraft</Th>
                      <Th numeric>Dynasty</Th>
                    </>
                  }
                >
                  {pairs.map((pair) => (
                    <tr key={pair.label}>
                      <Td>{pair.label}</Td>
                      <Td numeric>{pct(pair.redraft.median)}</Td>
                      <Td numeric>{pct(pair.dynasty.median)}</Td>
                    </tr>
                  ))}
                </DataTable>
              }
            >
              <PairedBars pairs={pairs} />
            </ChartFigure>
          </div>

          <div className="mt-3">
            <MarketTable
              caption="Winning bids in dynasty and keeper leagues by number of bidders, as a share of the league's budget."
              firstColumn="Teams bidding, dynasty"
              rows={facts.dynastyByBidders}
            />
          </div>
        </div>

        {positions.length >= 2 && dearest && cheapest && dearest !== cheapest && (
          <div>
            <h3
              id="faab-dynasty-position"
              className="text-lg font-semibold tracking-tight text-ink"
            >
              Dynasty by position, when 3 or more teams bid
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-muted">
              {dearest.label} is the costliest contested claim in our dynasty
              leagues at {pct(dearest.median)} of budget, against{" "}
              {pct(cheapest.median)} for {cheapest.label}.
              {facts.dynastySuperflexShare !== null && (
                <>
                  {" "}
                  {Math.round(facts.dynastySuperflexShare * 100)}% of these
                  claims came from superflex leagues, where a second starting
                  quarterback is the one hole on a roster nobody can stream
                  their way out of.
                </>
              )}
            </p>
            <div className="mt-3">
              <MarketTable
                caption="Winning bids in dynasty and keeper leagues by position in contested auctions, as a share of the league's budget."
                firstColumn="Position"
                rows={facts.dynastyByPosition}
              />
            </div>
          </div>
        )}

        <div>
          <h3 className="text-lg font-semibold tracking-tight text-ink">
            Three things that move a dynasty bid
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Point heading="The budget does not come back">
              On Sleeper a FAAB budget never resets or rolls over on its own: a
              commissioner has to do it by hand. In a league where nobody
              remembers to, every dollar you spend in October is gone for good,
              and in a league where waivers run through the offseason it also
              has to cover the rookies who go undrafted.
            </Point>
            <Point heading="You are buying the player, not the week">
              A redraft claim buys the weeks between now and the final. A
              dynasty claim buys those weeks and then the player. That is why a
              22-year-old who will not start until December is worth real money
              here and nothing at all in redraft, and why the two formats only
              agree on the claims nobody else wants.
            </Point>
            <Point heading="Who is asking changes the answer">
              The same receiver is a different buy for a team chasing a title
              and a team stockpiling picks. Connect your league and the
              calculator reads your position in it, then weights his market
              value against what he adds to your lineup: more asset for a
              rebuild, more lineup for a contender.
            </Point>
          </div>
        </div>
      </div>

      <p className="mt-6 max-w-3xl text-sm leading-relaxed text-ink-muted">
        Figures above come from {dynastyAuctions.toLocaleString()} priced
        dynasty and keeper auctions and {redraftAuctions.toLocaleString()}{" "}
        redraft auctions across the Sleeper leagues synced to FF Beacon, seasons{" "}
        {facts.seasonMin} to {facts.seasonMax}. Building a roster rather than
        pricing one claim? Our{" "}
        <Link
          href="/guides/dynasty-strategy"
          className="font-medium text-brand-cyan underline underline-offset-2 hover:text-brand-cyan/80"
        >
          dynasty strategy guide
        </Link>{" "}
        covers the rest.
      </p>
    </section>
  );
}

/** One of the three notes. A card, so the row reads as a set rather than prose. */
function Point({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-base/40 p-4">
      <h4 className="text-sm font-semibold text-ink">{heading}</h4>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{children}</p>
    </div>
  );
}

/**
 * The paired bars.
 *
 * Horizontal, two bars per bidder count, because the comparison is the point
 * and a reader's eye compares lengths from a shared left edge far more reliably
 * than heights from a shared baseline.
 *
 * EVERY BAR CARRIES ITS SERIES NAME AS TEXT, in its own column to the left of
 * the bar, rather than relying on the legend and the hue. Colour alone is not a
 * label, and "the top one of each pair" is not either: it fails the moment a
 * pair is dropped for thin data and the ordering a reader inferred shifts.
 */
function PairedBars({ pairs }: { pairs: Pair[] }) {
  // THE viewBox WIDTH IS A MOBILE DECISION, not a desktop one. An SVG with a
  // viewBox scales to its container, so the ratio of text size to chart size is
  // fixed by these numbers and nothing else: a 600-wide box rendered into a
  // 360px phone column draws 12px labels at 7px. Keeping the box narrow and the
  // type large is what makes the same markup legible at both ends, and it is
  // why the figures here are not the pixel sizes they look like.
  const groupWidth = 86;
  const seriesWidth = 52;
  const barStart = groupWidth + seriesWidth;
  const width = 480;
  const barHeight = 17;
  const innerGap = 5;
  const groupGap = 15;
  const groupHeight = barHeight * 2 + innerGap;
  const height = pairs.length * (groupHeight + groupGap) + groupGap;

  const max = Math.max(...pairs.flatMap((p) => [p.redraft.median, p.dynasty.median]), 1);
  // Room on the right for the longest value label ("10.5%") at this type size.
  const x = makeScale(0, max, barStart, width - 52);

  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto w-full"
    >
      {pairs.map((pair, index) => {
        const top = groupGap + index * (groupHeight + groupGap);
        const rows = [
          { name: "Redraft", row: pair.redraft, fill: SERIES_A },
          { name: "Dynasty", row: pair.dynasty, fill: SERIES_B },
        ];
        return (
          <g key={pair.label}>
            <text
              x={0}
              y={top + groupHeight / 2 + 4}
              fontSize={13}
              fill="#F4F4F8"
            >
              {pair.label}
            </text>
            {rows.map((entry, row) => {
              const y = top + row * (barHeight + innerGap);
              // A floor of 2, so a median of zero is still a visible mark
              // rather than a blank line a reader reads as missing data.
              const barWidth = Math.max(2, x(entry.row.median) - barStart);
              return (
                <g key={entry.name}>
                  <text
                    x={barStart - 7}
                    y={y + barHeight / 2 + 4}
                    fontSize={12}
                    textAnchor="end"
                    fill="#A8A8B8"
                  >
                    {entry.name}
                  </text>
                  <rect
                    x={barStart}
                    y={y}
                    width={barWidth}
                    height={barHeight}
                    fill={entry.fill}
                    opacity={0.9}
                    rx={3}
                  />
                  <text
                    x={barStart + barWidth + 7}
                    y={y + barHeight / 2 + 4}
                    fontSize={12}
                    fill="#F4F4F8"
                  >
                    {pct(entry.row.median)}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
