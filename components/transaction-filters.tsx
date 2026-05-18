"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

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
 * Accessibility:
 * - Each filter group is wrapped in <fieldset><legend>
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
    startTransition(() =>
      router.replace(`/leagues/${sleeperLeagueId}/transactions`, { scroll: false }),
    );
  };

  const hasAnyFilter =
    selectedTypes.length > 0 || selectedTeams.length > 0 || selectedWeek !== null;

  return (
    <div
      className="rounded-card border border-line bg-surface p-4"
      aria-busy={pending}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink">
          Filters
        </h2>
        {hasAnyFilter && (
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-brand-cyan underline-offset-2 hover:underline focus-visible:underline"
          >
            Clear all
          </button>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-10">
        {/* Left column: Type stacked on Week. 3 of 10 cols on desktop (~30%). */}
        <div className="flex flex-col gap-4 lg:col-span-3">
          <fieldset>
            <legend className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
              Type
            </legend>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {types.map((t) => {
                const checked = selectedTypes.includes(t.value);
                return (
                  <li key={t.value}>
                    <label
                      className={`inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs leading-tight transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-cyan ${
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
                        {t.label} <span className="text-ink-muted">({t.count})</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>

          <fieldset>
            <legend className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
              Week
            </legend>
            <select
              value={selectedWeek ?? ""}
              onChange={(e) => setParam("week", e.target.value || null)}
              className="mt-2 block min-h-11 w-full rounded-card border border-line bg-base px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-brand-cyan"
            >
              <option value="">All weeks</option>
              {weeks.map((w) => (
                <option key={w} value={String(w)}>
                  {w === 0 ? "Preseason" : `Week ${w}`}
                </option>
              ))}
            </select>
          </fieldset>
        </div>

        {/* Right column: Team filter. 7 of 10 cols on desktop (~70%). */}
        <fieldset className="lg:col-span-7">
          <legend className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Team
          </legend>
          <ul
            className="mt-2 flex max-h-40 flex-wrap gap-2 overflow-y-auto"
            role="region"
            aria-label="Team filter options, scrollable list"
            tabIndex={0}
          >
            {teams.map((team) => {
              const checked = selectedTeams.includes(team.rosterId);
              return (
                <li key={team.rosterId}>
                  <label
                    className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-cyan ${
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
        </fieldset>
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
