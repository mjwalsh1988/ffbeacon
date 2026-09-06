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

import { useId, useState } from "react";
import { RefreshCw, ArrowRight, Users, CheckCircle2 } from "lucide-react";
import { LeagueLogo } from "@/components/league-logo";
import { LeagueFilterBar } from "@/components/league-filter-bar";
import { leagueCategoryLabel } from "@/lib/league-category";
import {
  describeLeagueFilter,
  filterByLeagueQuery,
  matchesLeagueType,
  presentLeagueCategories,
  LEAGUE_FILTER_MIN_ROWS,
  type LeagueTypeFilter,
} from "@/lib/league-filter";
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
  if (
    l.stage === "drafting" ||
    l.stage === "pre_draft" ||
    l.stage === "completed"
  )
    return l.stage;
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
    hint: "Finished. Open one for results, grades, trades, and awards.",
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
  const filterId = useId();
  const [query, setQuery] = useState("");
  const [type, setType] = useState<LeagueTypeFilter>("all");

  // Below the shared threshold a search box is one more thing to tab past on
  // the way to the drafts themselves, which is the opposite of the point.
  const showFilter =
    !loading && !error && leagues.length >= LEAGUE_FILTER_MIN_ROWS;

  // Only the buckets this reader actually has. A card built before the route
  // carried a category key contributes none, so the chips simply do not render
  // and the text box still works.
  const categories = presentLeagueCategories(leagues, (l) => l.categoryKey);

  // Type first, then text, so the count below describes exactly what survived
  // both. A row can be found by everything the row SHOWS: its name, its team
  // count, its season, its status pill and the group it sits in.
  const shown = showFilter
    ? filterByLeagueQuery(
        leagues.filter((l) => matchesLeagueType(l.categoryKey, type)),
        query,
        (l) => {
          const stage = stageOf(l);
          const group = GROUPS.find((g) => g.stage === stage);
          return [
            l.name,
            `${l.totalRosters} teams`,
            `${l.season} season`,
            statusLabel(stage, l.draftStatus),
            group?.heading ?? "",
          ].join(" ");
        },
      )
    : leagues;
  const filteredOut = showFilter && shown.length === 0;
  const typeLabel = type === "all" ? null : leagueCategoryLabel(type);

  // Counted off the WHOLE list on purpose. The heading says what the lookup
  // found; the filter's own count below says how much of it is on screen.
  const activeCount = leagues.filter((l) => stageOf(l) === "drafting").length;
  const heading = loading
    ? "Finding your drafts"
    : activeCount > 0
      ? `${activeCount} active ${activeCount === 1 ? "draft" : "drafts"}, ${leagues.length} total`
      : `${leagues.length} ${leagues.length === 1 ? "league" : "leagues"} found`;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Live ONLY when the filter is absent. With the filter on screen its
            own status region already announces the count on every keystroke
            and every chip press, and two regions describing the same list
            means a reader hears the number twice for one action. Below the
            filter's row threshold this heading is the only thing that can
            report a finished lookup, so it keeps the job there. */}
        <h2
          className="text-xl font-semibold tracking-tight text-ink"
          aria-live={showFilter ? undefined : "polite"}
        >
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
          Some categories are showing their first few leagues only. If a draft
          is missing, Refresh once it opens.
        </p>
      )}

      {showFilter && (
        <LeagueFilterBar
          query={query}
          onQueryChange={setQuery}
          type={type}
          onTypeChange={setType}
          categories={categories}
          countId={`${filterId}-count`}
          countText={describeLeagueFilter(
            shown.length,
            leagues.length,
            query,
            typeLabel,
          )}
          label="Filter your drafts"
          className="mt-4 max-w-xl"
        />
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
            body="No leagues with a draft for this username and season. Check the season, or refresh once your draft opens."
          />
        </div>
      ) : filteredOut ? (
        <div className="mt-5">
          {/* Names whichever half of the filter is actually on, because a
              reader who pressed a chip and typed nothing is owed the reason
              their drafts went away. */}
          <EmptyCard
            title={describeLeagueFilter(0, leagues.length, query, typeLabel)}
            body="Clear the filter to see all of your drafts again."
          />
        </div>
      ) : (
        <div className="mt-5 space-y-7">
          {GROUPS.map(({ stage, heading: groupHeading, hint }) => {
            const group = shown.filter((l) => stageOf(l) === stage);
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
                        {/* First child of the card, so every card in the grid
                            starts on the same left edge whether or not the
                            league set a logo. Decorative: the name is the next
                            thing in the button. */}
                        <LeagueLogo
                          avatarId={l.avatar}
                          name={l.name}
                          size={48}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-base font-semibold text-ink">
                            {l.name}
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                            <span className="inline-flex items-center gap-1">
                              <Users
                                aria-hidden="true"
                                className="h-3.5 w-3.5"
                              />
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
                                <CheckCircle2
                                  aria-hidden="true"
                                  className="h-3 w-3"
                                />
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
