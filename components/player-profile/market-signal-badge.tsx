/**
 * The market signal badge on the player profile's Value trend panel (Team
 * Blueprint plan 12.2). The state word is the visible text, so color never
 * carries it alone; "since {date}" is part of the same element for a screen
 * reader. A "Why this signal" disclosure states the band in words and lists
 * the last three changes. No row renders nothing: no empty chip.
 */

import { DataTable, Td, Th } from "@/components/chart-kit";
import {
  formatSignalDay,
  type PlayerValueSignalChange,
  type PlayerValueSignalRow,
} from "@/lib/market-signals/read";
import type { SignalState } from "@/lib/market-signals/bollinger";

const CHIP = "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold uppercase tracking-wider";

const TONE: Record<SignalState, string> = {
  buy: "bg-signal-positive/15 text-signal-positive",
  watch_buy: "bg-signal-positive/15 text-signal-positive",
  sell: "bg-signal-warning/15 text-signal-warning",
  watch_sell: "bg-signal-warning/15 text-signal-warning",
  hold: "bg-ink/[0.07] text-ink-muted",
  baseline: "bg-ink/[0.05] text-ink-subtle",
  thin: "bg-ink/[0.05] text-ink-subtle",
};

export function signalWords(row: Pick<PlayerValueSignalRow, "signal" | "pointsInWindow">, minPoints: number): string {
  switch (row.signal) {
    case "buy":
      return "Buy window";
    case "watch_buy":
      return "Near a buy window";
    case "hold":
      return "Hold";
    case "watch_sell":
      return "Near a sell window";
    case "sell":
      return "Sell window";
    case "baseline":
      return `Building baseline (${row.pointsInWindow} of ${minPoints} days)`;
    default:
      return "Thin market";
  }
}

const STATE_WORD: Record<SignalState, string> = {
  buy: "Buy window",
  watch_buy: "Near a buy window",
  hold: "Hold",
  watch_sell: "Near a sell window",
  sell: "Sell window",
  baseline: "Building baseline",
  thin: "Thin market",
};

const fmt = (v: number) => Math.round(v).toLocaleString("en-US");

export function MarketSignalBadge({
  signal,
  changes,
  sourceDisplay,
  windowDays,
  minPoints,
}: {
  signal: PlayerValueSignalRow | null;
  changes: PlayerValueSignalChange[];
  sourceDisplay: string | null;
  /** The stored Market Signals window and minimum, so the words match the job. */
  windowDays: number;
  minPoints: number;
}) {
  if (!signal) return null;
  const since =
    signal.signalSince && signal.signal !== "baseline" && signal.signal !== "thin"
      ? formatSignalDay(signal.signalSince)
      : null;
  const recent = changes.slice(0, 3);
  return (
    <div className="mb-3">
      <span className={`${CHIP} ${TONE[signal.signal]}`}>
        {signalWords(signal, minPoints)}
      </span>
      {since && <span className="ml-2 text-[11px] text-ink-subtle">since {since}</span>}
      <details className="mt-1.5">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs font-medium text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">
          Why this signal
        </summary>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          {signal.upper !== null && signal.lower !== null
            ? `${sourceDisplay ?? "Market"} value ${fmt(signal.marketValue)} against a ${windowDays}-day band of ${fmt(signal.lower)} to ${fmt(signal.upper)}${
                signal.bandPct !== null ? `; band position ${Math.round(signal.bandPct * 100)}%` : ""
              }.`
            : `${sourceDisplay ?? "Market"} value ${fmt(signal.marketValue)}; not enough days of history for a band yet.`}
        </p>
        {recent.length > 0 && (
          <div className="mt-2 overflow-x-auto" tabIndex={0} role="region" aria-label="Recent signal changes">
            <DataTable
              caption="The last three market signal changes"
              head={
                <>
                  <Th>Date</Th>
                  <Th>From</Th>
                  <Th>To</Th>
                  <Th numeric>Value</Th>
                </>
              }
            >
              {recent.map((c) => (
                <tr key={c.changedOn}>
                  <Td>{formatSignalDay(c.changedOn)}</Td>
                  <Td>{c.fromSignal ? STATE_WORD[c.fromSignal] : "None"}</Td>
                  <Td>{STATE_WORD[c.toSignal]}</Td>
                  <Td numeric>{fmt(c.marketValue)}</Td>
                </tr>
              ))}
            </DataTable>
          </div>
        )}
      </details>
    </div>
  );
}
