"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

export type FaabPlayer = {
  slug: string;
  name: string;
  position: string;
  team: string | null;
  overall_rank: number;
  value: number | null;
};

type NeedLevel = "low" | "medium" | "high";

const NEED_MULTIPLIER: Record<NeedLevel, number> = {
  low: 0.6,
  medium: 1.0,
  high: 1.5,
};

const NEED_LABEL: Record<NeedLevel, string> = {
  low: "Bench depth (low need)",
  medium: "Streamer / FLEX (medium need)",
  high: "Starter you need now (high need)",
};

const MAX_SUGGESTIONS = 40;

export function FaabForm({
  players,
  formatName,
}: {
  players: FaabPlayer[];
  formatName: string;
}) {
  const [query, setQuery] = useState("");
  const [selectedPlayer, setSelectedPlayer] = useState<FaabPlayer | null>(null);
  const [budget, setBudget] = useState(100);
  const [need, setNeed] = useState<NeedLevel>("medium");

  const recommendation = useMemo(() => {
    if (!selectedPlayer) return null;
    const value = selectedPlayer.value;
    const rank = selectedPlayer.overall_rank;
    // Base percentage of remaining budget based on rank tier
    let basePct = 0;
    if (rank <= 24) basePct = 0.4;
    else if (rank <= 48) basePct = 0.25;
    else if (rank <= 96) basePct = 0.12;
    else if (rank <= 150) basePct = 0.05;
    else basePct = 0.02;

    // Adjust by market value relative to top
    const valueAdj = value && value > 0 ? Math.min(1.4, value / 6500) : 1;
    const needMult = NEED_MULTIPLIER[need];

    const center = budget * basePct * valueAdj * needMult;
    const low = Math.max(1, Math.floor(center * 0.7));
    const high = Math.max(low + 1, Math.ceil(center * 1.3));

    return {
      low,
      high,
      reasoning: [
        `${selectedPlayer.name} is ranked #${rank} for ${formatName}.`,
        value ? `Market value ${value.toLocaleString()}.` : null,
        `${NEED_LABEL[need]}.`,
        `Budget remaining ${budget} FAAB.`,
      ]
        .filter(Boolean)
        .join(" "),
    };
  }, [selectedPlayer, budget, need, formatName]);

  return (
    <form
      onSubmit={(event) => event.preventDefault()}
      className="space-y-6 rounded-card border border-line bg-surface p-6"
      aria-labelledby="faab-form-heading"
    >
      <h2 id="faab-form-heading" className="sr-only">
        FAAB calculator inputs
      </h2>
      <PlayerCombobox
        players={players}
        query={query}
        onQueryChange={setQuery}
        selected={selectedPlayer}
        onSelect={(p) => {
          setSelectedPlayer(p);
          setQuery(p ? p.name : "");
        }}
        formatName={formatName}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="faab-budget" className="block text-sm font-medium">
            FAAB budget remaining
          </label>
          <input
            id="faab-budget"
            type="number"
            min={1}
            max={1000}
            value={budget}
            onChange={(event) => setBudget(Number.parseInt(event.target.value || "0", 10))}
            className="mt-2 w-full rounded-card border border-line bg-base px-3 py-2 text-sm text-ink caret-brand-purple focus:border-brand-purple focus:outline-none"
          />
        </div>
        <fieldset>
          <legend className="block text-sm font-medium">Roster need</legend>
          <div className="mt-2 flex flex-col gap-1 text-sm">
            {(["low", "medium", "high"] as NeedLevel[]).map((level) => (
              <label key={level} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="need"
                  value={level}
                  checked={need === level}
                  onChange={() => setNeed(level)}
                />
                <span>{NEED_LABEL[level]}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <div aria-live="polite" className="rounded-card border border-line bg-base p-4">
        {!selectedPlayer ? (
          <p className="text-sm text-ink-muted">
            Pick a player to see a recommended bid range.
          </p>
        ) : recommendation ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm uppercase tracking-wide text-ink-subtle">Recommended bid</p>
            <p className="font-mono text-3xl font-semibold text-ink">
              {recommendation.low} – {recommendation.high} FAAB
            </p>
            <p className="text-sm text-ink-muted">{recommendation.reasoning}</p>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">
            We could not compute a bid for that player. Make sure the name matches an option in the
            suggestion list.
          </p>
        )}
      </div>
    </form>
  );
}

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
 */
function PlayerCombobox({
  players,
  query,
  onQueryChange,
  selected,
  onSelect,
  formatName,
}: {
  players: FaabPlayer[];
  query: string;
  onQueryChange: (q: string) => void;
  selected: FaabPlayer | null;
  onSelect: (player: FaabPlayer | null) => void;
  formatName: string;
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
      // Empty query — show the top-ranked players so users see something
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
        Player
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
            // Editing invalidates the current selection — caller re-resolves
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
            <span aria-hidden="true">✕</span>
          </button>
        )}
      </div>

      <p id={helpId} className="mt-1 text-xs text-ink-subtle">
        Pull from the top 300 ranked players. {formatName} format.
      </p>

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Player suggestions"
          className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-card border border-line bg-surface-elevated shadow-2xl shadow-black/50"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-3 text-sm text-ink-subtle">
              No players match &ldquo;{query}&rdquo;.
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
                  className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm transition-colors ${
                    isActive ? "bg-brand-purple/15 text-ink" : "text-ink-muted"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-ink">{p.name}</span>
                    <span className="ml-2 text-xs text-ink-subtle">
                      {p.position}
                      {p.team ? ` · ${p.team}` : ""}
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
