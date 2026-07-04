"use client";

/**
 * League picker for step 2. Renders every league the lookup returned, grouped
 * into three labelled sections in priority order:
 *   1. Actively Drafting  (the primary category, listed first)
 *   2. Pre-Draft
 *   3. Completed / In-Season Drafts (openable for review; visually dimmed and
 *      badged "Draft complete" so it is clear these are finished)
 *
 * Groups only render when they have leagues. Completed drafts open the same
 * room in snapshot mode (results locked to the draft's completion time).
 */

import { RefreshCw, ArrowRight, Users, CheckCircle2 } from "lucide-react";
import type { LeagueCard } from "@/lib/on-the-clock/types";
import { EmptyCard, ErrorCard, LoadingCard } from "./states";

type Stage = "drafting" | "pre_draft" | "completed";

function statusLabel(stage: Stage, status: string): string {
  if (stage === "drafting") return "Drafting now";
  if (stage === "pre_draft") return "Not started";
  if (status === "in_season") return "Draft complete";
  return "Draft complete";
}

/** Stage with a fallback for older cached responses that lack the field. */
function stageOf(l: LeagueCard): Stage {
  if (l.stage === "drafting" || l.stage === "pre_draft" || l.stage === "completed") return l.stage;
  if (l.draftStatus === "drafting") return "drafting";
  if (l.draftStatus === "pre_draft") return "pre_draft";
  return "completed";
}

const GROUPS: Array<{ stage: Stage; heading: string; hint: string }> = [
  {
    stage: "drafting",
    heading: "Actively drafting",
    hint: "Live right now. Jump in.",
  },
  {
    stage: "pre_draft",
    heading: "Pre-draft",
    hint: "Not started yet. Open one to get set up early.",
  },
  {
    stage: "completed",
    heading: "Completed and in-season drafts",
    hint: "Already finished. Open one to review results, grades, trades, and awards.",
  },
];

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
  /** True when a category had more leagues than the per-category cap. */
  truncated?: boolean;
}) {
  const activeCount = leagues.filter((l) => stageOf(l) === "drafting").length;
  const heading = loading
    ? "Finding your drafts"
    : activeCount > 0
      ? `${activeCount} active ${activeCount === 1 ? "draft" : "drafts"}, ${leagues.length} total`
      : `${leagues.length} ${leagues.length === 1 ? "league" : "leagues"} found`;

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
          Some categories are showing their first few leagues only. If a draft is
          missing, Refresh once it opens.
        </p>
      )}

      {loading ? (
        <div className="mt-5">
          <LoadingCard label="Finding your drafts..." />
        </div>
      ) : error ? (
        <div className="mt-5">
          <ErrorCard message={error} />
        </div>
      ) : leagues.length === 0 ? (
        <div className="mt-5">
          <EmptyCard
            title="No leagues with a draft found."
            body="We could not find any leagues with a draft for this username and season. Check the season picker, or try Refresh once your draft opens."
          />
        </div>
      ) : (
        <div className="mt-5 space-y-7">
          {GROUPS.map(({ stage, heading: groupHeading, hint }) => {
            const group = leagues.filter((l) => stageOf(l) === stage);
            if (group.length === 0) return null;
            const completed = stage === "completed";
            return (
              <section key={stage} aria-label={groupHeading}>
                <h3 className="text-sm font-bold uppercase tracking-[0.14em] text-ink-muted">
                  {stage === "drafting" ? (
                    <span className="text-brand-cyan">{groupHeading}</span>
                  ) : (
                    groupHeading
                  )}
                </h3>
                <p className="mt-0.5 text-xs text-ink-subtle">{hint}</p>
                <ul role="list" className="mt-3 grid gap-3 sm:grid-cols-2">
                  {group.map((l) => (
                    <li key={l.draftId}>
                      <button
                        type="button"
                        onClick={() => onSelect(l)}
                        className={`group flex w-full items-center justify-between gap-3 rounded-card border p-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                          completed
                            ? "border-line/70 bg-surface/30 opacity-80 hover:border-brand-cyan/50 hover:opacity-100"
                            : "border-line bg-surface/60 hover:border-brand-cyan/60"
                        }`}
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
                                stage === "drafting"
                                  ? "rounded-full border border-brand-cyan/40 px-2 py-0.5 font-medium text-brand-cyan"
                                  : completed
                                    ? "inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 font-medium text-ink-subtle"
                                    : "rounded-full border border-line px-2 py-0.5 font-medium text-ink-muted"
                              }
                            >
                              {completed && (
                                <CheckCircle2 aria-hidden="true" className="h-3 w-3" />
                              )}
                              {statusLabel(stage, l.draftStatus)}
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
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
