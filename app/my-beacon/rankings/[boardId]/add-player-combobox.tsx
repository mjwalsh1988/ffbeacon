"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { PlayerHeadshot } from "@/components/player-headshot";
import type { SearchablePlayer } from "@/lib/ranking-boards";
import { positionNoun } from "@/lib/site";
import { NO_ACTIVE_OPTION, nextComboboxIndex } from "@/lib/keyboard-navigation";

const SEARCH_DEBOUNCE_MS = 250;
const FETCH_HEADERS = { "x-requested-with": "ff-beacon" } as const;

/**
 * The "Add a player" search on a board. A combobox over /api/players/search,
 * narrowed to the positions the board can hold. A board that can hold a
 * defender asks for the IDP pool; an offense-only board stays on the default.
 */
export function AddPlayerCombobox({
  positions,
  holdsDefenders,
  excludeIds,
  onAdd,
}: {
  /** The positions this board may hold (scopePositions). */
  positions: readonly string[];
  holdsDefenders: boolean;
  excludeIds: Set<string>;
  onAdd: (player: SearchablePlayer) => void;
}) {
  const inputId = useId();
  const listboxId = useId();
  const helpId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchablePlayer[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  // No option is active until the reader presses Down (lib/keyboard-navigation).
  const [activeIdx, setActiveIdx] = useState(NO_ACTIVE_OPTION);
  const statusId = useId();

  const positionsKey = positions.join(",");
  const pool = holdsDefenders ? "ranked+idp" : null;

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, positions: positionsKey });
        if (pool) params.set("pool", pool);
        const res = await fetch(`/api/players/search?${params.toString()}`, {
          headers: FETCH_HEADERS,
          signal: controller.signal,
        });
        if (!res.ok) {
          setResults([]);
        } else {
          const json = (await res.json()) as { players: SearchablePlayer[] };
          setResults(json.players ?? []);
        }
      } catch {
        if (!controller.signal.aborted) setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, positionsKey, pool]);

  const matches = useMemo(
    () => results.filter((p) => !excludeIds.has(p.playerId)),
    [results, excludeIds],
  );

  // A new result set clears the active option: the reader has typed, not
  // chosen, and the next Down arrow lands on the FIRST match.
  useEffect(() => {
    setActiveIdx(NO_ACTIVE_OPTION);
  }, [results]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent | TouchEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  const commit = (player: SearchablePlayer) => {
    onAdd(player);
    // Keep the box open and clear the query so the user can add several in a
    // row without re-focusing.
    setQuery("");
    setResults([]);
    setActiveIdx(NO_ACTIVE_OPTION);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const key = event.key;
      setOpen(true);
      setActiveIdx((i) => nextComboboxIndex(i, key, matches.length));
    } else if (event.key === "Enter") {
      if (open && activeIdx >= 0 && matches[activeIdx]) {
        event.preventDefault();
        commit(matches[activeIdx]);
      }
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
        setActiveIdx(NO_ACTIVE_OPTION);
      }
    }
  };

  const single = positions.length === 1 ? positions[0] : null;
  const who = single ? positionNoun(single, "plural") : "players";
  const trimmedQuery = query.trim();
  const showPanel = open && trimmedQuery.length >= 2;
  // The listbox exists only when it has options. "Searching" and "No active
  // players match" are status text, carried by the live line, not options.
  const showList = showPanel && !loading && matches.length > 0;
  const statusText =
    trimmedQuery.length < 2
      ? ""
      : loading
        ? "Searching"
        : matches.length === 0
          ? `No active players match ${trimmedQuery}`
          : `${matches.length} ${matches.length === 1 ? "player" : "players"} found`;

  return (
    <div ref={wrapperRef} className="relative">
      <label htmlFor={inputId} className="block text-sm font-medium text-ink">
        Add a player
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={showList ? listboxId : undefined}
        aria-activedescendant={
          showList && activeIdx >= 0 && matches[activeIdx]
            ? `${listboxId}-opt-${activeIdx}`
            : undefined
        }
        aria-describedby={`${helpId} ${statusId}`}
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={`Search active ${who}`}
        className="mt-2 w-full rounded-card border border-line bg-base px-3 py-2 text-base text-ink placeholder:text-ink-subtle caret-brand-purple focus:border-brand-purple focus:outline-none sm:text-sm"
      />
      <p id={helpId} className="mt-1 text-xs text-ink-subtle">
        Type at least two letters. Active {who} only.
      </p>
      <p id={statusId} role="status" aria-live="polite" className="sr-only">
        {statusText}
      </p>

      {showPanel && !showList && (
        // Sighted twin of the live status line; plain text, no listbox.
        <div className="absolute left-0 right-0 z-30 mt-1 rounded-card border border-line bg-surface-elevated px-3 py-3 text-sm text-ink-subtle shadow-2xl shadow-black/50">
          {loading ? "Searching..." : <>No active players match &quot;{trimmedQuery}&quot;.</>}
        </div>
      )}

      {showList && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Player search results"
          className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-card border border-line bg-surface-elevated shadow-2xl shadow-black/50"
        >
          {matches.map((p, i) => {
              const isActive = i === activeIdx;
              return (
                <li
                  key={p.playerId}
                  id={`${listboxId}-opt-${i}`}
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setActiveIdx(i)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    commit(p);
                  }}
                  className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm transition-colors ${
                    isActive ? "bg-brand-purple/15 text-ink" : "text-ink-muted"
                  }`}
                >
                  <PlayerHeadshot
                    sleeperId={p.sleeperId}
                    position={p.position}
                    name={p.name}
                    size={28}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-ink">{p.name}</span>
                    <span className="ml-2 text-xs text-ink-subtle">
                      {p.position}
                      {p.team ? `, ${p.team}` : ""}
                    </span>
                  </span>
                  <Plus aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );
}
