"use client";

import { useId } from "react";
import { Search, X } from "lucide-react";

/**
 * Lists of this length or shorter do not get a filter.
 *
 * A search box above eight rows costs more of the panel than the scrolling it
 * saves, and it puts a control between the reader and a list they could have
 * read straight through. Exposure clears this on any synced league; projections
 * usually only clear it for managers in a lot of rooms, which is exactly who
 * needs it.
 */
export const FILTER_THRESHOLD = 8;

/**
 * The filter box at the top of a side panel.
 *
 * Shared by the two cross-league panels so a manager who learns it in one knows
 * it in the other. Both lists run long enough that scrolling is the wrong way to
 * find one row.
 *
 * Filters as you type, with no debounce and no submit. Everything it searches is
 * already in memory, so there is nothing to wait for, and a Search button would
 * only add a press between the reader and the answer.
 *
 * The magnifier is decorative. The label says what the box does, so announcing
 * an icon named "search" ahead of it would say it twice. The clear button is
 * real, not the browser's own X: WebKit hides that control from the keyboard,
 * and this list is long enough that clearing it by hand is a mouse-only path
 * nobody should be stuck on.
 */
export function PanelFilterField({
  label,
  placeholder,
  value,
  onChange,
  /** Announced after each keystroke. Say how much is left, not what was typed. */
  status,
  /** Wired to the field through aria-describedby. */
  hint,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (next: string) => void;
  status: string;
  hint?: string;
}) {
  const inputId = useId();
  const hintId = useId();

  return (
    <div className="mb-4">
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <div className="relative">
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
          aria-describedby={hint ? hintId : undefined}
          autoComplete="off"
          className="w-full rounded-card border border-line bg-base py-2.5 pl-9 pr-11 text-sm text-ink placeholder:text-ink-subtle focus:border-brand-purple focus:outline-none focus:ring-2 focus:ring-brand-purple/30 [&::-webkit-search-cancel-button]:hidden"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label={`Clear ${label.toLowerCase()}`}
            className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-card text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        )}
      </div>
      {hint && (
        <p id={hintId} className="mt-1.5 text-[11px] text-ink-subtle">
          {hint}
        </p>
      )}
      <p
        role="status"
        aria-live="polite"
        className="mt-1.5 text-xs text-ink-muted"
      >
        {status}
      </p>
    </div>
  );
}
