"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { BarChart3, Database, Sparkles, Trophy } from "lucide-react";

export type FaabPlayer = {
  slug: string;
  name: string;
  position: string;
  team: string | null;
  overall_rank: number;
  /** Per-position rank from rankings.position_rank for the resolved
   * (format, source) pair. Surfaced in the selected-player card. */
  position_rank: number;
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
  rankingsSourceName,
  valueSourceName,
}: {
  players: FaabPlayer[];
  formatName: string;
  /** Display name of the source backing the rankings (e.g. "KTC",
   * "FantasyCalc"). Falls back to null when no source covers the format. */
  rankingsSourceName: string | null;
  /** Same, for the player_value_history source. Often equal to rankings
   * source but can differ when one source publishes rankings only. */
  valueSourceName: string | null;
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

      <SourceContextBar
        formatName={formatName}
        rankingsSourceName={rankingsSourceName}
        valueSourceName={valueSourceName}
      />

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

      {selectedPlayer && (
        <SelectedPlayerCard
          player={selectedPlayer}
          formatName={formatName}
          rankingsSourceName={rankingsSourceName}
          valueSourceName={valueSourceName}
        />
      )}

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
      <div
        aria-live="polite"
        className="rounded-card border border-brand-cyan/30 bg-brand-cyan/5 p-4"
      >
        {!selectedPlayer ? (
          <p className="text-sm text-ink-muted">
            Pick a player to see a recommended bid range.
          </p>
        ) : recommendation ? (
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-1.5 text-xs uppercase tracking-[0.16em] text-brand-cyan">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Recommended bid
            </p>
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
 * Small banner pinned to the top of the form so the user always knows which
 * (source, format) pair is feeding rankings + values. Mirrors the design of
 * the league overview header chips: icon + label + value, brand-cyan accents.
 */
function SourceContextBar({
  formatName,
  rankingsSourceName,
  valueSourceName,
}: {
  formatName: string;
  rankingsSourceName: string | null;
  valueSourceName: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-base/60 px-3 py-2.5 text-xs text-ink-muted">
      <ContextChip
        icon={Trophy}
        label="Format"
        value={formatName}
        tone="purple"
      />
      <ContextChip
        icon={BarChart3}
        label="Rankings"
        value={rankingsSourceName ?? "—"}
        tone="cyan"
      />
      {valueSourceName && valueSourceName !== rankingsSourceName ? (
        <ContextChip
          icon={Database}
          label="Values"
          value={valueSourceName}
          tone="cyan"
        />
      ) : (
        <ContextChip
          icon={Database}
          label="Values"
          value={valueSourceName ?? rankingsSourceName ?? "—"}
          tone="cyan"
        />
      )}
      <p className="ml-auto text-[11px] text-ink-subtle">
        Change source or format from the site header.
      </p>
    </div>
  );
}

function ContextChip({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Trophy;
  label: string;
  value: string;
  tone: "cyan" | "purple";
}) {
  const palette =
    tone === "cyan"
      ? {
          backgroundColor: "rgba(34, 211, 238, 0.08)",
          borderColor: "rgba(34, 211, 238, 0.30)",
          iconColor: "#22D3EE",
        }
      : {
          backgroundColor: "rgba(168, 85, 247, 0.08)",
          borderColor: "rgba(168, 85, 247, 0.30)",
          iconColor: "#A855F7",
        };
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs"
      style={{
        backgroundColor: palette.backgroundColor,
        borderColor: palette.borderColor,
      }}
    >
      <Icon
        className="h-3.5 w-3.5"
        style={{ color: palette.iconColor }}
        aria-hidden="true"
      />
      <span className="font-semibold uppercase tracking-[0.14em] text-ink-subtle">
        {label}
      </span>
      <span className="font-semibold text-ink">{value}</span>
    </span>
  );
}

/**
 * Selected-player card. Shows the player identity (position badge, name,
 * NFL team) on the left and the three metrics that drive the FAAB heuristic
 * on the right: per-position rank, overall rank, and market value — each
 * labeled with the source it came from so users know which data they're
 * looking at (KTC vs FantasyCalc).
 */
function SelectedPlayerCard({
  player,
  formatName,
  rankingsSourceName,
  valueSourceName,
}: {
  player: FaabPlayer;
  formatName: string;
  rankingsSourceName: string | null;
  valueSourceName: string | null;
}) {
  const positionColor = positionAccent(player.position);
  return (
    <section
      aria-label="Selected player"
      className="rounded-card border border-line bg-base/60 p-4"
    >
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold uppercase tracking-wider"
            style={{
              backgroundColor: `${positionColor}22`,
              border: `1px solid ${positionColor}55`,
              color: positionColor,
            }}
          >
            {player.position}
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-ink">{player.name}</h3>
            <p className="truncate text-xs text-ink-subtle">
              {player.position}
              {player.team ? ` · ${player.team}` : ""} · {formatName}
            </p>
          </div>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Metric
          label={`${player.position} rank`}
          value={`#${player.position_rank}`}
          attribution={rankingsSourceName ?? "—"}
        />
        <Metric
          label="Overall rank"
          value={`#${player.overall_rank}`}
          attribution={rankingsSourceName ?? "—"}
        />
        <Metric
          label="Market value"
          value={
            player.value != null && player.value > 0
              ? player.value.toLocaleString()
              : "—"
          }
          attribution={valueSourceName ?? rankingsSourceName ?? "—"}
        />
      </dl>
    </section>
  );
}

function Metric({
  label,
  value,
  attribution,
}: {
  label: string;
  value: string;
  attribution: string;
}) {
  return (
    <div className="rounded-card border border-line/60 bg-surface px-3 py-2.5">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-ink">
        {value}
      </dd>
      <p className="mt-0.5 text-[10px] text-ink-subtle">via {attribution}</p>
    </div>
  );
}

/** Brand-aligned accent per offensive position. Keeps the player badge
 * scannable without inventing new colors outside the FF Beacon palette. */
function positionAccent(position: string): string {
  const pos = position.toUpperCase();
  if (pos === "QB") return "#F472B6"; // pink-400 — visually distinct from RB/WR/TE
  if (pos === "RB") return "#10B981"; // signal-success — common RB green
  if (pos === "WR") return "#22D3EE"; // brand-cyan
  if (pos === "TE") return "#F59E0B"; // signal-warning amber
  return "#A8A8B8"; // ink-muted fallback
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
