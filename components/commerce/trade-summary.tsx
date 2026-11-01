/**
 * The trade an order is about, drawn from the frozen Signal Check payload: the
 * verdict, both sides with every piece, and the format. Shared by the trade
 * checkout, the customer's order sheet and the admin's order page, so the three
 * cannot describe the same trade differently. Plain markup, no client code.
 */

import { Trophy } from "lucide-react";
import { tradeSideName } from "@/lib/commerce/describe";
import type { PublicSharePayload, SideKey } from "@/lib/signal-check/types";

export function TradeSummary({ trade, compact = false }: { trade: PublicSharePayload; compact?: boolean }) {
  const sides: SideKey[] = ["a", "b"];
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-base font-bold tracking-tight text-ink">{trade.verdictLabel}</p>
        {trade.marginPct !== null && (
          <p className="font-mono text-sm tabular-nums text-ink-muted">
            {trade.marginPct}% {trade.winnerSide ? "value margin" : "value spread"}
          </p>
        )}
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        {trade.formatDisplay}
        {trade.tradeShapeLabel ? `, ${trade.tradeShapeLabel}` : ""}
        {trade.confidenceLabel ? `, ${trade.confidenceLabel.toLowerCase()}` : ""}
      </p>
      <div className={`mt-3 grid gap-3 ${compact ? "" : "sm:grid-cols-2"}`}>
        {sides.map((side) => {
          const s = trade.sides.find((x) => x.side === side);
          const winner = trade.winnerSide === side;
          return (
            <div
              key={side}
              className={`rounded-card border p-3 ${winner ? "border-brand-cyan/50 bg-brand-cyan/[0.04]" : "border-line bg-base/40"}`}
            >
              <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                {tradeSideName(trade, side)}
                {winner && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-cyan/15 px-2 py-0.5 text-xs font-medium text-brand-cyan">
                    <Trophy aria-hidden="true" className="h-3 w-3" />
                    Winner
                  </span>
                )}
              </p>
              <ul role="list" className="mt-2 space-y-1">
                {(s?.assets ?? []).map((a, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0">
                      <span className="text-ink">{a.name}</span>
                      {a.detail && <span className="ml-1.5 text-xs text-ink-subtle">{a.detail}</span>}
                    </span>
                    {a.unpriced && <span className="shrink-0 text-xs text-ink-subtle">No market value</span>}
                  </li>
                ))}
              </ul>
              {s?.total != null && (
                <p className="mt-2 text-right font-mono text-xs tabular-nums text-ink-muted">Total {s.total.toLocaleString("en-US")}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
