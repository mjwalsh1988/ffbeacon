"use client";

/**
 * Trade History tab - a mini Signal Check for every trade in the league.
 *
 * Lists each completed trade newest-first with a per-side FF Beacon value
 * breakdown and a plain-English verdict, paginated with a "Show more" control that
 * reveals the next batch. All values come from lib/on-the-clock/trade-history.ts
 * (pure), fed the board the cockpit already holds; picks already made are valued by
 * the player taken, future picks are projected from the board and flagged estimated.
 * NOTHING here calls Sleeper, Supabase, or any API: the raw trades + board context
 * arrive as props.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, RefreshCw, Scale, Sparkles, TrendingUp } from "lucide-react";
import { formatEastern } from "@/lib/datetime";
import {
  analyzeTradeTransaction,
  type HistoryEntry,
  type HistorySide,
  type HistoryTransaction,
  type HistoryVerdict,
  type TradeHistoryContext,
} from "@/lib/on-the-clock/trade-history";
import { LoadingCard, ErrorCard, EmptyCard } from "./states";

/** How many trades to reveal per "Show more" press (and on first paint). */
const PAGE_SIZE = 10;

export function TradeHistory({
  transactions,
  context,
  loading,
  error,
  boardReady,
  formatLabel,
  truncated = false,
  onRefresh,
}: {
  transactions: HistoryTransaction[];
  context: TradeHistoryContext | null;
  loading: boolean;
  error: string | null;
  boardReady: boolean;
  formatLabel: string;
  truncated?: boolean;
  onRefresh: () => void;
}) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const countRef = useRef<HTMLParagraphElement>(null);
  // Set when the user presses "Show more" so focus lands on the count line after the
  // reveal (the button itself unmounts on the final batch, which would otherwise drop
  // focus to the body).
  const pendingFocus = useRef(false);

  // A new league (or a refresh that changes the trade set) resets pagination so the
  // user always starts at the most recent batch.
  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [transactions]);

  // Move focus to the count line after a "Show more" reveal.
  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    countRef.current?.focus();
  }, [visible]);

  // Only the visible slice is analyzed, so a long trade history stays cheap and the
  // "Show more" control does real, incremental work.
  const visibleEntries = useMemo<HistoryEntry[]>(() => {
    if (!context) return [];
    return transactions.slice(0, visible).map((t) => analyzeTradeTransaction(t, context));
  }, [transactions, context, visible]);

  const total = transactions.length;
  const shown = Math.min(visible, total);
  const canShowMore = shown < total;
  const ready = !loading && !error && boardReady && context != null;

  const showMore = () => {
    pendingFocus.current = true;
    setVisible((v) => v + PAGE_SIZE);
  };

  return (
    <section aria-labelledby="otc-history-title" className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="otc-history-title"
            className="flex items-center gap-2 text-xl font-bold tracking-tight text-ink sm:text-2xl"
          >
            <ArrowLeftRight aria-hidden="true" className="h-5 w-5 text-brand-cyan" />
            Trade History
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Every trade in this league, each one run through a mini FF Beacon value check.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-purple/40 bg-brand-purple/10 px-3 py-1 text-xs font-semibold text-brand-purple">
            <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
            FF Beacon, {formatLabel}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface/60 px-3 py-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshCw
              aria-hidden="true"
              className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </div>
      </div>

      {/* Persistent polite region: stays mounted across the loading -> loaded
          transition so screen readers hear when the trades have arrived. It only
          reflects the load outcome (not the visible count), so "Show more" never
          retriggers it. */}
      <p className="sr-only" role="status" aria-live="polite">
        {ready ? (total === 0 ? "No trades found." : `Loaded ${total} ${total === 1 ? "trade" : "trades"}.`) : ""}
      </p>

      {loading ? (
        <LoadingCard label="Loading trades from Sleeper..." />
      ) : error ? (
        <div className="space-y-3">
          <ErrorCard message={error} />
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-3 py-2 text-sm font-semibold text-ink hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Try again
          </button>
        </div>
      ) : !boardReady || !context ? (
        <EmptyCard
          title="Trade values are not available yet."
          body="Trade History needs this format's FF Beacon board. Each trade gets a value breakdown once it loads."
        />
      ) : total === 0 ? (
        <EmptyCard
          title="No trades yet."
          body="Every trade in this league shows up here with a value check."
        />
      ) : (
        <>
          <ul role="list" className="space-y-4">
            {visibleEntries.map((entry) => (
              <li key={entry.transactionId}>
                <TradeCard entry={entry} />
              </li>
            ))}
          </ul>

          <div className="flex flex-col items-center gap-2 pt-1">
            <p
              ref={countRef}
              tabIndex={-1}
              aria-live="polite"
              aria-atomic="true"
              className="text-xs text-ink-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Showing {shown} of {total} {total === 1 ? "trade" : "trades"}
              {truncated ? " (most recent)" : ""}
            </p>
            {canShowMore && (
              <button
                type="button"
                onClick={showMore}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-brand-cyan/50 bg-brand-cyan/10 px-4 py-2 text-sm font-semibold text-brand-cyan transition-colors hover:bg-brand-cyan/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <TrendingUp aria-hidden="true" className="h-4 w-4" />
                Show more trades
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function verdictAccent(lean: HistoryVerdict["lean"]): string {
  if (lean === "fair") return "text-brand-cyan";
  if (lean === "empty") return "text-ink-muted";
  return "text-brand-purple";
}

function TradeCard({ entry }: { entry: HistoryEntry }) {
  const { verdict } = entry;
  const when = entry.createdAt ? formatEastern(new Date(entry.createdAt).toISOString()) : null;
  // Concise accessible name from the visible eyebrow + verdict headline (referenced,
  // not duplicated). The full detail sentence reads as the card's own content below,
  // so we never restate it as the region name.
  const baseId = `otc-trade-${entry.transactionId}`;

  return (
    <article
      aria-labelledby={`${baseId}-label ${baseId}-verdict`}
      className="relative overflow-hidden rounded-modal border border-line bg-surface/50"
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
        }}
      />

      {/* Header: when + the verdict headline. */}
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line/70 px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <p
            id={`${baseId}-label`}
            className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-cyan"
          >
            <Scale aria-hidden="true" className="h-3 w-3" />
            Trade
            {entry.week != null && (
              <span className="text-ink-subtle">{`Week ${entry.week}`}</span>
            )}
          </p>
          <p
            id={`${baseId}-verdict`}
            className={`mt-0.5 text-base font-bold tracking-tight ${verdictAccent(verdict.lean)}`}
          >
            {verdict.headline}
          </p>
        </div>
        {when && (
          <time className="shrink-0 text-xs text-ink-subtle" dateTime={new Date(entry.createdAt!).toISOString()}>
            {when}
          </time>
        )}
      </div>

      {/* Sides. Two-up on sm+, stacked on mobile (no data hidden). */}
      <div className="grid gap-3 px-4 py-4 sm:px-5 sm:grid-cols-2">
        {entry.sides.map((side) => (
          <SideCard key={side.rosterId} side={side} />
        ))}
      </div>

      {/* Verdict detail + caveats. */}
      <div className="border-t border-line/70 px-4 py-3 sm:px-5">
        <p className="text-sm leading-relaxed text-ink">{verdict.detail}</p>
        {(entry.hasEstimates || entry.hasMissingValues) && (
          <p className="mt-2 text-xs text-ink-subtle">
            {entry.hasEstimates && "Picks marked est. are board projections. "}
            {entry.hasMissingValues && "Assets shown as n/a had no FF Beacon value to count."}
          </p>
        )}
      </div>
    </article>
  );
}

function SideCard({ side }: { side: HistorySide }) {
  // A plain div (not a labeled section) so dozens of trades don't flood the screen
  // reader's landmark list. The visible team name + "Received {total}" already convey
  // everything the label would have.
  return (
    <div
      className={`rounded-card border bg-base/50 p-3 ${
        side.leads ? "border-brand-purple/50" : "border-line"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-sm font-bold text-ink">
            <span className="truncate">{side.teamName}</span>
            {side.isYou && (
              <span className="shrink-0 rounded-full border border-brand-cyan/40 bg-brand-cyan/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-cyan">
                You
              </span>
            )}
          </p>
          {side.leads && (
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-purple">
              Most value
            </p>
          )}
        </div>
        <p className="shrink-0 text-right">
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
            Received
          </span>
          <span className="font-mono text-xl font-bold tabular-nums text-brand-cyan">
            {side.total.toLocaleString()}
          </span>
        </p>
      </div>

      {side.assets.length === 0 && side.faabIn === 0 ? (
        <p className="mt-3 rounded-card border border-dashed border-line bg-base/40 px-3 py-2 text-center text-xs text-ink-muted">
          Nothing of value received.
        </p>
      ) : (
        <ul role="list" className="mt-3 space-y-1.5">
          {side.assets.map((asset) => (
            <li
              key={asset.key}
              className="flex items-center justify-between gap-3 rounded-card border border-line/70 bg-surface/40 px-2.5 py-1.5"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink">
                  {asset.label}
                  {asset.estimated && (
                    <span className="ml-1.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                      est.
                    </span>
                  )}
                </span>
                {asset.detail && (
                  <span className="block truncate text-[11px] text-ink-subtle">{asset.detail}</span>
                )}
              </span>
              <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-brand-purple">
                {asset.noValue ? "n/a" : asset.value.toLocaleString()}
              </span>
            </li>
          ))}
          {side.faabIn > 0 && (
            <li className="flex items-center justify-between gap-3 rounded-card border border-dashed border-line/70 bg-surface/30 px-2.5 py-1.5">
              <span className="text-sm font-medium text-ink-muted">FAAB received</span>
              <span className="shrink-0 font-mono text-sm font-bold tabular-nums text-ink-muted">
                ${side.faabIn}
              </span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
