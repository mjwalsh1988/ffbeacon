"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

export type FaabPlayer = {
  slug: string;
  /** FF Beacon player id. Drives the rest-of-season read. Null when unresolved. */
  player_id: string | null;
  name: string;
  position: string;
  team: string | null;
  /** Sleeper player id from players.external_ids.sleeper. Drives the headshot
   * and the league-mode lookup; null when we have no Sleeper mapping. */
  sleeper_id: string | null;
  overall_rank: number;
  /** Per-position rank from rankings.position_rank for the resolved
   * (format, source) pair. Surfaced in the selected-player card. */
  position_rank: number;
  value: number | null;
};

const MAX_SUGGESTIONS = 40;

/**
 * Accessible combobox/listbox replacement for the old <datalist>. The native
 * datalist was the source of the bugs the user reported:
 *   - On iOS Safari / Chrome Android, datalist suggestions either don't render
 *     or only display the `value` attribute (so no metadata is visible).
 *   - On desktop, the browser-rendered popup can't be styled, and with 300
 *     options it occasionally renders pinned to the viewport edge instead of
 *     anchored below the input.
 *
 * This custom combobox follows the WAI-ARIA combobox-with-listbox pattern:
 *   role="combobox" on the input, aria-controls + aria-expanded wired to the
 *   listbox, aria-activedescendant tracks the highlighted option, and the
 *   listbox is positioned absolutely directly under the input.
 *
 * Lives in its own file because both paths through the calculator need it: the
 * connected-league flow and the manual one each search the same player list.
 */
export function PlayerCombobox({
  players,
  query,
  onQueryChange,
  selected,
  onSelect,
  formatName,
  label = "Player",
  helpText,
}: {
  players: FaabPlayer[];
  query: string;
  onQueryChange: (q: string) => void;
  selected: FaabPlayer | null;
  onSelect: (player: FaabPlayer | null) => void;
  formatName: string;
  label?: string;
  /** Overrides the default "top 300 ranked" line. League mode searches a
   * league's actual free agents, so that description would be wrong there. */
  helpText?: string;
}) {
  const inputId = useId();
  const listboxId = useId();
  const helpId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // Empty query: show the top-ranked players so users see something
      // immediately when they tap the field.
      return players.slice(0, MAX_SUGGESTIONS);
    }
    // Rank substring matches by overall_rank ascending so the most relevant
    // player shows up first. Cap to keep the DOM small.
    const out: FaabPlayer[] = [];
    for (const p of players) {
      if (p.name.toLowerCase().includes(q)) out.push(p);
      if (out.length >= MAX_SUGGESTIONS) break;
    }
    return out;
  }, [players, query]);

  // Clamp the active index whenever the visible match list changes (e.g. user
  // types another character and the matching set shrinks).
  useEffect(() => {
    if (activeIdx >= matches.length) setActiveIdx(0);
  }, [matches.length, activeIdx]);

  // Click-outside closes the listbox.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent | TouchEvent) => {
      const node = wrapperRef.current;
      if (!node) return;
      if (node.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  const commit = useCallback(
    (player: FaabPlayer) => {
      onSelect(player);
      setOpen(false);
      // Defocus on touch devices so the on-screen keyboard collapses; users
      // wanted to see the recommendation after selecting.
      inputRef.current?.blur();
    },
    [onSelect],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.min(matches.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter") {
      if (open && matches[activeIdx]) {
        event.preventDefault();
        commit(matches[activeIdx]);
      }
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
    } else if (event.key === "Home") {
      if (open) {
        event.preventDefault();
        setActiveIdx(0);
      }
    } else if (event.key === "End") {
      if (open) {
        event.preventDefault();
        setActiveIdx(matches.length - 1);
      }
    }
  };

  const showClear = query.length > 0 || selected != null;

  return (
    <div ref={wrapperRef} className="relative">
      <label htmlFor={inputId} className="block text-sm font-medium">
        {label}
      </label>
      <div className="relative mt-2">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={
            open && matches[activeIdx] ? `${listboxId}-opt-${activeIdx}` : undefined
          }
          aria-describedby={helpId}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="words"
          spellCheck={false}
          inputMode="search"
          value={query}
          onChange={(event) => {
            onQueryChange(event.target.value);
            setOpen(true);
            // Editing invalidates the current selection; the caller re-resolves
            // on the next commit.
            if (selected && event.target.value !== selected.name) {
              onSelect(null);
            }
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Start typing a player name"
          className="w-full rounded-card border border-line bg-base px-3 py-2 pr-9 text-base text-ink placeholder:text-ink-subtle caret-brand-purple focus:border-brand-purple focus:outline-none sm:text-sm"
        />
        {showClear && (
          <button
            type="button"
            onClick={() => {
              onQueryChange("");
              onSelect(null);
              setActiveIdx(0);
              setOpen(true);
              inputRef.current?.focus();
            }}
            aria-label={
              selected
                ? `Clear ${selected.name} and search for a different player`
                : "Clear search field"
            }
            title="Clear"
            className="absolute inset-y-0 right-0 my-1 mr-1 inline-flex w-8 items-center justify-center rounded-card text-ink-muted transition-colors hover:bg-line/40 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <span aria-hidden="true">X</span>
          </button>
        )}
      </div>

      <p id={helpId} className="mt-1 text-xs text-ink-subtle">
        {helpText ?? `Top ranked players, ${formatName} format.`}
      </p>

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Player suggestions"
          className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-card border border-line bg-surface-elevated shadow-2xl shadow-black/50"
        >
          {matches.length === 0 ? (
            <li role="presentation" className="px-3 py-3 text-sm text-ink-subtle">
              No players match &quot;{query}&quot;.
            </li>
          ) : (
            matches.map((p, i) => {
              const isActive = i === activeIdx;
              return (
                <li
                  key={p.slug}
                  id={`${listboxId}-opt-${i}`}
                  role="option"
                  aria-selected={isActive}
                  // Mouse-over highlights so cursor + keyboard stay in sync.
                  onMouseEnter={() => setActiveIdx(i)}
                  // onMouseDown (not click) so the input doesn't blur before
                  // we get the chance to handle selection.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    commit(p);
                  }}
                  className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm motion-safe:transition-colors ${
                    isActive ? "bg-brand-purple/15 text-ink" : "text-ink-muted"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-ink">{p.name}</span>
                    <span className="ml-2 text-xs text-ink-subtle">
                      {p.position}
                      {p.team ? `, ${p.team}` : ""}
                    </span>
                  </span>
                  <span className="flex-shrink-0 font-mono text-xs tabular-nums text-ink-subtle">
                    #{p.overall_rank}
                  </span>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
