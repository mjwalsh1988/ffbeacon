"use client";

/**
 * Player guess combobox: the WAI-ARIA combobox the daily games use to name a
 * player. Extracted from app/games/signal-scout/guess-combobox.tsx so Signal
 * Scout and Long Shot share one implementation (Long Shot plan 18.3).
 *
 * useId-wired ids, role=combobox input with aria-activedescendant, a
 * debounced fetch with a canceled flag, outside-click close, arrow, Enter
 * and Escape handling, onMouseDown commit, and an sr-only status that speaks
 * only about search results. A rate_limited answer keeps the last good
 * results on screen rather than clearing them.
 *
 * The listbox renders at most MAX_OPTIONS options so arrowing through results
 * under a clock is bounded.
 *
 * ANTI-CHEAT NOTE: the injected search function returns public player data
 * only. This component never receives or renders anything about a round's
 * answer.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { NflTeamLogo } from "@/components/nfl-team-logo";
import { PlayerHeadshot } from "@/components/player-headshot";

export interface SearchPlayerResult {
  id: string;
  name: string;
  position: string | null;
  team: string | null;
  sleeperId: string | null;
}

export type SearchOutcome = { ok: true; results: SearchPlayerResult[] } | { ok: false; code: string };

export const MAX_OPTIONS = 8;

export type SearchPhase = "idle" | "loading" | "ok" | "rate_limited" | "error";

export function firstSelectableIndex(results: readonly SearchPlayerResult[], ruledOut: ReadonlySet<string>): number {
  return results.findIndex((r) => !ruledOut.has(r.id));
}

export function nextSelectableIndex(
  results: readonly SearchPlayerResult[],
  ruledOut: ReadonlySet<string>,
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

/** Pure: the next (results, phase) after a search answers. */
export function applySearchOutcome(
  prev: { results: SearchPlayerResult[]; phase: SearchPhase },
  outcome: SearchOutcome,
): { results: SearchPlayerResult[]; phase: SearchPhase } {
  if (outcome.ok) return { results: outcome.results.slice(0, MAX_OPTIONS), phase: "ok" };
  if (outcome.code === "rate_limited") return { results: prev.results, phase: "rate_limited" };
  return { results: [], phase: "error" };
}

export type KeyAction =
  | { type: "move"; index: number }
  | { type: "commit"; index: number }
  | { type: "close" }
  | { type: "none" };

/** Pure: what a key press does to the combobox. */
export function comboboxKeyAction(
  key: string,
  state: { open: boolean; activeIdx: number; results: readonly SearchPlayerResult[]; ruledOut: ReadonlySet<string> },
): KeyAction {
  const { open, activeIdx, results, ruledOut } = state;
  if (key === "ArrowDown") return { type: "move", index: nextSelectableIndex(results, ruledOut, activeIdx, 1) };
  if (key === "ArrowUp") return { type: "move", index: nextSelectableIndex(results, ruledOut, activeIdx, -1) };
  if (key === "Enter") {
    const r = results[activeIdx];
    return open && activeIdx >= 0 && r && !ruledOut.has(r.id) ? { type: "commit", index: activeIdx } : { type: "none" };
  }
  if (key === "Escape") return open ? { type: "close" } : { type: "none" };
  return { type: "none" };
}

export interface PlayerGuessComboboxProps {
  disabled: boolean;
  ruledOutIds: string[];
  label: string;
  helpText: string;
  debounceMs: number;
  minLength: number;
  /** Adds the team crest beside the headshot in each option (Long Shot). */
  showTeamLogos: boolean;
  search: (q: string, signal: AbortSignal) => Promise<SearchOutcome>;
  onSelect: (player: SearchPlayerResult) => void;
  /** Optional: told whenever the typed text changes, so a parent can clear a stale choice. */
  onQueryChange?: (q: string) => void;
}

export function PlayerGuessCombobox({
  disabled,
  ruledOutIds,
  label,
  helpText,
  debounceMs,
  minLength,
  showTeamLogos,
  search,
  onSelect,
  onQueryChange,
}: PlayerGuessComboboxProps) {
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
  const searchRef = useRef(search);
  const resultsRef = useRef(results);
  useEffect(() => {
    searchRef.current = search;
    resultsRef.current = results;
  });

  const trimmed = query.trim();
  const longEnough = trimmed.length >= minLength;
  const ruledOutSet = useMemo(() => new Set(ruledOutIds), [ruledOutIds]);

  useEffect(() => {
    setActiveIdx(firstSelectableIndex(results, ruledOutSet));
  }, [results, ruledOutSet]);

  useEffect(() => {
    if (!longEnough) {
      setResults([]);
      setPhase("idle");
      return;
    }
    let canceled = false;
    const controller = new AbortController();
    setPhase("loading");
    const timer = setTimeout(async () => {
      try {
        const outcome = await searchRef.current(trimmed, controller.signal);
        if (canceled) return;
        const next = applySearchOutcome({ results: resultsRef.current, phase: "loading" }, outcome);
        setResults(next.results);
        setPhase(next.phase);
      } catch (err) {
        if (canceled) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setResults([]);
        setPhase("error");
      }
    }, debounceMs);
    return () => {
      canceled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, longEnough, debounceMs]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
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
    const action = comboboxKeyAction(e.key, { open, activeIdx, results, ruledOut: ruledOutSet });
    if (action.type === "move") {
      e.preventDefault();
      setOpen(true);
      setActiveIdx(action.index);
    } else if (action.type === "commit") {
      e.preventDefault();
      commit(results[action.index]);
    } else if (action.type === "close") {
      e.preventDefault();
      setOpen(false);
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
        {label}
      </label>
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listboxId}
        aria-activedescendant={showList && activeIdx >= 0 ? `${listboxId}-opt-${activeIdx}` : undefined}
        aria-describedby={`${helpId} ${statusId}`}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          onQueryChange?.(e.target.value);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search for a player"
        className="mt-2 min-h-11 w-full rounded-card border border-line bg-base px-3 py-2 text-base text-ink placeholder:text-ink-subtle caret-brand-purple focus:border-brand-purple focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
      />
      <p id={helpId} className="mt-1 text-xs text-ink-subtle">
        {helpText}
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
                  {showTeamLogos && (
                    <span className="inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center">
                      <NflTeamLogo team={r.team} size={14} />
                    </span>
                  )}
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
