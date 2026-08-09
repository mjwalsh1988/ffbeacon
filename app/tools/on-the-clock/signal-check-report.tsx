"use client";

/**
 * The Signal Check verdict, rendered inside the draft room.
 *
 * Deliberately the same information in the same order as /tools/signal-check:
 * the verdict sentence, both sides with their assets, the value adjustment when
 * one applied, the trade shape, the confidence, and the written explanation. A
 * draft-room trade and a builder trade are the same analysis, so they should
 * read as the same report rather than as a summary of one.
 *
 * The one addition is the estimate notice: a draft-room trade can contain picks
 * that have not been made yet, which were priced as the player Sleeper ADP says
 * would go there. That is a real assumption and it is named, per asset, rather
 * than hidden behind a single asterisk.
 *
 * NOTHING here is a live region. A region inserted into the DOM together with
 * its content usually does not announce, so the old markup said "Running this
 * trade through Signal Check" and then went silent exactly when the answer
 * arrived. The announcing is done by one region that TradeAnalyzer keeps mounted
 * and empty, and writes into.
 */

import { Loader2, ShieldCheck } from "lucide-react";
import type { BuilderView } from "@/lib/signal-check/builder-view";

export function SignalCheckReport({
  view,
  loading,
  error,
  simulatedLabels,
  droppedCount,
}: {
  view: BuilderView | null;
  loading: boolean;
  error: string | null;
  /** Labels of assets priced from the ADP simulation rather than a real pick. */
  simulatedLabels: string[];
  /** Assets that could not be priced at all and were left out of the analysis. */
  droppedCount: number;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-modal border border-line bg-surface/50 px-4 py-5 text-sm text-ink-muted">
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-brand-cyan" />
        Running this trade through Signal Check.
      </div>
    );
  }

  if (error) {
    return (
      <p className="rounded-modal border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
        {error}
      </p>
    );
  }

  if (!view) return null;

  return (
    <div
      className="relative overflow-hidden rounded-modal border border-brand-purple/40 bg-surface/60 p-5"
      style={{
        boxShadow: "0 0 130px -38px rgba(168, 85, 247, 0.7)",
        backgroundImage:
          "radial-gradient(ellipse at 50% -15%, rgba(168, 85, 247, 0.26) 0%, transparent 60%)",
      }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-0.5"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
        }}
      />
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
        <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
        {view.featureLabel} {view.resultLabel}
      </p>

      <div className="mt-3">
        <p className="text-xl font-bold tracking-tight text-ink">{view.verdictLabel}</p>
        <p className="mt-1.5 text-sm leading-relaxed text-ink">{view.explanation}</p>
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        {view.sides.map((side) => (
          <div key={side.side} className="rounded-card border border-line bg-base/50 px-3 py-2.5">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
              {side.teamLabel ?? (side.side === "a" ? "Side A" : "Side B")}
              {view.winnerSide === side.side ? " (wins the value)" : ""}
            </dt>
            <dd className="mt-1 space-y-1">
              <ul role="list" className="space-y-0.5">
                {side.assets.map((asset, i) => (
                  <li key={`${asset.name}-${i}`} className="text-sm text-ink">
                    {asset.name}
                    {asset.detail && <span className="text-ink-subtle">, {asset.detail}</span>}
                    {asset.noValue && (
                      <span className="ml-1 text-[10px] font-semibold uppercase text-amber-300">
                        no value
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {side.total !== null && (
                <p className="pt-1 font-mono text-lg font-bold tabular-nums text-brand-cyan">
                  {side.total.toLocaleString()}
                </p>
              )}
              {view.adjustmentLabel && side.adjustment !== null && side.adjustment !== 0 && (
                <p className="text-xs text-brand-purple">
                  {view.adjustmentLabel}: +{side.adjustment.toLocaleString()}
                </p>
              )}
              {view.adjustmentLabel &&
                side.adjustment === null &&
                side.adjustmentPct !== null &&
                side.adjustmentPct !== 0 && (
                  <p className="text-xs text-brand-purple">
                    {view.adjustmentLabel}: {side.adjustmentPct.toFixed(1)}% of the trade
                  </p>
                )}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full border border-line bg-base/50 px-2.5 py-1 text-ink-muted">
          {view.formatDisplay}
        </span>
        {view.tradeShapeLabel && (
          <span className="rounded-full border border-line bg-base/50 px-2.5 py-1 text-ink-muted">
            {view.tradeShapeLabel}
          </span>
        )}
        {view.confidenceLabel && (
          <span className="rounded-full border border-line bg-base/50 px-2.5 py-1 text-ink-muted">
            {view.confidenceLabel}
          </span>
        )}
      </div>

      {(simulatedLabels.length > 0 || droppedCount > 0 || view.hasMissingValues) && (
        <div className="mt-4 space-y-2 rounded-card border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          {simulatedLabels.length > 0 && (
            <p>
              Estimated from Sleeper ADP because the pick has not been made yet:{" "}
              {simulatedLabels.join(", ")}.
            </p>
          )}
          {droppedCount > 0 && (
            <p>
              {droppedCount} {droppedCount === 1 ? "asset" : "assets"} could not be priced and{" "}
              {droppedCount === 1 ? "was" : "were"} left out of this analysis.
            </p>
          )}
          {view.hasMissingValues && (
            <p>Some assets carry no FF Beacon value for this format, so the totals are incomplete.</p>
          )}
        </div>
      )}
    </div>
  );
}
