"use client";

/**
 * Guess combobox: the WAI-ARIA combobox the player uses to name the target.
 * Mirrors the house pattern in app/tools/signal-check/asset-autocomplete.tsx
 * (useId-wired ids, role=combobox input with aria-activedescendant, debounced
 * fetch effect with a cancelled flag, outside-click close, arrow/enter/escape
 * handling, onMouseDown commit, sr-only aria-live status) but is not a clone
 * import: this file is Signal Scout specific (player-only results, ruled-out
 * state, a much longer debounce to respect the search route's rate limit).
 *
 * ANTI-CHEAT NOTE: /api/games/signal-scout/search is round-independent
 * public player data, safe to call before or during any round. This
 * component never receives or renders anything about the round's target.
 *
 * The search route enforces a roughly 1-second minimum interval per
 * identity, so the debounce below is 1000ms, not the signal-check
 * pattern's 250ms. A 429 (rate_limited) response holds the last good
 * results on screen instead of clearing them or surfacing an error.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { PlayerHeadshot } from "@/components/player-headshot";
import { searchPlayers, type SearchPlayerResult } from "@/lib/signal-scout/client";

const MIN_LENGTH = 2;
const DEBOUNCE_MS = 1000;

type SearchPhase = "idle" | "loading" | "ok" | "rate_limited" | "error";

function firstSelectableIndex(results: SearchPlayerResult[], ruledOut: Set<string>): number {
  return results.findIndex((r) => !ruledOut.has(r.id));
}

function nextSelectableIndex(
  results: SearchPlayerResult[],
  ruledOut: Set<string>,
  from: number,
  dir: 1 | -1,
): number {
  let i = from;
  for (let step = 0; step < results.length; step++) {
    i += dir;
    if (i < 0 || i >= results.length) return from;
    if (!ruledOut.has(results[i].id)) return i;
  }
  return from;
}

export interface GuessComboboxProps {
  disabled: boolean;
  ruledOutIds: string[];
  /**
   * The LIVE scoring.wrong_guess_penalty setting, display copy only (the
   * round's frozen snapshot governs the real deduction server-side).
   */
  wrongGuessPenalty: number;
  onSelect: (player: SearchPlayerResult) => void;
}

export function GuessCombobox({
  disabled,
  ruledOutIds,
  wrongGuessPenalty,
  onSelect,
}: GuessComboboxProps) {
  const inputId = useId();
  const listboxId = useId();
  const helpId = useId();
  const statusId = useId();

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchPlayerResult[]>([]);
  const [phase, setPhase] = useState<SearchPhase>("idle");
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const trimmed = query.trim();
  const longEnough = trimmed.length >= MIN_LENGTH;
  const ruledOutSet = useMemo(() => new Set(ruledOutIds), [ruledOutIds]);

  // Keep the active option pointed at a selectable (non-ruled-out) row
  // whenever the result set or the ruled-out set changes.
  useEffect(() => {
    setActiveIdx(firstSelectableIndex(results, ruledOutSet));
  }, [results, ruledOutSet]);

  // Debounced search. Below MIN_LENGTH, never hits the server (mirrors the
  // route's own short-circuit for queries under 2 characters).
  useEffect(() => {
    if (!longEnough) {
      setResults([]);
      setPhase("idle");
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setPhase("loading");
    const timer = setTimeout(async () => {
      try {
        const result = await searchPlayers(trimmed, { signal: controller.signal });
        if (cancelled) return;
        if (result.ok) {
          setResults(result.data.results);
          setPhase("ok");
          return;
        }
        if (result.code === "rate_limited") {
          // Hold whatever results are already on screen; do not clear and
          // do not surface an error for a debounce-respecting client.
          setPhase("rate_limited");
          return;
        }
        setResults([]);
        setPhase("error");
      } catch (err) {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setResults([]);
        setPhase("error");
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, longEnough]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function commit(r: SearchPlayerResult) {
    if (ruledOutSet.has(r.id)) return;
    onSelect(r);
    setQuery("");
    setResults([]);
    setPhase("idle");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => nextSelectableIndex(results, ruledOutSet, i, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => nextSelectableIndex(results, ruledOutSet, i, -1));
    } else if (e.key === "Enter") {
      if (open && activeIdx >= 0 && results[activeIdx] && !ruledOutSet.has(results[activeIdx].id)) {
        e.preventDefault();
        commit(results[activeIdx]);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    }
  }

  const showList = open && longEnough;
  const statusText = !longEnough
    ? ""
    : phase === "loading"
      ? "Searching"
      : phase === "error"
        ? "Search failed. Keep typing to retry."
        : phase === "rate_limited" && results.length === 0
          ? "Hold on, searching soon"
          : results.length === 0
            ? "No players found"
            : `${results.length} ${results.length === 1 ? "result" : "results"}`;

  return (
    <div ref={wrapperRef} className="relative">
      <label htmlFor={inputId} className="block text-sm font-medium text-ink">
        Name the player
      </label>
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listboxId}
        aria-activedescendant={
          showList && activeIdx >= 0 ? `${listboxId}-opt-${activeIdx}` : undefined
        }
        aria-describedby={`${helpId} ${statusId}`}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search for a player"
        className={`mt-2 min-h-11 w-full rounded-card border border-line bg-base px-3 py-2 text-base text-ink placeholder:text-ink-subtle caret-brand-purple focus:border-brand-purple focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm`}
      />
      <p id={helpId} className="mt-1 text-xs text-ink-subtle">
        Type at least 2 characters to search. Guessing wrong costs {wrongGuessPenalty} points.
      </p>
      <p id={statusId} aria-live="polite" className="sr-only">
        {statusText}
      </p>

      {showList && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Player search results"
          className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-card border border-line bg-surface shadow-2xl shadow-black/50"
        >
          {results.length === 0 ? (
            <li className="px-3 py-3 text-sm text-ink-subtle">
              {phase === "loading"
                ? "Searching..."
                : phase === "rate_limited"
                  ? "Hold on, searching soon."
                  : phase === "error"
                    ? "Search failed. Keep typing to retry."
                    : `No players found for "${trimmed}".`}
            </li>
          ) : (
            results.map((r, i) => {
              const ruledOut = ruledOutSet.has(r.id);
              const isActive = i === activeIdx;
              return (
                <li
                  key={r.id}
                  id={`${listboxId}-opt-${i}`}
                  role="option"
                  aria-selected={isActive}
                  aria-disabled={ruledOut ? true : undefined}
                  onMouseEnter={() => {
                    if (!ruledOut) setActiveIdx(i);
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit(r);
                  }}
                  className={`flex min-h-11 items-center gap-3 px-3 py-2 text-sm transition-colors ${
                    ruledOut
                      ? "cursor-not-allowed opacity-50"
                      : isActive
                        ? "cursor-pointer bg-brand-purple/15 text-ink"
                        : "cursor-pointer text-ink-muted"
                  }`}
                >
                  <PlayerHeadshot sleeperId={r.sleeperId} name="" size={28} />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-ink">{r.name}</span>
                    <span className="ml-2 text-xs text-ink-subtle">
                      {r.position ?? "?"}, {r.team ?? "FA"}
                    </span>
                  </span>
                  {ruledOut && (
                    <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
                      Ruled out
                    </span>
                  )}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
