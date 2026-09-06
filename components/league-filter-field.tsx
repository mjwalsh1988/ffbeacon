"use client";

import { useId } from "react";
import { Search, X } from "lucide-react";

/**
 * The quick filter that sits above a long list of leagues.
 *
 * A real `<input type="search">` with a real `<label>`, not a placeholder
 * pretending to be one: a placeholder disappears the moment a reader types,
 * which is exactly when someone using a screen magnifier or coming back to a
 * half-filled field needs to know what the box is for.
 *
 * The label is `sr-only` by default because the list it sits above already
 * names itself, and a visible "Filter leagues" heading above a search icon is
 * the kind of redundancy that pushes the leagues further down the page. That
 * is the whole thing this change set is trying to avoid.
 *
 * The match count is announced by the CALLER, not here, because only the
 * caller knows how many rows survived. See `describeLeagueFilter`.
 */
export function LeagueFilterField({
  value,
  onChange,
  label = "Filter your leagues",
  placeholder = "Filter by name",
  countId,
  className = "",
}: {
  value: string;
  onChange: (next: string) => void;
  label?: string;
  placeholder?: string;
  /** The id of the caller's live region, so the field is described by it. */
  countId?: string;
  className?: string;
}) {
  const inputId = useId();

  return (
    <div className={`relative ${className}`}>
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
      />
      <input
        id={inputId}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        aria-describedby={countId}
        className="h-11 min-h-11 w-full rounded-card border border-line bg-base pl-9 pr-9 text-sm text-ink placeholder:text-ink-subtle focus:border-brand-purple focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      />
      {value && (
        // A named button, not a bare glyph. "Clear" on its own would be one
        // more unlabelled X in a page full of them.
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear the league filter"
          className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-card text-ink-subtle transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
