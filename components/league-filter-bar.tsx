"use client";

import { LeagueFilterField } from "@/components/league-filter-field";
import { leagueCategoryLabel } from "@/lib/league-category";
import type { LeagueCategoryKey } from "@/lib/league-category";
import type { LeagueTypeFilter } from "@/lib/league-filter";

/**
 * The quick filter above a long list of leagues: type toggles and a text box.
 *
 * Two controls because they answer two different questions. "Which of my
 * fourteen leagues is the dynasty one" is a TYPE question and a reader should
 * not have to remember what they called it; "where is Ohio's Finest" is a NAME
 * question and no set of chips will ever cover it. Either one alone leaves the
 * other unanswerable, so both are here and they combine.
 *
 * The toggles are a `role="group"` of buttons with `aria-pressed`, not a
 * radiogroup and not links. A radiogroup would take arrow keys hostage in a
 * list that may itself be a radiogroup below (the FAAB and Signal Check
 * pickers are), and `aria-pressed` is the honest description of what these
 * are: a pressed state a reader can toggle off by pressing All.
 *
 * Only buckets actually present in the reader's own list get a chip. A "Best
 * Ball Dynasty" button shown to somebody with no best ball league is a control
 * whose only possible outcome is an empty list.
 */
export function LeagueFilterBar({
  query,
  onQueryChange,
  type,
  onTypeChange,
  categories,
  countId,
  countText,
  label = "Filter your leagues",
  className = "",
}: {
  query: string;
  onQueryChange: (next: string) => void;
  type: LeagueTypeFilter;
  onTypeChange: (next: LeagueTypeFilter) => void;
  /** The buckets present in this list, from `presentLeagueCategories`. */
  categories: LeagueCategoryKey[];
  /** Id of the caller's live region, so both controls are described by it. */
  countId: string;
  /** The sentence that region carries, from `describeLeagueFilter`. */
  countText: string;
  label?: string;
  className?: string;
}) {
  const showTypes = categories.length >= 2;

  return (
    <div className={`grid gap-2 ${className}`}>
      <LeagueFilterField
        value={query}
        onChange={onQueryChange}
        label={label}
        countId={countId}
      />

      {showTypes && (
        <div
          role="group"
          aria-label="Show only one league type"
          className="flex flex-wrap gap-1.5"
        >
          <TypeChip
            active={type === "all"}
            onClick={() => onTypeChange("all")}
            countId={countId}
          >
            All
          </TypeChip>
          {categories.map((key) => (
            <TypeChip
              key={key}
              active={type === key}
              onClick={() => onTypeChange(type === key ? "all" : key)}
              countId={countId}
            >
              {leagueCategoryLabel(key)}
            </TypeChip>
          ))}
        </div>
      )}

      {/* One live region for both controls. A reader who presses Dynasty and
          hears nothing cannot tell the button worked from the list being
          empty anyway. */}
      <p id={countId} role="status" className="text-xs text-ink-subtle">
        {countText}
      </p>
    </div>
  );
}

function TypeChip({
  active,
  onClick,
  countId,
  children,
}: {
  active: boolean;
  onClick: () => void;
  countId: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // aria-pressed, not aria-current or a checked radio: this is a toggle,
      // and pressing the active chip again returns to All.
      aria-pressed={active}
      aria-describedby={countId}
      className={[
        "inline-flex min-h-11 items-center rounded-card border px-3 text-sm font-medium transition-colors",
        active
          ? "border-brand-purple bg-brand-purple/10 text-ink"
          : "border-line bg-surface text-ink-muted hover:border-line-accent hover:text-ink",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
