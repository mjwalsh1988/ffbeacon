"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { Route } from "next";
import { ChevronDown } from "lucide-react";
import type { NavChild } from "@/lib/site";

/**
 * Desktop primary-nav dropdown built as a WAI-ARIA disclosure (a button that
 * toggles a list of links), not a `menu`/`menuitem` widget. These are plain
 * navigation links, so the disclosure pattern is the correct, most robust
 * choice for screen readers.
 *
 * Interaction model:
 * - Mouse: hover opens, leaving closes. Click toggles.
 * - Keyboard: ArrowDown/Enter/Space open and focus the first item, ArrowUp
 *   opens and focuses the last. Inside the menu, Arrow keys move between
 *   items, Home/End jump to the ends, Escape closes and returns focus to the
 *   trigger, and Tab closes so focus continues naturally to the next control.
 * - Pointerdown outside, or a route change, closes the menu.
 */
export function NavDropdown({
  label,
  href,
  items,
}: {
  label: string;
  href: Route;
  items: NavChild[];
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuId = useId();

  // Hover open/close with a short grace period. Closing on a timer (rather than
  // instantly on mouseleave) keeps the menu open across the small travel gap
  // between the trigger and the panel, and tolerates a brief overshoot, so the
  // user doesn't have to re-hover "Tools" to reach the items.
  const cancelClose = () => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const openNow = () => {
    cancelClose();
    setOpen(true);
  };
  const closeSoon = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 140);
  };

  // Clear any pending close timer on unmount.
  useEffect(() => cancelClose, []);

  const isActive = (h: string) =>
    pathname === h || (pathname?.startsWith(`${h}/`) ?? false);
  const active = isActive(href) || items.some((item) => isActive(item.href));

  // Collapse after a navigation completes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Collapse when the user interacts anywhere outside the dropdown.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const focusItemAt = (index: number) => {
    const links = containerRef.current?.querySelectorAll<HTMLAnchorElement>(
      "[data-nav-dropdown-item]",
    );
    if (!links || links.length === 0) return;
    const next = (index + links.length) % links.length;
    links[next]?.focus();
  };

  const openAndFocus = (index: number) => {
    cancelClose();
    setOpen(true);
    // The menu mounts in this same commit; wait a frame before moving focus.
    requestAnimationFrame(() => focusItemAt(index));
  };

  const onButtonKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openAndFocus(0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openAndFocus(-1);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  const onItemKeyDown = (
    event: React.KeyboardEvent<HTMLAnchorElement>,
    index: number,
  ) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusItemAt(index + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusItemAt(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusItemAt(0);
        break;
      case "End":
        event.preventDefault();
        focusItemAt(-1);
        break;
      case "Escape":
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
        break;
      case "Tab":
        // Let focus leave naturally, but don't leave an orphaned open menu.
        setOpen(false);
        break;
    }
  };

  // The overview link sits at index 0, children follow in order.
  const overview: NavChild = {
    label: "All tools",
    href,
    description: "See every tool on one page",
  };
  const entries = [overview, ...items];

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseEnter={openNow}
      onMouseLeave={closeSoon}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        aria-current={active ? "page" : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={onButtonKeyDown}
        className={`inline-flex items-center gap-1 rounded-card px-3 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
          active
            ? "bg-surface text-ink"
            : "text-ink-muted hover:bg-surface hover:text-ink"
        }`}
      >
        {label}
        <ChevronDown
          aria-hidden="true"
          className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          id={menuId}
          // Outer wrapper sits flush against the trigger (top-full) and uses
          // top padding instead of margin so the visual gap stays part of the
          // hoverable area. This removes the dead zone that closed the menu
          // mid-travel. The inner div carries the visible panel styling.
          className="absolute left-0 top-full z-40 w-72 pt-1"
        >
          <div className="rounded-card border border-line bg-surface-elevated p-2 shadow-lg">
          <ul role="list" className="flex flex-col gap-0.5">
            {entries.map((entry, index) => {
              const entryActive = isActive(entry.href);
              return (
                <li key={entry.href}>
                  <Link
                    href={entry.href}
                    data-nav-dropdown-item
                    aria-current={entryActive ? "page" : undefined}
                    onKeyDown={(event) => onItemKeyDown(event, index)}
                    className={`block rounded-card px-3 py-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                      entryActive
                        ? "bg-surface text-ink"
                        : "text-ink-muted hover:bg-surface hover:text-ink"
                    }`}
                  >
                    <span className="block text-sm font-medium text-ink">
                      {entry.label}
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-ink-subtle">
                      {entry.description}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          </div>
        </div>
      )}
    </div>
  );
}
