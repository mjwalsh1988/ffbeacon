/**
 * Section 6.5: trading.
 *
 * Trade count and trades per season are scale-free, so they read straight
 * through `underLens` like the Results section does. Everything else here is
 * priced in league value, so it goes through `PerTypePair`
 * (docs/manager-pulse-plan.md section 6.0): dynasty and redraft never pool,
 * and under the All lens both render side by side rather than one standing in
 * for the other.
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
import { formatCount, formatRate, formatSample, formatSigned } from "./format";
import { underLens } from "@/components/manager-shell/lens";
import type { LensCounts } from "@/components/manager-shell/lens";
import { PerTypePair } from "./per-type-pair";
import { TRADE_POSITIONS, TRADE_POSITION_LABEL, type TradePosition } from "@/lib/trade-finder/types";
import type {
  LeagueLens,
  ManagerTrading,
  OverpayEntry,
  PositionAppetite,
  TradePartnerEntry,
  TradeVerdictCounts,
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

  return (
    <SectionFrame id="trading" title="Trading" eyebrow="Section 5" accent="purple">
      <div className="grid grid-cols-2 gap-3">
        <StatTile
          label="Trades"
          value={tradeCount === null ? null : formatCount(tradeCount)}
          emptyReason="No trades in this window"
        />
        <StatTile
          label="Trades per season"
          value={tradesPerSeason === null ? null : formatRate(tradesPerSeason)}
          emptyReason="No trades in this window"
        />
      </div>

      <PerTypePair
        lens={lens}
        label="Average trade margin"
        stat={trading.avgValueMargin}
        sampleStat={trading.avgValueMarginSampleSize}
        sampleNoun="trade"
        typeCounts={typeCounts}
        emptyReason="Not enough graded trades"
        render={(v) => (
          <>
            <span className="font-mono text-lg font-bold tabular-nums text-ink">
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
        render={(verdicts) => <VerdictList counts={verdicts} />}
      />

      <PerTypePair
        lens={lens}
        label="Position appetite"
        stat={trading.positionAppetite}
        typeCounts={typeCounts}
        emptyReason="Not enough graded trades"
        render={(shape) => <PositionAppetiteList shape={shape} />}
      />

      <PerTypePair
        lens={lens}
        label="Picks traded"
        stat={trading.picksTraded}
        typeCounts={typeCounts}
        emptyReason="No trades in this window"
        render={(v) => (
          <span className="font-mono text-lg font-bold tabular-nums text-ink">{formatCount(v)}</span>
        )}
      />

      <PerTypePair
        lens={lens}
        label="Most traded with"
        stat={trading.mostTradedWith}
        typeCounts={typeCounts}
        emptyReason="Not enough trades to say"
        render={(entries) => <TradePartnerList entries={entries} />}
      />

      <div>
        <PerTypePair
          lens={lens}
          label="Who they overpay for"
          stat={trading.overpays}
          typeCounts={typeCounts}
          emptyReason="Not enough graded trades yet to call it a pattern"
          render={(entries) => <OverpayList entries={entries} />}
        />
        <p className="mt-1 text-xs leading-relaxed text-ink-subtle">
          Only shown once there is enough evidence to call it a pattern, not one bad trade.
        </p>
      </div>

      <div>
        <PerTypePair
          lens={lens}
          label="Trades with unpriced picks"
          stat={trading.tradesWithUnpricedPicks}
          typeCounts={typeCounts}
          emptyReason="No trades in this window"
          render={(v) => (
            <span className="font-mono text-lg font-bold tabular-nums text-ink">{formatCount(v)}</span>
          )}
        />
        <p className="mt-1 text-xs leading-relaxed text-ink-subtle">
          These trades moved a pick the value source cannot price, so they are graded on their
          players only. The margin above is partial for them, not wrong.
        </p>
      </div>

      <AgeLean trading={trading} lens={lens} />
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
        Age lean
        <span className="ml-2 text-xs font-normal text-ink-subtle">(Dynasty only)</span>
      </h3>
      {!applies ? (
        <p className="mt-1 text-xs text-ink-muted">Does not apply to redraft leagues.</p>
      ) : trading.ageLean === null ? (
        <p className="mt-1 text-xs text-ink-muted">Not enough dynasty trades in this window.</p>
      ) : (
        <>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-mono text-lg font-bold tabular-nums text-ink">
              {formatSigned(trading.ageLean, "%")}
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

function VerdictList({ counts }: { counts: TradeVerdictCounts }) {
  const entries = Object.entries(counts).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0,
  );
  if (entries.length === 0) {
    return <p className="text-xs text-ink-muted">No graded trades yet</p>;
  }
  return (
    <ul className="space-y-1 text-sm text-ink">
      {entries.map(([verdict, n]) => (
        <li key={verdict} className="flex items-baseline justify-between gap-2">
          <span className="capitalize">{verdict.replace(/_/g, " ")}</span>
          <span className="font-mono tabular-nums text-ink-muted">{n}</span>
        </li>
      ))}
    </ul>
  );
}

/* --------------------------------------------------------- position shape */

function PositionAppetiteList({ shape }: { shape: PositionAppetite }) {
  const entries = TRADE_POSITIONS.map((position) => [position, shape[position]] as const).filter(
    (entry): entry is [TradePosition, number] => typeof entry[1] === "number",
  );
  if (entries.length === 0) {
    return <p className="text-xs text-ink-muted">Not enough graded trades</p>;
  }
  return (
    <ul className="space-y-1 text-sm text-ink">
      {entries.map(([position, value]) => (
        <li key={position} className="flex items-baseline justify-between gap-2">
          <span>{TRADE_POSITION_LABEL[position]}</span>
          <span className="font-mono tabular-nums text-ink-muted">
            {value >= 0 ? "Buying" : "Selling"} {formatSigned(value)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* --------------------------------------------------------- trade partners */

function TradePartnerList({ entries }: { entries: TradePartnerEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-xs text-ink-muted">No repeat trade partners yet</p>;
  }
  return (
    <ul className="space-y-1 text-sm text-ink">
      {entries.map((entry) => (
        <li key={entry.sleeperUserId} className="flex items-baseline justify-between gap-2">
          {/* A counterparty with no known handle is an honest placeholder,
              never an invented name and never dropped from the list. */}
          <span>{entry.handle ?? "Unknown Sleeper user"}</span>
          <span className="font-mono tabular-nums text-ink-muted">
            {entry.tradeCount} trade{entry.tradeCount === 1 ? "" : "s"}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------- overpays */

function OverpayList({ entries }: { entries: OverpayEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-xs text-ink-muted">No clear overpay pattern yet</p>;
  }
  return (
    <ul className="space-y-1 text-sm text-ink">
      {entries.map((entry) => (
        <li
          key={`${entry.subject}-${entry.playerId ?? "none"}`}
          className="flex items-baseline justify-between gap-2"
        >
          <span>{entry.subjectLabel}</span>
          <span className="font-mono tabular-nums text-ink-muted">
            {formatSigned(entry.avgMarginPct, "%")} across {entry.sampleSize} trade
            {entry.sampleSize === 1 ? "" : "s"}
          </span>
        </li>
      ))}
    </ul>
  );
}
