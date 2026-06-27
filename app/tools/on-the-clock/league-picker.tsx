"use client";

/**
 * Active-draft league picker. MOCKED for Phase 4: leagues come from fixtures and
 * "Open draft" calls onSelect. Phase 5 swaps the list for the leagues route
 * response. Empty state + Refresh match the plan copy (section 6).
 */

import { RefreshCw, ArrowRight, Users } from "lucide-react";
import type { LeagueCard } from "@/lib/on-the-clock/types";
import { EmptyCard, ErrorCard, LoadingCard } from "./states";

function statusLabel(status: string): string {
  if (status === "drafting") return "Drafting now";
  if (status === "pre_draft") return "Not started";
  return status;
}

export function LeaguePicker({
  leagues,
  onSelect,
  onRefresh,
  loading = false,
  refreshing = false,
  error = null,
  truncated = false,
}: {
  leagues: LeagueCard[];
  onSelect: (league: LeagueCard) => void;
  onRefresh: () => void;
  /** First load in flight (no leagues yet). */
  loading?: boolean;
  /** A manual refresh is in flight (leagues already shown). */
  refreshing?: boolean;
  /** Lookup error to surface instead of the list. */
  error?: string | null;
  /** True when more active drafts exist than the per-user cap returned. */
  truncated?: boolean;
}) {
  const heading = loading
    ? "Finding active drafts"
    : `${leagues.length} active ${leagues.length === 1 ? "draft" : "drafts"}`;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight text-ink" aria-live="polite">
          {heading}
        </h2>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading || refreshing}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-base px-3 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <RefreshCw
            aria-hidden="true"
            className={`h-3.5 w-3.5 ${refreshing ? "animate-spin motion-reduce:animate-none" : ""}`}
          />
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {truncated && !loading && !error && (
        <p className="mt-3 text-xs text-ink-subtle">
          Showing the first {leagues.length}. If your draft is missing, Refresh once it opens.
        </p>
      )}

      {loading ? (
        <div className="mt-5">
          <LoadingCard label="Finding your active drafts..." />
        </div>
      ) : error ? (
        <div className="mt-5">
          <ErrorCard message={error} />
        </div>
      ) : leagues.length === 0 ? (
        <div className="mt-5">
          <EmptyCard
            title="No active drafts right now."
            body="Only leagues that are actively drafting show up here. If you do not see a league, the draft may not have started yet or may already be finished. Try Refresh once your draft opens."
          />
        </div>
      ) : (
        <ul role="list" className="mt-5 grid gap-3 sm:grid-cols-2">
          {leagues.map((l) => (
            <li key={l.draftId}>
              <button
                type="button"
                onClick={() => onSelect(l)}
                className="group flex w-full items-center justify-between gap-3 rounded-card border border-line bg-surface/60 p-4 text-left transition-colors hover:border-brand-cyan/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <span className="min-w-0">
                  <span className="block truncate text-base font-semibold text-ink">
                    {l.name}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                    <span className="inline-flex items-center gap-1">
                      <Users aria-hidden="true" className="h-3.5 w-3.5" />
                      {l.totalRosters} teams
                    </span>
                    <span>{l.season} season</span>
                    <span
                      className={
                        l.draftStatus === "drafting"
                          ? "rounded-full border border-brand-cyan/40 px-2 py-0.5 font-medium text-brand-cyan"
                          : "rounded-full border border-line px-2 py-0.5 font-medium text-ink-muted"
                      }
                    >
                      {statusLabel(l.draftStatus)}
                    </span>
                  </span>
                </span>
                <ArrowRight
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-ink-subtle transition-colors group-hover:text-brand-cyan"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
