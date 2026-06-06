"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, ChevronDown, Search } from "lucide-react";
import { humanizeLeagueStatus } from "@/lib/league-status";

/**
 * One row in the switcher list. Mirrors the subset of a Sleeper league the
 * dropdown needs to render and link out. Defined here (not in the data lib)
 * so the lib can type-import it without pulling this client module into a
 * server bundle.
 */
export type SwitcherLeague = {
  sleeperLeagueId: string;
  name: string;
  status: string | null;
  totalRosters: number | null;
  season: string;
};

/**
 * In-view league switcher for the deep view. Lists the *other* leagues the
 * originally-searched Sleeper user belongs to (same season) so they can hop
 * between leagues without bouncing back to /tools/league-pulse for a fresh
 * search. Each entry navigates to that league's deep view, forwarding the same
 * ?username=/?name= the entry point uses so the team chips default correctly
 * and the title is right on first paint.
 *
 * Two presentations, one trigger look:
 * - Mobile (< sm): a real, transparent <select> overlaid on the styled button
 *   so tapping opens the device's NATIVE picker (iOS wheel, Android list).
 *   Best-integrated mobile UX while keeping the custom button visual.
 * - Desktop (>= sm): a custom disclosure dropdown (button + aria-controls
 *   region) with a filter textbox for users in many leagues. Escape closes and
 *   restores focus to the trigger; an outside click closes silently.
 */
export function LeagueSwitcher({
  leagues,
  searchedUsername,
}: {
  leagues: SwitcherLeague[];
  searchedUsername: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const listLabelId = useId();

  const showFilter = leagues.length > 6;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return leagues;
    return leagues.filter((l) => l.name.toLowerCase().includes(q));
  }, [leagues, query]);

  useEffect(() => {
    if (!open) return;
    // Move focus into the panel on open: the filter input when present,
    // otherwise the first league link.
    const raf = requestAnimationFrame(() => {
      if (inputRef.current) inputRef.current.focus();
      else panelRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    });
    const onDocClick = (e: MouseEvent) => {
      if (
        !triggerRef.current?.contains(e.target as Node) &&
        !panelRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (leagues.length === 0) return null;

  const hrefFor = (l: SwitcherLeague): string => {
    const params = new URLSearchParams();
    params.set("tab", "teams");
    if (searchedUsername) params.set("username", searchedUsername);
    params.set("name", l.name);
    return `/leagues/${l.sleeperLeagueId}?${params.toString()}`;
  };

  // Shared trigger visual so mobile and desktop look identical.
  const triggerClasses =
    "inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-3 py-2 text-sm font-medium text-ink";

  return (
    <>
      {/* Mobile: native picker behind the custom-looking button. Stretches to
          fill its grid cell so it shares the top action row with Copy link. */}
      <div className="relative sm:hidden">
        <div
          aria-hidden="true"
          className={`${triggerClasses} pointer-events-none w-full justify-between`}
        >
          <span className="inline-flex items-center gap-1.5">
            <ArrowLeftRight className="h-4 w-4" />
            <span>Switch league</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-ink-subtle" />
        </div>
        <select
          aria-label="Switch to another league"
          value=""
          onChange={(e) => {
            const target = leagues.find(
              (l) => l.sleeperLeagueId === e.target.value,
            );
            if (target) router.push(hrefFor(target));
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        >
          <option value="" disabled>
            Switch league
          </option>
          {leagues.map((l) => (
            <option key={l.sleeperLeagueId} value={l.sleeperLeagueId}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      {/* Desktop: custom disclosure dropdown. */}
      <div className="relative hidden sm:block">
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="true"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((p) => !p)}
          className={`${triggerClasses} transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan`}
        >
          <ArrowLeftRight aria-hidden="true" className="h-4 w-4" />
          <span>Switch league</span>
          <ChevronDown
            aria-hidden="true"
            className={`h-3.5 w-3.5 text-ink-subtle transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>

        {open && (
          <div
            ref={panelRef}
            id={panelId}
            className="absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-card border border-line bg-surface-elevated shadow-2xl"
          >
            <div className="border-b border-line p-3">
              <p id={listLabelId} className="mb-2 text-xs text-ink-muted">
                {searchedUsername ? (
                  <>
                    Other leagues for{" "}
                    <span className="font-medium text-ink">
                      @{searchedUsername}
                    </span>
                  </>
                ) : (
                  "Your other leagues"
                )}
              </p>
              {showFilter && (
                <div className="relative">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle"
                  />
                  <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Filter leagues"
                    aria-label="Filter leagues by name"
                    className="w-full rounded-card border border-line bg-base py-2 pl-8 pr-3 text-sm text-ink placeholder:text-ink-subtle focus:border-brand-cyan focus:outline-none"
                  />
                </div>
              )}
            </div>
            <ul
              role="list"
              aria-labelledby={listLabelId}
              className="max-h-72 overflow-y-auto py-1"
            >
              {filtered.length === 0 ? (
                <li className="px-3 py-3 text-sm text-ink-muted">
                  No leagues match "{query}".
                </li>
              ) : (
                filtered.map((l) => (
                  <li key={l.sleeperLeagueId}>
                    <Link
                      href={hrefFor(l)}
                      onClick={() => setOpen(false)}
                      className="block px-3 py-2.5 hover:bg-surface focus:bg-surface focus:outline-none"
                    >
                      <span className="block truncate text-sm font-medium text-ink">
                        {l.name}
                      </span>
                      <span className="mt-0.5 block text-xs text-ink-subtle">
                        {l.season}, {l.totalRosters ?? "?"} teams
                        {l.status ? `, ${humanizeLeagueStatus(l.status)}` : ""}
                      </span>
                    </Link>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
