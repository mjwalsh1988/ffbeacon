/**
 * Section 6.5: trading.
 *
 * Trade count and trades per season are scale-free, so they read straight
 * through `underLens` like the Results section does. Everything else here is
 * priced in league value, so it goes through `PerTypePair`
 * (docs/manager-pulse/manager-pulse-plan.md section 6.0): dynasty and redraft never pool,
 * and under the All lens both render side by side rather than one standing in
 * for the other.
 *
 * LAYOUT: TWO COLUMNS FROM `lg`, AND WHAT PAIRS WITH WHAT IS DELIBERATE.
 * Every card here used to be full width, so a chart with five rows in it was
 * given a whole desktop screen and read as a stub floating in space. The
 * pairings are by question, not by height: the verdict distribution and the
 * position appetite are both "what shape are their deals", the two pick cards
 * are both "which way do picks flow", and the two pattern cards (what they pay
 * up for, what they get value on) are the same measurement with the sign
 * flipped and belong beside each other.
 *
 * `ageLean` is the one field on `ManagerTrading` that is neither a
 * `PoolableStat` nor a `PerTypeStat`: it is a plain nullable number that only
 * exists in dynasty. It gets its own block, built the same way
 * `drafting-section.tsx`'s `RookieVeteranLean` builds its dynasty-only block
 * (a hand-rolled card with "(Dynasty only)" folded into its own heading, not
 * `SectionFrame`'s `typeExclusive`, which labels a whole section rather than
 * one block inside a mixed one), so the two dynasty-only figures in this
 * report read as the same pattern.
 */

import { SectionFrame } from "./section-frame";
import { StatTile } from "./stat-tile";
import { RankedBars, DivergingBars, StackedShareBar } from "./charts";
import type { RankedBarRow, DivergingRow, ShareSegment } from "./charts";
import {
  formatCompactValue,
  formatCount,
  formatPercent,
  formatRate,
  formatSample,
  formatSigned,
} from "./format";
import { underLens } from "@/components/manager-shell/lens";
import type { LensCounts } from "@/components/manager-shell/lens";
import { PerTypePair } from "./per-type-pair";
import { TRADE_POSITIONS, TRADE_POSITION_LABEL, type TradePosition } from "@/lib/trade-finder/types";
import {
  POSITION_BADGE,
  POSITION_BADGE_FALLBACK,
  normalizePositionColor,
} from "@/lib/on-the-clock/position-colors";
import {
  TRADE_VERDICT_BUCKETS,
  type LeagueLens,
  type ManagerTrading,
  type OverpayEntry,
  type PickFlow,
  type PositionAppetite,
  type TradePartnerEntry,
  type TradeVerdictBucket,
  type TradeVerdictCounts,
} from "@/lib/manager-pulse/types";

export function TradingSection({
  trading,
  counts,
  lens,
}: {
  trading: ManagerTrading;
  /**
   * League-seasons of each type this manager has, full stop, independent of
   * whether any given trading figure could be computed for them.
   * `PerTypePair` needs this to tell "never played this game" apart from
   * "played it, not enough graded trades yet".
   */
  counts: LensCounts;
  lens: LeagueLens;
}) {
  const tradeCount = underLens(trading.tradeCount, lens);
  const tradesPerSeason = underLens(trading.tradesPerSeason, lens);
  const typeCounts = { dynasty: counts.dynasty, redraft: counts.redraft };

  // "178 trades a season" is true and unreadable: a manager in thirty leagues
  // trades constantly, and the figure says more about how many leagues they
  // joined than about how they play. Trades per league-season is the one that
  // compares between two managers. Both are shown; neither replaces the other.
  // Plain division over two figures already on the page, the same way the
  // lineup-efficiency coverage line in RosterOpsSection divides two of them.
  const leagueSeasonsForLens =
    lens === "dynasty"
      ? counts.dynasty
      : lens === "redraft"
        ? counts.redraft
        : counts.leagueSeasons;
  const perLeagueSeason =
    tradeCount === null || leagueSeasonsForLens <= 0
      ? null
      : tradeCount / leagueSeasonsForLens;

  return (
    <SectionFrame id="trading" title="Trading" accent="purple">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile
          label="Trades"
          value={tradeCount === null ? null : formatCount(tradeCount)}
          size="hero"
          sub="Every trade in this window, graded or not."
          emptyReason="No trades in this window"
        />
        <StatTile
          label="Per league-season"
          value={perLeagueSeason === null ? null : formatRate(perLeagueSeason)}
          sub="The figure that compares between managers."
          emptyReason="No league-seasons in this window"
        />
        <StatTile
          label="Per season"
          value={tradesPerSeason === null ? null : formatRate(tradesPerSeason)}
          sub="Across every league they play at once, not per league."
          emptyReason="No trades in this window"
        />
      </div>

      {/* HOW DO THEIR DEALS TURN OUT. `items-start` throughout these rows so a
          short card next to a tall one keeps its own height instead of
          stretching to match and leaving a pane of empty surface. */}
      <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
        <PerTypePair
          lens={lens}
          label="Average trade margin"
          stat={trading.avgValueMargin}
          sampleStat={trading.avgValueMarginSampleSize}
          sampleNoun="trade"
          typeCounts={typeCounts}
          emptyReason="Not enough graded trades"
          stackSides
          render={(v) => (
            <>
              <span
                className={`font-mono text-3xl font-extrabold tabular-nums ${
                  v < 0 ? "text-signal-warning" : "text-signal-success"
                }`}
              >
                {formatSigned(v, "%")}
              </span>
              <p className="mt-0.5 text-xs text-ink-muted">
                Negative means they give up more than they get, priced at market.
              </p>
            </>
          )}
        />

        <PerTypePair
          lens={lens}
          label="Verdict distribution"
          stat={trading.verdictDistribution}
          typeCounts={typeCounts}
          emptyReason="Not enough graded trades"
          stackSides
          render={(verdicts) => <VerdictChart counts={verdicts} />}
        />
      </div>

      {/* WHICH ASSETS DO THEY MOVE. Position appetite prices players; the pick
          flow counts picks. Two halves of the same question. */}
      <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
        <PerTypePair
          lens={lens}
          label="Position appetite"
          stat={trading.positionAppetite}
          typeCounts={typeCounts}
          emptyReason="Not enough graded trades"
          stackSides
          render={(shape) => <PositionAppetiteChart shape={shape} />}
        />

        <PerTypePair
          lens={lens}
          label="Draft picks traded"
          stat={trading.pickFlow}
          typeCounts={typeCounts}
          emptyReason="No trades in this window"
          stackSides
          render={(flow) => <PickFlowPanel flow={flow} />}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
        <PerTypePair
          lens={lens}
          label="Most traded with"
          stat={trading.mostTradedWith}
          typeCounts={typeCounts}
          emptyReason="Not enough trades to say"
          stackSides
          render={(entries) => <TradePartnerChart entries={entries} />}
        />

        <div className="space-y-3">
          <AgeLean trading={trading} lens={lens} />
          <div>
            <PerTypePair
              lens={lens}
              label="Trades with unpriced picks"
              stat={trading.tradesWithUnpricedPicks}
              typeCounts={typeCounts}
              emptyReason="No trades in this window"
              stackSides
              render={(v) => (
                <span className="font-mono text-2xl font-bold tabular-nums text-ink">
                  {formatCount(v)}
                </span>
              )}
            />
            <p className="mt-1 text-xs leading-relaxed text-ink-subtle">
              These trades moved a pick the value source cannot price, so they are graded on
              their players only. The margin above is partial for them, not wrong.
            </p>
          </div>
        </div>
      </div>

      {/* THE SAME MEASUREMENT, BOTH SIGNS. Beside each other on purpose:
          together they are the two halves of "what should I offer them". */}
      <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
        <div>
          <PerTypePair
            lens={lens}
            label="What they pay up for"
            stat={trading.overpays}
            typeCounts={typeCounts}
            emptyReason="Not enough graded trades yet to call it a pattern"
            stackSides
            render={(entries) => <PatternCards entries={entries} direction="overpay" />}
          />
          <p className="mt-1 text-xs leading-relaxed text-ink-subtle">
            Only shown once there is enough evidence to call it a pattern, not one bad trade.
          </p>
        </div>

        <div>
          <PerTypePair
            lens={lens}
            label="What they get value on"
            stat={trading.bargains}
            typeCounts={typeCounts}
            emptyReason="Not enough graded trades yet to call it a pattern"
            stackSides
            render={(entries) => <PatternCards entries={entries} direction="bargain" />}
          />
          <p className="mt-1 text-xs leading-relaxed text-ink-subtle">
            The same measurement with the sign flipped. Think twice before selling these to them
            cheaply.
          </p>
        </div>
      </div>
    </SectionFrame>
  );
}

/* ---------------------------------------------------------------- age lean */

function AgeLean({ trading, lens }: { trading: ManagerTrading; lens: LeagueLens }) {
  const applies = lens !== "redraft";
  const sampleNote = formatSample(trading.ageLeanSampleSize, "trade");

  return (
    <div className="rounded-card border border-line bg-base/40 px-3 py-2.5">
      <h3 className="text-sm font-semibold text-ink">
        Age lean, in years
        <span className="ml-2 text-xs font-normal text-ink-subtle">(Dynasty only)</span>
      </h3>
      {!applies ? (
        <p className="mt-1 text-xs text-ink-muted">Does not apply to redraft leagues.</p>
      ) : trading.ageLean === null ? (
        <p className="mt-1 text-xs text-ink-muted">Not enough dynasty trades in this window.</p>
      ) : (
        <>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm">
            {/* YEARS, NOT PERCENT. This is a value-weighted mean of how far
                from 26 the players on each side of their trades are, so its
                unit is years of age. A percent sign turned "net value moves
                toward players 0.2 years younger" into what looked like a
                share of something. */}
            <span className="font-mono text-2xl font-bold tabular-nums text-ink">
              {formatSigned(trading.ageLean, "years")}
            </span>
            <span className="text-xs text-ink-muted">
              Positive means net value flows toward younger players.
            </span>
          </p>
          {sampleNote && <p className="mt-1 text-[11px] text-ink-subtle">{sampleNote}</p>}
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- verdicts */

/**
 * The six buckets in a fixed order, best outcome first, as one split bar.
 *
 * FIXED ORDER, NOT OBJECT ORDER. A distribution whose rows arrive in whatever
 * sequence the counting loop filled the object in cannot be compared against
 * the same card on another manager's report.
 *
 * This card used to count Signal Check's verdict SENTENCE, which carries the
 * margin inside it, so a manager with 251 graded trades got a 251-row
 * distribution in which almost every count was 1. See lib/manager-pulse/
 * trading.ts verdictBucketFor for the buckets that replaced it.
 */
const VERDICT_LABEL: Record<TradeVerdictBucket, string> = {
  clear_win: "Clear win for them",
  slight_win: "Slight win for them",
  even: "Even",
  slight_loss: "Slight loss for them",
  clear_loss: "Clear loss for them",
  ungraded: "Could not be graded",
};

const VERDICT_BAR: Record<TradeVerdictBucket, string> = {
  clear_win: "bg-signal-success",
  slight_win: "bg-signal-success/55",
  even: "bg-ink-subtle/60",
  slight_loss: "bg-signal-warning/55",
  clear_loss: "bg-signal-warning",
  ungraded: "bg-line-accent",
};

function VerdictChart({ counts }: { counts: TradeVerdictCounts }) {
  const segments: ShareSegment[] = TRADE_VERDICT_BUCKETS.map((bucket) => ({
    key: bucket,
    labelText: VERDICT_LABEL[bucket],
    count: counts[bucket] ?? 0,
    barClass: VERDICT_BAR[bucket],
  }));

  if (segments.every((segment) => segment.count === 0)) {
    return <p className="text-xs text-ink-muted">No graded trades yet</p>;
  }

  // The headline is the share they came out ahead on, because that is the one
  // number a reader is actually looking for in a distribution of outcomes.
  const graded = segments
    .filter((segment) => segment.key !== "ungraded")
    .reduce((sum, segment) => sum + segment.count, 0);
  const wins = (counts.clear_win ?? 0) + (counts.slight_win ?? 0);

  return (
    <div>
      {graded > 0 && (
        <p className="mb-2.5 flex items-baseline gap-2">
          <span className="font-mono text-3xl font-extrabold tabular-nums text-brand-cyan">
            {formatPercent(wins / graded)}
          </span>
          <span className="text-xs text-ink-muted">
            of their {formatCount(graded)} graded trades came out ahead
          </span>
        </p>
      )}
      <StackedShareBar segments={segments} />
    </div>
  );
}

/* --------------------------------------------------------- position shape */

/**
 * Net value bought minus sold, per position, as bars either side of zero.
 *
 * THE FIGURE IS COMPACT AND THE DIRECTION IS A WORD. The raw sum runs to six
 * digits (a manager with three hundred trades moves hundreds of thousands of
 * points of market value), and printed in full beside "Selling" it read as an
 * account balance rather than as a lean. The absolute number is league value
 * and means nothing next to another manager's; the direction and the relative
 * size are the whole content, which is what a diverging bar draws.
 */
function PositionAppetiteChart({ shape }: { shape: PositionAppetite }) {
  const entries = TRADE_POSITIONS.map((position) => [position, shape[position]] as const).filter(
    (entry): entry is [TradePosition, number] => typeof entry[1] === "number" && entry[1] !== 0,
  );
  if (entries.length === 0) {
    return <p className="text-xs text-ink-muted">Not enough graded trades</p>;
  }

  const rows: DivergingRow[] = entries.map(([position, value]) => ({
    key: position,
    labelText: TRADE_POSITION_LABEL[position],
    value,
    display: `${value >= 0 ? "Buying" : "Selling"} ${formatCompactValue(value)}`,
  }));

  const leader = [...entries].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];

  return (
    <div>
      <p className="mb-2.5 text-xs text-ink-muted">
        Their strongest lean is{" "}
        <span className="font-semibold text-ink">
          {leader[1] >= 0 ? "buying" : "selling"} {TRADE_POSITION_LABEL[leader[0]].toLowerCase()}
        </span>
        .
      </p>
      <DivergingBars rows={rows} />
    </div>
  );
}

/* -------------------------------------------------------------- pick flow */

/**
 * Picks in, picks out, and which rounds they were.
 *
 * A single "picks traded" count was one card on its own that could not tell a
 * manager who buys picks from one who sells them, and those are opposite
 * strategies. Two accent figures and a diverging bar per round say both.
 */
function PickFlowPanel({ flow }: { flow: PickFlow }) {
  const total = flow.acquired + flow.sent;
  if (total === 0) {
    return <p className="text-xs text-ink-muted">No picks have moved in this window.</p>;
  }

  const net = flow.acquired - flow.sent;
  const rows: DivergingRow[] = flow.byRound.map((row) => ({
    key: `round-${row.round ?? "later"}`,
    labelText:
      row.round === null
        ? `Round ${flow.laterFromRound ?? "?"} and later`
        : `Round ${row.round}`,
    // The bar draws the NET, and the figure states both halves, because a net
    // of zero can mean "no picks moved in this round" or "three each way" and
    // those are different facts about a manager.
    value: row.acquired - row.sent,
    display: `${row.acquired} in, ${row.sent} out`,
  }));

  // Counted picks and counted ROUNDS are different denominators: Sleeper does
  // not publish a round on every traded pick, and a chart that silently drew
  // fewer picks than the figure above it would look like an arithmetic error.
  const roundsMissing = total - flow.roundsKnown;

  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        <MiniFigure label="Picks moved" value={formatCount(total)} tone="accent" />
        <MiniFigure label="Acquired" value={formatCount(flow.acquired)} tone="good" />
        <MiniFigure label="Sent away" value={formatCount(flow.sent)} tone="warn" />
      </div>

      <p className="mt-2.5 text-xs text-ink-muted">
        {net === 0
          ? "They finish level on picks: as many in as out."
          : net > 0
            ? `Net buyers of picks, ${formatCount(net)} more in than out.`
            : `Net sellers of picks, ${formatCount(-net)} more out than in.`}
      </p>

      {rows.length > 0 ? (
        <div className="mt-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
            By round, net
          </h4>
          <div className="mt-1.5">
            {/* Wide enough for "Round 7 and later", which is the longest label
                this chart can produce. A narrower column truncated it to
                "Round 7 and ...", which reads as a different claim. */}
            <DivergingBars rows={rows} labelWidthClass="sm:w-32" />
          </div>
        </div>
      ) : (
        <p className="mt-2 text-xs text-ink-subtle">
          Sleeper published no round on these picks, so there is no per-round split.
        </p>
      )}

      {roundsMissing > 0 && rows.length > 0 && (
        <p className="mt-2 text-[11px] text-ink-subtle">
          {formatCount(roundsMissing)} of these picks carried no round from Sleeper and are counted
          above but not in the split.
        </p>
      )}
    </div>
  );
}

function MiniFigure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "accent" | "good" | "warn";
}) {
  const toneClass =
    tone === "accent"
      ? "text-brand-cyan"
      : tone === "good"
        ? "text-signal-success"
        : "text-signal-warning";
  return (
    <div className="rounded-card border border-line bg-surface/40 px-2.5 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">{label}</p>
      <p className={`mt-0.5 font-mono text-2xl font-extrabold tabular-nums ${toneClass}`}>
        {value}
      </p>
    </div>
  );
}

/* --------------------------------------------------------- trade partners */

/**
 * Who they deal with, as a ranked bar chart, plus how concentrated it is.
 *
 * Concentration is the useful part and it was not on the page at all: a
 * manager whose deals are spread across fifteen counterparties will talk to
 * anyone, and one who has made two thirds of their trades with the same
 * partner probably will not talk to you. The list is capped on screen and the
 * rest sits behind a disclosure, because twenty rows of "4 trades" was the
 * empty space this card was mostly made of.
 */
const PARTNERS_SHOWN = 8;

function TradePartnerChart({ entries }: { entries: TradePartnerEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-xs text-ink-muted">No repeat trade partners yet</p>;
  }

  const total = entries.reduce((sum, entry) => sum + entry.tradeCount, 0);
  const topThree = entries.slice(0, 3).reduce((sum, entry) => sum + entry.tradeCount, 0);

  const toRow = (entry: TradePartnerEntry, index: number): RankedBarRow => {
    // A counterparty with no known handle is an honest placeholder, never an
    // invented name and never dropped from the list.
    const name = entry.handle ?? "Unknown Sleeper user";
    return {
      key: entry.sleeperUserId,
      label: name,
      value: entry.tradeCount,
      display: `${entry.tradeCount}`,
      lead: index === 0,
      barClass: index === 0 ? "bg-beacon" : "bg-brand-cyan/60",
    };
  };

  const shown = entries.slice(0, PARTNERS_SHOWN).map(toRow);
  const rest = entries.slice(PARTNERS_SHOWN).map(toRow);

  return (
    <div>
      <p className="mb-2.5 flex items-baseline gap-2">
        <span className="font-mono text-3xl font-extrabold tabular-nums text-brand-cyan">
          {formatPercent(topThree / total)}
        </span>
        <span className="text-xs text-ink-muted">
          of these trades were with their top {Math.min(3, entries.length)} partner
          {entries.length === 1 ? "" : "s"}
        </span>
      </p>

      <RankedBars rows={shown} labelWidthClass="sm:w-36" />

      {rest.length > 0 && (
        <details className="group mt-2">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-xs font-semibold text-brand-cyan transition-colors hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">
            <span className="group-open:hidden">Show the other {rest.length}</span>
            <span className="hidden group-open:inline">Show fewer</span>
          </summary>
          <div className="mt-2">
            <RankedBars rows={rest} labelWidthClass="sm:w-36" />
          </div>
        </details>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- patterns */

/**
 * What they pay up for, and what they get value on, as cards.
 *
 * A row of "Kyren Williams -35.2% across 3 trades" is the finding stated and
 * nothing else. What a manager reading this actually wants is the move it
 * implies, so each card says it: a subject they pay up for is one to offer
 * them, and a subject they get value on is one to be careful selling.
 *
 * PLAYERS AND POSITIONS ARE SEPARATED. They come from two independent
 * groupings and answer different questions: a player row is a trade target, a
 * position row is a standing habit. Mixed into one list a reader cannot tell a
 * name from a category without already knowing every player in the league.
 */
function PatternCards({
  entries,
  direction,
}: {
  entries: OverpayEntry[];
  direction: "overpay" | "bargain";
}) {
  if (entries.length === 0) {
    return (
      <p className="text-xs text-ink-muted">
        {direction === "overpay"
          ? "No clear overpay pattern yet"
          : "No clear bargain pattern yet"}
      </p>
    );
  }

  const players = entries.filter((entry) => entry.kind === "player");
  const positions = entries.filter((entry) => entry.kind === "position");

  return (
    <div className="space-y-3">
      {players.length > 0 && (
        <PatternGroup heading="Players" entries={players} direction={direction} />
      )}
      {positions.length > 0 && (
        <PatternGroup heading="Positions" entries={positions} direction={direction} />
      )}
    </div>
  );
}

const PATTERN_SHOWN = 4;

function PatternGroup({
  heading,
  entries,
  direction,
}: {
  heading: string;
  entries: OverpayEntry[];
  direction: "overpay" | "bargain";
}) {
  const shown = entries.slice(0, PATTERN_SHOWN);
  const rest = entries.slice(PATTERN_SHOWN);

  return (
    <div>
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
        {heading}
      </h4>
      <ul className="mt-1.5 space-y-1.5">
        {shown.map((entry) => (
          <PatternCard key={`${entry.subject}-${entry.playerId ?? "none"}`} entry={entry} direction={direction} />
        ))}
      </ul>
      {rest.length > 0 && (
        <details className="group mt-1.5">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-xs font-semibold text-brand-cyan transition-colors hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">
            <span className="group-open:hidden">Show the other {rest.length}</span>
            <span className="hidden group-open:inline">Show fewer</span>
          </summary>
          <ul className="mt-1.5 space-y-1.5">
            {rest.map((entry) => (
              <PatternCard
                key={`${entry.subject}-${entry.playerId ?? "none"}`}
                entry={entry}
                direction={direction}
              />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function PatternCard({
  entry,
  direction,
}: {
  entry: OverpayEntry;
  direction: "overpay" | "bargain";
}) {
  const colorKey = normalizePositionColor(entry.position);
  const badgeClass = colorKey ? POSITION_BADGE[colorKey] : POSITION_BADGE_FALLBACK;
  const magnitude = formatPercent(Math.abs(entry.avgMarginPct) / 100, 0);

  return (
    <li className="rounded-card border border-line bg-surface/40 px-3 py-2">
      <div className="flex items-center gap-2">
        {entry.position && (
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${badgeClass}`}
          >
            {entry.position}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
          {entry.subjectLabel}
        </span>
        <span
          className={`shrink-0 font-mono text-xl font-extrabold tabular-nums ${
            direction === "overpay" ? "text-signal-warning" : "text-signal-success"
          }`}
        >
          {magnitude}
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
        {direction === "overpay"
          ? `They come out ${magnitude} behind market when this is in the deal, across ${entry.sampleSize} graded trade${entry.sampleSize === 1 ? "" : "s"}. Good to offer them.`
          : `They come out ${magnitude} ahead of market when this is in the deal, across ${entry.sampleSize} graded trade${entry.sampleSize === 1 ? "" : "s"}. Be careful selling this cheaply.`}
      </p>
    </li>
  );
}
