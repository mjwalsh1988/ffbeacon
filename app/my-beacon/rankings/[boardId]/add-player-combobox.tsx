"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { PlayerHeadshot } from "@/components/player-headshot";
import type { SearchablePlayer } from "@/lib/ranking-boards";
import { positionNoun } from "@/lib/site";

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
  const [activeIdx, setActiveIdx] = useState(0);

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

  useEffect(() => {
    if (activeIdx >= matches.length) setActiveIdx(0);
  }, [matches.length, activeIdx]);

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
    setActiveIdx(0);
    inputRef.current?.focus();
  };

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
    }
  };

  const single = positions.length === 1 ? positions[0] : null;
  const who = single ? positionNoun(single, "plural") : "players";

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
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={
          open && matches[activeIdx] ? `${listboxId}-opt-${activeIdx}` : undefined
        }
        aria-describedby={helpId}
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

      {open && query.trim().length >= 2 && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Player search results"
          className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-card border border-line bg-surface-elevated shadow-2xl shadow-black/50"
        >
          {loading ? (
            <li className="px-3 py-3 text-sm text-ink-subtle">Searching...</li>
          ) : matches.length === 0 ? (
            <li className="px-3 py-3 text-sm text-ink-subtle">
              No active players match &quot;{query.trim()}&quot;.
            </li>
          ) : (
            matches.map((p, i) => {
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
            })
          )}
        </ul>
      )}
    </div>
  );
}
