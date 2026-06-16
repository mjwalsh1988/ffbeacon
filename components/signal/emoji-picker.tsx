"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import {
  EMOJI_CATEGORIES,
  ALL_EMOJI,
  type EmojiEntry,
} from "@/lib/signal/emoji-data";

/**
 * Emoji picker for the Signal composers. The dataset is bundled in-app (no
 * external CDN), and a chosen emoji is plain text inserted at the textarea caret,
 * so there is no new storage and no schema (distinct from sub-phase f reactions).
 *
 * Accessibility:
 *   - The trigger that opens this lives in the composer and is labeled there.
 *   - On open, focus moves to the search box. On close, the composer returns focus
 *     to the trigger. On insert, the composer returns focus to the textarea.
 *   - The emoji grid is a single Tab stop with roving tabindex: arrow keys move
 *     within the grid (Left/Right by one, Up/Down by a row, Home/End to ends),
 *     Enter/Space inserts. Each emoji button is labeled with its name so a screen
 *     reader announces "grinning face, button", not a bare glyph.
 *   - A polite live region announces the result count while searching.
 *   - Every control is at least 44x44 CSS px.
 */

// Logical column count for arrow-key navigation. It matches the visual grid
// (grid-cols-6) at every breakpoint so Up/Down always moves one visual row.
const COLUMNS = 6;
const SEARCH_RESULT_CAP = 120;

export function EmojiPicker({
  onSelect,
  onClose,
}: {
  onSelect: (entry: EmojiEntry) => void;
  onClose: () => void;
}) {
  const [categoryId, setCategoryId] = useState(EMOJI_CATEGORIES[0].id);
  const [query, setQuery] = useState("");
  const [focusIndex, setFocusIndex] = useState(0);

  const searchId = useId();
  const statusId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Focus the search box when the picker opens.
  useEffect(() => {
    requestAnimationFrame(() => searchRef.current?.focus());
  }, []);

  const trimmed = query.trim().toLowerCase();
  const visible = useMemo<EmojiEntry[]>(() => {
    if (trimmed.length > 0) {
      return ALL_EMOJI.filter((e) => e.name.includes(trimmed)).slice(
        0,
        SEARCH_RESULT_CAP,
      );
    }
    const cat = EMOJI_CATEGORIES.find((c) => c.id === categoryId);
    return cat ? cat.emojis : [];
  }, [trimmed, categoryId]);

  // Reset the roving focus to the first cell whenever the visible set changes.
  useEffect(() => {
    setFocusIndex(0);
  }, [trimmed, categoryId]);

  const moveFocus = (next: number) => {
    const clamped = Math.max(0, Math.min(visible.length - 1, next));
    setFocusIndex(clamped);
    requestAnimationFrame(() => buttonRefs.current[clamped]?.focus());
  };

  const onGridKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        moveFocus(focusIndex + 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        moveFocus(focusIndex - 1);
        break;
      case "ArrowDown":
        event.preventDefault();
        moveFocus(focusIndex + COLUMNS);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveFocus(focusIndex - COLUMNS);
        break;
      case "Home":
        event.preventDefault();
        moveFocus(0);
        break;
      case "End":
        event.preventDefault();
        moveFocus(visible.length - 1);
        break;
      default:
        break;
    }
  };

  const status =
    trimmed.length > 0
      ? visible.length === 0
        ? "No emoji match your search."
        : `${visible.length} emoji found.`
      : "";

  const pickCategory = (id: string) => {
    setQuery("");
    setCategoryId(id);
  };

  // Reset the ref array each render so it never retains buttons from a larger
  // previous set (the per-cell ref callbacks repopulate it on commit).
  buttonRefs.current = [];

  return (
    <section
      aria-label="Emoji picker"
      className="mt-3 rounded-card border border-line bg-base p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Emoji
        </p>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-11 items-center gap-1.5 rounded-card px-2 text-xs font-medium text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <X aria-hidden="true" className="h-3.5 w-3.5" />
          Close emoji picker
        </button>
      </div>

      <p id={statusId} aria-live="polite" role="status" className="sr-only">
        {status}
      </p>

      <label htmlFor={searchId} className="mt-2 block text-sm font-medium text-ink">
        Search emoji
      </label>
      <div className="mt-1 flex items-center gap-2 rounded-card border border-line bg-surface px-3">
        <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-muted" />
        <input
          ref={searchRef}
          id={searchId}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-describedby={statusId}
          placeholder="Search by name, e.g. fire"
          className="h-11 w-full bg-transparent text-base text-ink caret-brand-purple placeholder:text-ink-subtle focus:outline-none"
        />
      </div>

      {trimmed.length === 0 && (
        <div
          role="group"
          aria-label="Emoji categories"
          className="mt-3 flex flex-wrap gap-1.5"
        >
          {EMOJI_CATEGORIES.map((cat) => {
            const active = cat.id === categoryId;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => pickCategory(cat.id)}
                aria-pressed={active}
                className={`inline-flex h-11 items-center rounded-card border px-3 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                  active
                    ? "border-brand-cyan/60 bg-surface text-brand-cyan"
                    : "border-line text-ink-muted hover:text-ink"
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>
      )}

      {visible.length > 0 ? (
        <div
          role="group"
          aria-label={
            trimmed.length > 0
              ? "Emoji search results"
              : EMOJI_CATEGORIES.find((c) => c.id === categoryId)?.label
          }
          onKeyDown={onGridKeyDown}
          className="mt-3 grid max-h-56 grid-cols-6 gap-1 overflow-y-auto"
        >
          {visible.map((entry, index) => (
            <button
              key={`${entry.char}-${index}`}
              ref={(el) => {
                buttonRefs.current[index] = el;
              }}
              type="button"
              tabIndex={index === focusIndex ? 0 : -1}
              aria-label={entry.name}
              onClick={() => onSelect(entry)}
              onFocus={() => setFocusIndex(index)}
              className="inline-flex h-11 w-full items-center justify-center rounded-card text-2xl leading-none hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <span aria-hidden="true">{entry.char}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-ink-muted">No emoji match your search.</p>
      )}
    </section>
  );
}
