"use client";

/**
 * The League Pulse rail: the section nav for a single league, running the full
 * height of the viewport beside the dashboard. Icon-only by default so the
 * content gets the width; the toggle at the top widens it to show labels, and
 * that choice is remembered per browser.
 *
 * Desktop only (lg and up). Below that the same sections come from
 * league-mobile-nav.tsx, which puts them in a slide-up sheet. Nothing is
 * dropped on the small layout, only relocated.
 *
 * These are links to different routes, not in-place tabs, so the markup is
 * <nav> + <Link aria-current="page">, never a tablist. Collapsed labels stay in
 * the DOM as sr-only text, so the accessible name of each link is the full
 * section name whether or not it is painted.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { LEAGUE_NAV_ITEMS, leagueTabHref, type LeagueTabId } from "./nav-items";

const STORAGE_KEY = "ffbeacon:league-rail-expanded";

export function LeagueSideNav({
  sleeperLeagueId,
  activeTab,
  searchedUsername,
}: {
  sleeperLeagueId: string;
  activeTab: LeagueTabId;
  searchedUsername: string | null;
}) {
  // Collapsed is the default, and it is also what the server renders. Reading
  // localStorage in an effect keeps the first paint identical on both sides so
  // React never has a hydration mismatch to reconcile.
  const [expanded, setExpanded] = useState(false);
  // The width only animates once the remembered state has been applied.
  // Without this the rail visibly slid open on every page load for anyone who
  // had expanded it, because that first change is a restore, not a toggle.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      setExpanded(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // Private mode or blocked storage: stay collapsed, still fully usable.
    }
    setMounted(true);
  }, []);

  const toggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Nothing to do; the state still applies for this page view.
      }
      return next;
    });
  }, []);

  const ToggleIcon = expanded ? PanelLeftClose : PanelLeftOpen;

  return (
    <aside
      id="league-rail"
      // `self-start` is load-bearing: a flex child stretches by default, and a
      // stretched item can never be sticky.
      className={`sticky top-[4.5rem] hidden h-[calc(100dvh-4.5rem)] shrink-0 self-start border-r border-line bg-surface/50 lg:flex lg:flex-col ${
        mounted ? "transition-[width] duration-200 motion-reduce:transition-none" : ""
      } ${expanded ? "w-60" : "w-[4.5rem]"}`}
    >
      <div
        className={`flex h-14 shrink-0 items-center border-b border-line/70 px-3 ${
          expanded ? "justify-between" : "justify-center"
        }`}
      >
        {expanded && (
          <p className="truncate text-[10px] font-bold uppercase tracking-[0.18em] text-brand-cyan">
            League Pulse
          </p>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          aria-controls="league-rail"
          className="flex h-9 w-9 items-center justify-center rounded-card border border-line bg-base/60 text-ink-muted transition-colors hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <ToggleIcon aria-hidden="true" className="h-4 w-4" />
          <span className="sr-only">
            {expanded ? "Collapse the league menu" : "Expand the league menu"}
          </span>
        </button>
      </div>

      <nav
        aria-label="League sections"
        className="beacon-scroll flex-1 overflow-y-auto p-2"
      >
        <ul className="space-y-1">
          {LEAGUE_NAV_ITEMS.map((item) => {
            const isActive = item.id === activeTab;
            const Icon = item.icon;
            return (
              <li key={item.id}>
                <Link
                  href={leagueTabHref(sleeperLeagueId, item.id, searchedUsername)}
                  aria-current={isActive ? "page" : undefined}
                  title={expanded ? undefined : item.label}
                  className={`group relative flex h-11 items-center gap-3 rounded-card border px-2.5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                    expanded ? "" : "justify-center"
                  } ${
                    isActive
                      ? "border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan"
                      : "border-transparent text-ink-muted hover:bg-base/70 hover:text-ink"
                  }`}
                >
                  {/* Left accent bar on the current section. Decorative: the
                      state is already carried by aria-current and the label. */}
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-brand-cyan"
                    />
                  )}
                  <Icon aria-hidden="true" className="h-[18px] w-[18px] shrink-0" />
                  <span className={expanded ? "truncate" : "sr-only"}>{item.label}</span>
                  {item.isNew && (
                    <span
                      className={
                        expanded
                          ? "ml-auto rounded-full bg-beacon px-1.5 py-px text-[9px] font-extrabold uppercase tracking-[0.1em] text-black"
                          : "sr-only"
                      }
                    >
                      New
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
