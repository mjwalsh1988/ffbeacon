"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { recomputeBeacon } from "@/app/admin/beacon/actions";

/**
 * Recompute-now control. Shows whether the board is stale relative to the last
 * recompute (a setting changed since the last run) and gives a clear path to
 * refresh so the reviewer is never tuning against stale numbers.
 */
export function RecomputeBar({ stale, lastRunLabel }: { stale: boolean; lastRunLabel: string }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="rounded-card border border-line bg-surface/60 p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="font-semibold text-ink">Board recompute</p>
        <p className="mt-0.5 text-sm text-ink-muted">
          Last recompute: {lastRunLabel}.{" "}
          {stale ? (
            <span className="font-semibold text-signal-warning">
              Settings changed since then. Recompute to review current numbers.
            </span>
          ) : (
            <span className="text-ink-subtle">Numbers reflect the latest settings.</span>
          )}
        </p>
      </div>
      <div className="mt-3 flex items-center gap-3 sm:mt-0">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setMsg(null);
              const res = await recomputeBeacon();
              setMsg(res.ok ? "Recompute complete. Numbers refreshed." : `Failed: ${res.error}`);
            })
          }
          className="inline-flex min-h-[44px] items-center gap-2 rounded-card border border-brand-purple bg-brand-purple/10 px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-brand-purple/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-60"
        >
          <RefreshCw aria-hidden="true" className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
          {pending ? "Recomputing values, rankings, trends..." : "Recompute now"}
        </button>
      </div>
      <p aria-live="polite" className="sr-only">
        {pending ? "Recompute in progress" : msg ?? ""}
      </p>
      {msg && !pending && (
        <p className="mt-2 w-full text-sm text-ink-muted sm:mt-3">{msg}</p>
      )}
    </div>
  );
}
