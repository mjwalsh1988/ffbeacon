"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeftRight,
  ArrowRight,
  BarChart3,
  Loader2,
  Search,
  Trophy,
  X,
} from "lucide-react";
import { PlayerHeadshot } from "@/components/player-headshot";

const FETCH_HEADERS = { "x-requested-with": "ff-beacon" } as const;
const MIN_LENGTH = 2;

export type PickedPlayer = {
  slug: string;
  name: string;
  position: string | null;
  team: string | null;
  sleeperId: string | null;
};

type SearchResult = PickedPlayer & { playerId: string };

/**
 * The Beacon Breakdown player selector. Two accessible player comboboxes plus a
 * "Run Breakdown" action that navigates to ?a=<slug>&b=<slug>, preserving the
 * current format/source params so the resulting matchup is a shareable URL.
 * Pre-fills from the already-selected players when the page is loaded with a
 * matchup (edit-in-place).
 */
export function BreakdownSelector({
  initialA = null,
  initialB = null,
  formatDisplay,
  sourceDisplay,
  compact = false,
}: {
  initialA?: PickedPlayer | null;
  initialB?: PickedPlayer | null;
  formatDisplay: string;
  sourceDisplay: string | null;
  /** When true the selector renders as a slim "edit matchup" bar (used above an
   * existing result) instead of the full hero card. */
  compact?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [playerA, setPlayerA] = useState<PickedPlayer | null>(initialA);
  const [playerB, setPlayerB] = useState<PickedPlayer | null>(initialB);

  const samePlayer = Boolean(playerA && playerB && playerA.slug === playerB.slug);
  const canRun = Boolean(playerA && playerB) && !samePlayer;

  const run = useCallback(() => {
    if (!playerA || !playerB || samePlayer) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("a", playerA.slug);
    params.set("b", playerB.slug);
    startTransition(() => {
      router.push(`/tools/beacon-breakdown?${params.toString()}`);
    });
  }, [playerA, playerB, samePlayer, router, searchParams]);

  const swap = useCallback(() => {
    setPlayerA(playerB);
    setPlayerB(playerA);
  }, [playerA, playerB]);

  return (
    <div
      className={
        compact
          ? "rounded-modal border border-line bg-surface/60 p-4 sm:p-5"
          : "relative rounded-modal border border-line bg-surface p-5 sm:p-7"
      }
      style={
        compact
          ? undefined
          : { boxShadow: "0 0 64px -44px rgba(168, 85, 247, 0.6)" }
      }
    >
      {!compact && (
        <span
          aria-hidden="true"
          className="absolute inset-x-6 top-0 h-px"
          style={{
            backgroundImage:
              "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
          }}
        />
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ContextChip icon={Trophy} label="Format" value={formatDisplay} tone="purple" />
        <ContextChip icon={BarChart3} label="Values" value={sourceDisplay ?? "-"} tone="cyan" />
        <p className="ml-auto text-[11px] text-ink-subtle">
          Change format or source from the site header.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-start">
        <PlayerPicker
          label="Player A"
          accent="purple"
          selected={playerA}
          onSelect={setPlayerA}
          otherSlug={playerB?.slug ?? null}
        />

        <div className="flex items-center justify-center sm:pt-8">
          <button
            type="button"
            onClick={swap}
            disabled={!playerA && !playerB}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-line bg-base text-ink-muted transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Swap Player A and Player B"
            title="Swap players"
          >
            <ArrowLeftRight aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        <PlayerPicker
          label="Player B"
          accent="cyan"
          selected={playerB}
          onSelect={setPlayerB}
          otherSlug={playerA?.slug ?? null}
        />
      </div>

      {samePlayer && (
        <p role="alert" className="mt-3 text-sm text-signal-warning">
          Pick two different players to run a breakdown.
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={!canRun || isPending}
          className="inline-flex min-h-11 items-center gap-2 rounded-card bg-beacon px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isPending ? (
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          ) : (
            <BarChart3 aria-hidden="true" className="h-4 w-4" />
          )}
          {compact ? "Update Breakdown" : "Run Breakdown"}
          {!isPending && <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />}
        </button>
        {!canRun && !samePlayer && (
          <p className="text-sm text-ink-subtle">
            Select two players to see who has the edge.
          </p>
        )}
      </div>
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
      ? { bg: "rgba(34, 211, 238, 0.08)", border: "rgba(34, 211, 238, 0.30)", icon: "#22D3EE" }
      : { bg: "rgba(168, 85, 247, 0.08)", border: "rgba(168, 85, 247, 0.30)", icon: "#A855F7" };
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs"
      style={{ backgroundColor: palette.bg, borderColor: palette.border }}
    >
      <Icon className="h-3.5 w-3.5" style={{ color: palette.icon }} aria-hidden="true" />
      <span className="font-semibold uppercase tracking-[0.14em] text-ink-subtle">{label}</span>
      <span className="font-semibold text-ink">{value}</span>
    </span>
  );
}

/**
 * One accessible player combobox (WAI-ARIA combobox-with-listbox). Debounced
 * server search against /api/breakdown/search. Once a player is chosen it
 * collapses to a compact selected-player chip with a clear button.
 */
function PlayerPicker({
  label,
  accent,
  selected,
  onSelect,
  otherSlug,
}: {
  label: string;
  accent: "purple" | "cyan";
  selected: PickedPlayer | null;
  onSelect: (p: PickedPlayer | null) => void;
  /** The slug picked on the other side, greyed out to avoid A === B. */
  otherSlug: string | null;
}) {
  const inputId = useId();
  const listboxId = useId();
  const statusId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  const trimmed = query.trim();
  const longEnough = trimmed.length >= MIN_LENGTH;

  const accentRing =
    accent === "purple"
      ? "focus:border-brand-purple focus:ring-brand-purple/30 caret-brand-purple"
      : "focus:border-brand-cyan focus:ring-brand-cyan/30 caret-brand-cyan";

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
      onSelect({
        slug: r.slug,
        name: r.name,
        position: r.position,
        team: r.team,
        sleeperId: r.sleeperId,
      });
      setQuery("");
      setResults([]);
      setOpen(false);
      inputRef.current?.blur();
    },
    [onSelect],
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
      if (open && results[activeIdx]) {
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

  const showList = open && longEnough;
  const statusText = !longEnough
    ? ""
    : loading
      ? "Searching for players"
      : results.length === 0
        ? "No players found"
        : `${results.length} player${results.length === 1 ? "" : "s"} found`;

  if (selected) {
    return (
      <div>
        <p className="mb-2 text-sm font-medium text-ink">{label}</p>
        <SelectedChip
          player={selected}
          accent={accent}
          onClear={() => {
            onSelect(null);
            setQuery("");
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
        />
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="relative">
      <label htmlFor={inputId} className="mb-2 block text-sm font-medium text-ink">
        {label}
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
          aria-describedby={statusId}
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
          className={`w-full rounded-card border border-line bg-base py-2.5 pl-9 pr-3 text-[16px] text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 sm:text-sm ${accentRing}`}
        />
      </div>

      <p id={statusId} className="sr-only" role="status" aria-live="polite">
        {statusText}
      </p>

      {showList && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={`${label} suggestions`}
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
              const isOther = otherSlug != null && r.slug === otherSlug;
              return (
                <li
                  key={r.slug}
                  id={`${listboxId}-opt-${i}`}
                  role="option"
                  aria-selected={isActive}
                  aria-disabled={isOther || undefined}
                  onMouseEnter={() => setActiveIdx(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (!isOther) commit(r);
                  }}
                  className={`flex items-center gap-3 px-3 py-2 text-sm motion-safe:transition-colors ${
                    isOther
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
                  {isOther && (
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

function SelectedChip({
  player,
  accent,
  onClear,
}: {
  player: PickedPlayer;
  accent: "purple" | "cyan";
  onClear: () => void;
}) {
  const edge = accent === "purple" ? "#A855F7" : "#22D3EE";
  return (
    <div className="relative flex items-center gap-3 overflow-hidden rounded-card border border-line bg-base/60 p-3">
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: edge }}
      />
      <PlayerHeadshot sleeperId={player.sleeperId} name="" size={40} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{player.name}</p>
        <p className="truncate text-xs text-ink-subtle">
          {player.position}
          {player.team ? `, ${player.team}` : ""}
        </p>
      </div>
      <button
        type="button"
        onClick={onClear}
        aria-label={`Remove ${player.name}`}
        title="Remove"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-card text-ink-muted transition-colors hover:bg-line/40 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  );
}
