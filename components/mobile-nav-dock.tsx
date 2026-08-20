"use client";

/**
 * The small-screen section switcher: a bar of one or two controls that names
 * where you are and opens a sheet of everywhere else.
 *
 * Every section of a League Pulse league, a player profile, and The Beacon
 * Brief lives in the site navigation rail, which is where navigation belongs.
 * But the rail only exists from lg up. Below that the same rows are in the site
 * drawer, and reaching them costs opening a modal from the header, finding the
 * section, and pressing a row. That is a long way round for the thing you do
 * most on a page.
 *
 * So below the rail's breakpoint the page carries its own switcher. One control
 * takes the full width; two sit side by side and split it, which is the shape
 * the draft room uses (app/tools/on-the-clock/sidebar-sheet.tsx and
 * draft-view-sheet.tsx, the pair this generalises).
 *
 * THE BAR FOLLOWS YOU DOWN. Once you have scrolled past it, it re-attaches
 * under the site header so the sections stay one tap away, and it lets go again
 * when you scroll back to where it lives. The switch is an IntersectionObserver
 * on the bar's own slot rather than `position: sticky`, because a page shell
 * carrying `overflow-hidden` anywhere above silently turns sticky into static.
 * The slot keeps its height either way, so the page never jumps at the moment
 * it detaches.
 *
 * The rail rows remain the canonical switcher. This is the same rows reached a
 * shorter way, so nothing here is exclusive to the small layout.
 *
 * The draft room keeps its own copy of this for now: its bar is entangled with
 * the room's padding and hosts the room's panels, and it is the one surface
 * where breaking the switcher breaks a live draft.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronUp, X } from "lucide-react";
import { BottomSheet } from "@/components/bottom-sheet";
import { navIcon, type NavIconName } from "@/components/app-shell/nav-icons";

/** Where the docked bar parks: the 4.5rem site header, plus breathing room. */
const DOCK_TOP_REM = 5.5;

/**
 * The trigger line in pixels, read from the document rather than assumed to be
 * 16 per rem. The bar's own `top` is in rem, so it scales with the reader's
 * font size, and a hardcoded 88px would leave a band, on exactly the setups
 * this product exists for, where the bar has slid under the header and not yet
 * docked.
 */
function dockTopPx(): number {
  if (typeof window === "undefined") return DOCK_TOP_REM * 16;
  const root = parseFloat(window.getComputedStyle(document.documentElement).fontSize);
  return DOCK_TOP_REM * (Number.isFinite(root) && root > 0 ? root : 16);
}

/**
 * Lines the docked bar up with where it sits in the flow. Two things pad it
 * there: the page shell (px-4 / sm:px-6 / lg:px-8) and, from lg, the navigation
 * rail, whose width is whatever the reader last set it to.
 *
 * The rail term only matters for a dock that stays visible at lg or wider. A
 * `lg:hidden` dock never meets the rail, and passing it a different inset is
 * what `insetClass` is for.
 */
export const DOCK_INSET_PAGE = "px-4 sm:px-6 lg:pr-8 lg:pl-[calc(var(--app-rail-w)+2rem)]";

export type DockItem = {
  id: string;
  label: string;
  /** One plain line under the label, and the tail of its accessible name. */
  hint?: string;
  icon?: NavIconName;
  href: string;
};

export type DockMenu = {
  /** Stable key, and the id of the sheet that belongs to this control. */
  key: string;
  /** Small word above the current value on the bar, e.g. "Section". */
  eyebrow: string;
  /** What the bar reads right now: the section you are on. */
  currentLabel: string;
  /** Heading of the sheet this control opens. */
  heading: string;
  /** One line naming what is inside, so the control's accessible name says
   *  what opening it gets you rather than just "Section, button". */
  summary?: string;
  icon: NavIconName;
  /** The rows. Omit when passing `content` instead. */
  items?: DockItem[];
  /** Which row is the current one. */
  activeId?: string;
  /** Arbitrary sheet body, for a menu whose contents are not a flat list.
   *  Ignored when `items` is given. */
  content?: ReactNode;
};

export function MobileNavDock({
  menus,
  hideAboveClass = "lg:hidden",
  insetClass = DOCK_INSET_PAGE,
  className = "",
}: {
  /** One control, or two. One takes the full width; two split it. */
  menus: DockMenu[];
  /** Where the rail takes over and this bar stops existing. */
  hideAboveClass?: string;
  /** Horizontal inset for the docked state, matching the page's own padding. */
  insetClass?: string;
  /** Extra classes on the slot, for spacing against what follows. */
  className?: string;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [docked, setDocked] = useState(false);
  const slotRef = useRef<HTMLDivElement>(null);
  const baseId = useId();

  // The page changed underneath: the sheet has done its job. Rows also close it
  // on tap, which is what covers the sections that differ only by query string,
  // where the pathname never changes. Reading useSearchParams here instead
  // would drag a Suspense requirement onto every page that mounts this.
  // BottomSheet returns focus to the control that opened it as it closes.
  const pathname = usePathname();
  useEffect(() => {
    setOpenKey(null);
  }, [pathname]);

  useEffect(() => {
    const slot = slotRef.current;
    if (!slot || typeof IntersectionObserver === "undefined") return;
    const trigger = dockTopPx();
    const observer = new IntersectionObserver(
      ([entry]) => {
        const box = entry.boundingClientRect;
        // Three things have to be true. The slot is not intersecting; it left
        // through the TOP rather than being below the fold (that is the other
        // way to not intersect); and it is actually laid out, because above the
        // breakpoint the slot is display:none, and a hidden element reports a
        // zero box that otherwise reads as "scrolled past".
        setDocked(!entry.isIntersecting && box.height > 0 && box.top < trigger);
      },
      { rootMargin: `-${trigger}px 0px 0px 0px`, threshold: 0 },
    );
    observer.observe(slot);
    return () => observer.disconnect();
  }, []);

  /**
   * Keep focus out from under the docked bar.
   *
   * When the browser scrolls a newly focused control into view it honours
   * scroll-padding on the scrolling element, so one declaration covers every
   * link and control on the page below. 8.5rem is the bar's bottom edge (5.5rem
   * top plus its 3rem height), which also clears the 4.5rem site header
   * underneath it. It lasts exactly as long as the bar is docked.
   *
   * WCAG 2.2 AA, 2.4.11 Focus Not Obscured (Minimum).
   */
  useEffect(() => {
    if (!docked) return;
    const root = document.documentElement;
    const previous = root.style.scrollPaddingTop;
    root.style.scrollPaddingTop = "8.5rem";
    return () => {
      root.style.scrollPaddingTop = previous;
    };
  }, [docked]);

  if (menus.length === 0) return null;

  return (
    <div className={hideAboveClass}>
      {/* The slot holds the bar's height at all times, so detaching it does not
          pull the page up by 3rem under whoever is reading. */}
      <div ref={slotRef} className={`h-12 ${className}`}>
        <div
          className={docked ? `fixed inset-x-0 z-20 ${insetClass}` : "relative"}
          style={docked ? { top: `${DOCK_TOP_REM}rem` } : undefined}
        >
          <div className="flex items-stretch gap-2">
            {menus.map((menu) => {
              const Icon = navIcon(menu.icon);
              return (
                <button
                  key={menu.key}
                  type="button"
                  onClick={() => setOpenKey(menu.key)}
                  // aria-haspopup="dialog" and nothing else. aria-expanded is a
                  // disclosure property, and this content does not expand in
                  // place; it opens a modal and takes focus with it. Screen
                  // readers announce "collapsed" on a trigger that carries it,
                  // which is a promise about layout this button does not keep.
                  aria-haspopup="dialog"
                  aria-label={`${menu.eyebrow}: ${menu.currentLabel}.${
                    menu.summary ? ` ${menu.summary}` : ""
                  } Change ${menu.eyebrow.toLowerCase()}.`}
                  className="relative flex h-12 min-w-0 flex-1 items-center gap-2.5 overflow-hidden rounded-card border border-line-accent bg-surface-elevated px-4 text-left shadow-lg shadow-black/40 transition-colors hover:border-brand-cyan/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                  style={{
                    backgroundImage:
                      "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.14) 0%, transparent 60%), radial-gradient(ellipse at 100% 100%, rgba(34, 211, 238, 0.12) 0%, transparent 60%)",
                  }}
                >
                  {/* Beacon hairline, matching the site's other elevated surfaces. */}
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 top-0 h-px"
                    style={{
                      backgroundImage:
                        "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
                    }}
                  />
                  <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-cyan" />
                  <span aria-hidden="true" className="min-w-0 flex-1 truncate">
                    <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-ink-muted">
                      {menu.eyebrow}
                    </span>
                    <span className="block truncate text-sm font-semibold leading-tight text-ink">
                      {menu.currentLabel}
                    </span>
                  </span>
                  <ChevronUp aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-muted" />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {menus.map((menu) => {
        const headingId = `${baseId}-${menu.key}`;
        return (
          <BottomSheet
            key={menu.key}
            open={openKey === menu.key}
            onClose={() => setOpenKey(null)}
            label={menu.heading}
            labelledBy={headingId}
            hideAboveClass={hideAboveClass}
            showClose={false}
          >
            <div className="flex items-center justify-between gap-3 px-4 pb-1 pt-3">
              <div className="min-w-0">
                <h2
                  id={headingId}
                  className="text-lg font-semibold tracking-tight text-ink"
                >
                  {menu.heading}
                </h2>
                {menu.summary && (
                  // Hidden from assistive tech on purpose: it is the middle of
                  // the trigger's accessible name, so a screen-reader user heard
                  // this exact sentence one keystroke ago. It stays visible
                  // because a sighted user did not.
                  <p aria-hidden="true" className="text-xs text-ink-muted">
                    {menu.summary}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setOpenKey(null)}
                aria-label={`Close ${menu.heading}`}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line text-ink-muted transition-colors hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>

            {menu.items ? (
              <nav aria-label={menu.heading} className="px-3 pb-4 pt-2">
                <ul className="space-y-2">
                  {menu.items.map((item) => {
                    const RowIcon = item.icon ? navIcon(item.icon) : null;
                    const isActive = item.id === menu.activeId;
                    return (
                      <li key={item.id}>
                        <Link
                          href={item.href}
                          onClick={() => setOpenKey(null)}
                          aria-current={isActive ? "page" : undefined}
                          className={`flex min-h-[3.25rem] w-full items-center gap-3 rounded-card border px-3 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                            isActive
                              ? "border-brand-cyan/40 bg-brand-cyan/10"
                              : "border-line bg-base/60 hover:border-line-accent"
                          }`}
                        >
                          {RowIcon && (
                            <span
                              aria-hidden="true"
                              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-card border ${
                                isActive
                                  ? "border-brand-cyan/40 text-brand-cyan"
                                  : "border-line text-ink-muted"
                              }`}
                            >
                              <RowIcon className="h-[18px] w-[18px]" />
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span
                              className={`block text-sm font-semibold ${
                                isActive ? "text-brand-cyan" : "text-ink"
                              }`}
                            >
                              {item.label}
                            </span>
                            {item.hint && (
                              <span className="block text-xs text-ink-muted">{item.hint}</span>
                            )}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            ) : (
              <div className="px-4 pb-4 pt-2">{menu.content}</div>
            )}
          </BottomSheet>
        );
      })}
    </div>
  );
}
