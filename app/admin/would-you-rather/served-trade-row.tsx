"use client";

/**
 * One recently served trade, with the control that takes it out of rotation.
 *
 * RETIRING, NOT DELETING. The votes already cast on a trade are a record of
 * what people did under the rules at the time, so they stay and the tally stays
 * with them. A retired row is simply never served again, and the admin panel's
 * "Retired" count is what it adds up to.
 *
 * The confirm step is here because the action is one press away from removing a
 * trade the game is actively using, and there is no undo in the panel.
 */

import { useState, useTransition } from "react";
import { Archive, Loader2 } from "lucide-react";
import { formatRelative } from "@/lib/datetime";
import { retireTradeAction } from "./actions";

export function ServedTradeRow({
  id,
  label,
  votes,
  servedCount,
  lastServedAt,
}: {
  id: string;
  label: string;
  votes: number;
  servedCount: number;
  lastServedAt: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-card border border-line bg-base/40 px-3.5 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink">{label}</p>
        <p className="text-xs text-ink-subtle">
          {votes.toLocaleString()} vote{votes === 1 ? "" : "s"}, shown{" "}
          {servedCount.toLocaleString()} time{servedCount === 1 ? "" : "s"}
          {lastServedAt ? `, last ${formatRelative(lastServedAt)}` : ""}
        </p>
        {/* The outcome sits with the row it belongs to, and is announced,
            because the row itself does not visibly change until a reload. */}
        {result && (
          <p role="status" className="mt-1 text-xs text-signal-success">
            {result}
          </p>
        )}
      </div>

      {result ? null : confirming ? (
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const outcome = await retireTradeAction(id);
                setResult(outcome.ok ? (outcome.message ?? "Retired.") : outcome.error);
                setConfirming(false);
              })
            }
            className="inline-flex min-h-11 items-center gap-2 rounded-card border border-signal-danger/50 bg-signal-danger/10 px-3.5 text-sm font-semibold text-signal-danger transition-colors hover:bg-signal-danger/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
            Confirm retire
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="inline-flex min-h-11 items-center rounded-card border border-line bg-base px-3.5 text-sm font-medium text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          // Names the trade, so a reader tabbing a list of ten of these hears
          // which one each button belongs to rather than "Retire" ten times.
          aria-label={`Retire ${label}`}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-card border border-line bg-base px-3.5 text-sm font-medium text-ink transition-colors hover:border-signal-danger/60 hover:text-signal-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <Archive aria-hidden="true" className="h-4 w-4" />
          Retire
        </button>
      )}
    </li>
  );
}
