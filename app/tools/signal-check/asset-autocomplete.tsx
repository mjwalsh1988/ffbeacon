"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Plus, Info } from "lucide-react";

const FETCH_HEADERS = { "x-requested-with": "ff-beacon" } as const;

/**
 * True when the typed query looks like a draft pick. A bare 20xx year is enough,
 * matching the server's loose pick suggestions. Used only to decide whether to
 * nudge the user toward a dynasty format, never to build picks.
 */
function looksLikePick(q: string): boolean {
  return /\b20\d{2}\b/.test(q);
}

export type SearchResult =
  | {
      kind: "player";
      playerId: string;
      name: string;
      position: string | null;
      team: string | null;
      sleeperId: string | null;
    }
  | {
      kind: "pick";
      season: number;
      round: number;
      pickPosition: "early" | "mid" | "late" | null;
      label: string;
    };

function resultKey(r: SearchResult): string {
  return r.kind === "player"
    ? `player:${r.playerId}`
    : `pick:${r.season}:${r.round}:${r.pickPosition ?? "unknown"}`;
}

function resultName(r: SearchResult): string {
  return r.kind === "player" ? r.name : r.label;
}

function resultDetail(r: SearchResult): string {
  if (r.kind === "player") {
    return [r.position, r.team].filter(Boolean).join(", ");
  }
  return "Draft pick";
}

export function AssetAutocomplete({
  sideLabel,
  formatSlug,
  allowsPicks,
  minLength,
  onSelect,
}: {
  sideLabel: string;
  formatSlug: string;
  allowsPicks: boolean;
  minLength: number;
  onSelect: (result: SearchResult) => void;
}) {
  const inputId = useId();
  const listboxId = useId();
  const helpId = useId();
  const statusId = useId();

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const trimmed = query.trim();
  const longEnough = trimmed.length >= minLength;
  // Picks are dynasty-only. When the user types a pick-shaped query on a redraft
  // (or not-yet-selected) format, nudge them toward a dynasty format instead of
  // silently returning players only.
  const showPickHint = !allowsPicks && looksLikePick(trimmed);

  // Debounced search.
  useEffect(() => {
    if (!longEnough) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: trimmed, format: formatSlug });
        const res = await fetch(`/api/signal-check/search?${params.toString()}`, {
          headers: FETCH_HEADERS,
        });
        const data = (await res.json()) as { results?: SearchResult[] };
        if (!cancelled) {
          setResults(data.results ?? []);
          setActiveIdx(0);
        }
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, longEnough, formatSlug]);

  // Close on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function commit(result: SearchResult) {
    onSelect(result);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      if (open && results[activeIdx]) {
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
    : loading
      ? "Searching"
      : `${results.length} ${results.length === 1 ? "result" : "results"}`;

  return (
    <div ref={wrapperRef} className="relative">
      <label htmlFor={inputId} className="block text-sm font-medium text-ink">
        Add an asset to {sideLabel}
      </label>
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listboxId}
        aria-activedescendant={showList && results[activeIdx] ? `${listboxId}-opt-${activeIdx}` : undefined}
        aria-describedby={`${helpId} ${statusId}`}
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search players, or a year like 2027 for picks"
        className="mt-2 min-h-11 w-full rounded-card border border-line bg-base px-3 py-2 text-base text-ink placeholder:text-ink-subtle caret-brand-purple focus:border-brand-purple focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:text-sm"
      />
      <p id={helpId} className="mt-1 text-xs text-ink-subtle">
        Type at least {minLength} characters. Players, plus draft picks in dynasty formats.
      </p>
      <p id={statusId} aria-live="polite" className="sr-only">
        {statusText}
      </p>

      {showPickHint && (
        <div
          role="note"
          aria-live="polite"
          className="mt-2 flex items-start gap-2 rounded-card border border-brand-cyan/30 bg-brand-cyan/5 px-3 py-2 text-xs leading-relaxed text-ink-muted"
        >
          <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brand-cyan" />
          <span>
            Draft picks are only available in dynasty formats. Choose a dynasty league format above
            to add picks to this trade.
          </span>
        </div>
      )}

      {showList && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={`Asset search results for ${sideLabel}`}
          className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-card border border-line bg-surface shadow-2xl shadow-black/50"
        >
          {loading ? (
            <li className="px-3 py-3 text-sm text-ink-subtle">Searching...</li>
          ) : results.length === 0 ? (
            <li className="px-3 py-3 text-sm text-ink-subtle">
              No matches for &ldquo;{trimmed}&rdquo;.
            </li>
          ) : (
            results.map((r, i) => {
              const isActive = i === activeIdx;
              return (
                <li
                  key={resultKey(r)}
                  id={`${listboxId}-opt-${i}`}
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setActiveIdx(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit(r);
                  }}
                  className={`flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm transition-colors ${
                    isActive ? "bg-brand-purple/15 text-ink" : "text-ink-muted"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-ink">{resultName(r)}</span>
                    <span className="ml-2 text-xs text-ink-subtle">{resultDetail(r)}</span>
                  </span>
                  <Plus aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-cyan" />
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
