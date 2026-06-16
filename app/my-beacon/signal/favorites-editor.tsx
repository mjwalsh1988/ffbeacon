"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import { Save, X } from "lucide-react";
import { NFL_TEAMS } from "@/lib/nfl-teams";
import { saveFavorites, searchPlayers } from "./actions";
import { type PlayerSearchResult } from "./customization";

/**
 * Favorites editor for a Signal: favorite NFL team (labeled select) and
 * favorite player (accessible debounced typeahead over the players table). Both
 * are optional and can be cleared back to null. Selections persist together on
 * Save via the saveFavorites server action (owner-only RLS; team code is
 * validated against the canonical list and the player id against a real players
 * row, with the DB CHECK + FK as backstops). Reorder is not relevant here; the
 * accessibility focus is the combobox pattern and clear-to-null announcements.
 */
export function FavoritesEditor({
  initialTeam,
  initialPlayer,
}: {
  initialTeam: string | null;
  initialPlayer: PlayerSearchResult | null;
}) {
  const [team, setTeam] = useState<string>(initialTeam ?? "");
  const [player, setPlayer] = useState<PlayerSearchResult | null>(initialPlayer);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [pending, startTransition] = useTransition();

  const teamSelectId = useId();

  const markDirty = () => {
    setDirty(true);
    setSaved(false);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await saveFavorites({
        favoriteTeam: team || null,
        favoritePlayerId: player?.id ?? null,
      });
      if (res.ok) {
        setDirty(false);
        setSaved(true);
        setAnnouncement("Favorites saved.");
      } else {
        setError(res.error);
        setAnnouncement("");
      }
    });
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-6 rounded-card border border-line bg-surface p-5 sm:p-6"
      aria-labelledby="signal-favorites-form-heading"
    >
      <h3 id="signal-favorites-form-heading" className="sr-only">
        Favorite team and player
      </h3>

      {/* Favorite team ----------------------------------------------------- */}
      <div>
        <label
          htmlFor={teamSelectId}
          className="block text-sm font-medium text-ink"
        >
          Favorite NFL team
        </label>
        <select
          id={teamSelectId}
          value={team}
          disabled={pending}
          onChange={(e) => {
            setTeam(e.target.value);
            markDirty();
            setAnnouncement(
              e.target.value
                ? `${
                    NFL_TEAMS.find((t) => t.code === e.target.value)?.name ??
                    e.target.value
                  } selected as your favorite team.`
                : "Favorite team cleared.",
            );
          }}
          className="mt-2 h-11 w-full rounded-card border border-line bg-base px-3 text-base text-ink focus:border-brand-purple focus:outline-none sm:text-sm"
        >
          <option value="">No favorite team</option>
          {NFL_TEAMS.map((t) => (
            <option key={t.code} value={t.code}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {/* Favorite player --------------------------------------------------- */}
      <PlayerTypeahead
        selected={player}
        disabled={pending}
        onSelect={(p) => {
          setPlayer(p);
          markDirty();
          setAnnouncement(
            p ? `${p.name} selected as your favorite player.` : "Favorite player cleared.",
          );
        }}
      />

      <div className="flex flex-wrap items-center gap-4 border-t border-line pt-5">
        <button
          type="submit"
          disabled={pending || !dirty}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-card bg-beacon px-5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
        >
          <Save aria-hidden="true" className="h-4 w-4" />
          {pending ? "Saving..." : "Save favorites"}
        </button>
        <div aria-live="polite" role="status" className="min-h-[1.25rem] text-sm">
          {saved && !dirty && <p className="text-signal-success">Favorites saved.</p>}
          {dirty && !error && (
            <p className="text-ink-subtle">You have unsaved changes.</p>
          )}
        </div>
      </div>

      {/* Status + error live regions. */}
      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>
      <div aria-live="assertive" className="min-h-[1.25rem]">
        {error && (
          <p role="alert" className="text-sm text-signal-danger">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}

/**
 * Accessible combobox over the players table, following the WAI-ARIA
 * combobox-with-listbox pattern: role="combobox" on the input, aria-expanded +
 * aria-controls wired to the listbox, aria-activedescendant tracking the
 * highlighted option, and a polite live region announcing the result count.
 * Results are fetched (debounced) through the searchPlayers server action.
 */
function PlayerTypeahead({
  selected,
  disabled,
  onSelect,
}: {
  selected: PlayerSearchResult | null;
  disabled: boolean;
  onSelect: (player: PlayerSearchResult | null) => void;
}) {
  const inputId = useId();
  const listboxId = useId();
  const helpId = useId();
  const statusId = useId();

  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeq = useRef(0);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlayerSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  // Debounced fetch. A monotonically increasing request id guards against
  // out-of-order responses overwriting a newer query's results.
  const runSearch = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const id = ++requestSeq.current;
      const found = await searchPlayers(trimmed);
      if (id !== requestSeq.current) return;
      setResults(found);
      setActiveIdx(0);
      setLoading(false);
    }, 250);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Click-outside closes the listbox.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent | TouchEvent) => {
      const node = wrapperRef.current;
      if (node && !node.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  const commit = (p: PlayerSearchResult) => {
    onSelect(p);
    setQuery("");
    setResults([]);
    setOpen(false);
    inputRef.current?.blur();
  };

  const clear = () => {
    onSelect(null);
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.min(results.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter") {
      if (open && results[activeIdx]) {
        event.preventDefault();
        commit(results[activeIdx]);
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
        setActiveIdx(results.length - 1);
      }
    }
  };

  const statusText = loading
    ? "Searching..."
    : query.trim().length >= 2
      ? `${results.length} player${results.length === 1 ? "" : "s"} found.`
      : "";

  return (
    <div ref={wrapperRef} className="relative">
      <label htmlFor={inputId} className="block text-sm font-medium text-ink">
        Favorite player
      </label>

      {selected ? (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-card border border-line bg-base p-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">
              {selected.name}
            </p>
            <p className="truncate text-xs text-ink-subtle">
              {selected.position}
              {selected.team ? `, ${selected.team}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={clear}
            disabled={disabled}
            aria-label={`Clear ${selected.name} as your favorite player`}
            className="inline-flex h-11 items-center gap-1.5 rounded-card border border-line px-3 text-xs font-semibold text-ink-muted hover:border-signal-danger/60 hover:text-signal-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-40 sm:h-9"
          >
            <X aria-hidden="true" className="h-4 w-4" />
            Clear
          </button>
        </div>
      ) : (
        <>
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
                open && results[activeIdx]
                  ? `${listboxId}-opt-${activeIdx}`
                  : undefined
              }
              aria-describedby={`${helpId} ${statusId}`}
              autoComplete="off"
              spellCheck={false}
              disabled={disabled}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
                runSearch(e.target.value);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={onKeyDown}
              placeholder="Start typing a player name"
              className="w-full rounded-card border border-line bg-base px-3 py-2.5 text-base text-ink caret-brand-purple placeholder:text-ink-subtle focus:border-brand-purple focus:outline-none sm:text-sm"
            />
          </div>

          <p id={helpId} className="mt-1 text-xs text-ink-subtle">
            Search any NFL player. Leave empty for no favorite player.
          </p>

          {open && (query.trim().length >= 2 || results.length > 0) && (
            <ul
              id={listboxId}
              role="listbox"
              aria-label="Player results"
              className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-card border border-line bg-surface-elevated shadow-2xl shadow-black/50"
            >
              {loading ? (
                <li
                  role="presentation"
                  className="px-3 py-3 text-sm text-ink-subtle"
                >
                  Searching...
                </li>
              ) : results.length === 0 ? (
                <li
                  role="presentation"
                  className="px-3 py-3 text-sm text-ink-subtle"
                >
                  No players match that name.
                </li>
              ) : (
                results.map((p, i) => {
                  const isActive = i === activeIdx;
                  return (
                    <li
                      key={p.id}
                      id={`${listboxId}-opt-${i}`}
                      role="option"
                      aria-selected={isActive}
                      onMouseEnter={() => setActiveIdx(i)}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        commit(p);
                      }}
                      className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm transition-colors ${
                        isActive ? "bg-brand-purple/15 text-ink" : "text-ink-muted"
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate text-ink">
                        {p.name}
                      </span>
                      <span className="shrink-0 text-xs text-ink-subtle">
                        {p.position}
                        {p.team ? `, ${p.team}` : ""}
                      </span>
                    </li>
                  );
                })
              )}
            </ul>
          )}
        </>
      )}

      {/* Polite result-count announcer for screen readers. */}
      <p id={statusId} aria-live="polite" role="status" className="sr-only">
        {statusText}
      </p>
    </div>
  );
}
