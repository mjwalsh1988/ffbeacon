"use client";

/**
 * The Who Should I Start player picker: one WAI-ARIA combobox for adding
 * players, a role="list" of chips above it in add order, and the "How many
 * of these do you start?" stepper, built from breakdown-selector.tsx (which
 * this replaces).
 *
 * Unlike breakdown-selector.tsx's two fixed comboboxes, this is a single
 * repeatable combobox: committing a result appends a chip and the combobox
 * stays open for the next player, the way a tag input works. MIN_START_SIT_PLAYERS
 * (2) to MAX_START_SIT_PLAYERS (8) players, lib/start-sit/types.ts.
 *
 * WORKS WITHOUT JAVASCRIPT for the URL-driven path. The whole picker is one
 * GET form. The stepper is a native number input and the chip list state
 * mirrors initialPlayers, so a page loaded with ?p= already renders its
 * players as chips with no script required. Adding a NEW player needs the
 * search fetch, which needs JavaScript, so the <noscript> block swaps in a
 * plain labelled text field that accepts a comma-separated list of slugs or
 * names as p, matching the week picker's noscript pattern in
 * week-select.tsx. Preserved params (week, league, roster, format, source,
 * and anything else the page is holding) ride along as hidden inputs either
 * way.
 *
 * The run button pushes the URL client side and does not submit the form
 * natively; the actual GET submission is the no-JS path's job, handled by
 * the noscript submit button.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Loader2, Minus, Plus, Search, X } from "lucide-react";
import { PlayerHeadshot } from "@/components/player-headshot";
import {
  MAX_START_SIT_PLAYERS,
  MIN_START_SIT_PLAYERS,
} from "@/lib/start-sit/types";
import { clampStartCount } from "@/lib/start-sit/rank";
import { buildStartSitHref } from "./picker-url";

const FETCH_HEADERS = { "x-requested-with": "ff-beacon" } as const;
const MIN_QUERY_LENGTH = 2;

export type StartSitPickedPlayer = {
  slug: string;
  name: string;
  position: string | null;
  team: string | null;
  sleeperId: string | null;
};

type SearchResult = StartSitPickedPlayer & { playerId: string };

export function StartSitPicker({
  basePath,
  initialPlayers = [],
  initialStart = 1,
  formatDisplay,
  sourceDisplay,
}: {
  /**
   * The route the run button pushes to: "/tools/who-should-i-start" since
   * the folder move (section 2.9). A prop rather than a hardcoded literal so
   * a future move changes one string rather than every call site.
   */
  basePath: string;
  /** The current ?p= players, resolved with names, in URL order. */
  initialPlayers?: StartSitPickedPlayer[];
  /** The current ?start=, already clamped by the caller. */
  initialStart?: number;
  formatDisplay: string;
  sourceDisplay: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [players, setPlayers] = useState<StartSitPickedPlayer[]>(initialPlayers);
  const [start, setStart] = useState(() =>
    clampStartCount(initialStart, initialPlayers.length),
  );
  const [duplicateName, setDuplicateName] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const maxReasonId = useId();
  const chipsHeadingId = useId();
  const startInputId = useId();
  const noscriptPId = useId();

  const atMax = players.length >= MAX_START_SIT_PLAYERS;
  const canRun = players.length >= MIN_START_SIT_PLAYERS;
  const maxStart = Math.max(1, players.length - 1);

  // Removing or adding a player can move the requested start count outside
  // 1..N-1 (a chip removal can drop N below the old start count). Re-clamp
  // whenever the roster changes rather than only at submit time, so the
  // stepper's own displayed value and its min/max never disagree.
  useEffect(() => {
    setStart((prev) => clampStartCount(prev, players.length));
  }, [players.length]);

  const addPlayer = useCallback((result: SearchResult) => {
    setPlayers((prev) => {
      if (prev.some((p) => p.slug === result.slug)) {
        setDuplicateName(result.name);
        return prev;
      }
      setDuplicateName(null);
      return [
        ...prev,
        {
          slug: result.slug,
          name: result.name,
          position: result.position,
          team: result.team,
          sleeperId: result.sleeperId,
        },
      ];
    });
  }, []);

  const removePlayer = useCallback((slug: string) => {
    setPlayers((prev) => prev.filter((p) => p.slug !== slug));
    setDuplicateName(null);
    // Focus goes back to the combobox so a keyboard reader who just removed
    // a chip lands somewhere useful rather than on a button that vanished.
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const run = useCallback(() => {
    if (!canRun) return;
    const href = buildStartSitHref({
      basePath,
      slugs: players.map((p) => p.slug),
      start,
      preserve: searchParams,
    });
    startTransition(() => {
      router.push(href);
    });
  }, [basePath, canRun, players, start, searchParams, router]);

  // Every current query parameter except the ones this picker owns (p,
  // start, and the retired a/b aliases), carried as hidden inputs so the
  // no-JS GET submission preserves week, league, roster, format, source, and
  // anything else the page is holding.
  const hiddenParams = Array.from(searchParams.entries()).filter(
    ([key]) => !["p", "start", "a", "b"].includes(key),
  );

  return (
    <form
      method="get"
      action={basePath}
      className="rounded-modal border border-line bg-surface p-5 sm:p-7"
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ContextChip label="Format" value={formatDisplay} tone="purple" />
        <ContextChip label="Values" value={sourceDisplay ?? "-"} tone="cyan" />
        <p className="ml-auto text-[11px] text-ink-subtle">
          Change format or source from the site header.
        </p>
      </div>

      {hiddenParams.map(([key, value]) => (
        <input key={`${key}:${value}`} type="hidden" name={key} value={value} />
      ))}

      <h3 id={chipsHeadingId} className="sr-only">
        Players in this comparison
      </h3>
      {players.length > 0 && (
        <ul role="list" aria-labelledby={chipsHeadingId} className="mb-3 flex flex-wrap gap-2">
          {players.map((player) => (
            <li key={player.slug}>
              <PlayerChip player={player} onRemove={() => removePlayer(player.slug)} />
            </li>
          ))}
        </ul>
      )}

      {duplicateName && (
        <p role="alert" className="mb-3 text-sm text-signal-warning">
          {duplicateName} is already in the comparison.
        </p>
      )}

      <AddPlayerCombobox
        inputRef={inputRef}
        atMax={atMax}
        maxReasonId={maxReasonId}
        excludeSlugs={players.map((p) => p.slug)}
        onCommit={addPlayer}
      />

      <div className="mt-5 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor={startInputId} className="mb-2 block text-sm font-medium text-ink">
            How many of these do you start?
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStart((prev) => clampStartCount(prev - 1, players.length))}
              disabled={start <= 1}
              aria-label="Start one fewer"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line bg-base text-ink-muted transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Minus aria-hidden="true" className="h-4 w-4" />
            </button>
            <input
              id={startInputId}
              type="number"
              name="start"
              min={1}
              max={maxStart}
              step={1}
              value={start}
              onChange={(event) => {
                const next = Number(event.target.value);
                setStart(clampStartCount(Number.isFinite(next) ? next : 1, players.length));
              }}
              className="h-11 w-16 rounded-card border border-line bg-base text-center text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-cyan/30 sm:text-sm"
            />
            <button
              type="button"
              onClick={() => setStart((prev) => clampStartCount(prev + 1, players.length))}
              disabled={start >= maxStart}
              aria-label="Start one more"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line bg-base text-ink-muted transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={run}
          disabled={!canRun || isPending}
          className="inline-flex min-h-11 items-center gap-2 rounded-card bg-beacon px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isPending ? (
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          ) : (
            <Search aria-hidden="true" className="h-4 w-4" />
          )}
          Who should I start?
          {!isPending && <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />}
        </button>
        {!canRun && (
          <p className="text-sm text-ink-subtle">
            Add at least {MIN_START_SIT_PLAYERS} players to see who to start.
          </p>
        )}
      </div>

      {/* Only rendered by a browser with scripting off. A scripted browser
          adds players through the combobox above and never needs this. */}
      <noscript>
        <div className="mt-5 border-t border-line pt-5">
          <label htmlFor={noscriptPId} className="mb-2 block text-sm font-medium text-ink">
            Players (comma-separated names or slugs)
          </label>
          <input
            id={noscriptPId}
            type="text"
            name="p"
            defaultValue={initialPlayers.map((p) => p.slug).join(", ")}
            placeholder="bijan robinson, josh jacobs"
            className="w-full rounded-card border border-line bg-base px-3 py-2.5 text-[16px] text-ink placeholder:text-ink-subtle sm:text-sm"
          />
          <button
            type="submit"
            className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-card bg-beacon px-5 py-2.5 text-sm font-semibold text-black hover:opacity-90"
          >
            Who should I start?
          </button>
        </div>
      </noscript>
    </form>
  );
}

function ContextChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "cyan" | "purple";
}) {
  const palette =
    tone === "cyan"
      ? { bg: "rgba(34, 211, 238, 0.08)", border: "rgba(34, 211, 238, 0.30)" }
      : { bg: "rgba(168, 85, 247, 0.08)", border: "rgba(168, 85, 247, 0.30)" };
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs"
      style={{ backgroundColor: palette.bg, borderColor: palette.border }}
    >
      <span className="font-semibold uppercase tracking-[0.14em] text-ink-subtle">{label}</span>
      <span className="font-semibold text-ink">{value}</span>
    </span>
  );
}

function PlayerChip({
  player,
  onRemove,
}: {
  player: StartSitPickedPlayer;
  onRemove: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`Remove ${player.name} from the comparison`}
      className="group flex min-h-11 items-center gap-2 rounded-full border border-line bg-base/60 py-1 pl-1 pr-3 text-sm text-ink transition-colors hover:border-signal-warning/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
    >
      <PlayerHeadshot sleeperId={player.sleeperId} name="" size={28} />
      <span className="max-w-[10rem] truncate">
        {player.name}
        {player.position ? (
          <span className="ml-1 text-xs text-ink-subtle">{player.position}</span>
        ) : null}
      </span>
      <X
        aria-hidden="true"
        className="h-3.5 w-3.5 shrink-0 text-ink-muted transition-colors group-hover:text-signal-warning"
      />
    </button>
  );
}

/**
 * The repeatable "add a player" combobox (WAI-ARIA combobox-with-listbox),
 * adapted from breakdown-selector.tsx's PlayerPicker. Committing a result
 * calls onCommit and clears back to an empty search rather than replacing
 * itself with a selected chip, since the chip lives in the list above.
 */
function AddPlayerCombobox({
  inputRef,
  atMax,
  maxReasonId,
  excludeSlugs,
  onCommit,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  atMax: boolean;
  maxReasonId: string;
  /** Slugs already picked, greyed out in the results so a reader cannot double-add by clicking. */
  excludeSlugs: string[];
  onCommit: (result: SearchResult) => void;
}) {
  const listboxId = useId();
  const statusId = useId();
  const inputId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  const trimmed = query.trim();
  const longEnough = trimmed.length >= MIN_QUERY_LENGTH;

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
        const params = new URLSearchParams({ q: trimmed });
        const res = await fetch(`/api/breakdown/search?${params.toString()}`, {
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
  }, [trimmed, longEnough]);

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

  const commit = useCallback(
    (r: SearchResult) => {
      onCommit(r);
      setQuery("");
      setResults([]);
      setOpen(false);
      // Stays focused, unlike breakdown-selector's single-shot picker: the
      // reader is very likely adding another player next.
      inputRef.current?.focus();
    },
    [onCommit, inputRef],
  );

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
      if (open && results[activeIdx] && !excludeSlugs.includes(results[activeIdx].slug)) {
        event.preventDefault();
        commit(results[activeIdx]);
      }
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
    }
  };

  const showList = open && longEnough && !atMax;
  const statusText = atMax
    ? ""
    : !longEnough
      ? ""
      : loading
        ? "Searching for players"
        : results.length === 0
          ? "No players found"
          : `${results.length} player${results.length === 1 ? "" : "s"} found`;

  return (
    <div ref={wrapperRef} className="relative">
      <label htmlFor={inputId} className="mb-2 block text-sm font-medium text-ink">
        Add a player
      </label>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
        />
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listboxId}
          aria-activedescendant={
            showList && results[activeIdx] ? `${listboxId}-opt-${activeIdx}` : undefined
          }
          aria-describedby={atMax ? maxReasonId : statusId}
          disabled={atMax}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search a player"
          className="w-full rounded-card border border-line bg-base py-2.5 pl-9 pr-3 text-[16px] text-ink placeholder:text-ink-subtle focus:border-brand-purple focus:outline-none focus:ring-2 focus:ring-brand-purple/30 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
        />
      </div>

      {atMax ? (
        <p id={maxReasonId} className="mt-2 text-sm text-ink-subtle">
          You can compare up to {MAX_START_SIT_PLAYERS} players at once. Remove one to add another.
        </p>
      ) : (
        <p id={statusId} className="sr-only" role="status" aria-live="polite">
          {statusText}
        </p>
      )}

      {showList && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Player suggestions"
          className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-card border border-line bg-surface-elevated shadow-2xl shadow-black/50"
        >
          {loading ? (
            <li role="presentation" className="flex items-center gap-2 px-3 py-3 text-sm text-ink-subtle">
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              Searching...
            </li>
          ) : results.length === 0 ? (
            <li role="presentation" className="px-3 py-3 text-sm text-ink-subtle">
              No players match &quot;{trimmed}&quot;.
            </li>
          ) : (
            results.map((r, i) => {
              const isActive = i === activeIdx;
              const isPicked = excludeSlugs.includes(r.slug);
              return (
                <li
                  key={r.slug}
                  id={`${listboxId}-opt-${i}`}
                  role="option"
                  aria-selected={isActive}
                  aria-disabled={isPicked || undefined}
                  onMouseEnter={() => setActiveIdx(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (!isPicked) commit(r);
                  }}
                  className={`flex items-center gap-3 px-3 py-2 text-sm motion-safe:transition-colors ${
                    isPicked
                      ? "cursor-not-allowed opacity-40"
                      : isActive
                        ? "cursor-pointer bg-brand-purple/15 text-ink"
                        : "cursor-pointer text-ink-muted"
                  }`}
                >
                  <PlayerHeadshot sleeperId={r.sleeperId} name="" size={32} />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-ink">{r.name}</span>
                    <span className="ml-2 text-xs text-ink-subtle">
                      {r.position}
                      {r.team ? `, ${r.team}` : ""}
                    </span>
                  </span>
                  {isPicked && (
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-subtle">
                      picked
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
