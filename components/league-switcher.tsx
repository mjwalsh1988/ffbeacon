"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, ChevronDown, Search } from "lucide-react";
import { LeagueLogo } from "@/components/league-logo";
import { humanizeLeagueStatus } from "@/lib/league-status";
import {
  viewerLinkUsername,
  type SleeperViewer,
} from "@/lib/sleeper-handle/types";

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
  /** Sleeper's avatar id, straight off the live payload. Null for the many
   *  leagues that never set one; the logo renders its placeholder. */
  avatar: string | null;
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
 *
 * THE MOBILE PICKER SHOWS NO LOGO, AND THAT IS DELIBERATE. A native <option>
 * cannot carry an image, and the native picker is here precisely because it IS
 * the accessibility feature on a phone: the platform wheel, the platform
 * keyboard behaviour, the platform screen reader. Swapping it for a styled list
 * to gain a decorative image would trade a real affordance for a picture. This
 * is the one place on the site where a league list shows a logo at one
 * breakpoint and not another (D12), and nothing a reader can ACT on is missing:
 * every league's name is in both presentations.
 *
 * The desktop panel is PORTALED to document.body and positioned fixed against
 * the trigger, rather than being absolutely positioned inside the trigger's
 * container. Every deep-view surface wraps its actions in
 * `<header class="relative overflow-hidden">` (the overflow contains the
 * decorative beacon hairline), and an absolutely positioned panel inside that
 * header gets clipped to the header's ~93px height: the label and filter box
 * showed, and the entire league list was cut off. Portaling makes the panel
 * immune to any ancestor's overflow, now or later.
 */
export function LeagueSwitcher({
  leagues,
  viewer,
}: {
  leagues: SwitcherLeague[];
  /** Who the page is acting for. Names the list, and decides whether the row
   *  hrefs carry `?username=` (only for a reader who arrived on one). */
  viewer: SleeperViewer | null;
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
  // Panel geometry, measured from the trigger. Null until the first measure so
  // the portal never paints in the wrong place for a frame.
  const [anchor, setAnchor] = useState<{
    top: number;
    right: number;
    maxHeight: number;
  } | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return leagues;
    return leagues.filter((l) => l.name.toLowerCase().includes(q));
  }, [leagues, query]);

  /**
   * Anchor the fixed panel under the trigger, clamped to the viewport. Returns
   * false when the trigger has scrolled out of view, which tells the caller to
   * close: a menu still floating after its button has gone is worse than no
   * menu, and the deep-view header does not stick.
   */
  const measure = useCallback((): boolean => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return true;
    if (rect.bottom < 0 || rect.top > window.innerHeight) return false;

    const GAP = 8;
    const MARGIN = 16;
    const top = rect.bottom + GAP;
    setAnchor({
      top,
      right: Math.max(MARGIN, window.innerWidth - rect.right),
      // Never run off the bottom of the screen; the list scrolls instead.
      maxHeight: Math.max(160, window.innerHeight - top - MARGIN),
    });
    return true;
  }, []);

  useEffect(() => {
    if (!open) return;
    measure();

    const onViewportChange = (event: Event) => {
      // Capture-phase scroll sees EVERY scroll on the page, including the
      // league list's own overflow container. Scrolling the list must not move
      // or close the panel it lives in.
      if (event.type === "scroll" && panelRef.current?.contains(event.target as Node)) {
        return;
      }
      if (!measure()) {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    return () => {
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [open, measure]);

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

  // Only a reader who arrived on ?username= carries it onward. A reader on
  // their own saved identity hops between leagues on clean URLs and still
  // lands on their own team, because the deep view matches the Sleeper user
  // id their saved identity carries.
  const linkUsername = viewerLinkUsername(viewer);

  const hrefFor = (l: SwitcherLeague): string => {
    const params = new URLSearchParams();
    params.set("tab", "teams");
    if (linkUsername) params.set("username", linkUsername);
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

        {open &&
          anchor &&
          createPortal(
          <div
            ref={panelRef}
            id={panelId}
            style={{ top: anchor.top, right: anchor.right, maxHeight: anchor.maxHeight }}
            className="fixed z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-card border border-line bg-surface-elevated shadow-2xl"
          >
            <div className="shrink-0 border-b border-line p-3">
              <p id={listLabelId} className="mb-2 text-xs text-ink-muted">
                {viewer ? (
                  <>
                    Other leagues for{" "}
                    <span className="font-medium text-ink">
                      @{viewer.username}
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
            {/* The panel's own maxHeight bounds the list, so this scrolls
                within whatever space the viewport actually leaves. */}
            <ul
              role="list"
              aria-labelledby={listLabelId}
              className="min-h-0 flex-1 overflow-y-auto py-1"
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
                      className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-surface focus:bg-surface focus:outline-none"
                    >
                      <LeagueLogo avatarId={l.avatar} name={l.name} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">
                          {l.name}
                        </span>
                        <span className="mt-0.5 block text-xs text-ink-subtle">
                          {l.season}, {l.totalRosters ?? "?"} teams
                          {l.status ? `, ${humanizeLeagueStatus(l.status)}` : ""}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))
              )}
            </ul>
          </div>,
            document.body,
          )}
      </div>
    </>
  );
}
