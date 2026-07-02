"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

type TeamOption = { rosterId: number; label: string };

type TransactionFiltersProps = {
  /** Sleeper league id for URL building. */
  sleeperLeagueId: string;
  /** Available type filter options. */
  types: Array<{ value: string; label: string; count: number }>;
  /** Available teams for the multi-select. */
  teams: TeamOption[];
  /** Available weeks (descending). */
  weeks: number[];
};

/**
 * Client-side filter bar for the transactions feed. Edits push to the URL
 * via router.replace so the server-rendered feed re-runs with the new
 * search params. We use replace (not push) so the back button doesn't get
 * polluted with each filter tweak.
 *
 * Layout: compact, single-panel bar. Type and Week sit inline on one row with
 * their labels; Team wraps to a full-width scroll strip below. The whole body
 * collapses behind a Hide/Show toggle so long feeds can be scrolled without the
 * filters taking up the viewport.
 *
 * Accessibility:
 * - Each filter group is a role="group" labeled by an inline heading span
 * - The collapse toggle carries aria-expanded + aria-controls to the body
 * - The team multi-select uses checkboxes (multi-select needs a multi-select
 *   primitive; native <select multiple> has terrible mobile UX)
 * - Filter changes are announced via the aria-live=polite region at the
 *   bottom so screen readers know the table re-loaded
 */
export function TransactionFilters({
  sleeperLeagueId,
  types,
  teams,
  weeks,
}: TransactionFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [collapsed, setCollapsed] = useState(false);
  const bodyId = useId();

  const selectedTypes = parseMulti(searchParams.get("type"));
  const selectedTeams = parseMulti(searchParams.get("team"))
    .map((v) => Number.parseInt(v, 10))
    .filter((n) => Number.isFinite(n));
  const selectedWeek = searchParams.get("week");

  const buildHref = (next: URLSearchParams): string =>
    `/leagues/${sleeperLeagueId}/transactions${next.toString() ? `?${next}` : ""}`;

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    next.delete("offset");
    startTransition(() => router.replace(buildHref(next), { scroll: false }));
  };

  const toggleMulti = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    const current = parseMulti(next.get(key));
    const set = new Set(current);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    if (set.size === 0) next.delete(key);
    else next.set(key, Array.from(set).join(","));
    next.delete("offset");
    startTransition(() => router.replace(buildHref(next), { scroll: false }));
  };

  const clearAll = () => {
    // Preserve the searched username so clearing filters doesn't drop the
    // in-view league switcher context.
    const next = new URLSearchParams();
    const username = searchParams.get("username");
    if (username) next.set("username", username);
    startTransition(() => router.replace(buildHref(next), { scroll: false }));
  };

  const activeCount =
    selectedTypes.length + selectedTeams.length + (selectedWeek !== null ? 1 : 0);
  const hasAnyFilter = activeCount > 0;

  return (
    <div
      className="relative overflow-hidden rounded-modal border border-line bg-surface/50 px-4 py-3 sm:px-5"
      aria-busy={pending}
    >
      {/* Top-edge beacon hairline, decorative — matches the dashboard panels. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
              Refine
            </p>
            <h2 className="mt-0.5 text-base font-semibold tracking-tight text-ink">
              Filters
            </h2>
          </div>
          {hasAnyFilter && (
            <span
              className="inline-flex items-center rounded-full border border-brand-cyan/40 bg-brand-cyan/10 px-2 py-0.5 text-[11px] font-semibold text-brand-cyan"
              aria-label={`${activeCount} active ${activeCount === 1 ? "filter" : "filters"}`}
            >
              {activeCount} active
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {hasAnyFilter && (
            <button
              type="button"
              onClick={clearAll}
              className="text-xs font-medium text-brand-cyan underline-offset-2 hover:underline focus-visible:underline"
            >
              Clear all
            </button>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            className="inline-flex min-h-8 items-center gap-1 rounded-card border border-line bg-base px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            {collapsed ? (
              <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
            ) : (
              <ChevronUp aria-hidden="true" className="h-3.5 w-3.5" />
            )}
            {collapsed ? "Show filters" : "Hide filters"}
          </button>
        </div>
      </div>

      <div id={bodyId} className={collapsed ? "hidden" : "mt-3"}>
        <div className="flex flex-wrap items-start gap-x-5 gap-y-3">
          {/* Type + Week share one inline row; each label sits beside its
              controls to keep the bar short. */}
          <div
            role="group"
            aria-labelledby={`${bodyId}-type`}
            className="flex flex-wrap items-center gap-x-2 gap-y-1.5"
          >
            <span
              id={`${bodyId}-type`}
              className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle"
            >
              Type
            </span>
            {types.map((t) => {
              const checked = selectedTypes.includes(t.value);
              return (
                <label
                  key={t.value}
                  className={`inline-flex min-h-11 cursor-pointer items-center rounded-full border px-2.5 py-0.5 text-xs leading-tight transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-cyan sm:min-h-8 ${
                    checked
                      ? "border-brand-purple bg-brand-purple/10 text-brand-purple"
                      : "border-line bg-base text-ink-muted hover:border-line-accent hover:text-ink"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleMulti("type", t.value)}
                    className="sr-only"
                    aria-label={`${t.label}, ${t.count} ${t.count === 1 ? "transaction" : "transactions"}`}
                  />
                  <span aria-hidden="true">
                    {t.label} <span className="text-ink-subtle">({t.count})</span>
                  </span>
                </label>
              );
            })}
          </div>

          <div
            role="group"
            aria-labelledby={`${bodyId}-week`}
            className="flex items-center gap-2"
          >
            <span
              id={`${bodyId}-week`}
              className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle"
            >
              Week
            </span>
            <select
              value={selectedWeek ?? ""}
              onChange={(e) => setParam("week", e.target.value || null)}
              aria-label="Filter by week"
              className="min-h-11 rounded-card border border-line bg-base px-2.5 py-1 text-xs text-ink focus-visible:outline-2 focus-visible:outline-brand-cyan sm:min-h-8"
            >
              <option value="">All weeks</option>
              {weeks.map((w) => (
                <option key={w} value={String(w)}>
                  {w === 0 ? "Preseason" : `Week ${w}`}
                </option>
              ))}
            </select>
          </div>

          {/* Team wraps to its own full-width strip; the pill list scrolls if it
              overflows so many-team leagues don't blow up the bar height. */}
          <div
            role="group"
            aria-labelledby={`${bodyId}-team`}
            className="flex w-full flex-wrap items-start gap-x-2 gap-y-1.5"
          >
            <span
              id={`${bodyId}-team`}
              className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle"
            >
              Team
            </span>
            <ul
              className="flex max-h-24 min-w-0 flex-1 flex-wrap gap-1.5 overflow-y-auto"
              aria-label="Team filter options, scrollable list"
              tabIndex={0}
            >
              {teams.map((team) => {
                const checked = selectedTeams.includes(team.rosterId);
                return (
                  <li key={team.rosterId}>
                    <label
                      className={`inline-flex min-h-11 cursor-pointer items-center rounded-full border px-2.5 py-0.5 text-xs transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-cyan sm:min-h-8 ${
                        checked
                          ? "border-brand-cyan bg-brand-cyan/10 text-brand-cyan"
                          : "border-line bg-base text-ink-muted hover:border-line-accent hover:text-ink"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMulti("team", String(team.rosterId))}
                        className="sr-only"
                        aria-label={team.label}
                      />
                      <span aria-hidden="true">{team.label}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {pending ? "Loading transactions" : ""}
      </p>
    </div>
  );
}

function parseMulti(input: string | null): string[] {
  if (!input) return [];
  return input
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}
